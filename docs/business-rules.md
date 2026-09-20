# Business rules

The rules the system enforces, and why. All of them live in services, never in
controllers, and all of them are enforced in the API — the UI only makes them
visible.

---

## The founding rule: stock is derived, never stored

For phones there is no inventory table and no quantity column anyone can edit.

A warehouse's stock is a `COUNT` over `Device` rows with a given status and
`currentWarehouseId`. If France shows 500 available, there are exactly 500 rows
saying so, and each one names the purchase it arrived on and the transfer that
carried it.

Every change to a device writes a `DeviceMovement` row in the same transaction.
Movements are append-only: nothing in the application updates or deletes one.

---

## Two kinds of stock

`Product.tracking` decides how a product is counted, and everything else
follows from it.

| | `SERIALIZED` | `BULK` |
|---|---|---|
| What it is | Phones | Accessories: cables, cases, chargers, glass |
| Identified by | A unique IMEI per unit | Nothing — the units are identical |
| Held as | One `Device` row per unit | One `StockLevel` row per warehouse |
| Costed by | Specific identification | Weighted average |
| Ledger | `DeviceMovement` | `StockMovement` |
| Traceable to a unit | Yes | **No** |

A product cannot change tracking mode once it holds stock. The phones already
recorded as rows have no quantity to become, and a quantity has no IMEIs to
become, so the API refuses and tells you to create a new product.

### Why accessories cannot be traced

An EAN-13 identifies a *model*, not a unit — every cable of that model carries
the same barcode. There is no second barcode to fall back on, as there is on a
phone. So a bulk product gives up what serialisation buys: no per-unit history,
no per-unit profit, and a miscount stays wrong until someone recounts.

That is inherent to identical goods. It is the reason `BULK` must never be used
to avoid the work of scanning phones.

### The quantity is still a ledger

`StockLevel.quantity` is a running total, not an authority. Every movement —
receipt, sale, transfer out, transfer in, correction — writes a `StockMovement`
row, and the level can always be rebuilt from them.

Nothing reads a level, decides in application code, and writes it back. Removals
are a conditional `UPDATE … WHERE quantity >= ?` whose affected-row count is
checked, the same primitive the serialised flow uses. Two tills selling the last
cable both read "1 in stock"; only the one whose `UPDATE` matches gets it.

### Stock takes

A missing phone is a specific IMEI, and marking that one `LOST` records
something true. A short count of cables names no unit, so the only honest record
is the size of the gap and the reason given for it — which is why
`POST /stock/adjust` takes the **counted quantity** rather than a delta, and why
the reason is required rather than optional.

### Transfers

Accessories are never "loaded" onto a transfer — there are no units to choose
between, so the ordered quantity is what ships. It leaves the source on despatch
and arrives on receipt, sitting in neither warehouse in between, which is what
in-transit means for a phone too.

Goods arrive at the cost they left at, read back from the despatch's ledger
entry. Re-pricing them at the destination's current average would invent margin
out of a lorry journey.

---

## Reading a barcode

A scanner almost never hands over a bare 15-digit number. Retail box labels
carry both IMEIs and a serial; Code 128 symbols may be prefixed with an AIM
identifier; GS1 payloads bury the number among application identifiers; some
labels encode the 16-digit IMEISV instead. So the scanner extracts the IMEI from
whatever it is given rather than demanding the payload *be* one — the earlier
rule of "exactly fifteen digits" silently dropped most real labels.

The check digit makes extraction safe: in a string full of digits, a 15-digit
window satisfying Luhn is an IMEI and almost nothing else is. Where several
windows qualify — a GS1 payload yields four — candidates are ranked by whether
they begin with an allocated Reporting Body Identifier, and by whether the label
said "IMEI" beside them. Ranking never rejects: an unfamiliar prefix still scans
when it is the only candidate.

A label carrying two IMEIs returns both, primary first.

## IMEI

The IMEI is the device identity. There is no second internal code.

- Exactly 15 digits after whitespace, dashes, underscores and dots are stripped
  — scanners routinely append a carriage return or a space.
- Unique, enforced by a database constraint, not only by application checks.
- The Luhn check digit is verified only when `IMEI_ENFORCE_CHECKSUM=true`. It is
  off by default because real stock arrives with IMEIs mistyped upstream, and
  refusing to receive a handset you are physically holding solves nothing.

A batch is rejected whole if any entry is malformed or appears twice. Partial
acceptance of a scan batch would leave the operator guessing which phones
counted.

---

## Device statuses

| Status | Meaning |
|---|---|
| `EXPECTED` | Reserved for future use; nothing in v1 sets it. |
| `RECEIVED` | Physically here, not yet sellable — awaiting receipt validation. |
| `IN_STOCK` | Available: may be sold or transferred. |
| `IN_TRANSFER` | Loaded on a shipped transfer. Still located at the source. |
| `SOLD` | Gone to a customer. |
| `RETURNED` / `DAMAGED` / `LOST` | Present but not sellable. |

Only `IN_STOCK` counts as available. A device is never in two warehouses, and
never in none: while in transit it keeps its source location until the
destination confirms receipt.

---

## Purchasing and goods-in

A purchase order lists products and quantities. Receiving turns scanned IMEIs
into devices.

