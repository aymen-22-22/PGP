-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'CHEQUE', 'OTHER');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "amountPaid" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SalePayment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalePayment_saleId_idx" ON "SalePayment"("saleId");

-- CreateIndex
CREATE INDEX "SalePayment_paidAt_idx" ON "SalePayment"("paidAt");

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Counter sales take the money on the spot: record the ones made before
-- payments existed as paid in cash, so they do not show up as owed.
INSERT INTO "SalePayment" ("id", "saleId", "amount", "method", "paidAt", "note", "createdById")
SELECT gen_random_uuid()::text, s."id", s."totalAmount", 'CASH', COALESCE(s."completedAt", s."createdAt"),
       'Recorded before payments were tracked', s."createdById"
FROM "Sale" s
WHERE s."channel" = 'POS' AND s."status" = 'COMPLETED' AND s."totalAmount" > 0;

UPDATE "Sale" SET "amountPaid" = "totalAmount"
WHERE "channel" = 'POS' AND "status" = 'COMPLETED';
