import { Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma, TrackingMode } from '@prisma/client';
import { add } from '@phone-erp/shared-types';
import type {
  BrandStockCards,
  StockStatus,
  Product360,
  ProductStockCards,
  WarehouseStockCards,
} from '@phone-erp/shared-types';
import { BusinessError } from '../common/errors/business.error';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toFixed(2);

/**
 * The stock browser is organised by make.
 *
 * Someone looking for stock thinks "have we got Samsung", not "have we got
 * smartphones" — so the second level is the brand. Every product has one, so
 * unlike the old free-text category there is no bucket for the ones that got
 * missed.
 */

/**
 * Below this, a card is flagged as running low.
 *
 * One number for every product is a placeholder, not a policy: five cables is
 * nothing and five handsets may be a fortnight's sales. A reorder point per
 * product is the real answer when someone wants to act on this.
 */
const LOW_STOCK_AT = 5;

/** One rule, so the cards and the product page can never disagree. */
const stockStatus = (quantity: number): StockStatus =>
  quantity === 0 ? 'OUT_OF_STOCK' : quantity <= LOW_STOCK_AT ? 'LOW' : 'IN_STOCK';

/**
 * Walking into the stock: warehouse, then category, then product, then history.
 *
 * Every level is valued the same way the dashboard values stock — phones at the
 * landed cost recorded on each unit, accessories at their average — so the
 * warehouse cards add up to the figure on the dashboard rather than telling a
 * second story.
 *
 * Authorisation is applied here, not by hiding cards. A warehouse user asking
 * for a warehouse that is not theirs is refused, however they got the id.
 */
