-- Photos are now served under /api/uploads, which reaches the application on
-- hosts that only route /api to Node. Point the saved links there too.
UPDATE "Product"   SET "imageUrl" = '/api' || "imageUrl" WHERE "imageUrl" LIKE '/uploads/%';
UPDATE "Warehouse" SET "imageUrl" = '/api' || "imageUrl" WHERE "imageUrl" LIKE '/uploads/%';
UPDATE "Brand"     SET "imageUrl" = '/api' || "imageUrl" WHERE "imageUrl" LIKE '/uploads/%';
