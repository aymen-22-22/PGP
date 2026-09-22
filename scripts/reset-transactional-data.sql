-- One-off reset: wipes every table except User and _prisma_migrations, so the
-- app can be exercised fresh with the label-first purchase workflow without
-- carrying over pre-label test data. Logins are kept — nobody has to be
-- reseeded to get back in.
--
-- Deliberately a plain SQL file, not a script or workflow: deleting all data
-- should take a conscious, manual step each time, never a button that's one
-- click (or one bad `confirm: MIGRATE`-style typo) away from firing again.
--
-- Run it directly against Neon:
--   psql "$DATABASE_URL" -f scripts/reset-transactional-data.sql
-- from anywhere that already reaches Neon (the cPanel host's shell, using
-- apps/api/.env's DATABASE_URL, is the known-working path).
--
-- Irreversible. Take a Neon branch/snapshot first if there is any chance
-- this data is wanted again.

BEGIN;

-- User.warehouseId and User.costCenterId are foreign keys into Warehouse and
-- CostCenter, both of which are wiped below. TRUNCATE ... CASCADE decides
-- what to cascade into by whether an FK constraint exists, not by whether any
-- row would currently violate it — so nulling these columns first is NOT
-- enough; the constraints still point at the tables being truncated, and
-- CASCADE truncates User right along with them. The constraints have to be
-- dropped first, and recreated after, to actually keep User's rows.
ALTER TABLE "User" DROP CONSTRAINT "User_warehouseId_fkey";
ALTER TABLE "User" DROP CONSTRAINT "User_costCenterId_fkey";

UPDATE "User" SET "warehouseId" = NULL, "costCenterId" = NULL;

TRUNCATE TABLE
  "CostEntry", "CostDocument", "ProductPrice", "ReceiptLine", "Receipt", "ReturnItem", "Return",
  "DeviceMovement", "StockMovement", "StockLevel", "TransferDevice", "TransferItem", "Shipment",
  "Transfer", "SaleItem", "Sale", "PurchaseUnitLabel", "Device", "Lot", "PurchaseItem", "Purchase",
  "AuditLog", "Product", "Supplier", "Customer", "CostCenter", "Warehouse", "Country",
  "DocumentCounter", "Brand", "Notification", "ExchangeRate"
RESTART IDENTITY CASCADE;

-- Recreate exactly as apps/api/prisma/migrations/20260916143803_init/migration.sql
-- defines them, so the schema ends up identical to a fresh migrate deploy.
ALTER TABLE "User" ADD CONSTRAINT "User_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

-- Verify: should show 0 rows for everything except User.
-- \dt
