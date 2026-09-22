-- Adds the goods-in pairing to a label: which device it became, who scanned
-- it, and when. Additive and all-nullable, so it is safe to apply before or
-- after the release that reads and writes it.
ALTER TABLE "PurchaseUnitLabel" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" TEXT;

CREATE UNIQUE INDEX "PurchaseUnitLabel_deviceId_key" ON "PurchaseUnitLabel"("deviceId");

CREATE INDEX "PurchaseUnitLabel_receivedById_idx" ON "PurchaseUnitLabel"("receivedById");

ALTER TABLE "PurchaseUnitLabel" ADD CONSTRAINT "PurchaseUnitLabel_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseUnitLabel" ADD CONSTRAINT "PurchaseUnitLabel_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
