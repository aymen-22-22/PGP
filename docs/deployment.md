# Deployment

The target is ordinary hosting: Node.js, PostgreSQL, HTTPS, environment
variables, and a process that stays running. No Docker, no root, no
system packages.

You deploy two things: the API as a Node application, and the web app as a
folder of static files.

---

## 1. Build

Build locally or in CI, not on the host — shared hosting rarely has the memory.

```bash
npm ci
npm run build
```

Produces:

| | |
|---|---|
| `apps/api/dist/` | The API. Run with Node. |
| `apps/web/dist/` | Static files. Serve from any web root. |
| `packages/shared-types/dist/` | Consumed by the API at runtime. |

---

## 2. Database

Create a database and a user through your provider's panel. Use the **private
or internal** hostname if one is offered, so PostgreSQL is never reachable from
the internet.

Apply the schema from a machine that can reach the database:

```bash
DATABASE_URL="postgresql://…" npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

### Managed PostgreSQL (Neon)

A managed provider replaces the panel-created database above. Nothing in the
application changes: it reads `DATABASE_URL` and does not know or care who runs
the server. The Docker database in `docker-compose.yml` stays where it is, for
development.

Neon issues two connection strings for the same database, differing only in the
hostname:

| | Host | Use for |
|---|---|---|
| **Pooled** | `ep-….<region>.aws.neon.tech` with `-pooler` | The API's `DATABASE_URL`. |
| **Direct** | the same host without `-pooler` | `pg_dump`, `pg_restore`, logical replication, and anything relying on session state. |

The pooled endpoint routes through PgBouncer in transaction mode, which holds no
session state between statements. That is right for the API, which opens a
connection per request, and wrong for tools that expect a session to persist —
those fail in ways that never mention pooling, such as `prepared statement "s0"
already exists` or a `SET` that silently does not survive its own transaction.

Keep the `?sslmode=require` the console gives you. Add `&connection_limit=5` if
the API and the migration job might run at once and the compute is small.

Migrations can be applied from anywhere that can reach the database, including
the **Neon migrate** workflow in this repository (Actions → Neon migrate),
which runs `prisma migrate deploy` from a GitHub runner against the
`NEON_DATABASE_URL` secret and then prints the resulting tables.

Two behaviours worth knowing before the first quiet night:

- **Scale to zero.** An idle compute suspends after about five minutes, and the
  first query afterwards pays a cold start of a few hundred milliseconds. The
  API's own timeouts are far longer than that, so it surfaces as one slow
  request rather than an error.
- **Storage stays live** while the compute sleeps, so a suspended database is
  still a database — it is not a cost-free way to decommission one.

Then create the first administrator. Either set `SEED_ADMIN_PASSWORD` and
`SEED_USER_PASSWORD` and run `npm run db:seed` — which also loads the demo
warehouses and a sample purchase — or, for a clean production start, seed and
then delete the demo records through the admin UI.

**Never deploy with the default seed passwords in place.**

---

## 3. The API

Upload to the host's application directory:

```
apps/api/dist/
apps/api/prisma/
packages/shared-types/dist/
node_modules/          # or run `npm ci --omit=dev` on the host
package.json
```

Create `.env` from `apps/api/.env.example`. Generate the secret properly:

```bash
openssl rand -base64 48
```

Then set, at minimum:

```env
NODE_ENV=production
DATABASE_URL=postgresql://…
JWT_SECRET=<the generated value>
FRONTEND_URL=https://erp.example.com
CORS_ORIGIN=https://erp.example.com
COOKIE_SECURE=true
TRUST_PROXY=true
SWAGGER_ENABLED=false
```

Point the host's Node application at **`dist/main.js`**, with start command:

```bash
npm run start:prod
```

The API validates its configuration before it listens, so a missing or too-short
secret fails immediately and visibly rather than at the first request.

### cPanel / Plesk ("Setup Node.js App")

- Application root: where you uploaded the files.
- Application startup file: `dist/main.js`.
- Node version: 20 or newer.
- Add the environment variables through the panel, or upload `.env`.
- The panel supplies `PORT`; do not hard-code one.
- Use "Run NPM Install" if you did not upload `node_modules`.

---

## 4. The web app

Copy the **contents** of `apps/web/dist/` into your public web root.

Because it is a single-page application, every path must serve `index.html` or a
refresh on `/transfers/123` returns 404. On Apache, `apps/web/dist/.htaccess`
below does it; on nginx, `try_files $uri /index.html;`.

One exception matters: `/assets/` must **not** fall back to the shell. Asset
filenames contain a content hash, so after a deploy a tab that is still running
the previous version asks for chunks that no longer exist. Answering those with
`index.html` produces a confusing MIME-type error instead of a clean 404. The
app recovers from the 404 by offering a reload; it cannot recover from HTML
served as JavaScript.

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  # A missing asset must 404, not return the shell — see the note below.
  RewriteCond %{REQUEST_URI} !^/assets/
  RewriteRule . /index.html [L]
</IfModule>

# Hashed assets are immutable; the shell and the service worker must not be cached.
<IfModule mod_headers.c>
  <FilesMatch "\.(js|css|woff2|png|svg)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "^(index\.html|sw\.js|manifest\.webmanifest)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
```

