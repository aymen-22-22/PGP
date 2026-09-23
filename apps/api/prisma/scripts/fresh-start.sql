-- Fresh start: erase every transaction, keep the set-up.
--
-- Same effect as `npm run db:fresh-start`, for when Node/Prisma cannot run
-- (e.g. shared hosting). Paste into the Neon console → SQL Editor and run.
-- Take a backup (or a Neon branch) first: this cannot be undone.
--
-- Kept: countries, warehouses, cost centres, users, brands, products, prices,
-- suppliers, customers, delivery companies, drivers, exchange rates.

-- 1) What is about to be erased:
SELECT 'Purchase' AS what, count(*) FROM "Purchase"
UNION ALL SELECT 'Device', count(*) FROM "Device"
UNION ALL SELECT 'Transfer', count(*) FROM "Transfer"
UNION ALL SELECT 'Sale', count(*) FROM "Sale"
UNION ALL SELECT 'StockLevel', count(*) FROM "StockLevel"
UNION ALL SELECT 'AuditLog', count(*) FROM "AuditLog";

-- 2) Erase. One statement, no CASCADE: if a kept table pointed at one of
--    these, Postgres would refuse rather than empty it too.
BEGIN;
TRUNCATE
  "CostEntry", "CostDocument", "ReturnItem", "Return",
  "TransferDevice", "TransferItem", "Shipment", "Transfer",
  "ReceiptLine", "Receipt", "PurchaseUnitLabel",
  "DeviceMovement", "Device", "SaleItem", "Sale",
  "PurchaseItem", "Purchase", "Lot",
  "StockMovement", "StockLevel",
  "Notification", "AuditLog", "DocumentCounter"
RESTART IDENTITY;
COMMIT;

-- 3) Check: all zero, users and products still there.
SELECT
  (SELECT count(*) FROM "Purchase") AS purchases,
  (SELECT count(*) FROM "Device") AS phones,
  (SELECT count(*) FROM "Sale") AS sales,
  (SELECT count(*) FROM "User") AS users_kept,
  (SELECT count(*) FROM "Product") AS products_kept;
