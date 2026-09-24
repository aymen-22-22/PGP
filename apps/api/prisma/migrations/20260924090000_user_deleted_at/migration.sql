-- Deleting a user with history archives them instead, so their name stays on past records.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
