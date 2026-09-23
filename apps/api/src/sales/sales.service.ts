import { Inject, Injectable } from '@nestjs/common';
import {
  Currency,
  DeviceStatus,
  MovementType,
  Prisma,
  SaleStatus,
  TrackingMode,
  TransferStatus,
} from '@prisma/client';
import { AuditAction, ErrorCode, add, multiply, subtract, toMinor } from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { BusinessError } from '../common/errors/business.error';
import { normalizeScanCodes } from '../common/pipes/imei.util';
import { DocumentNumberService } from '../common/services/document-number.service';
import { MovementService } from '../common/services/movement.service';
import { DeviceScanService } from '../common/services/device-scan.service';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import { APP_CONFIG } from '../common/tokens';
import type { RequestUser } from '../common/types';
import { AppConfig } from '../config/configuration';
import { ExchangeRateService } from '../costing/exchange-rate.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { CompleteSaleDto, CreateSaleDto, QuerySalesDto, SalePaymentDto } from './dto/sale.dto';

/**
 * A device loaded onto one of these transfers is physically spoken for, even
 * though its status is still IN_STOCK — `Device.transferId` is only stamped at
 * dispatch. Selling it would promise the same handset to two places.
 */
const CLAIMING_TRANSFER: TransferStatus[] = [
  TransferStatus.DRAFT,
  TransferStatus.READY,
  TransferStatus.IN_TRANSIT,
];

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
    private readonly deviceScan: DeviceScanService,
    private readonly numbers: DocumentNumberService,
    private readonly movements: MovementService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly rates: ExchangeRateService,
    private readonly stock: StockService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(user: RequestUser, query: QuerySalesDto) {
    const where: Prisma.SaleWhereInput = {
      ...this.access.filterFor<Prisma.SaleWhereInput>(user, 'warehouseId', query.warehouseId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.payment === 'UNPAID'
        ? { amountPaid: { lte: 0 }, totalAmount: { gt: 0 }, status: { not: SaleStatus.CANCELLED } }
        : query.payment === 'PARTIAL'
          ? { amountPaid: { gt: 0, lt: this.prisma.sale.fields.totalAmount } }
          : query.payment === 'PAID'
            ? { amountPaid: { gte: this.prisma.sale.fields.totalAmount } }
            : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { customer: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        select: {
          id: true,
          number: true,
          status: true,
          currency: true,
          totalAmount: true,
          totalCost: true,
          amountPaid: true,
          completedAt: true,
          createdAt: true,
          customer: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          items: { select: { quantity: true, pickedCount: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    const data = rows.map(({ items, ...s }) => ({
      ...s,
      totalAmount: s.totalAmount.toFixed(2),
      totalCost: s.totalCost.toFixed(2),
      ...paymentSummary(s.totalAmount.toFixed(2), s.amountPaid.toFixed(2)),
      quantity: items.reduce((a, i) => a + i.quantity, 0),
      pickedQuantity: items.reduce((a, i) => a + i.pickedCount, 0),
    }));
    return paginate(data, total, query);
  }

  async findOne(user: RequestUser, id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        customer: true,
        warehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, tracking: true } } } },
        payments: { orderBy: { paidAt: 'asc' }, include: { createdBy: { select: { id: true, name: true } } } },
      },
    });
    if (!sale) throw BusinessError.notFound('Sale', id);
    this.access.assertAccess(user, sale.warehouseId);

    const devices = await this.prisma.device.findMany({
      where: { saleId: id },
      take: 2000,
      select: {
        id: true,
        imei: true,
        status: true,
        // A label-received phone has no IMEI; its printed label is the only
        // thing to show on the line, and the only way to open its history.
        label: { select: { code: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });

    return {
      ...sale,
      totalAmount: sale.totalAmount.toFixed(2),
      totalCost: sale.totalCost.toFixed(2),
      ...paymentSummary(sale.totalAmount.toFixed(2), sale.amountPaid.toFixed(2)),
      payments: sale.payments.map((p) => ({ ...p, amount: p.amount.toFixed(2) })),
      devices,
      items: sale.items.map((i) => ({
        ...i,
        unitPrice: i.unitPrice.toFixed(2),
        totalPrice: i.totalPrice.toFixed(2),
      })),
    };
  }

  async create(user: RequestUser, dto: CreateSaleDto) {
    const warehouseId = this.access.resolveWarehouseId(user, dto.warehouseId);

    const productIds = dto.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'The same product appears on two lines.');
    }

    const [customer, products] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: dto.customerId }, select: { id: true } }),
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, defaultSalePrice: true, tracking: true, name: true },
      }),
    ]);
    if (!customer) throw BusinessError.notFound('Customer', dto.customerId);
    if (products.length !== productIds.length) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'One or more products do not exist.');
    }

    // An omitted price comes from the price list for the selling warehouse's
    // country, so a price change takes effect everywhere without editing
    // anything else. The product's list price is only the last resort.
    //
    // The price carries its own currency, and the sale must adopt it — booking
    // a EUR 980 list price as 980 dinars would be the same number and a
    // hundredth of the money.
    const priceByProduct = new Map<string, string>();
    const resolvedCurrencies = new Set<Currency>();
    for (const item of dto.items) {
      const resolved = await this.pricing.priceForWarehouse(item.productId, warehouseId);
      priceByProduct.set(item.productId, resolved.price);
      // A price typed in by hand is in whatever currency the sale is already in.
      if (!item.unitPrice) resolvedCurrencies.add(resolved.currency);
    }
    if (resolvedCurrencies.size > 1) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'These products are priced in different currencies and cannot go on one order.',
        400,
        { currencies: [...resolvedCurrencies] },
      );
    }
    const currency = [...resolvedCurrencies][0] ?? dto.currency;

    // Warn early rather than at completion: a sale for stock that is not there
    // is a data-entry mistake, not a business case.
    const trackingByProduct = new Map(products.map((p) => [p.id, p.tracking]));
    for (const item of dto.items) {
      // Phones are counted by counting rows; accessories by reading the level.
      const available =
        trackingByProduct.get(item.productId) === TrackingMode.BULK
          ? await this.stock.available(item.productId, warehouseId)
          : await this.prisma.device.count({
              where: {
                productId: item.productId,
                currentWarehouseId: warehouseId,
                status: DeviceStatus.IN_STOCK,
              },
            });
      if (available < item.quantity) {
        throw new BusinessError(
          ErrorCode.QUANTITY_EXCEEDED,
          `Only ${available} unit(s) of this product are available in this warehouse.`,
          400,
          { productId: item.productId, requested: item.quantity, available },
        );
      }
    }

    const items = dto.items.map((i) => {
      const unitPrice = i.unitPrice ?? priceByProduct.get(i.productId) ?? '0.00';
      return {
        productId: i.productId,
        quantity: i.quantity,
        unitPrice,
        totalPrice: multiply(unitPrice, i.quantity),
      };
    });
    const totalAmount = items.reduce((sum, i) => add(sum, i.totalPrice), '0.00');
    if (dto.payment) assertPayable(dto.payment.amount, totalAmount, '0.00');

    // Revenue is also held in the reporting currency at the rate of the day, so
    // margins across markets add up and never move afterwards.
    const { amountBase: totalAmountBase, exchangeRate } = await this.rates.toBase(totalAmount, currency);

    const sale = await this.prisma.$transaction(async (tx) => {
      const number = await this.numbers.next(tx, 'SO', items);
      return tx.sale.create({
        data: {
          number,
          customerId: dto.customerId,
          warehouseId,
          status: SaleStatus.CONFIRMED,
          currency,
          totalAmount,
          totalAmountBase,
          exchangeRate,
          notes: dto.notes,
          createdById: user.id,
          items: { create: items },
          ...(dto.payment
            ? {
                amountPaid: dto.payment.amount,
                payments: {
                  create: {
                    amount: dto.payment.amount,
                    method: dto.payment.method,
                    paidAt: dto.payment.paidAt ? new Date(dto.payment.paidAt) : undefined,
                    note: dto.payment.note,
                    createdById: user.id,
                  },
                },
              }
            : {}),
        },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.CREATE_SALE,
      entityType: 'Sale',
      entityId: sale.id,
      metadata: { number: sale.number, customerId: dto.customerId, totalAmount },
    });
    return this.findOne(user, sale.id);
  }

  /**
   * Completes a sale by assigning specific physical devices to it.
   *
   * The double-sell guard (spec §28) is the status-filtered updateMany below:
   * only devices still IN_STOCK in this warehouse are claimed, and if the number
   * claimed differs from the number requested the whole transaction rolls back
   * and the losing request gets a clear business error.
   */
  async complete(user: RequestUser, saleId: string, dto: CompleteSaleDto) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { product: { select: { tracking: true, name: true } } } } },
    });
    if (!sale) throw BusinessError.notFound('Sale', saleId);
    this.access.assertAccess(user, sale.warehouseId);

    if (sale.status === SaleStatus.COMPLETED) {
      throw new BusinessError(ErrorCode.INVALID_STATUS_TRANSITION, 'This sale is already completed.');
    }
    if (sale.status === SaleStatus.CANCELLED) {
      throw new BusinessError(ErrorCode.INVALID_STATUS_TRANSITION, 'This sale has been cancelled.');
    }

    // Accessories have no units to choose between, so they are never "picked"
    // — they are simply deducted when the sale completes.
    const bulkLines = sale.items.filter(
      (i) => i.product.tracking === TrackingMode.BULK && i.quantity > i.pickedCount,
    );
    const serialisedSale = { ...sale, items: sale.items.filter((i) => i.product.tracking !== TrackingMode.BULK) };

    const picks =
      serialisedSale.items.length === 0
        ? []
        : dto.imeis?.length
          ? await this.resolveScannedPicks(serialisedSale, dto.imeis)
          : await this.resolveAutoPicks(serialisedSale, dto.autoPick ?? false);

    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Claim the sale itself so two completions cannot both proceed.
        const claim = await tx.sale.updateMany({
          where: { id: saleId, status: { in: [SaleStatus.DRAFT, SaleStatus.CONFIRMED] } },
          data: { status: SaleStatus.COMPLETED, completedAt: now },
        });
        if (claim.count === 0) {
          throw BusinessError.conflict(
            ErrorCode.CONCURRENT_MODIFICATION,
            'This sale was completed by someone else a moment ago.',
          );
        }

        let totalCost = '0.00';
        for (const pick of picks) {
          const ids = pick.devices.map((d) => d.id);
          const claimed = await tx.device.updateMany({
            where: {
              id: { in: ids },
              status: DeviceStatus.IN_STOCK,
              currentWarehouseId: sale.warehouseId,
              saleId: null,
            },
            data: {
              status: DeviceStatus.SOLD,
              saleId,
              saleItemId: pick.saleItemId,
              soldAt: now,
            },
          });
          if (claimed.count !== ids.length) {
            throw BusinessError.conflict(
              ErrorCode.IMEI_NOT_AVAILABLE,
              `${ids.length - claimed.count} phone(s) were sold or moved by someone else. Nothing has been changed — please rescan.`,
              { requested: ids.length, claimed: claimed.count },
            );
          }

          await tx.saleItem.update({
            where: { id: pick.saleItemId },
            data: { pickedCount: { increment: ids.length } },
          });

          for (const device of pick.devices) {
            totalCost = add(totalCost, device.landedCost?.toFixed(2) ?? '0.00');
          }

          await this.movements.recordMany(
            tx,
            pick.devices.map((d) => ({
              deviceId: d.id,
              type: MovementType.SALE,
              fromWarehouseId: sale.warehouseId,
              toWarehouseId: null,
              referenceType: 'Sale',
              referenceId: saleId,
              referenceNumber: sale.number,
              performedById: user.id,
              metadata: { imei: d.imei, unitPrice: pick.unitPrice },
            })),
          );
        }

        for (const item of bulkLines) {
          const outstanding = item.quantity - item.pickedCount;
          const { unitCost } = await this.stock.issue(tx, {
            productId: item.productId,
            warehouseId: sale.warehouseId,
            quantity: outstanding,
            type: MovementType.SALE,
            performedById: user.id,
            referenceType: 'Sale',
            referenceId: saleId,
            referenceNumber: sale.number,
          });
          const pickedCost = unitCost.times(outstanding).toDecimalPlaces(2);
          await tx.saleItem.update({
            where: { id: item.id },
            data: { pickedCount: { increment: outstanding }, pickedCost: { increment: pickedCost } },
          });
          totalCost = add(totalCost, pickedCost.toFixed(2));
        }

        await tx.sale.update({ where: { id: saleId }, data: { totalCost } });
        return {
          totalCost,
          sold:
            picks.reduce((s, p) => s + p.devices.length, 0) +
            bulkLines.reduce((s, i) => s + (i.quantity - i.pickedCount), 0),
        };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    await this.audit.log({
      userId: user.id,
      action: AuditAction.COMPLETE_SALE,
      entityType: 'Sale',
      entityId: saleId,
      metadata: {
        number: sale.number,
        devices: result.sold,
        totalAmount: sale.totalAmount.toFixed(2),
        totalCost: result.totalCost,
      },
    });

    return {
      saleId,
      status: SaleStatus.COMPLETED,
      devicesSold: result.sold,
      revenue: sale.totalAmount.toFixed(2),
      cost: result.totalCost,
      completedAt: now.toISOString(),
    };
  }

  /** Money received against a sale; a sale can be paid in several goes. */
  async addPayment(user: RequestUser, saleId: string, dto: SalePaymentDto) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw BusinessError.notFound('Sale', saleId);
    this.access.assertAccess(user, sale.warehouseId);
    if (sale.status === SaleStatus.CANCELLED) {
      throw new BusinessError(ErrorCode.INVALID_STATUS_TRANSITION, 'A cancelled sale cannot take a payment.');
    }
    assertPayable(dto.amount, sale.totalAmount.toFixed(2), sale.amountPaid.toFixed(2));

    await this.prisma.$transaction([
      this.prisma.salePayment.create({
        data: {
          saleId,
          amount: dto.amount,
          method: dto.method,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
          note: dto.note,
          createdById: user.id,
        },
      }),
      this.prisma.sale.update({ where: { id: saleId }, data: { amountPaid: { increment: dto.amount } } }),
    ]);
    await this.audit.log({
      userId: user.id,
      action: AuditAction.RECORD_PAYMENT,
      entityType: 'Sale',
      entityId: saleId,
      metadata: { number: sale.number, amount: dto.amount, method: dto.method ?? 'CASH' },
    });
    return this.findOne(user, saleId);
  }

  /** Takes back a payment recorded by mistake. */
  async removePayment(user: RequestUser, saleId: string, paymentId: string) {
    const payment = await this.prisma.salePayment.findUnique({ where: { id: paymentId }, include: { sale: true } });
    if (!payment || payment.saleId !== saleId) throw BusinessError.notFound('Payment', paymentId);
    this.access.assertAccess(user, payment.sale.warehouseId);

    await this.prisma.$transaction([
      this.prisma.salePayment.delete({ where: { id: paymentId } }),
      this.prisma.sale.update({ where: { id: saleId }, data: { amountPaid: { decrement: payment.amount } } }),
    ]);
    await this.audit.log({
      userId: user.id,
      action: AuditAction.DELETE_PAYMENT,
      entityType: 'Sale',
      entityId: saleId,
      metadata: { number: payment.sale.number, amount: payment.amount.toFixed(2), method: payment.method },
    });
    return this.findOne(user, saleId);
  }

  async cancel(user: RequestUser, saleId: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw BusinessError.notFound('Sale', saleId);
    this.access.assertAccess(user, sale.warehouseId);

    if (sale.status === SaleStatus.COMPLETED) {
      throw new BusinessError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        'A completed sale cannot be cancelled — record a return instead.',
      );
    }
    const updated = await this.prisma.sale.update({
      where: { id: saleId },
      data: { status: SaleStatus.CANCELLED },
    });
    await this.audit.log({
      userId: user.id,
      action: AuditAction.CANCEL_SALE,
      entityType: 'Sale',
      entityId: saleId,
      metadata: { number: sale.number },
    });
    return updated;
  }

  // -------------------------------------------------------------------------

  private async resolveScannedPicks(
    sale: Prisma.SaleGetPayload<{ include: { items: true } }>,
    rawImeis: string[],
  ) {
    // Whatever was scanned — a legacy IMEI or a printed unit label — stands
    // for one device. Errors below name the code that was actually scanned,
    // since a label-received phone has no IMEI to quote back.
    const codes = normalizeScanCodes(rawImeis);
    const { resolved, missing } = await this.deviceScan.resolve(codes);
    if (missing.length > 0) {
      throw new BusinessError(ErrorCode.IMEI_NOT_FOUND, `${missing.length} code(s) are unknown.`, 404, {
        imeis: missing.slice(0, 20),
      });
    }

    const codeByDeviceId = new Map(resolved.map((r) => [r.device.id, r.code]));
    const devices = await this.prisma.device.findMany({
      where: { id: { in: resolved.map((r) => r.device.id) } },
      select: {
        id: true,
        imei: true,
        status: true,
        productId: true,
        currentWarehouseId: true,
        landedCost: true,
      },
    });
    /** What the picker scanned for this device, for any message about it. */
    const codeOf = (device: { id: string }) => codeByDeviceId.get(device.id)!;

    const alreadySold = devices.filter((d) => d.status === DeviceStatus.SOLD);
    if (alreadySold.length > 0) {
      throw BusinessError.conflict(
        ErrorCode.IMEI_ALREADY_SOLD,
        `${alreadySold.length} phone(s) have already been sold.`,
        { imeis: alreadySold.slice(0, 20).map(codeOf) },
      );
    }

    const elsewhere = devices.filter((d) => d.currentWarehouseId !== sale.warehouseId);
    if (elsewhere.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_WRONG_WAREHOUSE,
        `${elsewhere.length} phone(s) do not belong to this warehouse.`,
        400,
        { imeis: elsewhere.slice(0, 20).map(codeOf) },
      );
    }

    const unavailable = devices.filter((d) => d.status !== DeviceStatus.IN_STOCK);
    if (unavailable.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_NOT_AVAILABLE,
        `${unavailable.length} phone(s) are not available for sale.`,
        400,
        { imeis: unavailable.slice(0, 20).map((d) => ({ imei: codeOf(d), status: d.status })) },
      );
    }

    // A handset already packed for another warehouse cannot also be sold here.
    const packed = await this.prisma.transferDevice.findMany({
      where: {
        deviceId: { in: devices.map((d) => d.id) },
        transfer: { status: { in: CLAIMING_TRANSFER } },
      },
      select: { imei: true, transfer: { select: { number: true } } },
    });
    if (packed.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_NOT_AVAILABLE,
        `${packed.length} phone(s) are loaded on a transfer. Remove them from it before selling.`,
        400,
        { imeis: packed.slice(0, 20).map((l) => ({ imei: l.imei, transfer: l.transfer.number })) },
      );
    }

    // Every scanned device must match a line, and the counts must agree exactly.
    const byProduct = new Map<string, typeof devices>();
    for (const device of devices) {
      const bucket = byProduct.get(device.productId) ?? [];
      bucket.push(device);
      byProduct.set(device.productId, bucket);
    }

    const picks = sale.items.map((item) => {
      const scanned = byProduct.get(item.productId) ?? [];
      const needed = item.quantity - item.pickedCount;
      if (scanned.length !== needed) {
        throw new BusinessError(
          ErrorCode.QUANTITY_EXCEEDED,
          `This sale needs ${needed} unit(s) of one product but ${scanned.length} were scanned.`,
          400,
          { productId: item.productId, required: needed, scanned: scanned.length },
        );
      }
      byProduct.delete(item.productId);
      return { saleItemId: item.id, unitPrice: item.unitPrice.toFixed(2), devices: scanned };
    });

    if (byProduct.size > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_WRONG_PRODUCT,
        'Some scanned phones are not on this sales order.',
        400,
        { productIds: [...byProduct.keys()] },
      );
    }
    return picks;
  }

  private async resolveAutoPicks(
    sale: Prisma.SaleGetPayload<{ include: { items: true } }>,
    autoPick: boolean,
  ) {
    if (!autoPick) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'Scan the IMEIs being shipped, or set autoPick to let the system choose.',
      );
    }

    const picks = [];
    for (const item of sale.items) {
      const needed = item.quantity - item.pickedCount;
      if (needed <= 0) continue;
      const devices = await this.prisma.device.findMany({
        where: {
          productId: item.productId,
          currentWarehouseId: sale.warehouseId,
          status: DeviceStatus.IN_STOCK,
          saleId: null,
          NOT: { transferLines: { some: { transfer: { status: { in: CLAIMING_TRANSFER } } } } },
        },
        orderBy: { receivedAt: 'asc' },
        take: needed,
        select: { id: true, imei: true, landedCost: true },
      });
      if (devices.length < needed) {
        throw new BusinessError(
          ErrorCode.QUANTITY_EXCEEDED,
          `Only ${devices.length} of the ${needed} required unit(s) are available.`,
          400,
          { productId: item.productId, required: needed, available: devices.length },
        );
      }
      picks.push({ saleItemId: item.id, unitPrice: item.unitPrice.toFixed(2), devices });
    }
    if (picks.length === 0) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Every line of this sale is already picked.');
    }
    return picks;
  }
}

export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

/** Paid, half paid or not paid, and what is still owed. */
export function paymentSummary(total: string, paid: string) {
  const owed = toMinor(total) - toMinor(paid);
  const status: PaymentStatus = toMinor(paid) <= 0n && toMinor(total) > 0n ? 'UNPAID' : owed > 0n ? 'PARTIAL' : 'PAID';
  return { amountPaid: paid, balance: owed > 0n ? subtract(total, paid) : '0.00', paymentStatus: status };
}

/** A payment must be positive and never take the sale past its total. */
function assertPayable(amount: string, total: string, alreadyPaid: string) {
  if (toMinor(amount) <= 0n) {
    throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'A payment must be more than zero.');
  }
  if (toMinor(alreadyPaid) + toMinor(amount) > toMinor(total)) {
    throw new BusinessError(
      ErrorCode.VALIDATION_FAILED,
      `This is more than what is owed (${subtract(total, alreadyPaid)}).`,
      400,
      { owed: subtract(total, alreadyPaid) },
    );
  }
}
