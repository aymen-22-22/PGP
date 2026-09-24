-- The receiving warehouse is told when a purchase is ordered for it.
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'PURCHASE_ORDERED' BEFORE 'PURCHASE_RECEIVED';
