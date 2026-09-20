-- pickedCost must never be NULL: a partial B2B pick increments it, and
-- PostgreSQL keeps `NULL + x` NULL. Historic rows from before restatement had
-- no elected cost recorded, so they are backfilled to 0 — an old sale keeps
-- the totalCost it already had, because 0 adds nothing.
ALTER TABLE "SaleItem" ALTER COLUMN "pickedCost" SET DEFAULT 0;
UPDATE "SaleItem" SET "pickedCost" = 0 WHERE "pickedCost" IS NULL;
ALTER TABLE "SaleItem" ALTER COLUMN "pickedCost" SET NOT NULL;