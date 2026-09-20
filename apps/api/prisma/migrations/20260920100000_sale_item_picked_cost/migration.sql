-- COGS of the BULK (non-IMEI) units already handed over on each sale item.
-- NULL for device (serialised) lines, which carry their own landed cost.
ALTER TABLE "SaleItem" ADD COLUMN "pickedCost" DECIMAL(16,2);