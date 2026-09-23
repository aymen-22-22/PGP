import { Injectable } from '@nestjs/common';
import {
  AllocationMethod,
  CostDocumentStatus,
  CostScope,
  Prisma,
} from '@prisma/client';
import { ErrorCode, add } from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { BusinessError } from '../common/errors/business.error';
import { DocumentNumberService } from '../common/services/document-number.service';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { allocate, type AllocationTarget } from './allocation';
import { BASE_CURRENCY, ExchangeRateService } from './exchange-rate.service';
import { CreateCostDocumentDto, ManualAmountDto } from './dto/cost-document.dto';

@Injectable()
export class CostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: ExchangeRateService,
    private readonly numbers: DocumentNumberService,
    private readonly access: WarehouseAccessService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Creating and posting
  // -------------------------------------------------------------------------

  async create(user: RequestUser, dto: CreateCostDocumentDto) {
    const incurredAt = dto.incurredAt ? new Date(dto.incurredAt) : new Date();

    // Convert once, now, and keep the rate. Costs billed in dinars become euros
    // at the rate in force on the day they were incurred.
    const { amountBase, exchangeRate } = await this.rates.toBase(dto.amount, dto.currency, incurredAt);

    const devices = await this.resolveScope(dto);
    if (devices.length === 0) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'This cost applies to no units. Check the receipt, shipment or lot you attached it to.',
      );
    }
    this.assertAllowedWarehouses(user, devices);

    if (dto.allocation === AllocationMethod.MANUAL) {
      this.assertManualCoversDocument(dto.manualAmounts, devices, amountBase);
    }

    const document = await this.prisma.$transaction(async (tx) => {
      const number = await this.numbers.next(tx, 'LC', { deviceIds: devices.map((d) => d.id) });
      return tx.costDocument.create({
        data: {
          number,
          type: dto.type,
          description: dto.description,
          amount: dto.amount,
          currency: dto.currency,
          exchangeRate,
          amountBase,
          baseCurrency: BASE_CURRENCY,
          allocation: dto.allocation,
          scope: dto.scope,
          scopeId: dto.scopeId ?? null,
          targetDeviceIds: dto.scope === CostScope.DEVICES ? (dto.deviceIds ?? []) : [],
          lotId: dto.scope === CostScope.LOT ? dto.scopeId : null,
          incurredAt,
          createdById: user.id,
          status: CostDocumentStatus.DRAFT,
        },
      });
    });

    return dto.post === false
      ? this.findOne(user, document.id)
      : this.post(user, document.id, dto.manualAmounts);
  }

  /**
   * Spreads the document over its units and writes the ledger.
   *
   * Units already sold are included by design: the business asked that a late
   * freight or customs invoice restate history rather than fall only on
   * whatever stock happens to be left. Any sale touched is recomputed, and the
   * restatement is audited, because it changes a figure someone has read before.
   */
  async post(user: RequestUser, id: string, manualAmounts?: { deviceId: string; amount: string }[]) {
    const document = await this.prisma.costDocument.findUnique({ where: { id } });
    if (!document) throw BusinessError.notFound('Cost document', id);
    if (document.status !== CostDocumentStatus.DRAFT) {
      throw new BusinessError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `This cost document is already ${document.status.toLowerCase()}.`,
      );
    }

    const devices = await this.resolveScope({
      scope: document.scope,
      scopeId: document.scopeId ?? undefined,
      deviceIds: document.targetDeviceIds.length > 0
        ? document.targetDeviceIds
        : manualAmounts?.map((m) => m.deviceId),
    });
    if (devices.length === 0) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'This cost applies to no units.');
    }
    this.assertAllowedWarehouses(user, devices);

    if (document.allocation === AllocationMethod.MANUAL) {
      this.assertManualCoversDocument(manualAmounts, devices, document.amountBase.toString());
    }

    const targets = this.buildTargets(document.allocation, devices, manualAmounts);
    const allocations =
      document.allocation === AllocationMethod.MANUAL
        ? manualAmounts!.map((m) => ({ deviceId: m.deviceId, amount: m.amount, basis: m.amount }))
        : allocate(document.amountBase.toFixed(2), targets);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const claim = await tx.costDocument.updateMany({
          where: { id, status: CostDocumentStatus.DRAFT },
          data: { status: CostDocumentStatus.POSTED, postedAt: new Date(), postedById: user.id },
        });
        if (claim.count === 0) {
          throw BusinessError.conflict(
            ErrorCode.CONCURRENT_MODIFICATION,
            'This cost document was posted by someone else a moment ago.',
          );
        }

        await tx.costEntry.createMany({
          data: allocations.map((a) => ({
            costDocumentId: id,
            deviceId: a.deviceId,
            type: document.type,
            amount: a.amount,
            basis: a.basis,
          })),
        });

        const touched = await this.recomputeDevices(
          tx,
          allocations.map((a) => a.deviceId),
        );
        const restatedSales = await this.restateSales(
          tx,
          allocations.map((a) => a.deviceId),
        );
        await tx.costDocument.update({ where: { id }, data: { restatedSales: restatedSales.length } });

        return { devices: touched, restatedSales };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    await this.audit.log({
      userId: user.id,
      action: 'POST_COST_DOCUMENT',
      entityType: 'CostDocument',
      entityId: id,
      metadata: {
        number: document.number,
        type: document.type,
        amount: document.amount.toFixed(2),
        currency: document.currency,
        amountBase: document.amountBase.toFixed(2),
        exchangeRate: document.exchangeRate.toFixed(8),
        units: allocations.length,
        restatedSales: result.restatedSales,
      },
    });

    return this.findOne(user, id);
  }

  /**
   * Reverses a posted document by removing its entries and recomputing.
   * The document itself is kept and marked REVERSED — the audit trail must show
   * that a cost was booked and taken back, not that it never existed.
   */
  async reverse(user: RequestUser, id: string) {
    const document = await this.prisma.costDocument.findUnique({ where: { id } });
    if (!document) throw BusinessError.notFound('Cost document', id);
    if (document.status !== CostDocumentStatus.POSTED) {
      throw new BusinessError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Only a posted cost document can be reversed.',
      );
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const entries = await tx.costEntry.findMany({
          where: { costDocumentId: id },
          select: { deviceId: true },
        });
        const deviceIds = entries.map((e) => e.deviceId);

        await tx.costEntry.deleteMany({ where: { costDocumentId: id } });
        await tx.costDocument.update({
          where: { id },
          data: { status: CostDocumentStatus.REVERSED, reversedAt: new Date() },
        });

        await this.recomputeDevices(tx, deviceIds);
        const restated = await this.restateSales(tx, deviceIds);
        return { units: deviceIds.length, restated };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    await this.audit.log({
      userId: user.id,
      action: 'REVERSE_COST_DOCUMENT',
      entityType: 'CostDocument',
      entityId: id,
      metadata: { number: document.number, units: result.units, restatedSales: result.restated },
    });
    return this.findOne(user, id);
  }

  // -------------------------------------------------------------------------
  // Recomputation — the ledger is always the authority
  // -------------------------------------------------------------------------

  /** landedCost = purchaseCost + every entry against the unit. */
  private async recomputeDevices(tx: Prisma.TransactionClient, deviceIds: string[]): Promise<number> {
    if (deviceIds.length === 0) return 0;

    const sums = await tx.costEntry.groupBy({
      by: ['deviceId'],
      where: { deviceId: { in: deviceIds } },
      _sum: { amount: true },
    });
    const extraByDevice = new Map(sums.map((s) => [s.deviceId, s._sum.amount ?? new Prisma.Decimal(0)]));

    const devices = await tx.device.findMany({
      where: { id: { in: deviceIds } },
      select: { id: true, purchaseCost: true },
    });

    for (const device of devices) {
      const base = device.purchaseCost ?? new Prisma.Decimal(0);
      const extra = extraByDevice.get(device.id) ?? new Prisma.Decimal(0);
      await tx.device.update({
        where: { id: device.id },
        data: { landedCost: base.plus(extra).toDecimalPlaces(2) },
      });
    }
    return devices.length;
  }

  /** Re-adds the landed cost of every device on each affected completed sale. */
  private async restateSales(tx: Prisma.TransactionClient, deviceIds: string[]): Promise<string[]> {
    if (deviceIds.length === 0) return [];

    const affected = await tx.device.findMany({
      where: { id: { in: deviceIds }, saleId: { not: null } },
      select: { saleId: true },
      distinct: ['saleId'],
    });
    const saleIds = affected.map((a) => a.saleId!).filter(Boolean);
    if (saleIds.length === 0) return [];

    const restated: string[] = [];
    for (const saleId of saleIds) {
      const [devices, items] = await Promise.all([
        tx.device.findMany({ where: { saleId }, select: { landedCost: true } }),
        tx.saleItem.findMany({ where: { saleId }, select: { pickedCost: true } }),
      ]);
      let total = devices.reduce((sum, d) => add(sum, d.landedCost?.toFixed(2) ?? '0.00'), '0.00');
      total = items.reduce((sum, i) => add(sum, i.pickedCost?.toFixed(2) ?? '0.00'), total);
      const sale = await tx.sale.findUnique({ where: { id: saleId }, select: { totalCost: true } });
      if (sale && !sale.totalCost.equals(new Prisma.Decimal(total))) {
        await tx.sale.update({ where: { id: saleId }, data: { totalCost: total } });
        restated.push(saleId);
      }
    }
    return restated;
  }

  /**
   * Rebuilds every landed cost from the ledger. The stored figure is a
   * materialised sum, so it must be reconstructible on demand — otherwise
   * nobody can prove it is right.
   */
  async rebuildAll(user: RequestUser): Promise<{ devices: number; salesRestated: number }> {
    if (!this.access.isAdmin(user)) throw BusinessError.forbiddenWarehouse();

    const ids = await this.prisma.device.findMany({ select: { id: true } });
    const deviceIds = ids.map((d) => d.id);

    let restated = 0;
    const batchSize = 500;
    for (let i = 0; i < deviceIds.length; i += batchSize) {
      const batch = deviceIds.slice(i, i + batchSize);
      await this.prisma.$transaction(
        async (tx) => {
          await this.recomputeDevices(tx, batch);
          restated += (await this.restateSales(tx, batch)).length;
        },
        { timeout: 120_000, maxWait: 20_000 },
      );
    }

    await this.audit.log({
      userId: user.id,
      action: 'REBUILD_LANDED_COSTS',
      entityType: 'Device',
      metadata: { devices: deviceIds.length, salesRestated: restated },
    });
    return { devices: deviceIds.length, salesRestated: restated };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Turns "this receipt / shipment / lot" into the units it covers. */
  private async resolveScope(input: {
    scope: CostScope;
    scopeId?: string;
    deviceIds?: string[];
  }): Promise<{ id: string; landedCost: Prisma.Decimal | null; currentWarehouseId: string | null }[]> {
    const select = { id: true, landedCost: true, currentWarehouseId: true };

    switch (input.scope) {
      case CostScope.RECEIPT: {
        if (!input.scopeId) throw missingScope('receipt');
        const lines = await this.prisma.receiptLine.findMany({
          where: { receiptId: input.scopeId },
          select: { device: { select } },
        });
        return lines.map((l) => l.device);
      }
      case CostScope.SHIPMENT: {
        if (!input.scopeId) throw missingScope('shipment');
        // Accept either the shipment or its transfer — operators think in both.
        const shipment = await this.prisma.shipment.findFirst({
          where: { OR: [{ id: input.scopeId }, { transferId: input.scopeId }] },
          select: { transferId: true },
        });
        const transferId = shipment?.transferId ?? input.scopeId;
        const lines = await this.prisma.transferDevice.findMany({
          where: { transferId },
          select: { device: { select } },
        });
        return lines.map((l) => l.device);
      }
      case CostScope.LOT: {
        if (!input.scopeId) throw missingScope('lot');
        return this.prisma.device.findMany({ where: { lotId: input.scopeId }, select });
      }
      case CostScope.DEVICES: {
        if (!input.deviceIds?.length) throw missingScope('device list');
        return this.prisma.device.findMany({ where: { id: { in: input.deviceIds } }, select });
      }
      default:
        throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Unknown cost scope.');
    }
  }

  private buildTargets(
    method: AllocationMethod,
    devices: { id: string; landedCost: Prisma.Decimal | null }[],
    manualAmounts?: { deviceId: string; amount: string }[],
  ): AllocationTarget[] {
    if (method === AllocationMethod.MANUAL) {
      const byDevice = new Map(manualAmounts?.map((m) => [m.deviceId, m.amount]) ?? []);
      return devices.map((d) => ({
        deviceId: d.id,
        basis: BigInt(Math.round(Number(byDevice.get(d.id) ?? '0') * 10_000)),
      }));
    }
    if (method === AllocationMethod.VALUE) {
      // Weighted by what each unit is already worth, so an expensive handset
      // carries more of the customs bill than a cheap one.
      return devices.map((d) => ({
        deviceId: d.id,
        basis: BigInt(Math.round(Number(d.landedCost?.toFixed(4) ?? '0') * 10_000)),
      }));
    }
    return devices.map((d) => ({ deviceId: d.id, basis: 10_000n })); // QUANTITY
  }

  private assertManualCoversDocument(
    manualAmounts: ManualAmountDto[] | undefined,
    devices: { id: string }[],
    amountBase: string,
  ): void {
    const manual = manualAmounts ?? [];
    if (manual.length === 0) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'Manual allocation needs an amount for each unit.',
      );
    }
    const known = new Set(devices.map((d) => d.id));
    const unknown = manual.filter((m) => !known.has(m.deviceId));
    if (unknown.length > 0) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'Some manually allocated units are not covered by this cost document.',
        400,
        { deviceIds: unknown.slice(0, 20).map((u) => u.deviceId) },
      );
    }
    const sum = manual.reduce((acc, m) => add(acc, Number(m.amount).toFixed(2)), '0.00');
    if (Number(sum).toFixed(2) !== Number(amountBase).toFixed(2)) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        `Manual amounts total ${sum} but the document is ${amountBase}. They must match exactly.`,
        400,
        { allocated: sum, document: amountBase },
      );
    }
  }

  /** A warehouse user may only cost goods sitting in their own warehouse. */
  private assertAllowedWarehouses(
    user: RequestUser,
    devices: { currentWarehouseId: string | null }[],
  ): void {
    if (this.access.isAdmin(user)) return;
    const outside = devices.filter((d) => !this.access.canAccess(user, d.currentWarehouseId));
    if (outside.length > 0) {
      throw BusinessError.forbiddenWarehouse();
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findOne(user: RequestUser, id: string) {
    const document = await this.prisma.costDocument.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true } },
        postedBy: { select: { id: true, name: true } },
        lot: { select: { id: true, number: true } },
        _count: { select: { entries: true } },
      },
    });
    if (!document) throw BusinessError.notFound('Cost document', id);

    return {
      ...document,
      amount: document.amount.toFixed(2),
      amountBase: document.amountBase.toFixed(2),
      exchangeRate: document.exchangeRate.toFixed(8),
      unitCount: document._count.entries,
      unitAmount:
        document._count.entries > 0
          ? document.amountBase.dividedBy(document._count.entries).toDecimalPlaces(4).toFixed(4)
          : null,
    };
  }
}

function missingScope(what: string): BusinessError {
  return new BusinessError(ErrorCode.VALIDATION_FAILED, `Choose the ${what} this cost belongs to.`);
}
