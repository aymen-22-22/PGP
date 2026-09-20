-- Landed costing.
--
-- Adds the country layer, product lots, dated exchange rates, and the
-- append-only cost ledger (CostDocument + CostEntry) that accumulates handling,
-- freight and customs onto each unit as it moves France -> Spain -> Algeria.
-- Also adds selling-price history and the POS sales channel.

-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('PURCHASE', 'HANDLING', 'FREIGHT', 'CUSTOMS', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('QUANTITY', 'VALUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "CostScope" AS ENUM ('RECEIPT', 'SHIPMENT', 'LOT', 'DEVICES');

-- CreateEnum
CREATE TYPE "CostDocumentStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('B2B', 'POS');

-- AlterTable
-- Device: split the single cost figure into purchase cost and landed cost.
-- costPrice already holds the purchase price, so it is RENAMED rather than
-- dropped; dropping it would discard the cost of every unit already in stock.
ALTER TABLE "Device" RENAME COLUMN "costPrice" TO "purchaseCost";
ALTER TABLE "Device" ADD COLUMN "landedCost" DECIMAL(14,2);
ALTER TABLE "Device" ADD COLUMN "lotId" TEXT;
ALTER TABLE "Device" ALTER COLUMN "costCurrency" SET DEFAULT 'EUR';

-- Before any cost document exists, landed cost equals purchase cost. This makes
-- existing stock immediately valid rather than momentarily worthless.
UPDATE "Device" SET "landedCost" = "purchaseCost" WHERE "purchaseCost" IS NOT NULL;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "channel" "SalesChannel" NOT NULL DEFAULT 'B2B',
ADD COLUMN     "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
ADD COLUMN     "totalAmountBase" DECIMAL(16,2) NOT NULL DEFAULT 0,
ALTER COLUMN "customerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "countryId" TEXT;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "countryId" TEXT;

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'EUR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "purchaseItemId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPurchaseCost" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'EUR',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "fromCurrency" "Currency" NOT NULL,
    "toCurrency" "Currency" NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostDocument" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "CostType" NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(16,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "amountBase" DECIMAL(16,2) NOT NULL,
    "baseCurrency" "Currency" NOT NULL DEFAULT 'EUR',
    "allocation" "AllocationMethod" NOT NULL DEFAULT 'QUANTITY',
    "scope" "CostScope" NOT NULL,
    "scopeId" TEXT,
    "status" "CostDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "restatedSales" INTEGER NOT NULL DEFAULT 0,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "postedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lotId" TEXT,

    CONSTRAINT "CostDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL,
    "costDocumentId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" "CostType" NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "basis" DECIMAL(16,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "countryId" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE INDEX "Country_isActive_idx" ON "Country"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_number_key" ON "Lot"("number");

-- CreateIndex
CREATE INDEX "Lot_productId_idx" ON "Lot"("productId");

-- CreateIndex
CREATE INDEX "Lot_purchaseId_idx" ON "Lot"("purchaseId");

-- CreateIndex
CREATE INDEX "Lot_warehouseId_idx" ON "Lot"("warehouseId");

-- CreateIndex
CREATE INDEX "Lot_receivedAt_idx" ON "Lot"("receivedAt");

-- CreateIndex
CREATE INDEX "ExchangeRate_fromCurrency_toCurrency_validFrom_idx" ON "ExchangeRate"("fromCurrency", "toCurrency", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_fromCurrency_toCurrency_validFrom_key" ON "ExchangeRate"("fromCurrency", "toCurrency", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "CostDocument_number_key" ON "CostDocument"("number");

-- CreateIndex
CREATE INDEX "CostDocument_status_idx" ON "CostDocument"("status");

-- CreateIndex
CREATE INDEX "CostDocument_scope_scopeId_idx" ON "CostDocument"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "CostDocument_incurredAt_idx" ON "CostDocument"("incurredAt");

-- CreateIndex
CREATE INDEX "CostDocument_lotId_idx" ON "CostDocument"("lotId");

-- CreateIndex
CREATE INDEX "CostDocument_type_idx" ON "CostDocument"("type");

-- CreateIndex
CREATE INDEX "CostEntry_deviceId_idx" ON "CostEntry"("deviceId");

-- CreateIndex
CREATE INDEX "CostEntry_createdAt_idx" ON "CostEntry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CostEntry_costDocumentId_deviceId_key" ON "CostEntry"("costDocumentId", "deviceId");

-- CreateIndex
CREATE INDEX "ProductPrice_productId_countryId_validFrom_idx" ON "ProductPrice"("productId", "countryId", "validFrom");

-- CreateIndex
CREATE INDEX "ProductPrice_validFrom_idx" ON "ProductPrice"("validFrom");

-- CreateIndex
CREATE INDEX "Device_lotId_idx" ON "Device"("lotId");

-- CreateIndex
CREATE INDEX "Sale_channel_status_idx" ON "Sale"("channel", "status");

-- CreateIndex
CREATE INDEX "Supplier_countryId_idx" ON "Supplier"("countryId");

-- CreateIndex
CREATE INDEX "Warehouse_countryId_idx" ON "Warehouse"("countryId");

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostDocument" ADD CONSTRAINT "CostDocument_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostDocument" ADD CONSTRAINT "CostDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostDocument" ADD CONSTRAINT "CostDocument_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_costDocumentId_fkey" FOREIGN KEY ("costDocumentId") REFERENCES "CostDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill: give existing data the country layer it now expects.
-- ---------------------------------------------------------------------------

INSERT INTO "Country" ("id", "code", "name", "currency", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'FR', 'France',  'EUR', true, NOW(), NOW()),
  (gen_random_uuid(), 'ES', 'Spain',   'EUR', true, NOW(), NOW()),
  (gen_random_uuid(), 'DZ', 'Algeria', 'DZD', true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

-- Attach warehouses and suppliers to a country by their existing country name.
UPDATE "Warehouse" w SET "countryId" = c."id"
  FROM "Country" c WHERE lower(w."country") = lower(c."name") AND w."countryId" IS NULL;
UPDATE "Supplier" s SET "countryId" = c."id"
  FROM "Country" c WHERE lower(s."country") = lower(c."name") AND s."countryId" IS NULL;

-- The agreed starting rate: 1 EUR = 280 DZD, stored both ways so a cost billed
-- in dinars converts to euros without needing a second row.
INSERT INTO "ExchangeRate" ("id", "fromCurrency", "toCurrency", "rate", "validFrom", "createdAt")
VALUES
  (gen_random_uuid(), 'EUR', 'DZD', 280,          '2000-01-01T00:00:00Z', NOW()),
  (gen_random_uuid(), 'DZD', 'EUR', 0.00357142857,'2000-01-01T00:00:00Z', NOW())
ON CONFLICT ("fromCurrency", "toCurrency", "validFrom") DO NOTHING;

-- Existing sales were all in the base currency, so revenue in base equals revenue.
UPDATE "Sale" SET "totalAmountBase" = "totalAmount" WHERE "totalAmountBase" = 0;
