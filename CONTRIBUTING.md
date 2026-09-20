# Working on this codebase


## API response types live in shared-types

`packages/shared-types/src/api/` holds the shape of every response both apps
agree on. It is not documentation — both sides are checked against it:

- the **API** annotates its service methods (`Promise<Product360>`), so a change
  to what a service returns fails the server build;
- the **web** types its queries with the same type, so a page that reads a field
  the server no longer sends fails the client build.

Either half alone is worthless. The web used to hand-write its own copy of each
response, which is how `product.brand` went from a string to an object and took
the product page down in production while both projects compiled cleanly.

**Adding an endpoint:** write the type in `src/api/`, annotate the service with
it, then use it in the page. If the annotation will not compile, the type is
wrong — or the service is returning something it should not.

**Money** crosses as a decimal string with its places intact (`"12.50"`, never
`12.5`). Map `Decimal` with `.toFixed(2)` rather than letting Prisma serialise it.

**Dates** are the one place the two sides differ: the API holds a `Date`, the
wire carries an ISO string. Types that carry dates take the representation as a
parameter — the API annotates with `<Date>`, the web takes the default `string`.


## Ground rules

**Business logic lives in services.** Controllers validate input, authorise,
call a service, and return. A rule inside a controller is a rule the tests
cannot reach and another controller cannot reuse.

**Stock is never a stored number.** If you find yourself writing a quantity
column that the application increments, stop. Count `Device` rows.

**Anything that moves a device writes a movement.** Use `MovementService`,
inside the same transaction as the change. The ledger is append-only: never
update or delete a `DeviceMovement`.

**Authorisation goes through `WarehouseAccessService`.** Use `filterFor` on
reads and `resolveWarehouseId` on writes. Never trust a warehouse id from a
request body.

**Concurrency is handled by status-guarded updates.** To claim devices, filter
the `updateMany` on the status you expect and compare `count` to what you asked
for. If they differ, throw — the transaction rolls back. No explicit locks, no
retry loops.

**Money never touches a float.** Decimal strings across the API, `DECIMAL(n,2)`
in the database, integer minor units in arithmetic. The helpers are in
`@phone-erp/shared-types`.

**Errors carry a stable code.** Add to `ErrorCode` and throw a `BusinessError`,
so the frontend can react precisely instead of parsing English.

## Adding a module

```
apps/api/src/<module>/
├── dto/<module>.dto.ts     class-validator DTOs
├── <module>.service.ts     the business logic
├── <module>.controller.ts  thin
└── <module>.module.ts      registered in app.module.ts
```

## Adding a field

1. Edit `apps/api/prisma/schema.prisma`.
2. `npm run db:migrate -w @phone-erp/api -- --name describes_the_change`
3. Review the generated SQL and commit it.
4. Index it if anything filters or sorts by it.

## Before opening a pull request

```bash
npm run lint
npm test
npm run build
```

Add a test for any new business rule. The suite runs against a real PostgreSQL
database on purpose — rules that depend on transactions and row locking cannot
be verified against a mock.

## Conventions

TypeScript strict mode; `any` is a lint error. Two spaces, single quotes,
Prettier at 110 columns. Comments explain *why*, not *what* — the code already
says what.
