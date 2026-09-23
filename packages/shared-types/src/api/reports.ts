import type { Currency, DeviceStatus, SalesChannel, TrackingMode } from '../enums';

export interface DashboardTotals {
  totalDevices: number;
  available: number;
  pendingValidation: number;
  inTransfer: number;
  sold: number;
  returned: number;
  damaged: number;
  lost: number;
}

export interface Dashboard {
  scope: 'GLOBAL' | 'WAREHOUSE';
  warehouseId: string | null;
  totals: DashboardTotals;
  stockValue: string;
  financials: {
    revenue: string;
    /** What the units sold cost to land — cost of sales, not purchase-order spend. */
    purchaseCost: string;
    profit: string;
    margin: string;
    currency: Currency;
    completedSales: number;
  };
  movement: {
    inTransit: number;
    incoming: number;
    outgoing: number;
    openPurchases: number;
    openTransfers: number;
    /** Outstanding purchase orders plus shipments in — what Receive lists. */
    pendingReceipts: number;
  };
  byWarehouse: {
    warehouseId: string;
    warehouseName: string;
    warehouseCode: string;
    available: number;
    pendingValidation: number;
    inTransfer: number;
    sold: number;
    total: number;
  }[];
  /** Plain-language summary for the top of the dashboard. */
  today: {
    sales: number;
    revenue: string;
    yesterdaySales: number;
    yesterdayRevenue: string;
    /** In transit for more than three days. */
    lateTransfers: number;
  };
}

/** What a ledger was asked for, echoed back so its header can say so. */
export interface LedgerContext {
  warehouseId: string | null;
  from: string | null;
  to: string | null;
}

/**
 * Ledger totals always describe the whole filtered set, never the page.
 *
 * A ledger that added up one page would contradict the dashboard tile it was
 * opened from the moment anyone turned to page two.
 */
export interface LedgerTotals {
  revenue?: string;
  cost?: string;
  profit?: string;
  margin?: string;
  stockValue?: string;
  quantity: number;
  lines?: number;
  rows?: number;
  products?: number;
  transactions?: number;
  currency: 'EUR';
}

/** One row of the stock-value ledger: a product in a warehouse. */
export interface StockValueLedgerRow {
  productId: string;
  productName: string;
  sku: string;
  category: string | null;
  imageUrl: string | null;
  warehouseId: string;
  warehouseName: string;
  tracking: TrackingMode;
  quantity: number;
  unitCost: string;
  stockValue: string;
}

/** One line of one completed sale, carrying revenue, cost and the difference. */
export interface SaleLedgerRow {
  lineId: string;
  saleId: string;
  reference: string;
  channel: SalesChannel | string;
  date: string | null;
  productId: string;
  productName: string;
  sku: string;
  category: string | null;
  tracking: TrackingMode;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  currency: Currency;
  exchangeRate: string;
  revenue: string;
  cost: string;
  profit: string;
  margin: string;
  customerId: string | null;
  customerName: string | null;
  warehouseId: string;
  warehouseName: string;
  /** Where the units came from, for the cost ledger. */
  purchaseId: string | null;
  purchaseNumber: string | null;
  supplierName: string | null;
  imei: string | null;
  unitCost: string;
}

export interface Ledger<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  totals: LedgerTotals;
  context: LedgerContext;
}

export type StockValueLedger = Ledger<StockValueLedgerRow>;
export type SaleLedger = Ledger<SaleLedgerRow>;

export interface InventoryRow {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  productId: string;
  productName: string;
  sku: string;
  unitCost: string;
  tracking: TrackingMode;
  expected: number;
  pendingValidation: number;
  inStock: number;
  inTransfer: number;
  sold: number;
  returned: number;
  damaged: number;
  lost: number;
}

export interface StockDevice {
  id: string;
  imei: string;
  status: DeviceStatus;
  receivedAt: string | null;
  product: { id: string; name: string; sku: string };
  currentWarehouse: { id: string; name: string } | null;
}
