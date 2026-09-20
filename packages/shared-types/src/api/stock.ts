import type { TrackingMode } from '../enums';
import type { Product } from './catalogue';
import type { WarehouseRef } from './common';

/** Whether a figure needs attention, decided server-side so every screen agrees. */
export type StockStatus = 'IN_STOCK' | 'LOW' | 'OUT_OF_STOCK';

/** A warehouse card: the way into the stock. */
export interface WarehouseStockCard {
  id: string;
  name: string;
  code: string;
  location: string;
  imageUrl: string | null;
  countryCode: string | null;
  products: number;
  /** Distinct brands holding stock here. */
  categories: number;
  quantity: number;
  stockValue: string;
  currency: 'EUR';
}

/** A brand card inside one warehouse. */
export interface BrandStockCard {
  /** The brand name. Called `category` because it is the browser's middle level. */
  category: string;
  products: number;
  quantity: number;
  stockValue: string;
  imageUrl: string | null;
  currency: 'EUR';
}

/** One product's stock in one warehouse, before the per-status detail. */
export interface ProductStockRow {
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  imageUrl: string | null;
  brandId: string;
  brandImageUrl: string | null;
  tracking: TrackingMode;
  quantity: number;
  unitCost: string;
  stockValue: string;
  salePrice: string;
  saleCurrency: string;
}

/** A product card, with what is on the way out and already gone. */
export interface ProductStockCard extends ProductStockRow {
  inShipment: number;
  sold: number;
  status: StockStatus;
}

export interface WarehouseStockCards {
  data: WarehouseStockCard[];
  meta: { total: number };
}

export interface BrandStockCards {
  warehouse: WarehouseRef & { country: string; imageUrl: string | null };
  data: BrandStockCard[];
  meta: { total: number };
}

export interface ProductStockCards {
  warehouse: WarehouseRef & { country: string; imageUrl: string | null };
  category: string;
  data: ProductStockCard[];
  meta: { total: number };
}

/** Everything that has happened to one product in one warehouse. */
export interface Product360 {
  warehouse: WarehouseRef & { country: string; imageUrl: string | null };
  /**
   * The product, with `category` carrying its brand name — the browser's
   * middle level. Deliberately not re-declaring `brand`: an intersection that
   * restates a field masks any change to it, which defeats the point.
   */
  product: Omit<Product, 'category'> & { category: string };
  stock: {
    available: number;
    awaitingValidation: number;
    inShipment: number;
    sold: number;
    returned: number;
    damaged: number;
    lost: number;
    stockValue: string;
    unitCost: string;
    currency: 'EUR';
    status: StockStatus;
    countedAt: string | null;
  };
  sellingPrice: { price: string; currency: string; market: string; since: string } | null;
  units: { id: string; imei: string; landedCost: string | null; receivedAt: string | null }[];
  purchases: {
    purchaseId: string;
    number: string;
    status: string;
    date: string;
    supplier: string;
    ordered: number;
    received: number;
    unitPrice: string;
    totalPrice: string;
    currency: string;
  }[];
  sales: {
    saleId: string;
    number: string;
    date: string | null;
    channel: string;
    customer: string | null;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
    currency: string;
    cost: string;
  }[];
  movements: {
    id: string;
    kind: 'DEVICE' | 'QUANTITY';
    type: string;
    at: string;
    quantity: number;
    imei: string | null;
    from: string | null;
    to: string | null;
    reference: string | null;
    referenceType: string | null;
    referenceId: string | null;
    by: string | null;
    notes: string | null;
  }[];
}
