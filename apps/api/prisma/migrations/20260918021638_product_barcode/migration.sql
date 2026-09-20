-- Nullable, so every existing product stays valid with no barcode recorded.
ALTER TABLE "Product" ADD COLUMN "barcode" TEXT;

-- Unique, but only over the rows that have one: two products may both have no
-- barcode, and in Postgres NULLs never collide in a unique index anyway.
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
