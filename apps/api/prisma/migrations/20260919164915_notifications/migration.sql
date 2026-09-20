-- Queued outgoing mail.
--
-- Rows are written after the business transaction commits, so a mail server
-- that is down delays a message rather than rolling back a receipt.

CREATE TYPE "NotificationEvent" AS ENUM (
  'PURCHASE_RECEIVED', 'SHORT_DELIVERY', 'RECEIPT_VALIDATED',
  'TRANSFER_SHIPPED', 'TRANSFER_RECEIVED'
);

CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "recipients" TEXT[],
    "referenceType" TEXT,
    "referenceId" TEXT,
    "warehouseId" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- The sweep reads pending rows oldest first.
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");
CREATE INDEX "Notification_referenceType_referenceId_idx" ON "Notification"("referenceType", "referenceId");
CREATE INDEX "Notification_event_idx" ON "Notification"("event");

-- Opted in by default: someone who does not want the mail can say so, but a
-- new user should not silently miss a short delivery.
ALTER TABLE "User" ADD COLUMN "notifyByEmail" BOOLEAN NOT NULL DEFAULT true;
