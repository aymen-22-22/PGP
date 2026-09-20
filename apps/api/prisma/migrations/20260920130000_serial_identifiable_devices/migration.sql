-- A unit may be received by serial number alone: its device row exists with
-- IMEI null and status PENDING_IDENTIFICATION until the IMEI is read (*#06#).
ALTER TABLE "Device" ALTER COLUMN "imei" DROP NOT NULL;
ALTER TYPE "DeviceStatus" ADD VALUE IF NOT EXISTS 'PENDING_IDENTIFICATION';
