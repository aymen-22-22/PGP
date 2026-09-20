import { Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma, TrackingMode } from '@prisma/client';
import type { InventoryRow, Listed } from '@phone-erp/shared-types';
import { paginate } from '../common/dto/pagination.dto';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { QueryInventoryDto, QueryStockDevicesDto } from './dto/inventory.dto';

/**
 * Stock is always derived, never stored (spec §18, §48).
 *
 * Every number here is a COUNT over Device rows with the relevant status, so
 * there is no "inventory" table that could drift from the physical devices.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
  ) {}

  /** Stock per warehouse × product, one grouped query. */
  async summary(user: RequestUser, query: QueryInventoryDto): Promise<Listed<InventoryRow>> {
    const scope = this.access.filterFor<Prisma.DeviceWhereInput>(
      user,
      'currentWarehouseId',
      query.warehouseId,
    );
    // filterFor returns either a plain id or an `{ in: [...] }` filter, and a
    // string spread into an object becomes `{ 0: '9', 1: 'b', … }` — which
    // Prisma rejects. Narrow before combining rather than spreading blind.
    const warehouseScope = scope.currentWarehouseId;
    const warehouseWhere: Prisma.DeviceWhereInput['currentWarehouseId'] =
      typeof warehouseScope === 'string' ? warehouseScope : { not: null, ...(warehouseScope ?? {}) };

    const where: Prisma.DeviceWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.status ? { status: query.status } : {}),
      currentWarehouseId: warehouseWhere,
    };

    const grouped = await this.prisma.device.groupBy({
      by: ['currentWarehouseId', 'productId', 'status'],
      where,
      _count: { _all: true },
    });

    const warehouseIds = [...new Set(grouped.map((g) => g.currentWarehouseId).filter(Boolean))] as string[];
    const productIds = [...new Set(grouped.map((g) => g.productId))];

    const [warehouses, products] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          sku: true,
          purchasePrice: true,
          defaultSalePrice: true,
          tracking: true,
        },
      }),
    ]);
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
    const productById = new Map(products.map((p) => [p.id, p]));

    const rows = new Map<string, StockRow>();
    for (const g of grouped) {
      if (!g.currentWarehouseId) continue;
      const key = `${g.currentWarehouseId}:${g.productId}`;
      const warehouse = warehouseById.get(g.currentWarehouseId);
      const product = productById.get(g.productId);
      if (!warehouse || !product) continue;

      const row =
        rows.get(key) ??
        emptyRow({
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          warehouseCode: warehouse.code,
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          unitCost: product.purchasePrice.toFixed(2),
          tracking: product.tracking,
        });
      row[STATUS_FIELD[g.status]] += g._count._all;
      rows.set(key, row);
    }

    // Accessories have no Device rows to group, so their on-hand figure comes
    // from the level table and is merged into the same shape — the screen
    // should show one stock list, not two.
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        quantity: { not: 0 },
        ...(query.productId ? { productId: query.productId } : {}),
        ...(typeof warehouseScope === 'string'
          ? { warehouseId: warehouseScope }
          : warehouseScope?.in
            ? { warehouseId: { in: warehouseScope.in as string[] } }
            : {}),
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        warehouse: { select: { id: true, name: true, code: true } },
      },
    });

    // A status filter asking for anything but IN_STOCK cannot match a quantity:
    // there is no such thing as a damaged-but-counted cable in this model.
    const wantsBulk = !query.status || query.status === DeviceStatus.IN_STOCK;
    if (wantsBulk) {
      for (const level of levels) {
        const row = emptyRow({
          warehouseId: level.warehouse.id,
          warehouseName: level.warehouse.name,
          warehouseCode: level.warehouse.code,
          productId: level.product.id,
          productName: level.product.name,
          sku: level.product.sku,
          unitCost: level.avgUnitCost.toDecimalPlaces(2).toFixed(2),
          tracking: TrackingMode.BULK,
        });
        row.inStock = level.quantity;
        rows.set(`${level.warehouseId}:${level.productId}`, row);
      }
    }

    const data = [...rows.values()].sort(
      (a, b) => a.warehouseName.localeCompare(b.warehouseName) || a.productName.localeCompare(b.productName),
    );
    return { data, meta: { total: data.length } };
  }

  /** Individual devices behind a stock figure — the drill-down from any tile. */
  async devices(user: RequestUser, query: QueryStockDevicesDto) {
    const where: Prisma.DeviceWhereInput = {
      ...this.access.filterFor<Prisma.DeviceWhereInput>(user, 'currentWarehouseId', query.warehouseId),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { imei: { contains: query.search } },
              { serialNumber: { contains: query.search } },
              { product: { name: { contains: query.search, mode: 'insensitive' } } },
              { product: { sku: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.device.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        select: {
          id: true,
          imei: true,
          status: true,
          receivedAt: true,
          product: { select: { id: true, name: true, sku: true } },
          currentWarehouse: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.device.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  /** Headline counts for one warehouse. */
  async forWarehouse(user: RequestUser, warehouseId: string) {
    this.access.assertAccess(user, warehouseId);

    const [grouped, incoming, bulk] = await Promise.all([
      this.prisma.device.groupBy({
        by: ['status'],
        where: { currentWarehouseId: warehouseId },
        _count: { _all: true },
      }),
      this.prisma.transferDevice.count({
        where: {
          receivedAt: null,
          transfer: { destinationWarehouseId: warehouseId, status: 'IN_TRANSIT' },
        },
      }),
      this.prisma.stockLevel.aggregate({
        where: { warehouseId, quantity: { gt: 0 } },
        _sum: { quantity: true },
      }),
    ]);

    const counts = Object.fromEntries(
      Object.values(DeviceStatus).map((s) => [s, grouped.find((g) => g.status === s)?._count._all ?? 0]),
    ) as Record<DeviceStatus, number>;

    return {
      warehouseId,
      // Accessories hold only quantity on the level table, so "available" is
      // the sellable phones plus the on-hand accessories.
      available: counts.IN_STOCK + (bulk._sum.quantity ?? 0),
      pendingValidation: counts.RECEIVED,
      pendingIdentification: counts.PENDING_IDENTIFICATION,
      inTransfer: counts.IN_TRANSFER,
      sold: counts.SOLD,
      returned: counts.RETURNED,
      damaged: counts.DAMAGED,
      lost: counts.LOST,
      incoming,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    };
  }
}

type StockRow = ReturnType<typeof emptyRow>;
type StockCountField = Exclude<keyof StockRow, keyof StockRowBase>;

interface StockRowBase {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  productId: string;
  productName: string;
  sku: string;
  unitCost: string;
  tracking: TrackingMode;
}

const STATUS_FIELD: Record<DeviceStatus, StockCountField> = {
  EXPECTED: 'expected',
  RECEIVED: 'pendingValidation',
  PENDING_IDENTIFICATION: 'pendingIdentification',
  IN_STOCK: 'inStock',
  IN_TRANSFER: 'inTransfer',
  SOLD: 'sold',
  RETURNED: 'returned',
  DAMAGED: 'damaged',
  LOST: 'lost',
};

function emptyRow(base: StockRowBase) {
  return {
    ...base,
    expected: 0,
    pendingValidation: 0,
    pendingIdentification: 0,
    inStock: 0,
    inTransfer: 0,
    sold: 0,
    returned: 0,
    damaged: 0,
    lost: 0,
  };
}
