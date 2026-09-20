# Landed costing

Every unit must carry a traceable cost from the supplier that shipped it to the
sale that closed it. This is how that works.

```
Supplier ──▶ France WH ──▶ Spain WH ──▶ Algeria WH ──▶ Sale / POS
             +handling     +freight      +freight
                           +handling     +customs
                                         +handling
             └──────── landed cost accumulates per unit ────────┘
```

---

## Why there is no FIFO

Every unit has an IMEI, so the system knows exactly which physical handset was
sold. That makes **specific identification** available — the most accurate
costing method there is — and FIFO, LIFO and weighted average unnecessary. They
exist to approximate what we can simply look up.

A **lot** is therefore not a costing method here. It is the handle you point a
customs bill at, and the grouping reports are built on. The authoritative cost
lives on the device.

---

## The two costs on every unit

| Field | Meaning |
|---|---|
| `Device.purchaseCost` | What it cost to buy. Frozen at goods-in, never changes. |
| `Device.landedCost` | Purchase cost plus every cost allocated along the way. |

`landedCost` is a **materialised sum** of the cost ledger, not an independent
figure. `POST /costing/rebuild` recomputes every unit from its entries, so the
number can always be proved rather than trusted.

This is the one deliberate exception to "never store what you can derive":
recomputing landed cost on every stock query would be far too slow, and the
stored value is exactly reconstructible.

---

## The cost ledger

```
CostDocument   one bill: type, amount, currency, allocation method,
               attached to a receipt, a shipment, a lot, or a chosen list
     │ posting spreads it
     ▼
CostEntry      one append-only row per unit — never edited
     │ sums to
     ▼
Device.landedCost
```

A mistake is corrected by **reversing** the document, which removes its entries
and recomputes. The document itself is kept and marked `REVERSED`, because the
audit trail must show that a cost was booked and taken back — not that it never
happened.

### Cost types

`PURCHASE` · `HANDLING` · `FREIGHT` · `CUSTOMS` · `INSURANCE` · `OTHER`

### Allocation

| Method | Spreads by | Use it for |
|---|---|---|
| `QUANTITY` | evenly per unit | freight, handling — most bills |
| `VALUE` | each unit's current landed cost | ad-valorem customs duty |
| `MANUAL` | amounts you supply | a bill that genuinely differs per unit |

Weight and volume are deliberately absent. Handsets differ by grams, so quantity
and value cover every invoice this business sees. They can be added when one
does not — the allocation function takes an arbitrary basis already.

**Rounding is exact.** €100 across 3 units cannot divide evenly; the split is
computed in integer minor units and the remainder handed to the largest shares,
so the parts always add back to the document to the cent.

---

## Partial shipments

Buy 100, ship 10, and the freight for that leg lands on those 10 only:

| | Units | Landed cost |
|---|---|---|
| Received in France, handling posted | 100 | €905 |
| 10 shipped to Spain, €200 freight | 10 | **€925** |
| remaining in France | 90 | **€905** |

This works because transfers move *actual devices*, not quantities. The system
knows which ten went.

---

## Currencies

Costs are reported in **EUR**. A bill in dinars is entered in dinars and
converted **once**, at the rate in force on the day it was incurred, and that
rate is **stamped on the document**.

```
168,000 DZD ÷ 280 = €600.00   (rate 0.00357142857 stamped)
```

Rates are dated rows in `ExchangeRate`; adding a rate never edits an old one.
This is what stops last September's margins drifting every time the dinar moves.

Re-running an allocation re-spreads **euros**. It never re-converts at today's
rate.

---

## Late invoices restate history

A freight or customs invoice often arrives weeks after the goods, sometimes
after units are sold. Posting it:

1. allocates across **all** units in scope, sold ones included;
2. recomputes their landed cost;
3. **recomputes the total cost of any completed sale** they belong to;
4. writes an audit entry recording how many sales were restated.

So gross profit on a past sale can change when a late cost lands. That is
deliberate — it was chosen over letting the last remaining units absorb
everything, which would distort whatever stock is left. The audit log is what
makes it accountable: `POST_COST_DOCUMENT` records the amount, the rate, the
units touched and the sales restated.

---

## Worked example

The seeded chain, 10 units, France → Spain → Algeria:

