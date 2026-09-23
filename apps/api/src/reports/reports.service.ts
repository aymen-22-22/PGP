import { Injectable } from '@nestjs/common';
import { Currency, DeviceStatus, Prisma, SaleStatus, TransferStatus } from '@prisma/client';
import { add, marginPercent, subtract, toMinor, type Dashboard } from '@phone-erp/shared-types';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { buildLedgerScope } from './ledger-scope';

/**
 * Dashboard figures (spec §19, §35).
 *
 * Profit is deliberately simple and explainable: revenue is the total of
 * completed sales, cost is the purchase cost of the exact phones those sales
 * shipped — frozen on the sale at completion — and profit is the difference.
 * No accruals, no landed cost, no accounting engine.
 */
/** A transfer still on the road after this many days is flagged as late. */
const LATE_AFTER_DAYS = 3;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
  ) {}

  async dashboard(
    user: RequestUser,
    warehouseId?: string,
    from?: string,
    to?: string,
  ): Promise<Dashboard> {
    const isAdmin = this.access.isAdmin(user);
    // One definition of "which records count", shared with every ledger that
    // explains one of these figures.
    const scope = buildLedgerScope(this.access, user, { warehouseId, from, to });
    const scopeId = scope.warehouseId ?? undefined;

    const deviceScope: Prisma.DeviceWhereInput = scopeId ? { currentWarehouseId: scopeId } : {};
    const saleScope: Prisma.SaleWhereInput = scope.completedSales;

    const [
      byStatus,
      salesAgg,
      stockValue,
      bulkLevels,
      inTransit,
      incoming,
      outgoing,
      openTransfers,
      byWarehouse,
      openPurchases,
    ] =
      await Promise.all([
        this.prisma.device.groupBy({
          by: ['status'],
          where: deviceScope,
          _count: { _all: true },
        }),
        this.prisma.sale.aggregate({
          where: saleScope,
          // totalAmountBase, not totalAmount: sales happen in several
          // currencies and only the reporting figure is comparable.
          _sum: { totalAmountBase: true, totalCost: true },
          _count: { _all: true },
        }),
        // Stock value = purchase cost of everything currently sellable.
        this.prisma.device.aggregate({
          where: scope.devicesInStock,
          _sum: { landedCost: true },
        }),
        // Accessories hold value too, and leaving them out would understate
        // the shelf by however much the cable wall is worth.
        this.prisma.stockLevel.findMany({
          where: scope.bulkInStock,
          select: { quantity: true, avgUnitCost: true },
        }),
        this.prisma.device.count({
          where: scopeId
            ? { status: DeviceStatus.IN_TRANSFER, transfer: { sourceWarehouseId: scopeId } }
            : { status: DeviceStatus.IN_TRANSFER },
        }),
        this.prisma.transferDevice.count({
          where: {
            receivedAt: null,
            transfer: {
              status: TransferStatus.IN_TRANSIT,
              ...(scopeId ? { destinationWarehouseId: scopeId } : {}),
            },
          },
        }),
        // Units in transit away from the scope — the mirror of `incoming`.
        this.prisma.transferDevice.count({
          where: {
            receivedAt: null,
            transfer: {
              status: TransferStatus.IN_TRANSIT,
              ...(scopeId ? { sourceWarehouseId: scopeId } : {}),
            },
          },
        }),
        // Transfers still to be received here — documents, not units, because
        // that is what the Receive page lists and the dashboard card counts.
        this.prisma.transfer.count({
          where: {
            status: TransferStatus.IN_TRANSIT,
            ...(scopeId ? { destinationWarehouseId: scopeId } : {}),
          },
        }),
        isAdmin && !warehouseId ? this.warehouseBreakdown() : Promise.resolve([]),
        this.prisma.purchase.count({
          where: {
            ...(scopeId ? { warehouseId: scopeId } : {}),
            status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] },
          },
        }),
      ]);

    const counts = Object.fromEntries(
      Object.values(DeviceStatus).map((s) => [s, byStatus.find((g) => g.status === s)?._count._all ?? 0]),
    ) as Record<DeviceStatus, number>;

    // Accessories have no Device rows behind them, so the "ready to sell" total
    // is the IN_STOCK phones plus the quantities on hand — the same bulkLevels
    // already read for the stock value.
    const bulkAvailable = bulkLevels
      .reduce((sum, l) => sum.plus(l.quantity), new Prisma.Decimal(0))
      .toNumber();

    const today = await this.todayAtAGlance(saleScope, scopeId);

    const revenue = salesAgg._sum.totalAmountBase?.toFixed(2) ?? '0.00';
    const purchaseCost = salesAgg._sum.totalCost?.toFixed(2) ?? '0.00';
    const profit = subtract(revenue, purchaseCost);

    return {
      scope: scopeId ? ('WAREHOUSE' as const) : ('GLOBAL' as const),
      warehouseId: scopeId ?? null,
      totals: {
        totalDevices: Object.values(counts).reduce((a, b) => a + b, 0),
        available: counts.IN_STOCK + bulkAvailable,
        pendingValidation: counts.RECEIVED,
        inTransfer: counts.IN_TRANSFER,
        sold: counts.SOLD,
        returned: counts.RETURNED,
        damaged: counts.DAMAGED,
        lost: counts.LOST,
      },
      stockValue: add(
        stockValue._sum.landedCost?.toFixed(2) ?? '0.00',
        bulkLevels
          .reduce(
            (sum, l) => sum.plus(l.avgUnitCost.times(l.quantity)),
            new Prisma.Decimal(0),
          )
          .toDecimalPlaces(2)
          .toFixed(2),
      ),
      financials: {
        revenue,
        purchaseCost,
        profit,
        margin: marginPercent(revenue, profit),
        currency: Currency.EUR,
        completedSales: salesAgg._count._all,
      },
      movement: {
        inTransit,
        incoming,
        outgoing,
        openPurchases,
        openTransfers,
        // What the Receive page actually has waiting: outstanding purchase
        // orders plus shipments in from other warehouses. `incoming` counts
        // transfer units alone, so the card read 0 with a full loading bay.
        pendingReceipts: openPurchases + openTransfers,
      },
      byWarehouse,
      today,
    };
  }

  /**
   * The few numbers the dashboard says in words: today against yesterday, and
   * transfers that have been on the road too long.
   */
  private async todayAtAGlance(saleScope: Prisma.SaleWhereInput, scopeId?: string): Promise<Dashboard['today']> {
    const startToday = new Date();
    startToday.setUTCHours(0, 0, 0, 0);
    const startYesterday = new Date(startToday.getTime() - 86_400_000);
    const lateBefore = new Date(Date.now() - LATE_AFTER_DAYS * 86_400_000);

    const sales = (from: Date, to?: Date) =>
      this.prisma.sale.aggregate({
        where: {
          AND: [saleScope, { completedAt: { gte: from, ...(to ? { lt: to } : {}) } }],
        },
        _sum: { totalAmountBase: true },
        _count: { _all: true },
      });

    const [now, before, late] = await Promise.all([
      sales(startToday),
      sales(startYesterday, startToday),
      this.prisma.transfer.count({
        where: {
          status: TransferStatus.IN_TRANSIT,
          shipment: { shippedAt: { lt: lateBefore } },
          ...(scopeId
            ? { OR: [{ sourceWarehouseId: scopeId }, { destinationWarehouseId: scopeId }] }
            : {}),
        },
      }),
    ]);

    return {
      sales: now._count._all,
      revenue: now._sum.totalAmountBase?.toFixed(2) ?? '0.00',
      yesterdaySales: before._count._all,
      yesterdayRevenue: before._sum.totalAmountBase?.toFixed(2) ?? '0.00',
      lateTransfers: late,
    };
  }

  /** Per-product profit for completed sales — the "what actually earns" view. */
  async profitByProduct(user: RequestUser, from?: string, to?: string) {
    const scopeId = this.access.isAdmin(user) ? undefined : (user.warehouseId ?? undefined);

    const items = await this.prisma.saleItem.findMany({
      where: {
        sale: {
          status: SaleStatus.COMPLETED,
          ...(scopeId ? { warehouseId: scopeId } : {}),
          ...(from || to
            ? {
                completedAt: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              }
            : {}),
        },
      },
      select: {
        totalPrice: true,
        quantity: true,
        product: { select: { id: true, name: true, sku: true } },
        devices: { select: { landedCost: true } },
        // The rate stamped on the sale, so a dinar line and a euro line can be
        // added together — and neither moves when the rate does.
        sale: { select: { exchangeRate: true, currency: true } },
      },
    });

    const byProduct = new Map<
      string,
      { productId: string; productName: string; sku: string; quantity: number; revenue: string; cost: string }
    >();

    for (const item of items) {
      const key = item.product.id;
      const row = byProduct.get(key) ?? {
        productId: item.product.id,
        productName: item.product.name,
        sku: item.product.sku,
        quantity: 0,
        revenue: '0.00',
        cost: '0.00',
      };
      row.quantity += item.quantity;
      const revenueInBase = item.totalPrice.times(item.sale.exchangeRate).toDecimalPlaces(2);
      row.revenue = add(row.revenue, revenueInBase.toFixed(2));
      for (const device of item.devices) {
        row.cost = add(row.cost, device.landedCost?.toFixed(2) ?? '0.00');
      }
      byProduct.set(key, row);
    }

    const data = [...byProduct.values()]
      .map((r) => {
        const profit = subtract(r.revenue, r.cost);
        return { ...r, profit, margin: marginPercent(r.revenue, profit) };
      })
      .sort((a, b) => Number(toMinor(b.profit) - toMinor(a.profit)));

    const totals = data.reduce(
      (acc, r) => ({
        quantity: acc.quantity + r.quantity,
        revenue: add(acc.revenue, r.revenue),
        cost: add(acc.cost, r.cost),
      }),
      { quantity: 0, revenue: '0.00', cost: '0.00' },
    );
    const totalProfit = subtract(totals.revenue, totals.cost);

    return {
      data,
      totals: { ...totals, profit: totalProfit, margin: marginPercent(totals.revenue, totalProfit) },
    };
  }

  private async warehouseBreakdown() {
    const [warehouses, grouped, bulkLevels] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.device.groupBy({
        by: ['currentWarehouseId', 'status'],
        _count: { _all: true },
      }),
      // Accessories again counted here, or a warehouse of only cables reads as
      // empty while the dashboard tile above it says otherwise.
      this.prisma.stockLevel.groupBy({
        by: ['warehouseId'],
        where: { quantity: { gt: 0 } },
        _sum: { quantity: true },
      }),
    ]);
    const bulkByWarehouse = new Map(bulkLevels.map((l) => [l.warehouseId, l._sum.quantity ?? 0]));

    return warehouses.map((w) => {
      const rows = grouped.filter((g) => g.currentWarehouseId === w.id);
      const count = (status: DeviceStatus) => rows.find((r) => r.status === status)?._count._all ?? 0;
      return {
        warehouseId: w.id,
        warehouseName: w.name,
        warehouseCode: w.code,
        available: count(DeviceStatus.IN_STOCK) + (bulkByWarehouse.get(w.id) ?? 0),
        pendingValidation: count(DeviceStatus.RECEIVED),
        inTransfer: count(DeviceStatus.IN_TRANSFER),
        sold: count(DeviceStatus.SOLD),
        total: rows.reduce((a, r) => a + r._count._all, 0) + (bulkByWarehouse.get(w.id) ?? 0),
      };
    });
  }
}