### Connecting the two

**Same site (recommended).** Proxy `/api` to the Node app, and the default
configuration works with no CORS and no cross-site cookies.

```apache
RewriteCond %{REQUEST_URI} ^/api
RewriteRule ^api/(.*)$ http://127.0.0.1:3000/api/$1 [P,L]
```

**Different origins.** Build the web app with `VITE_API_URL` pointing at the
API, set `CORS_ORIGIN` to the web app's origin, and set `COOKIE_SAME_SITE=none`
with `COOKIE_SECURE=true`.

---

## 5. Check it

```bash
curl -i https://erp.example.com/api/v1/auth/me          # expect 401 + JSON error
curl -i https://erp.example.com/api/v1/reports/dashboard # expect 401, never a stack trace
```

Then sign in through the web app and confirm: the dashboard loads, a scanned
IMEI resolves, and a warehouse user sees only their own warehouse.

---

## Serving it over Tailscale

Tailscale gives the machine a real hostname and a real Let's Encrypt
certificate, reachable only from your tailnet — no ports opened, no public DNS,
no certificate to renew by hand. It is the quickest honest way to get the ERP
onto phones in a warehouse.

Enable HTTPS certificates once in the tailnet admin console (**DNS → HTTPS
Certificates**), then:

```bash
# 1. Build both apps
npm run build

# 2. Point the API at the web build and the tailnet hostname
#    apps/api/.env
HOST=127.0.0.1
SERVE_WEB_ROOT=../web/dist
FRONTEND_URL=https://<machine>.<tailnet>.ts.net
CORS_ORIGIN=https://<machine>.<tailnet>.ts.net
COOKIE_SECURE=true
TRUST_PROXY=true

# 3. Run the API (loopback only — Tailscale is the only way in)
npm run start:prod -w @phone-erp/api

# 4. Put HTTPS in front of it
tailscale serve --bg --https=443 http://127.0.0.1:3000
```

`tailscale serve status` shows what is mounted;
`tailscale serve --https=443 off` removes it.

Three details make this work rather than half-work:

- **`SERVE_WEB_ROOT` makes it one origin.** The API serves the app and its own
  `/api` routes, so there is no CORS and the session cookie is same-site without
  configuring anything. Deep links and refreshes work because the API falls back
  to `index.html` for any non-`/api` path — while a missing `/assets/*` file
  still returns 404, so a stale tab gets a clean miss instead of HTML served as
  JavaScript.
- **`HOST=127.0.0.1`** keeps the plain-HTTP port off every network interface.
  The only route in is Tailscale's TLS listener.
- **`TRUST_PROXY=true`** makes the app read `X-Forwarded-For`. Without it every
  audit-log entry and every rate-limit bucket records `127.0.0.1`, so one
  person tripping the login limiter would lock out everybody.

`tailscale serve` keeps this inside your tailnet. `tailscale funnel` would put it
on the public internet — do not use it for this without thinking hard about it
first.

## HTTPS

Terminate TLS at the host or panel (Let's Encrypt is usually one click) and
redirect HTTP to HTTPS. `COOKIE_SECURE=true` means the session cookie is not
sent over plain HTTP, so sign-in will appear to fail over HTTP — that is the
protection working.

---

## Backups

```bash
pg_dump "$DATABASE_URL" --format=custom --file=phone-erp-$(date +%F).dump
```

Daily, kept off the server, with at least one restore tested into a scratch
database. An untested backup is a guess.

---

## Upgrading

```bash
npm ci && npm run build                 # build
# upload apps/api/dist, packages/shared-types/dist, apps/web/dist
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
# restart the Node application
```

Take a backup before any release that carries a migration. Migrations run
forward only; to go back, restore the dump.

---

## VPS, optionally

Nothing above changes. You gain a process manager and a real reverse proxy:

```bash
npm i -g pm2
pm2 start apps/api/dist/main.js --name phone-erp-api
pm2 save && pm2 startup
```

Serve `apps/web/dist` with nginx and proxy `/api` to `127.0.0.1:3000`:

```nginx
server {
  server_name erp.example.com;
  root /var/www/phone-erp;

  # Hashed assets must 404 when they are gone, never fall back to the shell.
  location /assets/ { try_files $uri =404; }

  location / { try_files $uri /index.html; }

  location /api {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Keep `TRUST_PROXY=true` — without it, rate limiting and audit logs record the
proxy's address for every user.

Docker is available for this route and is entirely optional: `docker compose up
-d` from the repository root brings up the API and PostgreSQL. The application
has no dependency on it.

---

## Operational notes

- **Connection limits.** Shared hosts cap PostgreSQL connections; append
  `&connection_limit=5` to `DATABASE_URL` if migrations fail with "too many
  connections".
- **Memory.** The API idles at roughly 80–120 MB. Argon2 uses 19 MB per hash, so
  a 256 MB plan is comfortable and a 128 MB plan is not.
- **Statement timeouts.** Goods-in runs as one transaction sized for a thousand
  handsets. If your host enforces a shorter timeout, receive in batches of a few
  hundred — the purchase stays open until the last one is scanned.
- **Logs.** The API logs to stdout; your panel captures it. Warnings carry the
  method, path, status and error code, which is enough to find any failed
  request in the audit log.
