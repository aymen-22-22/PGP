import type { Currency, TrackingMode } from '../enums';

/** A make: Apple, Samsung, Xiaomi. The stock browser groups by these. */
export interface BrandSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  isActive: boolean;
  products: number;
}

/** The brand as it arrives nested on a product. */
export interface BrandRef {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  /** The EAN-13 on the box. Identifies the model, never a unit. */
  barcode: string | null;
  brandId: string;
  brand: BrandRef;
  model: string;
  storage: string | null;
  color: string | null;
  category: string | null;
  imageUrl: string | null;
  tracking: TrackingMode;
  purchasePrice: string;
  defaultSalePrice: string;
  currency: Currency;
  isActive: boolean;
}

/** On-hand quantity of one accessory in one warehouse. */
export interface StockLevel {
  productId: string;
  productName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  quantity: number;
  avgUnitCost: string;
  salePrice: string;
  currency: Currency;
  stockValue: string;
}
