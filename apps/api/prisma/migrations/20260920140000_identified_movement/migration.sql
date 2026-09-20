-- Recording that a serial-only unit had its IMEI read (*#06#) and became a
-- real, sellable device belongs in the movement ledger.
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'IDENTIFIED';
