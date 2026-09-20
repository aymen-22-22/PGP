import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode, add, fromMinor, toMinor } from '@phone-erp/shared-types';
import { BusinessError } from '../common/errors/business.error';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { BASE_CURRENCY } from './exchange-rate.service';

/**
 * The document the business asked for: when goods land, show every cost that
 * built up along the way and how the unit cost was arrived at.
 *
 * It is generated on demand rather than stored. A stored copy would be a second
 * version of the truth that a later restatement could silently contradict —
 * this always reflects the ledger as it stands, and says when it was produced.
 */
@Injectable()
export class LandedCostStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
  ) {}

  /** The statement for one arrival: the units that travelled and landed together. */
  async forReceipt(user: RequestUser, receiptId: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: {
        warehouse: { select: { id: true, name: true, code: true, country: true } },
        createdBy: { select: { id: true, name: true } },
        purchase: { select: { id: true, number: true } },
        transfer: { select: { id: true, number: true } },
      },
    });
    if (!receipt) throw BusinessError.notFound('Receipt', receiptId);
    this.access.assertAccess(user, receipt.warehouseId);

    const lines = await this.prisma.receiptLine.findMany({
      where: { receiptId },
      select: { deviceId: true },
    });

    return this.build(lines.map((l) => l.deviceId), {
      kind: 'ARRIVAL',
      reference: receipt.number,
      arrivedAt: receipt.createdAt,
      receivedBy: receipt.createdBy?.name ?? null,
      warehouse: receipt.warehouse,
      purchase: receipt.purchase?.number ?? null,
      arrivedVia: receipt.transfer?.number ?? receipt.purchase?.number ?? null,
    });
  }

  /** The statement for a whole purchase lot, wherever its units have got to. */
  async forLot(user: RequestUser, lotId: string) {
    const lot = await this.prisma.lot.findUnique({
      where: { id: lotId },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        warehouse: { select: { id: true, name: true, code: true, country: true } },
        purchase: { select: { id: true, number: true, supplier: { select: { name: true } } } },
      },
    });
    if (!lot) throw BusinessError.notFound('Lot', lotId);

    const devices = await this.prisma.device.findMany({
      where: { lotId },
      select: { id: true, currentWarehouseId: true },
    });
    if (!this.access.isAdmin(user)) {
      const visible = devices.some((d) => this.access.canAccess(user, d.currentWarehouseId));
      if (!visible) throw BusinessError.forbiddenWarehouse();
    }

    return this.build(devices.map((d) => d.id), {
      kind: 'LOT',
      reference: lot.number,
      arrivedAt: lot.receivedAt,
      receivedBy: null,
      warehouse: lot.warehouse,
      purchase: lot.purchase?.number ?? null,
      arrivedVia: lot.purchase?.number ?? null,
      supplier: lot.purchase?.supplier?.name ?? null,
    });
  }

  // -------------------------------------------------------------------------

  private async build(
    deviceIds: string[],
    header: {
      kind: 'ARRIVAL' | 'LOT';
      reference: string;
      arrivedAt: Date;
      receivedBy: string | null;
      warehouse: { id: string; name: string; code: string; country: string };
      /// The purchase order the goods originate from.
      purchase: string | null;
      /// The document that brought them to this warehouse — a transfer, or the
      /// purchase itself when this is the first goods-in.
      arrivedVia: string | null;
      supplier?: string | null;
    },
  ) {
    if (deviceIds.length === 0) {
      throw new BusinessError(ErrorCode.NOT_FOUND, 'There are no units to report on.', 404);
    }

    const devices = await this.prisma.device.findMany({
      where: { id: { in: deviceIds } },
      select: {
        id: true,
        imei: true,
        purchaseCost: true,
        landedCost: true,
        costCurrency: true,
        product: { select: { id: true, name: true, sku: true } },
        lot: { select: { id: true, number: true, unitPurchaseCost: true } },
        purchase: { select: { number: true, supplier: { select: { name: true } } } },
        currentWarehouse: { select: { id: true, name: true, code: true } },
      },
    });
    const units = devices.length;

    // --- the purchase, which is where every unit's cost starts ---------------
    const purchaseTotal = devices.reduce(
      (sum, d) => add(sum, d.purchaseCost?.toFixed(2) ?? '0.00'),
      '0.00',
    );

    // --- every bill that touched these units, one line each ------------------
    const grouped = await this.prisma.costEntry.groupBy({
      by: ['costDocumentId'],
      where: { deviceId: { in: deviceIds } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const documents = await this.prisma.costDocument.findMany({
      where: { id: { in: grouped.map((g) => g.costDocumentId) } },
      select: {
        id: true,
        number: true,
        type: true,
        description: true,
        amount: true,
        currency: true,
        exchangeRate: true,
        amountBase: true,
        allocation: true,
        incurredAt: true,
        status: true,
      },
      orderBy: { incurredAt: 'asc' },
    });
    const byId = new Map(documents.map((d) => [d.id, d]));

    const componentRows = grouped
      .map((g) => {
        const doc = byId.get(g.costDocumentId)!;
        const share = g._sum.amount ?? new Prisma.Decimal(0);
        return {
          costDocumentId: doc.id,
          number: doc.number,
          type: doc.type,
          description: doc.description,
          /// What the supplier of the service actually billed, in their currency.
          billedAmount: doc.amount.toFixed(2),
          billedCurrency: doc.currency,
          exchangeRate: doc.exchangeRate.toFixed(8),
          /// Only the part of that bill these units carry.
          amount: share.toDecimalPlaces(2).toFixed(2),
          perUnit: share.dividedBy(units).toDecimalPlaces(4).toFixed(4),
          allocation: doc.allocation,
          unitsOnDocument: g._count._all,
          incurredAt: doc.incurredAt,
          status: doc.status,
        };
      })
      .sort((a, b) => a.incurredAt.getTime() - b.incurredAt.getTime());

    const componentsTotal = componentRows.reduce((sum, r) => add(sum, r.amount), '0.00');
    const landedTotal = add(purchaseTotal, componentsTotal);

    // --- the route these units actually travelled ----------------------------
    const movements = await this.prisma.deviceMovement.findMany({
      where: { deviceId: { in: deviceIds } },
      orderBy: { createdAt: 'asc' },
      select: {
        type: true,
        createdAt: true,
        referenceNumber: true,
        fromWarehouse: { select: { id: true, name: true } },
        toWarehouse: { select: { id: true, name: true } },
        performedBy: { select: { name: true } },
      },
    });
    // Each leg produced one movement per unit, so collapse them into a single
    // row per leg and count the units that travelled on it. Keying on ids keeps
    // two warehouses that share a name apart.
    const legs = new Map<
      string,
      { type: string; from: string | null; to: string | null; reference: string | null; at: Date; by: string | null; units: number }
    >();
    for (const m of movements) {
      const key = `${m.type}|${m.fromWarehouse?.id ?? ''}|${m.toWarehouse?.id ?? ''}|${m.referenceNumber ?? ''}`;
      const existing = legs.get(key);
      if (existing) {
        existing.units += 1;
        if (m.createdAt < existing.at) existing.at = m.createdAt;
        continue;
      }
      legs.set(key, {
        type: m.type,
        from: m.fromWarehouse?.name ?? null,
        to: m.toWarehouse?.name ?? null,
        reference: m.referenceNumber,
        at: m.createdAt,
        by: m.performedBy?.name ?? null,
        units: 1,
      });
    }
    const journey = [...legs.values()].sort((a, b) => a.at.getTime() - b.at.getTime());

    // --- units in a lot diverge once part of it ships, so be honest about it --
    const spread = new Map<string, number>();
    for (const d of devices) {
      const key = d.landedCost?.toFixed(2) ?? '0.00';
      spread.set(key, (spread.get(key) ?? 0) + 1);
    }
    const distinct = [...spread.entries()]
      .map(([unitCost, count]) => ({ unitCost, units: count }))
      .sort((a, b) => Number(a.unitCost) - Number(b.unitCost));

    const sample = devices[0];
    return {
      document: {
        kind: header.kind,
        title: header.kind === 'ARRIVAL' ? 'Landed cost statement — arrival' : 'Landed cost statement — lot',
        reference: header.reference,
        generatedAt: new Date(),
        /// Generated from the ledger each time, so it can never disagree with it.
        note: 'Figures are derived from the cost ledger when this statement is produced. A cost recorded later will change them.',
      },
      goods: {
        product: sample.product,
        lot: sample.lot ? { id: sample.lot.id, number: sample.lot.number } : null,
        supplier: header.supplier ?? sample.purchase?.supplier?.name ?? null,
        purchase: header.purchase ?? sample.purchase?.number ?? null,
        arrivedVia: header.arrivedVia,
        units,
        warehouse: header.warehouse,
        arrivedAt: header.arrivedAt,
        receivedBy: header.receivedBy,
      },
      journey,
      costs: {
        currency: BASE_CURRENCY,
        purchase: {
          label: 'Purchase',
          perUnit: unitCostOf(purchaseTotal, units),
          amount: purchaseTotal,
        },
        components: componentRows,
        componentsTotal,
        landedTotal,
        unitLandedCost: unitCostOf(landedTotal, units),
      },
      /// More than one figure here means the lot has been split across legs.
      unitCostSpread: distinct,
      uniform: distinct.length === 1,
    };
  }
}

function unitCostOf(total: string, units: number): string {
  if (units === 0) return '0.0000';
  return fromMinor((toMinor(total, 4) * 10_000n) / (BigInt(units) * 10_000n), 4);
}
