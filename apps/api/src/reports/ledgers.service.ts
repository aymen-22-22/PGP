import { Injectable } from '@nestjs/common';
import { Prisma, TrackingMode } from '@prisma/client';
import {
  add,
  marginPercent,
  subtract,
  type SaleLedger,
  type SaleLedgerRow,
  type StockValueLedger,
} from '@phone-erp/shared-types';
import { paginate } from '../common/dto/pagination.dto';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import type { QueryLedgerDto } from './dto/ledger.dto';
import { buildLedgerScope, type LedgerScope } from './ledger-scope';

const ZERO = new Prisma.Decimal(0);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toFixed(2);


/**
 * The records behind each dashboard figure.
 *
 * Every total returned here is computed over the whole filtered set, never over
 * the page being displayed — a ledger that added up one page would contradict
 * the tile it was opened from the moment anyone turned to page two.
 *
 * Revenue needs one piece of care. The dashboard adds `Sale.totalAmountBase`,
 * which is the sale's own total converted once at the rate stamped on it.
 * Converting each line separately and adding those up can land a penny away,
 * because two roundings are not one rounding. So the sale's base total is
 * treated as the authoritative figure and apportioned across its lines by
 * value, with the remainder going to the largest line. The rows then add up to
 * the tile exactly, and each row still carries its real price in the currency
 * it was actually sold in.
 */
