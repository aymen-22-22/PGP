/** Domain enums, mirroring prisma/schema.prisma (the schema is the source of truth). */

export const Role = {
  ADMIN: 'ADMIN',
  WAREHOUSE_USER: 'WAREHOUSE_USER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const DeviceStatus = {
  EXPECTED: 'EXPECTED',
  RECEIVED: 'RECEIVED',
  PENDING_IDENTIFICATION: 'PENDING_IDENTIFICATION',
  IN_STOCK: 'IN_STOCK',
  IN_TRANSFER: 'IN_TRANSFER',
  SOLD: 'SOLD',
  RETURNED: 'RETURNED',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

export const PurchaseStatus = {
  DRAFT: 'DRAFT',
  ORDERED: 'ORDERED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseStatus = (typeof PurchaseStatus)[keyof typeof PurchaseStatus];

export const ReceiptStatus = {
  PENDING_VALIDATION: 'PENDING_VALIDATION',
  VALIDATED: 'VALIDATED',
} as const;
export type ReceiptStatus = (typeof ReceiptStatus)[keyof typeof ReceiptStatus];

export const ReceiptSource = {
  PURCHASE: 'PURCHASE',
  TRANSFER: 'TRANSFER',
} as const;
export type ReceiptSource = (typeof ReceiptSource)[keyof typeof ReceiptSource];

export const TransferStatus = {
  DRAFT: 'DRAFT',
  READY: 'READY',
  IN_TRANSIT: 'IN_TRANSIT',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type TransferStatus = (typeof TransferStatus)[keyof typeof TransferStatus];

export const ShipmentStatus = {
  PREPARING: 'PREPARING',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  RECEIVED: 'RECEIVED',
} as const;
export type ShipmentStatus = (typeof ShipmentStatus)[keyof typeof ShipmentStatus];

export const SaleStatus = {
  DRAFT: 'DRAFT',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type SaleStatus = (typeof SaleStatus)[keyof typeof SaleStatus];

export const ReturnStatus = {
  RETURNED: 'RETURNED',
  INSPECTION: 'INSPECTION',
  RESTOCKED: 'RESTOCKED',
  DAMAGED: 'DAMAGED',
} as const;
export type ReturnStatus = (typeof ReturnStatus)[keyof typeof ReturnStatus];

export const MovementType = {
  PURCHASE_RECEIPT: 'PURCHASE_RECEIPT',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  SALE: 'SALE',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
  IDENTIFIED: 'IDENTIFIED',
} as const;
export type MovementType = (typeof MovementType)[keyof typeof MovementType];

export const Currency = {
  EUR: 'EUR',
  USD: 'USD',
  DZD: 'DZD',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  CHANGE_PASSWORD: 'CHANGE_PASSWORD',
  CREATE_USER: 'CREATE_USER',
  CHANGE_USER: 'CHANGE_USER',
  CREATE_PURCHASE: 'CREATE_PURCHASE',
  RECEIVE_PURCHASE: 'RECEIVE_PURCHASE',
  VALIDATE_RECEIPT: 'VALIDATE_RECEIPT',
  IDENTIFY_DEVICE: 'IDENTIFY_DEVICE',
  CREATE_TRANSFER: 'CREATE_TRANSFER',
  SHIP_TRANSFER: 'SHIP_TRANSFER',
  RECEIVE_TRANSFER: 'RECEIVE_TRANSFER',
  CREATE_SALE: 'CREATE_SALE',
  COMPLETE_SALE: 'COMPLETE_SALE',
  CANCEL_SALE: 'CANCEL_SALE',
  CREATE_RETURN: 'CREATE_RETURN',
  ADJUST_STOCK: 'ADJUST_STOCK',
  CREATE_PRODUCT: 'CREATE_PRODUCT',
  CHANGE_PRODUCT: 'CHANGE_PRODUCT',
  CREATE_WAREHOUSE: 'CREATE_WAREHOUSE',
  CHANGE_WAREHOUSE: 'CHANGE_WAREHOUSE',
  CREATE_SUPPLIER: 'CREATE_SUPPLIER',
  CREATE_CUSTOMER: 'CREATE_CUSTOMER',
  CREATE_DELIVERY_COMPANY: 'CREATE_DELIVERY_COMPANY',
  UPDATE_DELIVERY_COMPANY: 'UPDATE_DELIVERY_COMPANY',
  DELETE_DELIVERY_COMPANY: 'DELETE_DELIVERY_COMPANY',
  CREATE_DRIVER: 'CREATE_DRIVER',
  UPDATE_DRIVER: 'UPDATE_DRIVER',
  DELETE_DRIVER: 'DELETE_DRIVER',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/**
 * How a product's stock is counted.
 *
 * SERIALIZED is a phone: every unit carries an IMEI and is costed specifically.
 * BULK is an accessory, where the units are identical and the only honest
 * answer is a quantity and an average.
 */
export const TrackingMode = {
  SERIALIZED: 'SERIALIZED',
  BULK: 'BULK',
} as const;
export type TrackingMode = (typeof TrackingMode)[keyof typeof TrackingMode];

/** What a bill that lands on stock actually was. */
export const CostType = {
  PURCHASE: 'PURCHASE',
  HANDLING: 'HANDLING',
  FREIGHT: 'FREIGHT',
  CUSTOMS: 'CUSTOMS',
  INSURANCE: 'INSURANCE',
  OTHER: 'OTHER',
} as const;
export type CostType = (typeof CostType)[keyof typeof CostType];

/** How one bill is spread across the units it applies to. */
export const AllocationMethod = {
  QUANTITY: 'QUANTITY',
  VALUE: 'VALUE',
  MANUAL: 'MANUAL',
} as const;
export type AllocationMethod = (typeof AllocationMethod)[keyof typeof AllocationMethod];

/** What a cost document attaches to, which decides the units it covers. */
export const CostScope = {
  RECEIPT: 'RECEIPT',
  SHIPMENT: 'SHIPMENT',
  LOT: 'LOT',
  DEVICES: 'DEVICES',
} as const;
export type CostScope = (typeof CostScope)[keyof typeof CostScope];

export const CostDocumentStatus = {
  DRAFT: 'DRAFT',
  POSTED: 'POSTED',
  REVERSED: 'REVERSED',
} as const;
export type CostDocumentStatus = (typeof CostDocumentStatus)[keyof typeof CostDocumentStatus];

export const SalesChannel = {
  B2B: 'B2B',
  POS: 'POS',
} as const;
export type SalesChannel = (typeof SalesChannel)[keyof typeof SalesChannel];