- The receiving user must have access to the purchase's warehouse.
- A line cannot receive more than it still expects.
- An IMEI already in the system is refused with `IMEI_ALREADY_EXISTS`, before
  the transaction opens, so the operator gets a precise message.
- A short delivery is refused with `PARTIAL_RECEIPT_NOT_ALLOWED` — which reports
  expected, scanned and missing — unless the operator explicitly accepts it and
  `ALLOW_PARTIAL_RECEIPT` is on.
- The whole receipt is one transaction. A thousand devices are created or none
  is.
- Each device is stamped with the line's unit price. That frozen cost is what
  profit is computed from later, so a price change next year cannot rewrite last
  year's margin.
- The purchase becomes `PARTIALLY_RECEIVED`, then `RECEIVED` when every line is
  complete.

### Optional validation

With `REQUIRE_RECEIPT_VALIDATION=true`, received devices sit in `RECEIVED`:
traceable, but not sellable or transferable. An administrator validates the
receipt and they become `IN_STOCK`. Validation is guarded on status, so two
administrators clicking at once release the devices exactly once.

---

## Transfers

A transfer moves **specific devices**, never a bare quantity.

- Only the source warehouse may create, load or ship it.
- Only the destination warehouse may receive it.
- Source and destination must differ.
- A device may be loaded only if it is `IN_STOCK` **in the source warehouse** and
  its product is on the transfer plan. Planned quantities are a ceiling.
- `auto-fill` picks the oldest available matching devices. Scanning five hundred
  handsets twice — once to send, once to receive — is not something a warehouse
  will do, so the sending side may pick; the receiving side always scans.

### Shipping

On dispatch the devices become `IN_TRANSFER` through a status-guarded update. If
even one has been sold or moved in the meantime, the count will not match and the
entire dispatch rolls back with `IMEI_NOT_AVAILABLE` rather than shipping a
phantom.

### Receiving

Every scanned IMEI must belong to this shipment (`IMEI_NOT_IN_TRANSFER`).
Already-received devices are ignored rather than double-counted. A short
delivery behaves as it does for purchases: refused with the exact shortfall
unless explicitly accepted, in which case the transfer stays open for the
missing phones.

The receiving user and timestamp are recorded per device, and the transfer
closes as `RECEIVED` only when nothing is outstanding.

---

## Sales

A sales order names products and quantities; completing it names the exact
handsets that leave the building.

- Creation refuses quantities the warehouse does not hold — an order for stock
  that is not there is a data-entry error, not a business case.
- Completion requires either scanned IMEIs or an explicit `autoPick`.
- Each device must exist, be `IN_STOCK`, and be in the selling warehouse.
  Otherwise: `IMEI_NOT_FOUND`, `IMEI_ALREADY_SOLD`, `IMEI_WRONG_WAREHOUSE`,
  `IMEI_NOT_AVAILABLE`.
- The scanned count must match the order exactly.
- The sale's cost is the sum of the frozen purchase cost of the devices shipped.

### Never twice

Two users must never sell the same phone. The guard is a single
status-filtered `UPDATE`:

```sql
UPDATE "Device" SET status = 'SOLD', "saleId" = …
 WHERE id IN (…) AND status = 'IN_STOCK' AND "currentWarehouseId" = … AND "saleId" IS NULL
```

PostgreSQL serialises the two statements on the row locks. The first claims the
rows; the second updates zero and, because the count no longer matches what was
requested, its whole transaction rolls back with a clear business error. The
sale row itself is claimed the same way, so one order cannot be completed twice.
This is covered by a test that fires both requests concurrently.

---

## Returns

A sold phone comes back. `RESTOCKED` returns it to sellable stock in the
receiving warehouse; `DAMAGED` keeps it located but out of stock, so it is never
simply lost. A device that was never sold cannot be returned, and the same
device cannot be returned twice.

---

## Profit

Deliberately simple and explainable:

```
revenue = Σ completed sale totals
cost    = Σ purchase cost of the devices those sales shipped
profit  = revenue − cost
margin  = profit / revenue × 100
```

Worked through the specification's example: 1,000 handsets bought at €900;
500 sold at €980.

```
revenue  500 × 980  =  490,000.00
cost     500 × 900  =  450,000.00
profit                  40,000.00
margin   40,000 / 490,000  =  8.16%
```

All money is held as `DECIMAL(n,2)` in PostgreSQL and moves across the API as
decimal strings. Arithmetic happens in integer minor units — no monetary value
is ever a JavaScript float.

---

## Authorisation

Two roles: `ADMIN` sees and does everything; `WAREHOUSE_USER` is confined to one
warehouse.

A warehouse user cannot read another warehouse's stock, purchases, sales or
receipts; cannot ship its transfers or receive its shipments; cannot look up an
IMEI they have never handled; and cannot reach any administrative endpoint.
Passing another warehouse's id does not help: list filters are intersected with
what the user may see, and writes resolve the warehouse from the user rather
than from the request.

The one deliberate widening: a user may look up a phone that *was* theirs even
after it has moved on — otherwise traceability would break the moment stock
leaves, which defeats the purpose.

---

## Document numbers

`PO-2026-000001`, `TR-…`, `SHP-…`, `SO-…`, `RET-…`, `RCP-…`, generated from a
per-scope, per-year counter updated inside the caller's transaction. The row
lock serialises concurrent generators, so two documents can never share a
number. Users never type one.