| Step | Bill | Per unit | Landed |
|---|---|---|---|
| Purchase | €900 | €900.00 | €900.00 |
| France handling | €500 / 100 units | €5.00 | €905.00 |
| Lyon → Barcelona | €200 / 10 units | €20.00 | €925.00 |
| Spain handling | €30 / 10 | €3.00 | €928.00 |
| Barcelona → Algiers | €400 / 10 | €40.00 | €968.00 |
| Marine insurance | €20 / 10 | €2.00 | €970.00 |
| Algerian customs | 168,000 DZD / 10 | €60.00 | €1,030.00 |
| Algeria handling | 11,200 DZD / 10 | €4.00 | **€1,034.00** |

Sell at €1,200 → gross profit €166.00. A late €100 haulage invoice then lands:
landed cost becomes €1,044.00 and the completed sale's profit is restated to
€156.00.

---

## The arrival document

`GET /landed-cost/receipt/:id` produces the statement for one arrival, and
`GET /landed-cost/lot/:id` for a whole purchase lot. It shows the goods, the
route they actually travelled (one row per leg, with the units that moved on
it), every bill that contributed, and the unit cost arrived at.

It is **generated on demand, never stored**. A stored copy would be a second
version of the truth that a later restatement could silently contradict; this
always reflects the ledger as it stands and says when it was produced.

Where a lot has been split across legs its units no longer share one cost, so
the statement reports the spread rather than averaging it away:

```
uniform: false
unitCostSpread: [ { unitCost: "905.00", units: 90 },
                  { unitCost: "925.00", units: 10 } ]
```

The screen at `/landed-cost/:kind/:id` renders this and prints cleanly.

---

## Selling prices

Selling prices are independent of cost and change often, so they are kept as
dated history in `ProductPrice`. Setting a price **closes** the one in force and
opens a new row — it never overwrites — so the price a sale was made at is
always recoverable.

Resolution falls back in order: a price for the product in that country, then a
price with no country, then the product's list price. So a product always has a
price even before anyone sets one.

```
GET  /price-list?countryId=            what everything sells for now
GET  /products/:id/price?countryId=&at= the price in force at a moment
GET  /products/:id/prices              full history
POST /products/:id/prices              set a new price (admin)
```

A price cannot be back-dated behind one that is already closed, because that
would silently reinterpret sales that have already happened.

---

## The counter (POS)

A counter sale is an ordinary `Sale` with `channel = POS`, created and completed
in one call. Keeping it in the same model means one source of sales truth: every
report, margin and IMEI history covers counter sales with no second code path.

```
POST /pos/lookup    scan a handset — can it be sold here, and for how much
POST /pos/sales     sell (walk-in customers need no customer record)
GET  /pos/today     the day's takings for this shop
```

Selling happens in the local currency; the takings are converted to EUR at a
rate stamped on the sale, so gross profit — revenue in EUR minus landed cost in
EUR — is fixed at the moment of sale.

Two tills cannot sell the same handset: the same status-guarded claim the B2B
path uses means the loser charges nothing and is told to rescan.

---

## API

```
GET    /cost-documents                 list bills
GET    /cost-documents/:id             one bill and its headline figures
GET    /cost-documents/:id/entries     how it was split, unit by unit
POST   /cost-documents                 record and post a cost
POST   /cost-documents/:id/post        post a draft
POST   /cost-documents/:id/reverse     reverse a posted bill (admin)
POST   /costing/rebuild                recompute every landed cost (admin)

GET    /exchange-rates                 dated rates
POST   /exchange-rates                 add a rate from a date (admin)
```

```jsonc
// POST /cost-documents — customs billed in dinars, spread over a goods-in receipt
{
  "type": "CUSTOMS",
  "description": "Algerian import duty",
  "amount": "168000.00",
  "currency": "DZD",
  "allocation": "QUANTITY",
  "scope": "RECEIPT",
  "scopeId": "<receipt id>"
}
// → amountBase "600.00", exchangeRate "0.00357143", restatedSales 0
```

Scope accepts `RECEIPT`, `SHIPMENT` (the shipment **or** its transfer id — staff
think in both), `LOT`, or `DEVICES` with an explicit `deviceIds` list.

```
GET    /landed-cost/receipt/:id        arrival statement
GET    /landed-cost/lot/:id            lot statement
GET    /lots                           goods-in batches
GET    /countries                      markets and their currencies
```
