-- A DEVICES-scoped cost document needs to remember which units it covers while
-- it is still a draft; scopeId holds a single id and cannot carry a list.
ALTER TABLE "CostDocument" ADD COLUMN "targetDeviceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
