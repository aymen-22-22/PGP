# Phone ERP

A B2B phone distribution ERP built around one idea: **the IMEI is the phone**.
Every quantity the system shows is counted from real device records, every
device carries an unbroken history from the supplier that shipped it to the
customer that bought it, and every device carries the cost it accumulated on
the way.

It is deliberately small. A warehouse employee who has never seen an ERP should
be able to use the phone app without training.

```
Supplier ──▶ France WH ──▶ Spain WH ──▶ Algeria WH ──▶ Sale / POS
             +handling     +freight     +freight
                           +handling    +customs, +handling
             └── every step recorded per IMEI, cost accumulating ──┘
```

France and Spain source and hold stock; Algeria holds stock and sells.

---

## What it does

- **Purchasing** — purchase orders, then goods-in by scanning each IMEI.
- **Scanning** — a hardware scanner is captured anywhere on the page, so focus
  never has to be managed; the IMEI is extracted from whatever the label
  actually encodes; every scan beeps and buzzes so eyes stay on the phones.
  Camera scanning works on every browser: the native detector where it exists,
  and a decoder loaded on demand everywhere else, including iPhones.
- **Traceability** — ask any IMEI where it is, where it came from, who received
  it, and who sold it.
- **Transfers** — move *actual devices* between warehouses, not abstract
  quantities. Ship from the source, scan in at the destination.
- **Sales** — B2B orders completed against the specific handsets that leave the
  building.
- **Returns** — a sold phone comes back and either re-enters stock or is parked
  as damaged.
- **Stock** — for phones, derived and never stored: there is no editable
  inventory number.
- **Accessories** — cables, cases and chargers have no IMEI, because the units
  are identical, so they are counted by quantity and costed at a weighted
  average. Marked `BULK` on the product; everything else works the same way, with
  a quantity where a phone carries IMEIs. The trade is stated plainly: no
  per-unit history and no per-unit profit.
- **Landed cost** — handling, freight, customs and insurance accumulate onto
  each unit as it moves, allocated by quantity, value or by hand. Bills in
  dinars convert to euros at a stamped rate. See
  [landed costing](docs/landed-costing.md).
- **Selling prices** — kept as dated history per market, independent of cost. A
  new price closes the old one rather than overwriting it.
- **Counter sales (POS)** — scan, price, take payment. Sold in local currency,
  with profit booked in euros at a rate stamped on the sale.
- **Money** — revenue, landed cost, profit and margin, all traceable back to
  the individual bills that produced them.
- **Audit** — who did what, when, from where.

## What it deliberately does not do

No general ledger, no multi-currency conversion engine, no RMA workflow, no
forecasting, no microservices, no message broker, no Redis, no Kubernetes. If a
feature is not needed to move a phone from a supplier to a customer, it is not
in v1.

---

## Architecture

```
React PWA  ──HTTPS/REST──▶  NestJS modular monolith  ──▶  Prisma  ──▶  PostgreSQL
```

One deployable API process, one folder of static files, one database.

```
phone-erp/
├── apps/
│   ├── api/                 NestJS REST API
│   │   ├── prisma/          schema, migrations, seed
│   │   ├── src/             one folder per business module
│   │   └── test/            end-to-end business-rule tests
│   └── web/                 React + Vite PWA
├── packages/
│   └── shared-types/        enums, error codes, IMEI and money helpers
└── docs/
```

Two deviations from a textbook layout, both for deployability:

- **npm workspaces, not pnpm** — shared hosts rarely have pnpm, and npm
  workspaces give the same result with no extra tooling.
- **`prisma/` lives inside `apps/api/`** — so the API deploys as a
  self-contained Node application.

Further reading: [architecture](docs/architecture.md) ·
[database](docs/database.md) · [API](docs/api.md) ·
[business rules](docs/business-rules.md) · [landed costing](docs/landed-costing.md) ·
[deployment](docs/deployment.md).

---

## Requirements

| | |
|---|---|
| Node.js | 20 or newer |
| PostgreSQL | 14 or newer |
| npm | 9 or newer |

No Docker, no root access, no system packages required.

---

## Installation

```bash
git clone <your-repository> phone-erp
cd phone-erp
npm install
```

Create the API configuration:

```bash
cp apps/api/.env.example apps/api/.env
```

Then edit `apps/api/.env`. At minimum set `DATABASE_URL` and generate a secret:

```bash
openssl rand -base64 48
```

Every variable is documented inline in `apps/api/.env.example`. The ones that
change behaviour rather than wiring:

| Variable | Meaning |
|---|---|
| `AUTO_VALIDATE_RECEIPT` | Scanned phones enter sellable stock immediately. |
| `REQUIRE_RECEIPT_VALIDATION` | They wait in `RECEIVED` until an admin validates the receipt. Wins if both are set. |
| `ALLOW_PARTIAL_RECEIPT` | Whether a short delivery may be accepted. |
| `IMEI_ENFORCE_CHECKSUM` | Also verify the IMEI's Luhn check digit. Off by default — real stock carries mistyped IMEIs, and refusing a phone you are physically holding helps nobody. |

---

## Database

```bash
npm run db:migrate          # create the schema (development)
npm run db:seed             # load the demo dataset
```