@Injectable()
export class StockExplorerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
  ) {}

  /** The warehouses this user may actually open. */
  async warehouses(user: RequestUser): Promise<WarehouseStockCards> {
    const allowed = this.access.allowedWarehouseIds(user);

    const warehouses = await this.prisma.warehouse.findMany({
      where: { isActive: true, ...(allowed ? { id: { in: allowed } } : {}) },
      select: {
        id: true,
        name: true,
        code: true,
        country: true,
        imageUrl: true,
        countryRef: { select: { code: true, currency: true } },
      },
      orderBy: { name: 'asc' },
    });
    if (warehouses.length === 0) return { data: [], meta: { total: 0 } };

    const ids = warehouses.map((w) => w.id);
    const [deviceRows, levels] = await Promise.all([
      this.prisma.device.groupBy({
        by: ['currentWarehouseId', 'productId'],
        where: { status: DeviceStatus.IN_STOCK, currentWarehouseId: { in: ids } },
        _sum: { landedCost: true },
        _count: { _all: true },
      }),
      this.prisma.stockLevel.findMany({
        where: { quantity: { gt: 0 }, warehouseId: { in: ids } },
        select: { warehouseId: true, productId: true, quantity: true, avgUnitCost: true },
      }),
    ]);

    const productIds = [
      ...new Set([...deviceRows.map((r) => r.productId), ...levels.map((l) => l.productId)]),
    ];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, brand: { select: { name: true } } },
    });
    const brandOf = new Map(products.map((p) => [p.id, p.brand.name]));

    const tally = new Map<
      string,
      { products: Set<string>; categories: Set<string>; quantity: number; value: string }
    >();
    const bucket = (warehouseId: string) => {
      const existing = tally.get(warehouseId);
      if (existing) return existing;
      const fresh = { products: new Set<string>(), categories: new Set<string>(), quantity: 0, value: '0.00' };
      tally.set(warehouseId, fresh);
      return fresh;
    };

    for (const row of deviceRows) {
      if (!row.currentWarehouseId) continue;
      const b = bucket(row.currentWarehouseId);
      b.products.add(row.productId);
      b.categories.add(brandOf.get(row.productId) ?? '');
      b.quantity += row._count._all;
      b.value = add(b.value, money(row._sum.landedCost ?? ZERO));
    }
    for (const level of levels) {
      const b = bucket(level.warehouseId);
      b.products.add(level.productId);
      b.categories.add(brandOf.get(level.productId) ?? '');
      b.quantity += level.quantity;
      b.value = add(b.value, money(level.avgUnitCost.times(level.quantity)));
    }

    const data = warehouses.map((w) => {
      const b = tally.get(w.id);
      return {
        id: w.id,
        name: w.name,
        code: w.code,
        location: w.country,
        imageUrl: w.imageUrl,
        countryCode: w.countryRef?.code ?? null,
        products: b?.products.size ?? 0,
        categories: b?.categories.size ?? 0,
        quantity: b?.quantity ?? 0,
        stockValue: b?.value ?? '0.00',
        currency: 'EUR' as const,
      };
    });

    return { data, meta: { total: data.length } };
  }

  /** The categories actually holding stock in one warehouse. */
  async categories(user: RequestUser, warehouseId: string): Promise<BrandStockCards> {
    const warehouse = await this.assertWarehouse(user, warehouseId);

    const { rows } = await this.stockRows(warehouseId);

    const tally = new Map<string, { products: Set<string>; quantity: number; value: string; image: string | null }>();
    for (const row of rows) {
      const key = row.category;
      const b = tally.get(key) ?? { products: new Set<string>(), quantity: 0, value: '0.00', image: null };
      b.products.add(row.productId);
      b.quantity += row.quantity;
      b.value = add(b.value, row.stockValue);
      // The first product picture stands in for the category, so the cards are
      // not a wall of identical placeholders.
      // The brand's own logo first; a product photo only if it has none.
      if (!b.image) b.image = row.brandImageUrl ?? row.imageUrl;
      tally.set(key, b);
    }

    const data = [...tally.entries()]
      .map(([category, b]) => ({
        category,
        products: b.products.size,
        quantity: b.quantity,
        stockValue: b.value,
        imageUrl: b.image,
        currency: 'EUR' as const,
      }))
      .sort((a, b) => Number(b.stockValue) - Number(a.stockValue));

    return { warehouse, data, meta: { total: data.length } };
  }

  /** The products of one category, in one warehouse. */
  async products(user: RequestUser, warehouseId: string, category: string): Promise<ProductStockCards> {
    const warehouse = await this.assertWarehouse(user, warehouseId);
    const { rows } = await this.stockRows(warehouseId);

    const wanted = rows.filter((r) => r.category.toLowerCase() === category.toLowerCase());
    if (wanted.length === 0) {
      return { warehouse, category, data: [], meta: { total: 0 } };
    }

    // What is on the way out or already gone, which a card showing only
    // "available" would leave the reader guessing about.
    const productIds = wanted.map((r) => r.productId);
    const [inTransfer, sold] = await Promise.all([
      this.prisma.device.groupBy({
        by: ['productId'],
        where: {
          productId: { in: productIds },
          status: DeviceStatus.IN_TRANSFER,
          // Scoped to this warehouse, like every other figure on the card. A
          // card that counted every warehouse's sales would disagree with the
          // product page it opens.
          currentWarehouseId: warehouseId,
        },
        _count: { _all: true },
      }),
      this.prisma.device.groupBy({
        by: ['productId'],
        where: {
          productId: { in: productIds },
          status: DeviceStatus.SOLD,
          currentWarehouseId: warehouseId,
        },
        _count: { _all: true },
      }),
    ]);
    const transferByProduct = new Map(inTransfer.map((r) => [r.productId, r._count._all]));
    const soldByProduct = new Map(sold.map((r) => [r.productId, r._count._all]));

    const data = wanted
      .map((row) => ({
        ...row,
        inShipment: transferByProduct.get(row.productId) ?? 0,
        sold: soldByProduct.get(row.productId) ?? 0,
        status: stockStatus(row.quantity),
      }))
      .sort((a, b) => Number(b.stockValue) - Number(a.stockValue));

    return { warehouse, category, data, meta: { total: data.length } };
  }

  /**
   * Everything that has happened to one product in one warehouse.
   *
   * Assembled here rather than left to the reader to piece together from the
   * purchases, transfers, sales and costing screens — which is the whole point
   * of the page. Nothing below is a new calculation: each section reads the
   * same records those screens read.
   */
  async product360(user: RequestUser, warehouseId: string, productId: string): Promise<Product360> {
    const warehouse = await this.assertWarehouse(user, warehouseId);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        brandId: true,
        model: true,
        storage: true,
        color: true,
        category: true,
        imageUrl: true,
        tracking: true,
        brand: { select: { id: true, name: true, imageUrl: true } },
        purchasePrice: true,
        defaultSalePrice: true,
        currency: true,
        isActive: true,
      },
    });
    if (!product) throw BusinessError.notFound('Product', productId);

    const here = { productId, currentWarehouseId: warehouseId };

    const [byStatus, level, recentDevices, purchaseLines, saleLines, movements, bulkLedger, price] =
      await Promise.all([
        this.prisma.device.groupBy({
          by: ['status'],
          where: { productId, currentWarehouseId: warehouseId },
          _count: { _all: true },
          _sum: { landedCost: true },
        }),
        this.prisma.stockLevel.findUnique({
          where: { productId_warehouseId: { productId, warehouseId } },
          select: { quantity: true, avgUnitCost: true, currency: true, updatedAt: true },
        }),
        // A sample of the actual units, so the count is not just a number.
        this.prisma.device.findMany({
          where: { ...here, status: DeviceStatus.IN_STOCK },
          // A label-received unit has no IMEI at all — its printed label is
          // the only thing that identifies it, on screen and in a link.
          select: {
            id: true,
            imei: true,
            label: { select: { code: true } },
            landedCost: true,
            receivedAt: true,
          },
          orderBy: { receivedAt: 'desc' },
          take: 10,
        }),
        this.prisma.purchaseItem.findMany({
          where: { productId, purchase: { warehouseId } },
          select: {
            id: true,
            quantity: true,
            receivedQuantity: true,
            unitPrice: true,
            totalPrice: true,
            purchase: {
              select: {
                id: true,
                number: true,
                status: true,
                purchaseDate: true,
                currency: true,
                supplier: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { purchase: { purchaseDate: 'desc' } },
          take: 20,
        }),
        this.prisma.saleItem.findMany({
          where: { productId, sale: { warehouseId, status: 'COMPLETED' } },
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            sale: {
              select: {
                id: true,
                number: true,
                currency: true,
                completedAt: true,
                channel: true,
                customer: { select: { id: true, name: true } },
              },
            },
            devices: { select: { landedCost: true } },
          },
          orderBy: { sale: { completedAt: 'desc' } },
          take: 20,
        }),
        this.prisma.deviceMovement.findMany({
          where: {
            device: { productId },
            OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }],
          },
          select: {
            id: true,
            type: true,
            createdAt: true,
            referenceType: true,
            referenceId: true,
            referenceNumber: true,
            device: { select: { imei: true } },
            fromWarehouse: { select: { name: true } },
            toWarehouse: { select: { name: true } },
            performedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
        this.prisma.stockMovement.findMany({
          where: { productId, warehouseId },
          select: {
            id: true,
            type: true,
            quantity: true,
            unitCost: true,
            createdAt: true,
            referenceType: true,
            referenceId: true,
            referenceNumber: true,
            notes: true,
            performedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
        this.prisma.productPrice.findFirst({
          where: { productId, validTo: null },
          orderBy: { validFrom: 'desc' },
          select: { price: true, currency: true, validFrom: true, country: { select: { name: true } } },
        }),
      ]);

    const countOf = (status: DeviceStatus) =>
      byStatus.find((g) => g.status === status)?._count._all ?? 0;
    const serialised = product.tracking === TrackingMode.SERIALIZED;

    const available = serialised ? countOf(DeviceStatus.IN_STOCK) : (level?.quantity ?? 0);
    const stockValue = serialised
      ? money(byStatus.find((g) => g.status === DeviceStatus.IN_STOCK)?._sum.landedCost ?? ZERO)
      : money((level?.avgUnitCost ?? ZERO).times(level?.quantity ?? 0));

    return {
      warehouse,
      product: {
        ...product,
        purchasePrice: product.purchasePrice.toFixed(2),
        defaultSalePrice: product.defaultSalePrice.toFixed(2),
        // The browser groups by make, so that is what "category" means here.
        category: product.brand.name,
      },
      stock: {
        available,
        // Serialised stock knows exactly which units are where; a quantity
        // cannot, so these read zero rather than pretending.
        awaitingValidation: serialised ? countOf(DeviceStatus.RECEIVED) : 0,
        inShipment: serialised ? countOf(DeviceStatus.IN_TRANSFER) : 0,
        sold: serialised ? countOf(DeviceStatus.SOLD) : 0,
        returned: serialised ? countOf(DeviceStatus.RETURNED) : 0,
        damaged: serialised ? countOf(DeviceStatus.DAMAGED) : 0,
        lost: serialised ? countOf(DeviceStatus.LOST) : 0,
        stockValue,
        unitCost: serialised
          ? money(available > 0 ? new Prisma.Decimal(stockValue).dividedBy(available) : ZERO)
          : money(level?.avgUnitCost ?? ZERO),
        currency: 'EUR' as const,
        status: stockStatus(available),
        countedAt: level?.updatedAt?.toISOString() ?? null,
      },
      sellingPrice: price
        ? {
            price: price.price.toFixed(2),
            currency: price.currency,
            market: price.country?.name ?? 'Everywhere',
            since: price.validFrom.toISOString(),
          }
        : null,
      units: recentDevices.map((d) => ({
        id: d.id,
        // Not `d.imei!`: a label-received unit genuinely has none, and the
        // assertion sent a null through to the screen, which crashed the
        // whole product page trying to format it.
        imei: d.imei,
        label: d.label ? { code: d.label.code } : null,
        landedCost: d.landedCost?.toFixed(2) ?? null,
        receivedAt: d.receivedAt?.toISOString() ?? null,
      })),
      purchases: purchaseLines.map((line) => ({
        purchaseId: line.purchase.id,
        number: line.purchase.number,
        status: line.purchase.status,
        date: line.purchase.purchaseDate.toISOString(),
        supplier: line.purchase.supplier.name,
        ordered: line.quantity,
        received: line.receivedQuantity,
        unitPrice: line.unitPrice.toFixed(2),
        totalPrice: line.totalPrice.toFixed(2),
        currency: line.purchase.currency,
      })),
      sales: saleLines.map((line) => {
        const cost = line.devices.reduce((sum, d) => sum.plus(d.landedCost ?? ZERO), ZERO);
        return {
          saleId: line.sale.id,
          number: line.sale.number,
          date: line.sale.completedAt?.toISOString() ?? null,
          channel: line.sale.channel,
          customer: line.sale.customer?.name ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice.toFixed(2),
          totalPrice: line.totalPrice.toFixed(2),
          currency: line.sale.currency,
          cost: money(cost),
        };
      }),
      movements: [
        ...movements.map((m) => ({
          id: m.id,
          kind: 'DEVICE' as const,
          type: m.type,
          at: m.createdAt.toISOString(),
          quantity: 1,
          imei: m.device.imei,
          from: m.fromWarehouse?.name ?? null,
          to: m.toWarehouse?.name ?? null,
          reference: m.referenceNumber,
          referenceType: m.referenceType,
          referenceId: m.referenceId,
          by: m.performedBy?.name ?? null,
          notes: null as string | null,
        })),
        ...bulkLedger.map((m) => ({
          id: m.id,
          kind: 'QUANTITY' as const,
          type: m.type,
          at: m.createdAt.toISOString(),
          quantity: m.quantity,
          imei: null,
          from: m.quantity < 0 ? warehouse.name : null,
          to: m.quantity > 0 ? warehouse.name : null,
          reference: m.referenceNumber,
          referenceType: m.referenceType,
          referenceId: m.referenceId,
          by: m.performedBy?.name ?? null,
          notes: m.notes,
        })),
      ].sort((a, b) => b.at.localeCompare(a.at)),
    };
  }

  /**
   * One product's stock in one warehouse, valued the same way as everywhere.
   *
   * Phones are summed from the units themselves rather than counted and
   * multiplied, because each carries its own landed cost.
   */
  private async stockRows(warehouseId: string) {
    const [deviceRows, levels] = await Promise.all([
      this.prisma.device.groupBy({
        by: ['productId'],
        where: { status: DeviceStatus.IN_STOCK, currentWarehouseId: warehouseId },
        _sum: { landedCost: true },
        _count: { _all: true },
      }),
      this.prisma.stockLevel.findMany({
        where: { quantity: { gt: 0 }, warehouseId },
        select: { productId: true, quantity: true, avgUnitCost: true },
      }),
    ]);

    const productIds = [
      ...new Set([...deviceRows.map((r) => r.productId), ...levels.map((l) => l.productId)]),
    ];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        category: true,
        imageUrl: true,
        tracking: true,
        defaultSalePrice: true,
        currency: true,
        brand: { select: { id: true, name: true, imageUrl: true } },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const rows = [
      ...deviceRows.flatMap((row) => {
        const product = byId.get(row.productId);
        if (!product) return [];
        const value = row._sum.landedCost ?? ZERO;
        const quantity = row._count._all;
        return [
          {
            productId: product.id,
            name: product.name,
            sku: product.sku,
            barcode: product.barcode,
            category: product.brand.name,
            brandId: product.brand.id,
            brandImageUrl: product.brand.imageUrl,
            imageUrl: product.imageUrl,
            tracking: TrackingMode.SERIALIZED,
            quantity,
            unitCost: money(quantity > 0 ? value.dividedBy(quantity) : ZERO),
            stockValue: money(value),
            salePrice: product.defaultSalePrice.toFixed(2),
            saleCurrency: product.currency,
          },
        ];
      }),
      ...levels.flatMap((level) => {
        const product = byId.get(level.productId);
        if (!product) return [];
        return [
          {
            productId: product.id,
            name: product.name,
            sku: product.sku,
            barcode: product.barcode,
            category: product.brand.name,
            brandId: product.brand.id,
            brandImageUrl: product.brand.imageUrl,
            imageUrl: product.imageUrl,
            tracking: TrackingMode.BULK,
            quantity: level.quantity,
            unitCost: money(level.avgUnitCost),
            stockValue: money(level.avgUnitCost.times(level.quantity)),
            salePrice: product.defaultSalePrice.toFixed(2),
            saleCurrency: product.currency,
          },
        ];
      }),
    ];

    return { rows };
  }

  private async assertWarehouse(user: RequestUser, warehouseId: string) {
    // The check comes before the read, so an unauthorised id cannot even be
    // used to confirm that a warehouse exists.
    this.access.assertAccess(user, warehouseId);

    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, name: true, code: true, country: true, imageUrl: true },
    });
    if (!warehouse) throw BusinessError.notFound('Warehouse', warehouseId);
    return warehouse;
  }
}