@Injectable()
export class LedgersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
  ) {}

  private scope(user: RequestUser, query: QueryLedgerDto): LedgerScope {
    return buildLedgerScope(this.access, user, query);
  }

  /** Context echoed back so the ledger header can state what it is showing. */
  private context(scope: LedgerScope) {
    return {
      warehouseId: scope.warehouseId,
      from: scope.from?.toISOString() ?? null,
      to: scope.to?.toISOString() ?? null,
    };
  }

  // ── stock value ───────────────────────────────────────────────────────────

  /**
   * What the shelf is worth, product by product.
   *
   * Phones are valued at the landed cost recorded on each unit, so a row's
   * value is the sum of its devices rather than a count times an average. The
   * average unit cost shown is derived from that sum, not the other way round.
   */
  async stockValue(user: RequestUser, query: QueryLedgerDto): Promise<StockValueLedger> {
    const scope = this.scope(user, query);

    const [deviceGroups, levels] = await Promise.all([
      this.prisma.device.groupBy({
        by: ['productId', 'currentWarehouseId'],
        where: scope.devicesInStock,
        _sum: { landedCost: true },
        _count: { _all: true },
      }),
      this.prisma.stockLevel.findMany({
        where: scope.bulkInStock,
        include: {
          product: { select: { id: true, name: true, sku: true, category: true, imageUrl: true } },
          warehouse: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);

    const productIds = [...new Set(deviceGroups.map((g) => g.productId))];
    const warehouseIds = [
      ...new Set(deviceGroups.map((g) => g.currentWarehouseId).filter(Boolean) as string[]),
    ];
    const [products, warehouses] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sku: true, category: true, imageUrl: true },
      }),
      this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, name: true, code: true },
      }),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

    const rows = [
      ...deviceGroups.flatMap((group) => {
        const product = productById.get(group.productId);
        const warehouse = group.currentWarehouseId
          ? warehouseById.get(group.currentWarehouseId)
          : undefined;
        if (!product || !warehouse) return [];
        const value = group._sum.landedCost ?? ZERO;
        const quantity = group._count._all;
        return [
          {
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            category: product.category,
            imageUrl: product.imageUrl,
            warehouseId: warehouse.id,
            warehouseName: warehouse.name,
            tracking: TrackingMode.SERIALIZED,
            quantity,
            // Derived from the total, so quantity × unit never disagrees with
            // the value by more than the display rounding.
            unitCost: money(quantity > 0 ? value.dividedBy(quantity) : ZERO),
            stockValue: money(value),
          },
        ];
      }),
      ...levels.map((level) => ({
        productId: level.product.id,
        productName: level.product.name,
        sku: level.product.sku,
        category: level.product.category,
        imageUrl: level.product.imageUrl,
        warehouseId: level.warehouse.id,
        warehouseName: level.warehouse.name,
        tracking: TrackingMode.BULK,
        quantity: level.quantity,
        unitCost: money(level.avgUnitCost),
        stockValue: money(level.avgUnitCost.times(level.quantity)),
      })),
    ];

    const filtered = this.applySearch(rows, query.search, (r) => [r.productName, r.sku, r.warehouseName]);
    const sorted = this.applySort(filtered, query.sort, query.direction, {
      product: (r) => r.productName,
      warehouse: (r) => r.warehouseName,
      quantity: (r) => r.quantity,
      value: (r) => Number(r.stockValue),
    }, 'value');

    const totals = {
      stockValue: sorted.reduce((sum, r) => add(sum, r.stockValue), '0.00'),
      quantity: sorted.reduce((sum, r) => sum + r.quantity, 0),
      products: new Set(sorted.map((r) => r.productId)).size,
      rows: sorted.length,
      currency: 'EUR' as const,
    };

    const page = sorted.slice(query.skip, query.skip + query.pageSize);
    return { ...paginate(page, sorted.length, query), totals, context: this.context(scope) };
  }

  // ── revenue, cost and profit share one query ──────────────────────────────

  /**
   * Sale lines in the period, each carrying its revenue, its cost and the
   * difference.
   *
   * One query serves three ledgers because they are three views of the same
   * rows: showing revenue without the cost beside it would invite exactly the
   * mismatch this whole feature exists to prevent.
   */
  private async saleLines(scope: LedgerScope) {
    const sales = await this.prisma.sale.findMany({
      where: scope.completedSales,
      select: {
        id: true,
        number: true,
        channel: true,
        currency: true,
        completedAt: true,
        totalAmount: true,
        totalAmountBase: true,
        totalCost: true,
        exchangeRate: true,
        customer: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            product: { select: { id: true, name: true, sku: true, category: true, tracking: true } },
            devices: {
              select: {
                id: true,
                imei: true,
                landedCost: true,
                // The supplier is reached through the purchase the unit
                // arrived on; a device has no supplier of its own.
                purchase: {
                  select: { id: true, number: true, supplier: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { completedAt: 'desc' },
    });

    const rows: SaleLedgerRow[] = [];
    for (const sale of sales) {
      // Apportion the sale's authoritative base total across its lines, so the
      // rows add up to the dashboard figure to the penny.
      const shares = this.apportion(
        sale.totalAmountBase,
        sale.items.map((i) => i.totalPrice),
      );

      // Cost is already per line: it is the landed cost of the exact units that
      // left, which is how the sale's own total cost was arrived at.
      const lineCosts = sale.items.map((item) =>
        item.devices.reduce((sum, d) => sum.plus(d.landedCost ?? ZERO), ZERO),
      );
      // Accessories carry no devices, so whatever the sale's total cost has
      // left over belongs to them, split by value.
      const accounted = lineCosts.reduce((sum, c) => sum.plus(c), ZERO);
      const remainder = sale.totalCost.minus(accounted);
      if (!remainder.isZero()) {
        const bulkIndexes = sale.items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.devices.length === 0);
        const bulkShares = this.apportion(
          remainder,
          bulkIndexes.map(({ item }) => item.totalPrice),
        );
        bulkIndexes.forEach(({ index }, k) => {
          lineCosts[index] = lineCosts[index].plus(bulkShares[k] ?? ZERO);
        });
      }

      sale.items.forEach((item, index) => {
        const revenueBase = shares[index] ?? ZERO;
        const cost = lineCosts[index] ?? ZERO;
        const origin = item.devices[0];
        rows.push({
          lineId: item.id,
          saleId: sale.id,
          reference: sale.number,
          channel: sale.channel,
          date: sale.completedAt?.toISOString() ?? null,
          productId: item.product.id,
          productName: item.product.name,
          sku: item.product.sku,
          category: item.product.category,
          tracking: item.product.tracking,
          quantity: item.quantity,
          unitPrice: money(item.unitPrice),
          lineTotal: money(item.totalPrice),
          currency: sale.currency,
          exchangeRate: sale.exchangeRate.toFixed(6),
          revenue: money(revenueBase),
          cost: money(cost),
          profit: money(revenueBase.minus(cost)),
          margin: marginPercent(money(revenueBase), money(revenueBase.minus(cost))),
          customerId: sale.customer?.id ?? null,
          customerName: sale.customer?.name ?? null,
          warehouseId: sale.warehouse.id,
          warehouseName: sale.warehouse.name,
          // Where these units came from, for the cost ledger.
          purchaseId: origin?.purchase?.id ?? null,
          purchaseNumber: origin?.purchase?.number ?? null,
          supplierName: origin?.purchase?.supplier?.name ?? null,
          imei: item.devices.length === 1 ? origin?.imei ?? null : null,
          unitCost: money(item.quantity > 0 ? cost.dividedBy(item.quantity) : ZERO),
        });
      });
    }
    return { rows, saleCount: sales.length };
  }

  async revenue(user: RequestUser, query: QueryLedgerDto): Promise<SaleLedger> {
    return this.saleLedger(user, query, 'revenue');
  }

  async cost(user: RequestUser, query: QueryLedgerDto): Promise<SaleLedger> {
    return this.saleLedger(user, query, 'cost');
  }

  async profit(user: RequestUser, query: QueryLedgerDto): Promise<SaleLedger> {
    return this.saleLedger(user, query, 'profit');
  }

  private async saleLedger(
    user: RequestUser,
    query: QueryLedgerDto,
    kind: 'revenue' | 'cost' | 'profit',
  ): Promise<SaleLedger> {
    const scope = this.scope(user, query);
    const { rows } = await this.saleLines(scope);

    let filtered = rows;
    if (query.productId) filtered = filtered.filter((r) => r.productId === query.productId);
    if (query.customerId) filtered = filtered.filter((r) => r.customerId === query.customerId);
    if (query.category) {
      filtered = filtered.filter((r) => (r.category ?? '').toLowerCase() === query.category!.toLowerCase());
    }
    filtered = this.applySearch(filtered, query.search, (r) => [
      r.productName,
      r.sku,
      r.reference,
      r.customerName ?? '',
      r.imei ?? '',
    ]);

    const defaultSort = kind === 'cost' ? 'cost' : kind === 'profit' ? 'profit' : 'date';
    const sorted = this.applySort(filtered, query.sort, query.direction, {
      date: (r) => r.date ?? '',
      reference: (r) => r.reference,
      product: (r) => r.productName,
      quantity: (r) => r.quantity,
      revenue: (r) => Number(r.revenue),
      cost: (r) => Number(r.cost),
      profit: (r) => Number(r.profit),
      customer: (r) => r.customerName ?? '',
      warehouse: (r) => r.warehouseName,
    }, defaultSort);

    const revenue = sorted.reduce((sum, r) => add(sum, r.revenue), '0.00');
    const cost = sorted.reduce((sum, r) => add(sum, r.cost), '0.00');
    const profit = subtract(revenue, cost);

    const totals = {
      revenue,
      cost,
      profit,
      margin: marginPercent(revenue, profit),
      quantity: sorted.reduce((sum, r) => sum + r.quantity, 0),
      lines: sorted.length,
      transactions: new Set(sorted.map((r) => r.saleId)).size,
      currency: 'EUR' as const,
    };

    const page = sorted.slice(query.skip, query.skip + query.pageSize);
    return { ...paginate(page, sorted.length, query), totals, context: this.context(scope) };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Splits a total across parts in proportion to their weights, exactly.
   *
   * Percentages of a money amount rarely divide evenly, so the shares are
   * rounded down and the leftover pennies handed to the largest part. The
   * result always adds back to the original — which is the entire reason this
   * exists rather than multiplying each line by a rate.
   */
  private apportion(total: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] {
    if (weights.length === 0) return [];
    if (weights.length === 1) return [total];

    const sum = weights.reduce((acc, w) => acc.plus(w), ZERO);
    if (sum.isZero()) {
      // Nothing to weigh by: give it all to the first line rather than losing it.
      return weights.map((_, i) => (i === 0 ? total : ZERO));
    }

    const shares = weights.map((w) => total.times(w).dividedBy(sum).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN));
    const allocated = shares.reduce((acc, s) => acc.plus(s), ZERO);
    const leftover = total.minus(allocated);

    if (!leftover.isZero()) {
      let largest = 0;
      weights.forEach((w, i) => {
        if (w.greaterThan(weights[largest])) largest = i;
      });
      shares[largest] = shares[largest].plus(leftover);
    }
    return shares;
  }

  private applySearch<T>(rows: T[], search: string | undefined, fields: (row: T) => string[]): T[] {
    if (!search?.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => fields(row).some((f) => f.toLowerCase().includes(needle)));
  }

  private applySort<T>(
    rows: T[],
    sort: string | undefined,
    direction: 'asc' | 'desc' | undefined,
    keys: Record<string, (row: T) => string | number>,
    fallback: string,
  ): T[] {
    const key = keys[sort ?? ''] ? sort! : fallback;
    const pick = keys[key];
    const sign = (direction ?? (key === 'date' ? 'desc' : 'desc')) === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      const left = pick(a);
      const right = pick(b);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign;
      return String(left).localeCompare(String(right)) * sign;
    });
  }
}
