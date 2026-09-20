import type {
  Currency,
  PurchaseStatus,
  ReceiptSource,
  ReceiptStatus,
  SaleStatus,
  SalesChannel,
  ShipmentStatus,
  TransferStatus,
} from '../enums';
import type { NamedRef } from './common';

/**
 * Dates are the one place the two sides genuinely differ.
 *
 * The API holds a `Date`; JSON carries the ISO string it serialises to. Rather
 * than pretend either is universal, these types take the representation as a
 * parameter: the API annotates with `<Date>`, the web takes the default. Both
 * still check every other field, which is where drift actually happens.
 */
export interface PurchaseListItem<TDate = string> {
  id: string;
  number: string;
  status: PurchaseStatus;
  currency: Currency;
  totalAmount: string;
  purchaseDate: TDate;
  supplier: NamedRef;
  warehouse: NamedRef;
  expectedQuantity: number;
  receivedQuantity: number;
}

export interface TransferListItem<TDate = string> {
  id: string;
  number: string;
  status: TransferStatus;
  createdAt: TDate;
  sourceWarehouse: NamedRef;
  destinationWarehouse: NamedRef;
  shipment: { number: string; status: ShipmentStatus; shippedAt: TDate | null } | null;
  shipmentNumber: string | null;
  shipmentStatus: ShipmentStatus | null;
  plannedQuantity: number;
  loadedQuantity: number;
  receivedQuantity: number;
}

export interface SaleListItem<TDate = string> {
  id: string;
  number: string;
  status: SaleStatus;
  currency: Currency;
  totalAmount: string;
  totalCost: string;
  createdAt: TDate;
  completedAt: TDate | null;
  /** Null on a walk-in counter sale. */
  customer: NamedRef | null;
  warehouse: NamedRef;
  quantity: number;
  pickedQuantity: number;
}

export interface ReceiptListItem<TDate = string> {
  id: string;
  number: string;
  source: ReceiptSource;
  status: ReceiptStatus;
  expectedCount: number;
  scannedCount: number;
  createdAt: TDate;
  validatedAt: TDate | null;
  warehouse: NamedRef;
  createdBy: NamedRef | null;
  validatedBy: NamedRef | null;
  purchase: { id: string; number: string } | null;
  transfer: { id: string; number: string } | null;
}

export type { SalesChannel };
