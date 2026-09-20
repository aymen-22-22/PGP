-- Serial-only (PENDING_IDENTIFICATION) units arrive without an IMEI, so the
-- receipt line that records their arrival cannot force one either.
ALTER TABLE "ReceiptLine" ALTER COLUMN "imei" DROP NOT NULL;
