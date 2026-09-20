import { Injectable } from '@nestjs/common';
import {
  Currency,
  DeviceStatus,
  MovementType,
  Prisma,
  SaleStatus,
  TrackingMode,
  TransferStatus,
} from '@prisma/client';
import { AuditAction, ErrorCode, add, multiply, subtract } from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { BusinessError } from '../common/errors/business.error';
import { normalizeSingleImei } from '../common/pipes/imei.util';
import { DocumentNumberService } from '../common/services/document-number.service';
import { MovementService } from '../common/services/movement.service';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { BASE_CURRENCY, ExchangeRateService } from '../costing/exchange-rate.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { PosSaleDto } from './dto/pos.dto';

const CLAIMING_TRANSFER: TransferStatus[] = [
  TransferStatus.DRAFT,
  TransferStatus.READY,
  TransferStatus.IN_TRANSIT,
];

/**
 * Counter sales in Algeria.
 *
 * A POS sale is an ordinary Sale with `channel = POS`, created and completed in
 * one call. Keeping it in the same model means there is one source of sales
 * truth: every report, every margin and every IMEI history covers counter sales
 * without a second code path.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
    private readonly pricing: PricingService,
    private readonly rates: ExchangeRateService,
    private readonly stock: StockService,
    private readonly numbers: DocumentNumberService,
    private readonly movements: MovementService,
    private readonly audit: AuditService,
  ) {}

  /**
   * What the counter needs the instant a handset is scanned: is it here, is it
   * sellable, and what does it sell for.
   */
  async lookup(user: RequestUser, rawImei: string, warehouseId?: string) {
    const shopId = this.access.resolveWarehouseId(user, warehouseId);
    const imei = normalizeSingleImei(rawImei, false);

    const device = await this.prisma.device.findUnique({
      where: { imei },
      select: {
        id: true,
        imei: true,
        status: true,
        currentWarehouseId: true,
        landedCost: true,
        product: { select: { id: true, name: true, sku: true } },
        currentWarehouse: { select: { id: true, name: true } },
      },
    });
    if (!device) {
      return { imei, sellable: false, code: ErrorCode.IMEI_NOT_FOUND, message: 'Unknown IMEI.' };
    }
    if (device.currentWarehouseId !== shopId) {
      return {
        imei,
        sellable: false,
        code: ErrorCode.IMEI_WRONG_WAREHOUSE,
        message: 'This phone is not in this shop.',
        device,
      };
    }
    if (device.status === DeviceStatus.SOLD) {
      return { imei, sellable: false, code: ErrorCode.IMEI_ALREADY_SOLD, message: 'Already sold.', device };
    }
    if (device.status !== DeviceStatus.IN_STOCK) {
      return {
        imei,
        sellable: false,
        code: ErrorCode.IMEI_NOT_AVAILABLE,
        message: `This phone is ${device.status.toLowerCase().replace(/_/g, ' ')}.`,
        device,
      };
    }
    const packed = await this.prisma.transferDevice.findFirst({
      where: { deviceId: device.id, transfer: { status: { in: CLAIMING_TRANSFER } } },
      select: { transfer: { select: { number: true } } },
    });
    if (packed) {
      return {
        imei,
        sellable: false,
        code: ErrorCode.IMEI_NOT_AVAILABLE,
        message: `Packed for transfer ${packed.transfer.number}.`,
        device,
      };
    }

    const price = await this.pricing.priceForWarehouse(device.product.id, shopId);
    return { imei, sellable: true, device, price: price.price, currency: price.currency, priceSource: price.source };
  }

  /**
   * Takes the money and hands over the phones, in one transaction.
   *
   * The same status-guarded claim the B2B path uses protects against two tills
   * selling the same handset: the loser updates nothing and rolls back.
   */
  /**
   * Accessories sellable at this till: what is on the shelf, at the price in
   * force here.
   *
   * The till cannot work this out for itself — the price depends on the
   * warehouse's country and the quantity on the level table — and making it
   * guess is how a cable ends up sold at a euro price in dinars.
   */
  async accessories(user: RequestUser, warehouseId?: string) {
    const shopId = this.access.resolveWarehouseId(user, warehouseId);

    const levels = await this.prisma.stockLevel.findMany({
      where: { warehouseId: shopId, quantity: { gt: 0 }, product: { tracking: TrackingMode.BULK, isActive: true } },
      include: { product: { select: { id: true, name: true, sku: true, imageUrl: true } } },
      orderBy: { product: { name: 'asc' } },
    });

    const data = [];
    for (const level of levels) {
      const price = await this.pricing.priceForWarehouse(level.product.id, shopId);
      data.push({
        productId: level.product.id,
        name: level.product.name,
        sku: level.product.sku,
        imageUrl: level.product.imageUrl,
        available: level.quantity,
        unitPrice: price.price,
        currency: price.currency,
      });
    }
    return { data, meta: { total: data.length } };
  }

  async sell(user: RequestUser, dto: PosSaleDto) {
    const shopId = this.access.resolveWarehouseId(user, dto.warehouseId);

    const shop = await this.prisma.warehouse.findUnique({
      where: { id: shopId },
      select: { id: true, name: true, countryId: true, countryRef: { select: { currency: true } } },
    });
    if (!shop) throw BusinessError.notFound('Warehouse', shopId);

    const posLines = dto.lines ?? [];
    const posItems = dto.items ?? [];
    if (posLines.length === 0 && posItems.length === 0) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Scan a phone or add an accessory first.');
    }

    const imeis = posLines.map((l) => normalizeSingleImei(l.imei, false));
    if (new Set(imeis).size !== imeis.length) {
      throw new BusinessError(ErrorCode.IMEI_DUPLICATE_IN_REQUEST, 'The same phone was scanned twice.');
    }

    // Accessories are identified by product, so the same product twice is two
    // lines for one thing — merge rather than reject, because at a till that is
    // just how a second cable gets added.
    const bulkByProduct = new Map<string, { quantity: number; unitPrice?: string }>();
    for (const item of posItems) {
      const existing = bulkByProduct.get(item.productId);
      bulkByProduct.set(item.productId, {
        quantity: (existing?.quantity ?? 0) + item.quantity,
        unitPrice: item.unitPrice ?? existing?.unitPrice,
      });
    }

    const bulkProducts = await this.prisma.product.findMany({
      where: { id: { in: [...bulkByProduct.keys()] } },
      select: { id: true, name: true, tracking: true },
    });
    if (bulkProducts.length !== bulkByProduct.size) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'One or more products do not exist.');
    }
    for (const product of bulkProducts) {
      this.stock.assertTracking(product, TrackingMode.BULK);
    }

    const devices = await this.prisma.device.findMany({
      where: { imei: { in: imeis } },
      select: {
        id: true,
        imei: true,
        status: true,
        currentWarehouseId: true,
        productId: true,
        landedCost: true,
      },
    });
    const byImei = new Map(devices.map((d) => [d.imei, d]));

    const unknown = imeis.filter((i) => !byImei.has(i));
    if (unknown.length > 0) {
      throw new BusinessError(ErrorCode.IMEI_NOT_FOUND, `${unknown.length} IMEI(s) are unknown.`, 404, {
        imeis: unknown.slice(0, 20),
      });
    }
    const elsewhere = devices.filter((d) => d.currentWarehouseId !== shopId);
    if (elsewhere.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_WRONG_WAREHOUSE,
        `${elsewhere.length} phone(s) are not in this shop.`,
        400,
        { imeis: elsewhere.slice(0, 20).map((d) => d.imei) },
      );
    }
    const sold = devices.filter((d) => d.status === DeviceStatus.SOLD);
    if (sold.length > 0) {
      throw BusinessError.conflict(
        ErrorCode.IMEI_ALREADY_SOLD,
        `${sold.length} phone(s) have already been sold.`,
        { imeis: sold.slice(0, 20).map((d) => d.imei) },
      );
    }
    const unavailable = devices.filter((d) => d.status !== DeviceStatus.IN_STOCK);
    if (unavailable.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_NOT_AVAILABLE,
        `${unavailable.length} phone(s) are not available to sell.`,
        400,
        { imeis: unavailable.slice(0, 20).map((d) => ({ imei: d.imei, status: d.status })) },
      );
    }
    const packed = await this.prisma.transferDevice.findMany({
      where: { deviceId: { in: devices.map((d) => d.id) }, transfer: { status: { in: CLAIMING_TRANSFER } } },
      select: { imei: true, transfer: { select: { number: true } } },
    });
    if (packed.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_NOT_AVAILABLE,
        `${packed.length} phone(s) are packed for a transfer. Remove them from it before selling.`,
        400,
        { imeis: packed.slice(0, 20).map((p) => ({ imei: p.imei, transfer: p.transfer.number })) },
      );
    }

    // --- price each line, defaulting to the list ------------------------------
    //
    // The sale is denominated in whatever currency the price is actually in.
    // Assuming the shop's currency instead would book a EUR 980 list price as
    // 980 dinars — the same number, a hundredth of the money.
    const priceByImei = new Map<string, string>();
    const currencies = new Set<Currency>();
    for (const line of posLines) {
      const imei = normalizeSingleImei(line.imei, false);
      const device = byImei.get(imei)!;
      const resolved = await this.pricing.priceForWarehouse(device.productId, shopId);
      currencies.add(resolved.currency);
      priceByImei.set(imei, line.unitPrice ? Number(line.unitPrice).toFixed(2) : resolved.price);
    }

    const bulkPrices = new Map<string, string>();
    for (const [productId, line] of bulkByProduct) {
      const resolved = await this.pricing.priceForWarehouse(productId, shopId);
      currencies.add(resolved.currency);
      bulkPrices.set(productId, line.unitPrice ? Number(line.unitPrice).toFixed(2) : resolved.price);
    }

    if (currencies.size > 1) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'These products are priced in different currencies and cannot go on one sale. Sell them separately.',
        400,
        { currencies: [...currencies] },
      );
    }

    const currency = [...currencies][0] ?? shop.countryRef?.currency ?? BASE_CURRENCY;
    if (dto.currency && dto.currency !== currency) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        `These phones are priced in ${currency}, not ${dto.currency}. Set a ${dto.currency} price for this market first.`,
        400,
        { priced: currency, requested: dto.currency },
      );
    }

    // One sale line per product, because that is what a receipt shows.
    const byProduct = new Map<string, { imeis: string[]; total: string; unitPrice: string }>();
    for (const imei of imeis) {
      const device = byImei.get(imei)!;
      const price = priceByImei.get(imei)!;
      const bucket = byProduct.get(device.productId) ?? { imeis: [], total: '0.00', unitPrice: price };
      bucket.imeis.push(imei);
      bucket.total = add(bucket.total, price);
      byProduct.set(device.productId, bucket);
    }

    const bulkTotals = new Map<string, { quantity: number; unitPrice: string; total: string }>();
    for (const [productId, line] of bulkByProduct) {
      const unitPrice = bulkPrices.get(productId)!;
      bulkTotals.set(productId, {
        quantity: line.quantity,
        unitPrice,
        total: multiply(unitPrice, line.quantity),
      });
    }

    const totalAmount = add(
      [...byProduct.values()].reduce((sum, b) => add(sum, b.total), '0.00'),
      [...bulkTotals.values()].reduce((sum, b) => add(sum, b.total), '0.00'),
    );
    const { amountBase: totalAmountBase, exchangeRate } = await this.rates.toBase(totalAmount, currency);

    // Names for the receipt: the phone path only ever carried IMEIs, which say
    // nothing to a customer holding a piece of paper.
    const productNames = new Map(
      (
        await this.prisma.product.findMany({
          where: { id: { in: [...new Set([...byProduct.keys(), ...bulkTotals.keys()])] } },
          select: { id: true, name: true },
        })
      ).map((p) => [p.id, p.name]),
    );

    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const number = await this.numbers.next(tx, 'SO');
        const sale = await tx.sale.create({
          data: {
            number,
            customerId: dto.customerId ?? null,
            warehouseId: shopId,
            channel: 'POS',
            status: SaleStatus.COMPLETED,
            currency,
            totalAmount,
            totalAmountBase,
            exchangeRate,
            notes: dto.notes,
            completedAt: now,
            createdById: user.id,
            items: {
              create: [
                ...[...byProduct.entries()].map(([productId, b]) => ({
                  productId,
                  quantity: b.imeis.length,
                  unitPrice: b.unitPrice,
                  totalPrice: b.total,
                  pickedCount: b.imeis.length,
                })),
                ...[...bulkTotals.entries()].map(([productId, b]) => ({
                  productId,
                  quantity: b.quantity,
                  unitPrice: b.unitPrice,
                  totalPrice: b.total,
                  // Nothing is left to pick: the goods go over the counter now.
                  pickedCount: b.quantity,
                })),
              ],
            },
          },
          include: { items: true },
        });

        const itemByProduct = new Map(sale.items.map((i) => [i.productId, i.id]));
        let totalCost = '0.00';

        for (const [productId, bucket] of byProduct) {
          const ids = bucket.imeis.map((i) => byImei.get(i)!.id);
          const claimed = await tx.device.updateMany({
            where: {
              id: { in: ids },
              status: DeviceStatus.IN_STOCK,
              currentWarehouseId: shopId,
              saleId: null,
            },
            data: {
              status: DeviceStatus.SOLD,
              saleId: sale.id,
              saleItemId: itemByProduct.get(productId)!,
              soldAt: now,
            },
          });
          if (claimed.count !== ids.length) {
            throw BusinessError.conflict(
              ErrorCode.IMEI_NOT_AVAILABLE,
              'Another till just sold one of these phones. Nothing has been charged — please rescan.',
              { requested: ids.length, claimed: claimed.count },
            );
          }
          for (const imei of bucket.imeis) {
            totalCost = add(totalCost, byImei.get(imei)!.landedCost?.toFixed(2) ?? '0.00');
          }
          await this.movements.recordMany(
            tx,
            bucket.imeis.map((imei) => ({
              deviceId: byImei.get(imei)!.id,
              type: MovementType.SALE,
              fromWarehouseId: shopId,
              toWarehouseId: null,
              referenceType: 'Sale',
              referenceId: sale.id,
              referenceNumber: sale.number,
              performedById: user.id,
              metadata: { imei, channel: 'POS', unitPrice: priceByImei.get(imei), currency },
            })),
          );
        }

        for (const [productId, line] of bulkTotals) {
          const { unitCost } = await this.stock.issue(tx, {
            productId,
            warehouseId: shopId,
            quantity: line.quantity,
            type: MovementType.SALE,
            performedById: user.id,
            referenceType: 'Sale',
            referenceId: sale.id,
            referenceNumber: sale.number,
            notes: 'POS',
          });
          const itemId = itemByProduct.get(productId);
          if (itemId) {
            await tx.saleItem.update({
              where: { id: itemId },
              data: { pickedCost: unitCost.times(line.quantity).toDecimalPlaces(2) },
            });
          }
          totalCost = add(totalCost, unitCost.times(line.quantity).toDecimalPlaces(2).toFixed(2));
        }

        await tx.sale.update({ where: { id: sale.id }, data: { totalCost } });
        return { sale, totalCost };
      },
      { timeout: 60_000, maxWait: 15_000 },
    );

    await this.audit.log({
      userId: user.id,
      action: AuditAction.COMPLETE_SALE,
      entityType: 'Sale',
      entityId: result.sale.id,
      metadata: {
        number: result.sale.number,
        channel: 'POS',
        units: imeis.length,
        totalAmount,
        currency,
        totalAmountBase,
        totalCost: result.totalCost,
      },
    });

    // Gross profit is computed in the reporting currency, where the cost lives.
    const grossProfit = subtract(totalAmountBase, result.totalCost);
    return {
      saleId: result.sale.id,
      number: result.sale.number,
      soldAt: now.toISOString(),
      warehouse: shop.name,
      units: imeis.length,
      currency,
      total: totalAmount,
      exchangeRate,
      baseCurrency: BASE_CURRENCY,
      totalInBase: totalAmountBase,
      cost: result.totalCost,
      grossProfit,
      lines: [
        ...[...byProduct.entries()].map(([productId, b]) => ({
          productId,
          name: productNames.get(productId) ?? null,
          quantity: b.imeis.length,
          unitPrice: b.unitPrice,
          total: b.total,
          imeis: b.imeis,
        })),
        // Accessory lines carry a name instead of IMEIs — the receipt has to
        // show something, and "2 ×" against nothing is not a receipt.
        ...[...bulkTotals.entries()].map(([productId, b]) => ({
          productId,
          name: productNames.get(productId) ?? null,
          quantity: b.quantity,
          unitPrice: b.unitPrice,
          total: b.total,
          imeis: [] as string[],
        })),
      ],
    };
  }

  /** Today's counter takings for a shop — what a cashier checks at close. */
  async today(user: RequestUser, warehouseId?: string) {
    const shopId = this.access.resolveWarehouseId(user, warehouseId);
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const where: Prisma.SaleWhereInput = {
      warehouseId: shopId,
      channel: 'POS',
      status: SaleStatus.COMPLETED,
      completedAt: { gte: start },
    };

    const [agg, sales] = await Promise.all([
      this.prisma.sale.aggregate({
        where,
        _sum: { totalAmount: true, totalAmountBase: true, totalCost: true },
        _count: { _all: true },
      }),
      this.prisma.sale.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        take: 25,
        select: {
          id: true,
          number: true,
          totalAmount: true,
          currency: true,
          completedAt: true,
          createdBy: { select: { name: true } },
          // Item quantities, not a device count: an accessory sale has no
          // devices and would otherwise report as nothing sold.
          items: { select: { quantity: true } },
        },
      }),
    ]);

    const revenueBase = agg._sum.totalAmountBase?.toFixed(2) ?? '0.00';
    const cost = agg._sum.totalCost?.toFixed(2) ?? '0.00';
    return {
      warehouseId: shopId,
      sales: agg._count._all,
      revenue: agg._sum.totalAmount?.toFixed(2) ?? '0.00',
      revenueInBase: revenueBase,
      cost,
      grossProfit: subtract(revenueBase, cost),
      baseCurrency: BASE_CURRENCY,
      recent: sales.map(({ items, ...s }) => ({
        ...s,
        totalAmount: s.totalAmount.toFixed(2),
        units: items.reduce((sum, i) => sum + i.quantity, 0),
      })),
    };
  }
}
