# API

Base path `/api/v1`. Interactive documentation at `/api/docs` when
`SWAGGER_ENABLED=true`.

## Authenticating

**Browser.** `POST /auth/login` sets two cookies: `perp_token` (HTTP-only, the
session) and `perp_csrf` (readable). Send the CSRF value back in the
`X-CSRF-Token` header on every non-`GET` request. The bundled web client does
this for you.

**API client.** The login response also returns `accessToken`. Send it as
`Authorization: Bearer <token>` and CSRF does not apply.

```bash
curl -s https://erp.example.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"…"}'
```

Sessions end at `JWT_EXPIRES_IN`, and immediately if the password, role or
warehouse changes or the account is deactivated.

## Errors

Every error has the same shape and a stable `code` — match on the code, never on
the English text.

```json
{
  "statusCode": 409,
  "code": "IMEI_ALREADY_EXISTS",
  "message": "This IMEI already exists.",
  "details": { "imeis": ["990000000000010"] }
}
```

| Code | Meaning |
|---|---|
| `VALIDATION_FAILED` | Malformed request. `details.fields` lists the problems. |
| `UNAUTHENTICATED` / `INVALID_CREDENTIALS` / `ACCOUNT_INACTIVE` | Not signed in, wrong password, disabled account. |
| `FORBIDDEN` / `WAREHOUSE_FORBIDDEN` | Wrong role; wrong warehouse. |
| `IMEI_INVALID` / `IMEI_NOT_FOUND` / `IMEI_ALREADY_EXISTS` | Not 15 digits; unknown; already in the system. |
| `IMEI_DUPLICATE_IN_REQUEST` | Scanned twice in one batch. |
| `IMEI_WRONG_WAREHOUSE` / `IMEI_NOT_AVAILABLE` / `IMEI_ALREADY_SOLD` | Belongs elsewhere; not sellable; already gone. |
| `IMEI_NOT_IN_TRANSFER` / `IMEI_WRONG_PRODUCT` | Not on this shipment; not on this order. |
| `QUANTITY_EXCEEDED` | More than expected or more than available. |
| `PARTIAL_RECEIPT_NOT_ALLOWED` | Short delivery. `details` gives expected / scanned / missing. |
| `INVALID_STATUS_TRANSITION` / `ALREADY_RECEIVED` | Wrong state for this action. |
| `CONCURRENT_MODIFICATION` | Someone else got there first. Refresh and retry. |
| `RATE_LIMITED` | Too many requests. |

Stack traces are never returned in production.

## Lists

List endpoints take `page` (from 1), `pageSize` (max 200) and usually `search`,
plus endpoint-specific filters. They return:

```json
{ "data": [ … ], "meta": { "page": 1, "pageSize": 25, "total": 137, "totalPages": 6 } }
```

Money is always a decimal string (`"900.00"`), never a number.

## Scoping

Administrators see everything. A warehouse user sees only their own warehouse —
a `warehouseId` filter naming another warehouse is refused, and omitting it
restricts rather than widens. Writes take the warehouse from the authenticated
user, so posting someone else's id changes nothing.

---

## Endpoints

### Auth
```
POST   /auth/login              Sign in. Rate limited.
POST   /auth/logout             Sign out, clear cookies.
GET    /auth/me                 Current user, warehouse and cost centre.
POST   /auth/change-password    Signs out every other session.
```

### Users · admin only
```
GET    /users                   ?role= &warehouseId= &isActive= &search=
GET    /users/:id
POST   /users
PATCH  /users/:id               Also resets a password or deactivates.
```

### Warehouses and cost centres
```
GET    /warehouses              All users — needed to name a transfer's counterpart.
GET    /warehouses/:id          Stock counts only for users with access.
POST   /warehouses              admin
PATCH  /warehouses/:id          admin
GET    /cost-centers            ?warehouseId=
POST   /cost-centers            admin
PATCH  /cost-centers/:id        admin
```

### Catalogue and partners
```
GET    /products  /products/:id     POST, PATCH: admin
GET    /suppliers /suppliers/:id    POST, PATCH: admin
GET    /customers /customers/:id    POST, PATCH: admin
```

### Purchases
```
GET    /purchases               ?status= &supplierId= &warehouseId= &from= &to=
GET    /purchases/:id           Lines with remaining quantities, plus receipts.
POST   /purchases               admin
POST   /purchases/:id/receive   Goods-in. Transactional.
POST   /purchases/:id/cancel    admin; only if nothing received.
```

```jsonc
// POST /purchases/:id/receive
{
  "lines": [{ "purchaseItemId": "…", "imeis": ["990000000000010", "…"] }],
  "allowPartial": false
}
// → { receiptNumber, expected, scanned, missing, purchaseStatus, pendingValidation }
```

