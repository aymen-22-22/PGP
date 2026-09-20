# Architecture

```
┌──────────────┐   HTTPS / REST    ┌──────────────┐          ┌────────────┐
│  React PWA   │ ────────────────▶ │   NestJS     │ ──────▶  │ PostgreSQL │
│  (static)    │  cookie + CSRF    │  (monolith)  │  Prisma  │            │
└──────────────┘                   └──────────────┘          └────────────┘
```

One API process, one folder of static files, one database. That is the whole
system, and it is the point: it runs on a shared host with Node and PostgreSQL,
and it moves to a VPS later without a line of code changing.

## Why a modular monolith

The business has one database's worth of data and a handful of concurrent
users. Splitting it into services would buy nothing and cost a great deal: the
transactional guarantees this system depends on — a thousand devices created or
none, an IMEI sold exactly once — are free inside one PostgreSQL transaction and
expensive across a network.

So: no microservices, no message broker, no Redis, no Kubernetes. Rate limiting
is in-memory. Modules are separated by folder and by service boundary, which is
where the real benefit of modularity lives anyway.

## API layering

```
Controller   validate input → authorise → call service → return
Service      all business logic, all transactions
Prisma       data access
```

Controllers are thin by rule. A controller that contained a business rule would
be a rule the tests could not reach and another controller could not reuse.

Cross-cutting concerns are global providers, applied in order:

1. `JwtAuthGuard` — authenticate, unless the route is `@Public()`.
2. `CsrfGuard` — double-submit check, for cookie-authenticated requests only.
3. `RolesGuard` — `@AdminOnly()` and friends.
4. `ThrottlerGuard` — rate limiting.
5. `ValidationPipe` — whitelisting DTO validation; unknown fields are rejected.
6. `AllExceptionsFilter` — one exit point, one error shape.

### Shared services

| Service | Responsibility |
|---|---|
| `WarehouseAccessService` | The single authority on which warehouses a user may touch. |
| `MovementService` | Writes the append-only device ledger. |
| `DocumentNumberService` | Generates `PO-2026-000001` style references. |
| `AuditService` | Records significant actions; never breaks the operation it describes. |

## Authorisation

Hiding a page is not authorisation. Every warehouse-scoped read intersects its
filter with what the user may see, and every warehouse-scoped write resolves the
warehouse from the authenticated user rather than from the request body. A
France user who posts Spain's warehouse id gets `WAREHOUSE_FORBIDDEN`, and a
France user who omits it gets France.

This is verified by tests that call the API directly as the wrong user, because
that is how it would actually be attacked.

## Sessions

The browser authenticates with an HTTP-only cookie, so no token is reachable
from JavaScript and an XSS bug cannot exfiltrate a session. That choice brings
CSRF exposure, which a double-submit token closes: a second, JS-readable cookie
that the client echoes in `X-CSRF-Token`, which a third-party site cannot read.
Requests presenting a bearer token instead — server-to-server, tests — are
exempt, since they cannot be forged by a cross-site request.

`JwtStrategy` re-reads the user on every request. That costs one primary-key
lookup and buys immediate revocation: a `tokenVersion` column, bumped on
password change, role change, warehouse change or deactivation, invalidates
every outstanding token at once. Stateless JWTs cannot do that, and "this
account was disabled twelve hours ago but still works" is not acceptable in a
warehouse.

## Concurrency

Two operations must never both succeed on the same phone. The pattern
throughout is a status-guarded bulk update inside a transaction:

```ts
const claimed = await tx.device.updateMany({
  where: { id: { in: ids }, status: 'IN_STOCK', currentWarehouseId: warehouseId },
  data:  { status: 'SOLD', saleId },
});
if (claimed.count !== ids.length) throw BusinessError.conflict(…);  // rolls back
```

PostgreSQL serialises the concurrent statements on the row locks. One claims the
rows; the other updates fewer than it asked for, and the mismatch aborts its
whole transaction. No explicit locking, no retry loop, no lost update. The same
guard protects shipping a transfer, receiving one, validating a receipt, and
completing a sale.

## Performance