The seed builds the real operating structure: three countries, six warehouses
(FR-01/02, ES-01/02, DZ-01/02), an admin and one user per country, suppliers in
France and Spain, Algerian customers, one product, a rate of 1 EUR = 280 DZD,
and a 1,000-unit purchase into France waiting to be received.

```
admin@phone-erp.local    Admin12345!       administrator, every warehouse
jean@phone-erp.local     Warehouse123!     France Warehouse 1
carlos@phone-erp.local   Warehouse123!     Spain Warehouse 1
amina@phone-erp.local    Warehouse123!     Algeria Warehouse 1
```

Change these before seeding anything real — set `SEED_ADMIN_PASSWORD` and
`SEED_USER_PASSWORD` first.

Test IMEIs use the reserved `99000000` test prefix with a valid Luhn check
digit, so they behave exactly like real ones in the scanner:

```bash
npm run db:imeis -w @phone-erp/api -- 1 1000
```

---

## Development

Two terminals:

```bash
npm run dev:api             # http://localhost:3000
```

```bash
npm run dev:web             # http://localhost:5173
```

Vite proxies `/api` to the API, so there is no CORS to configure locally.
Swagger is at http://localhost:3000/api/docs when `SWAGGER_ENABLED=true`.

---

## Testing

```bash
npm test
```

The suite runs against a real PostgreSQL database — business rules that depend
on transactions and row locking cannot be verified against a mock. Point
`apps/api/.env.test` at a scratch database and apply the schema once:

```bash
createdb phone_erp_test
DATABASE_URL="postgresql://…/phone_erp_test" npx prisma migrate deploy -w @phone-erp/api
```

It covers authentication and session invalidation, warehouse isolation against
a forged API call, IMEI validity and uniqueness, receiving (including short and
duplicate deliveries), the full transfer lifecycle, sales, and — importantly —
that two simultaneous requests can never sell the same phone twice.

---

## Production build

```bash
npm run build
```

Produces `apps/api/dist/` (run with Node) and `apps/web/dist/` (static files).

```bash
npm run db:deploy           # apply migrations
npm run start:prod -w @phone-erp/api
```

Deployment on shared hosting, including a VPS alternative and the optional
Docker files, is covered in [docs/deployment.md](docs/deployment.md).

---

## PWA

The web app installs to a phone's home screen and keeps its shell, icons and
code cached, so it opens instantly and survives a dropped connection.

Business data is deliberately **never** served from cache — a stale stock figure
in a warehouse is worse than an honest "cannot reach the server". The service
worker is given no rule for `/api` at all, so those requests bypass it entirely
rather than being routed through workbox, which would turn a connection failure
into an uncaught `no-response` rejection.

A dropped connection never signs anyone out; only a real authentication failure
does.

---

## Security

- Argon2id password hashing.
- Sessions in an HTTP-only cookie, with double-submit CSRF protection; API
  clients may use a bearer token instead.
- Changing a password, a role, a warehouse, or deactivating a user invalidates
  every outstanding token immediately.
- Authorisation is enforced in the API, never by hiding pages. A France user
  who calls the Spain endpoints directly is refused.
- Rate limiting on login, validation on every input, secure headers, CORS
  restricted to the configured origin.
- Secrets come from the environment; no secret is committed.
- Passwords and tokens are stripped from audit metadata before it is written.

See [docs/architecture.md](docs/architecture.md) for the reasoning.

---

## Backups

The database is the system of record; the application holds no state.

```bash
pg_dump "$DATABASE_URL" --format=custom --file=phone-erp-$(date +%F).dump
```

Run it daily, keep copies off the server, and **restore one into a scratch
database at least once** — an untested backup is a guess. The movement ledger is
append-only, so a restore gives you a coherent history rather than a set of
totals that no longer add up.

---

## Troubleshooting

**`Invalid environment configuration` at startup**
The API checks its configuration before it listens. The message names the
missing variable. `JWT_SECRET` must be at least 32 characters, and `CORS_ORIGIN`
is required in production.

**Login succeeds, then every request is 401**
The session cookie is not coming back. Check that `CORS_ORIGIN` exactly matches
the site's origin, that `COOKIE_SECURE=true` only where you serve HTTPS, and
that the web app is served from the same site as the API — or set
`COOKIE_SAME_SITE=none` if it genuinely is not.

**`403 FORBIDDEN — Invalid or missing CSRF token`**
The browser has the session cookie but not the CSRF cookie, usually after a
domain change. Sign out and back in.

**A user sees an empty dashboard**
Warehouse users see only their own warehouse. Check they are assigned to the
right one under Users.

**`IMEI_ALREADY_EXISTS` when receiving**
That IMEI is already in the system. Search it under Scan to see where it is —
usually it was received against a different purchase line.

**Receiving a large delivery times out**
Goods-in runs as one transaction sized for a thousand handsets. If your host
enforces a shorter statement timeout, receive in batches of a few hundred; the
purchase stays open until the last one is scanned.

**`npm run acceptance` stops with "rate limited"**
The script fires several hundred calls in a few seconds, which is exactly what
the rate limiter exists to stop. Start the API with the limits lifted for that
run — they are correct for real use:

```bash
THROTTLE_LIMIT=100000 THROTTLE_LOGIN_LIMIT=100000 npm run start:prod -w @phone-erp/api
```

**Migrations fail with "too many connections"**
Shared hosts cap connections. Append `&connection_limit=5` to `DATABASE_URL`.
