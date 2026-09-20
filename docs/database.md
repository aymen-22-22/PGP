# Database

PostgreSQL, normalised, with the integrity rules in the schema rather than only
in application code. The source of truth is
[`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

## The shape of it

```
Warehouse ──< CostCenter ──< User
    │
    ├──< Device >── Product
    │      │  └──< DeviceMovement        (append-only history)
    │      │
    │      ├── Purchase ──< PurchaseItem      ── Supplier
    │      ├── Transfer ──< TransferDevice ── Shipment
    │      └── Sale     ──< SaleItem          ── Customer
    │
    └──< Receipt ──< ReceiptLine
```

`Device` is the centre. Everything else either describes a device, moves one, or
records that one moved.

## Tables

### Organisation

| Table | Notes |
|---|---|
| `Warehouse` | `code` unique. |
| `CostCenter` | `code` unique; optionally attached to a warehouse. |
| `User` | `email` unique. `tokenVersion` invalidates outstanding JWTs. `passwordHash` is Argon2id. |

### Catalogue and partners

| Table | Notes |
|---|---|
| `Product` | `sku` unique. Prices are `DECIMAL(14,2)`. |
| `Supplier`, `Customer` | Minimal contact records; identical shape by design. |

### Brands

`Brand` — one row per make, `name` unique. `Product.brandId` is a required
foreign key with `onDelete: Restrict`, so a make cannot be deleted out from
under its products.

The `brands` migration creates one brand per distinct value that was in
`Product.brand`, links every product, and only then drops the old text column —
nothing is retyped and no product is orphaned.

### Two kinds of stock

`Product.tracking` is `SERIALIZED` (phones) or `BULK` (accessories). Serialised
stock lives as `Device` rows; bulk stock as a `StockLevel` quantity per
warehouse with a `StockMovement` ledger behind it. See
[business-rules.md](business-rules.md) for why, and for what bulk gives up.

| Table | Notes |
|---|---|
| `StockLevel` | `@@unique([productId, warehouseId])`. `quantity` plus `avgUnitCost` at `DECIMAL(14,4)` — four places, because an average divides. |
| `StockMovement` | Append-only, signed `quantity`. The level is rebuildable from it. |
| `TransferItem.shippedQuantity` / `.receivedQuantity` | Bulk lines only; serialised lines count `TransferDevice` rows instead. |

### Devices

`Device` — one row per physical handset.

| Column | Notes |
|---|---|
| `imei` | **Unique.** The device identity. |
| `imei2`, `serialNumber` | Unique when present; room for dual-SIM and serials. |
| `status` | `IN_STOCK`, `IN_TRANSFER`, `SOLD`, … |
| `currentWarehouseId` | Where it physically is. Stays at the source while in transit. |
| `costPrice` | The purchase price, frozen at goods-in. Profit is computed from this. |
| `purchaseId`, `transferId`, `saleId` | Provenance and current commitments. |

`DeviceMovement` — the ledger. One row per change, written in the same
transaction as the change. Nothing in the application updates or deletes one.

### Documents

`Purchase` + `PurchaseItem` (with `receivedQuantity` per line) ·
`Transfer` + `TransferItem` (planned) + `TransferDevice` (the actual handsets) ·
`Shipment` (one per transfer) · `Sale` + `SaleItem` · `Return` + `ReturnItem` ·
`Receipt` + `ReceiptLine` (every goods-in event, from a purchase or a transfer).

`Sale.totalCost` is frozen at completion from the devices actually shipped.

### Cross-cutting

`AuditLog` — who did what, when, from where. Secrets are stripped before
writing.

`DocumentCounter` — `(scope, year) → value`, incremented inside the caller's
transaction so two documents can never share a number.

## Integrity

Unique constraints on `Device.imei`, `Device.imei2`, `Device.serialNumber`,
`Product.sku`, `Warehouse.code`, `CostCenter.code`, `User.email`, and the
`number` of every document type. Composite uniques stop the same product
appearing twice on one purchase or transfer, and the same device twice on one
transfer or receipt.

Foreign keys everywhere. `Restrict` on references that must not silently vanish
(a product with devices, a supplier with purchases); `SetNull` where history
should outlive the reference (a deleted user's movements stay, attributed to
nobody); `Cascade` only for lines that belong to their parent.

## Indexes

Every column the application filters or sorts by is indexed:
`Device.imei` (via the unique), `productId`, `status`, `currentWarehouseId`;
`Purchase` by supplier, status, date and `(warehouseId, status)`;
`Transfer` by source, destination and status; `Sale` by customer, status and
`(warehouseId, status)`; `DeviceMovement` by `(deviceId, createdAt)` and by
reference; `AuditLog` by `(userId, createdAt)` and by action.

Two composites earn their place by carrying the hot paths:
`Device(currentWarehouseId, status)` drives every dashboard tile, and
`Device(currentWarehouseId, productId, status)` drives the stock summary.

## Migrations

```bash
npm run db:migrate          # development: create and apply
npm run db:deploy           # production: apply existing migrations
npm run db:reset            # development only: drop, recreate, re-seed
```

Migrations are committed under `apps/api/prisma/migrations/`. Generate them in
development, review the SQL, commit it, and run `db:deploy` in production —
never `db:migrate`, which can prompt and can reset.

## Money

Every monetary column is `DECIMAL(n,2)`. Values cross the API as decimal
strings and are added and multiplied in integer minor units. No monetary value
is ever a JavaScript float.

## Backups

```bash
pg_dump "$DATABASE_URL" --format=custom --file=phone-erp-$(date +%F).dump
pg_restore --dbname="$TARGET" --clean --if-exists phone-erp-2026-01-31.dump
```

Restore into a scratch database periodically and check that a known IMEI still
tells its whole story. Because the ledger is append-only, a restore yields a
coherent history rather than totals that no longer reconcile.