The scale is a small distributor, not a marketplace, but the operations are
bulky: a thousand handsets arrive at once.

- **Bulk writes.** Goods-in generates device ids up front and inserts devices,
  movements and receipt lines with one statement each. The first implementation
  inserted row by row and blew the transaction timeout at exactly the 1,000-unit
  scale the specification describes — the fix was three `createMany` calls.
- **Transaction budget.** Write paths get an explicit generous timeout, because
  Prisma's 5-second default is tuned for small transactions and shared hosting
  is slow.
- **No N+1.** List endpoints aggregate with `groupBy` or a single extra grouped
  query, never one query per row.
- **Narrow selects.** Endpoints select the fields they render.
- **Pagination everywhere**, capped at 200 rows per page.
- **Indexes** on every column the application filters or sorts by, including the
  composite `(currentWarehouseId, status)` that drives every dashboard tile.

On the client: route-level code splitting, a vendor chunk, TanStack Query
caching with a short stale time, and Zustand used only for the one piece of
genuinely global state — who is signed in. The initial load is about 85 KB
gzipped.

## Camera scanning

Two backends, chosen at runtime:

- **The browser's own `BarcodeDetector`** where it exists — Chrome and Edge on
  Android. Hardware-accelerated and free: zero extra bytes.
- **A ZXing decoder everywhere else** — iOS Safari, Firefox, desktop — imported
  dynamically the moment the camera is first opened. It is around 115 kB
  gzipped and sits in its own chunk, so opening the scan screen costs nothing
  until someone actually asks for the camera.

The fallback decodes a **downscaled crop of the guide band**, not the whole
frame. A full 1080p pass costs about 260 ms in pure JavaScript against roughly
75 ms for the band — and cropping raises the hit rate as well, because the
decoder is no longer distracted by shelving and packaging around the label.

Capture asks for 1920×1080 with continuous autofocus. The default is often
640×480, which physically cannot resolve the bars of a dense Code 128 symbol —
that was the main reason camera scanning used to fail. Where the device exposes
it, a torch toggle is offered: a lit label reads far better than a sharp one in
shadow.

The keyboard-wedge scanner remains the daily tool; the camera is a convenience
on top of it, and neither is required for the other to work.

## Offline and the service worker

The service worker caches the app shell so it opens instantly and survives a
dropped connection. It is deliberately given **no rule for `/api`**.

That matters more than it sounds. A request matching no runtime-caching rule is
never handled by the service worker at all — it goes straight to the network and
is never cached, which is exactly the guarantee wanted for business data. An
explicit `NetworkOnly` rule gives the same caching behaviour but puts workbox in
the path of every API call, and on a failed request it rejects with
`no-response`. That surfaces as an uncaught promise rejection and buries the
app's own error handling in console noise.

When the API cannot be reached, the client says so plainly:

- a failed connection becomes `NETWORK_ERROR`;
- a proxy answering for a dead API (nginx returns 502 or 504) becomes
  `SERVER_UNREACHABLE`, with **our** message rather than the proxy's HTML or a
  bare "fetch failed";
- both render the same "cannot reach the server" state.

A network failure never signs anyone out. Only a real `401` does. Warehouse wifi
drops, and bouncing someone to the login screen mid-scan — when their session is
perfectly valid — loses their work for no reason. The session cookie survives,
so the next successful call picks straight up.

## Frontend shape

One responsive application, two shells. Warehouse staff get bottom navigation
sized for a thumb; administrators on a large screen get a sidebar. The viewport
decides, so an administrator on a phone still gets the thumb-friendly shell.

Server state lives in TanStack Query and is keyed by request path, so a receipt
invalidates every stock figure on screen by prefix. Money and IMEI helpers are
shared with the API through `@phone-erp/shared-types`, so the two cannot
disagree about what a valid IMEI is or how a margin is computed.

## Extending it

Adding a module means adding a folder under `apps/api/src`: a controller, a
service, DTOs, and a Nest module registered in `app.module.ts`. Use
`WarehouseAccessService` for scoping and `MovementService` for anything that
moves a device, and the new module inherits the system's guarantees rather than
reinventing them.