### Receipts
```
GET    /receipts                ?status= &source= &warehouseId=
GET    /receipts/:id            Including every scanned IMEI.
POST   /receipts/:id/validate   admin; releases the devices into stock.
```

### Transfers
```
GET    /transfers               ?status= &warehouseId= &incoming=true &from= &to=
GET    /transfers/:id
POST   /transfers                          Source warehouse only.
POST   /transfers/:id/load                 Attach scanned IMEIs.
POST   /transfers/:id/auto-fill            Pick the oldest matching devices.
DELETE /transfers/:id/devices/:imei        Before dispatch.
POST   /transfers/:id/ship                 Source warehouse only.
POST   /transfers/:id/receive              Destination warehouse only.
POST   /transfers/:id/cancel               Before dispatch.
```

```jsonc
// POST /transfers
{
  "sourceWarehouseId": "…",
  "destinationWarehouseId": "…",
  "items": [{ "productId": "…", "quantity": 500 }],
  "autoFill": true          // or "imeis": [...] to load exact handsets
}

// POST /transfers/:id/receive
{ "imeis": ["…"], "allowPartial": false }
// → { expected, scanned, missing, status, receivedBy, receivedAt, receiptNumber }
```

`?incoming=true` is what a destination warehouse asks to see what is arriving.

### Sales
```
GET    /sales                   ?status= &customerId= &warehouseId= &from= &to=
GET    /sales/:id               Including the exact devices shipped.
POST   /sales
POST   /sales/:id/complete      { "imeis": [...] } or { "autoPick": true }
POST   /sales/:id/cancel        Only before completion.
```

### Returns
```
GET    /returns  /returns/:id
POST   /returns                 { customerId, lines: [{ imei, outcome }] }
```
`outcome` is `RESTOCKED` (back into stock) or `DAMAGED` (held, not sellable).

### Inventory
```
GET    /inventory               Per warehouse × product. ?warehouseId= &productId= &status=
GET    /inventory/devices       The individual phones behind a figure. Paginated.
GET    /inventory/:warehouseId  Headline counts for one warehouse.
```

Rows carry `tracking`. A `BULK` row's `inStock` is a quantity, and its
`inTransfer`/`sold` are always 0 — there are no units to be in either state.

### Stock — accessories only
```
GET    /stock                   On-hand quantities. ?warehouseId= &search=
POST   /stock/adjust            Correct a count after a stock take.
```

`POST /stock/adjust` takes `countedQuantity` — what is physically on the shelf,
not a delta — plus a required `reason`. Refused for `SERIALIZED` products with
`TRACKING_MODE_MISMATCH`: a missing phone is a specific IMEI to mark `LOST`.

Receiving, transferring and selling accessories go through the ordinary
endpoints, with a quantity where a phone would carry IMEIs:

```
POST   /purchases/:id/receive   lines: [{ purchaseItemId, quantity }]
POST   /transfers/:id/receive   imeis may be omitted entirely
POST   /pos/sales               items: [{ productId, quantity }]
GET    /pos/accessories         What is on the shelf at this till, with prices.
```

Sending `imeis` for a `BULK` line, or `quantity` for a `SERIALIZED` one, is
refused with `TRACKING_MODE_MISMATCH`. Removing more than is in stock is refused
with `INSUFFICIENT_STOCK` (409) and changes nothing.

### IMEI
```
GET    /imeis/search?q=         Type-ahead over IMEI, serial and product.
POST   /imeis/verify            Check one scan against a context. Changes nothing.
GET    /imeis/:imei             Where it is and where it came from.
GET    /imeis/:imei/history     The full chronological journey.
```

```jsonc
// POST /imeis/verify
{ "imei": "990000000000010", "transferId": "…" }
// → { accepted: false, code: "IMEI_NOT_IN_TRANSFER", message: "…", device: {…} }
```
This is what makes the scan screen answer instantly instead of failing at submit.

### Brands
```
GET    /brands                  ?search= &inUse=true
POST   /brands                  admin
PATCH  /brands/:id              Rename or retire. admin
POST   /brands/:id/image        Logo. admin
DELETE /brands/:id/image        admin
```

A make is a record, not a word typed onto each product — free text is how a
catalogue ends up with "Apple", "apple" and "Apple " in three piles. Names are
trimmed and compared case-insensitively, so a duplicate is refused with a
message naming the existing one rather than a constraint violation.

`Product.brandId` is required. There is no delete: a brand with products is
refused by the database, and retiring (`isActive: false`) is the safe operation.

