-- AlterTable
ALTER TABLE "TransferItem" ADD COLUMN     "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shippedQuantity" INTEGER NOT NULL DEFAULT 0;
