-- Transport firms and the people who drive for them.
CREATE TABLE "DeliveryCompany" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryCompany_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "vehicle" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryCompany_name_key" ON "DeliveryCompany"("name");
CREATE INDEX "DeliveryCompany_isActive_idx" ON "DeliveryCompany"("isActive");
CREATE UNIQUE INDEX "Driver_name_companyId_key" ON "Driver"("name", "companyId");
CREATE INDEX "Driver_isActive_idx" ON "Driver"("isActive");
CREATE INDEX "Driver_companyId_idx" ON "Driver"("companyId");

ALTER TABLE "Driver" ADD CONSTRAINT "Driver_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "DeliveryCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Who carried a given shipment.
ALTER TABLE "Shipment" ADD COLUMN "deliveryCompanyId" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "driverId" TEXT;

CREATE INDEX "Shipment_deliveryCompanyId_idx" ON "Shipment"("deliveryCompanyId");
CREATE INDEX "Shipment_driverId_idx" ON "Shipment"("driverId");

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_deliveryCompanyId_fkey"
    FOREIGN KEY ("deliveryCompanyId") REFERENCES "DeliveryCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
