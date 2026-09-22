-- Per-user thermal printer settings.
CREATE TYPE "PrinterConnectionType" AS ENUM ('BROWSER', 'NETWORK', 'AGENT');

ALTER TABLE "User"
    ADD COLUMN "printerConnectionType" "PrinterConnectionType" NOT NULL DEFAULT 'BROWSER',
    ADD COLUMN "printerAddress" TEXT,
    ADD COLUMN "printerLabelSize" TEXT NOT NULL DEFAULT '58x40';