**Brands are the second level of the stock browser** — someone looks for
"Samsung", not "smartphones". The old free-text `Product.category` is still on
the row but no longer groups anything.

### Notifications
```
GET    /notifications        What has been emailed, and what failed. admin
POST   /notifications/flush  Try the queue now. admin
PATCH  /auth/preferences     Turn your own emails on or off.
```

Five events are emailed: goods received, short delivery, receipt validated,
shipment sent, shipment received. Each message names the products, quantities,
who did it, when, and links back to the document.

**Mail never participates in a business transaction.** Messages are queued after
the transaction commits, so a mail server that is down or slow delays a message
rather than rolling back a receipt. A failure is retried on a sweep and, after
`MAIL_MAX_ATTEMPTS`, kept as `FAILED` with the reason — a row that says why it
never arrived is worth more than one that quietly disappeared.

**Bodies are rendered when the event happens, not when the mail is sent.** Stock
keeps moving; an email composed an hour later from live data would describe a
different warehouse than the one the reader is being told about.

Recipients are resolved at the same moment: administrators, plus the warehouse
concerned, minus anyone inactive or opted out. They travel in `bcc`, so one
warehouse never sees another's addresses.

With no `SMTP_HOST` configured nothing is queued and nothing is sent.

### Images
```
POST   /products/:id/image      Set the product photo. Admin only.
DELETE /products/:id/image      Remove it.
POST   /warehouses/:id/image    Set the warehouse photo. Admin only.
DELETE /warehouses/:id/image    Remove it.
```

Multipart, field name `image`. The declared content type and filename both come
from the uploader, so neither is trusted — the file's first bytes are checked
instead, and the stored name is generated server-side. JPEG, PNG and WebP only;
2 MB after the browser has shrunk the picture to 800px on the long edge.

Files live under `UPLOAD_DIR` (`./uploads`, outside the web build so a deploy
does not wipe them) and are served read-only from `/uploads`. Deleting a photo
deletes the file. `ImageStorageService` handles both, keyed by folder.

### Stock explorer — warehouse → category → product → history
```
GET  /stock-explorer/warehouses                                   Warehouses this user may open.
GET  /stock-explorer/warehouses/:id/categories                    Categories holding stock there.
GET  /stock-explorer/warehouses/:id/categories/:category/products Products of one category.
GET  /stock-explorer/warehouses/:id/products/:productId           Everything about one product here.
```

The warehouse list is filtered by `WarehouseAccessService`, and every deeper
route calls `assertAccess` **before** reading anything — so an unauthorised id
returns 403 rather than a 404 that would confirm the id is real. Hiding a card
in the frontend is not authorisation.

Valuation is the same one the dashboard uses: phones summed from the landed cost
on each unit, accessories at `quantity × avgUnitCost`. The warehouse cards
therefore add up to the dashboard's stock value, which `test/stock-explorer.e2e-spec.ts`
asserts directly.

`.../products/:productId` is the 360° view: stock by status, the units
themselves, the purchases they arrived on, the sales they left on, and the full
movement history — device movements and quantity-ledger entries merged into one
timeline, each linking to its original document.

### Ledgers — the records behind a dashboard figure
```
GET    /reports/ledger/stock-value   Products holding stock, valued per unit.
GET    /reports/ledger/revenue       Sale lines in the period.
GET    /reports/ledger/cost          What the units sold cost, and the PO they arrived on.
GET    /reports/ledger/profit        Revenue against cost, line by line.
```

All four take the dashboard's own scope — `warehouseId`, `from`, `to` — plus
`search`, `productId`, `customerId`, `category`, `sort`, `direction` and the
usual pagination. They return `{ data, meta, totals, context }`.

**`totals` covers the whole filtered set, never the page.** A ledger that added
up one page would contradict the tile it was opened from as soon as anyone
turned to page two, so the total is computed before slicing.

Scope is built once, in `reports/ledger-scope.ts`, and used by both the
dashboard and every ledger. Neither can drift from the other about which
records count. `test/ledgers.e2e-spec.ts` asserts the equality directly.

One subtlety in revenue. The dashboard adds `Sale.totalAmountBase` — the sale's
total converted once at the rate stamped on it. Converting each line separately
and adding those up can land a penny away, because two roundings are not one
rounding. So the sale's base total is apportioned across its lines by value,
with the remainder going to the largest line. Rows add to the tile exactly, and
each still shows its real price in the currency it sold in.

### Reports
```
GET    /reports/dashboard           ?warehouseId= &from= &to=
GET    /reports/profit-by-product   ?from= &to=
```

### Audit — admin only
```
GET    /audit-logs              ?userId= &action= &entityType= &entityId= &from= &to=
```
