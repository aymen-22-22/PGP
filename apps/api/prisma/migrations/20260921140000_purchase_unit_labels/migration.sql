-- One printable label per unit ordered on a purchase line. Additive: nothing
-- existing reads or writes this table, so it is safe to apply before or after
-- the release that introduces it.
CREATE TABLE "PurchaseUnitLabel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purchaseItemId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "printedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseUnitLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseUnitLabel_code_key" ON "PurchaseUnitLabel"("code");

CREATE INDEX "PurchaseUnitLabel_purchaseItemId_idx" ON "PurchaseUnitLabel"("purchaseItemId");

CREATE UNIQUE INDEX "PurchaseUnitLabel_purchaseItemId_sequence_key" ON "PurchaseUnitLabel"("purchaseItemId", "sequence");

ALTER TABLE "PurchaseUnitLabel" ADD CONSTRAINT "PurchaseUnitLabel_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
