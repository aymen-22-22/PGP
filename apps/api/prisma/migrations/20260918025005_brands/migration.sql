-- Brands become a table.
--
-- Every product already carries a brand as free text, so the makes are created
-- from what is there and each product is pointed at its own. Nothing is typed
-- twice and no product is orphaned: the column is only dropped once every row
-- has a link.

CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");
CREATE INDEX "Brand_isActive_idx" ON "Brand"("isActive");

-- One row per distinct make already in the catalogue. Trimmed, because a
-- trailing space is not a different company.
INSERT INTO "Brand" ("id", "name", "updatedAt")
SELECT gen_random_uuid(), TRIM("brand"), NOW()
FROM "Product"
WHERE TRIM(COALESCE("brand", '')) <> ''
GROUP BY TRIM("brand");

-- Nullable first, so existing rows survive the ALTER.
ALTER TABLE "Product" ADD COLUMN "brandId" TEXT;

UPDATE "Product" p
SET "brandId" = b."id"
FROM "Brand" b
WHERE b."name" = TRIM(p."brand");

-- A product with no brand text at all would block the NOT NULL below. Give it
-- somewhere to live rather than failing the deploy.
INSERT INTO "Brand" ("id", "name", "updatedAt")
SELECT gen_random_uuid(), 'Unbranded', NOW()
WHERE EXISTS (SELECT 1 FROM "Product" WHERE "brandId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Brand" WHERE "name" = 'Unbranded');

UPDATE "Product"
SET "brandId" = (SELECT "id" FROM "Brand" WHERE "name" = 'Unbranded')
WHERE "brandId" IS NULL;

ALTER TABLE "Product" ALTER COLUMN "brandId" SET NOT NULL;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Product_brand_idx";
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- Only now, with every row linked.
ALTER TABLE "Product" DROP COLUMN "brand";
