import { DeviceStatus, Prisma, SaleStatus } from '@prisma/client';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';

export interface LedgerFilters {
  warehouseId?: string;
  from?: string;
  to?: string;
}

/**
 * The exact set of records behind each dashboard figure.
 *
 * Every KPI and the ledger that explains it read their rows from here, so the
 * two can never disagree about which records count. A ledger that built its own
 * `where` clause would eventually drift from the tile it claims to explain, and
 * the whole point of the drill-down is that the number can be trusted.
 */
export interface LedgerScope {
  /** Null for an administrator looking at every warehouse. */
  warehouseId: string | null;
  from: Date | null;
  to: Date | null;
  /** Phones counted as stock on hand. */
  devicesInStock: Prisma.DeviceWhereInput;
  /** Accessory quantities counted as stock on hand. */
  bulkInStock: Prisma.StockLevelWhereInput;
  /** Completed sales in the period — the source of revenue, cost and profit. */
  completedSales: Prisma.SaleWhereInput;
}

export function buildLedgerScope(
  access: WarehouseAccessService,
  user: RequestUser,
  filters: LedgerFilters,
): LedgerScope {
  const isAdmin = access.isAdmin(user);
  // A warehouse user always sees their own warehouse, whatever they ask for.
  const scopeId = isAdmin ? (filters.warehouseId ?? null) : (user.warehouseId ?? null);
  if (!isAdmin && !user.warehouseId) {
    throw new Error('Warehouse user without a warehouse');
  }

  const from = filters.from ? new Date(filters.from) : null;
  const to = filters.to ? new Date(filters.to) : null;

  return {
    warehouseId: scopeId,
    from,
    to,
    devicesInStock: {
      status: DeviceStatus.IN_STOCK,
      ...(scopeId ? { currentWarehouseId: scopeId } : {}),
    },
    bulkInStock: {
      quantity: { gt: 0 },
      ...(scopeId ? { warehouseId: scopeId } : {}),
    },
    completedSales: {
      status: SaleStatus.COMPLETED,
      ...(scopeId ? { warehouseId: scopeId } : {}),
      ...(from || to
        ? { completedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
  };
}
