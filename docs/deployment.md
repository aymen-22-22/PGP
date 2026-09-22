# Deployment

The target is ordinary hosting: Node.js, PostgreSQL, HTTPS, environment
variables, and a process that stays running. No Docker, no root, no
system packages.

You deploy two things: the API as a Node application, and the web app as a
folder of static files.

---

## 0. What the host must provide

Check these before uploading anything. Each one has cost somebody an
afternoon.

| Requirement | Why |
|---|---|
| **Node 20 or newer**, running as a persistent application | A host that only runs PHP or CGI cannot run this at all. cPanel and Plesk call it "Setup Node.js App"; Passenger works too. |
| **256 MB of memory or more** | The API idles at 80–120 MB and Argon2 takes 19 MB per password hash. A 128 MB plan runs until somebody logs in. |
| **Outbound TCP to the database port** | Only when the database is not on the host — a managed provider is reached over the public internet. Plenty of shared hosts block outbound connections and say nothing about it. |
| **`npm install` on the host** | `argon2` is a native module. A `node_modules` built on your laptop will not load if the host's architecture, libc or Node ABI differs, and the error names a `.node` file rather than the cause. |
| **A writable directory for uploads** | `UPLOAD_DIR` holds product photos. See §3. |
| **HTTPS**, and a reverse proxy if the API shares the domain | See §4. |

### Check outbound access first

Nothing else matters if the API cannot reach the database. From an SSH
session on the host:

```bash
node -e "require('net').createConnection(5432,'YOUR-DB-HOST').on('connect',()=>{console.log('OK');process.exit(0)}).on('error',e=>{console.log('BLOCKED',e.code);process.exit(1)})"
```

`BLOCKED` is not a configuration problem and no environment variable fixes
it. Either the host permits egress or the database has to be somewhere the
host can reach.

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

### When even `prisma generate` won't run on the host

Some shared hosts cap the number of threads a user may create (a CloudLinux
LVE `nproc` limit). `prisma generate` forks a generator process that needs
its own thread pool, and `tsc`/`vite build` fork workers of their own; under
a tight enough cap any of them dies with `pthread_create: Resource
temporarily unavailable` — and Prisma's generator can be killed without the
CLI reporting a non-zero exit, so `prisma generate` can appear to succeed
while writing nothing. No combination of `UV_THREADPOOL_SIZE` or
`--v8-pool-size` fixes a cap that is simply too low; smaller values just move
the failure from one fork to another (the build workers this time).

Run `.github/workflows/build-artifacts.yml` instead (Actions → Build
artifacts → Run workflow). It installs, generates the Prisma client, and
builds all three packages on the runner — Linux x64 like the host, so the
query engine binary it produces (`debian-openssl-3.0.x`) runs there
unmodified — and uploads a `build-artifacts` zip. Unpack it into place:

```bash
unzip build-artifacts.zip -d /tmp/build-artifacts
cp -r /tmp/build-artifacts/prisma-client/. node_modules/.prisma/
cp -r /tmp/build-artifacts/api-dist/. apps/api/dist/
cp -r /tmp/build-artifacts/web-dist/. apps/web/dist/
cp -r /tmp/build-artifacts/shared-types-dist/. packages/shared-types/dist/
touch tmp/restart.txt
```

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
hostname: a **pooled** one, whose host carries `-pooler`, and a **direct** one
without it. The pooled endpoint routes through PgBouncer in transaction mode,
which holds no session state between statements.

**Use the direct string**, unless you have a reason not to:

```env
DATABASE_URL=postgresql://user:pass@ep-….<region>.aws.neon.tech/db?sslmode=require&schema=public&connection_limit=5
```

Pooling is what you reach for when connection count is the constraint —
serverless functions, or anything opening a connection per request at volume.
This API is a single long-lived process with its own connection pool, so it
gains little and inherits the pooler's restrictions. A deployment of this app
ran against the pooled endpoint and showed screens holding values the database
had already changed; moving `DATABASE_URL` to the direct endpoint fixed it. That
is an observation rather than an explained mechanism — several variables moved
at once — but the direct string is the safer default here either way.

If you do use the pooled endpoint with Prisma, add `pgbouncer=true` to the
query string. Prisma uses prepared statements, which transaction pooling cannot
carry across statements, and without that flag the failures are obscure:
`prepared statement "s0" already exists`, or a `SET` that does not survive its
own transaction.

The direct string is also the one for `pg_dump`, `pg_restore`, logical
replication and anything else that expects a session to persist.

Keep the `?sslmode=require` the console gives you. `&connection_limit=5` is
worth setting on a small compute, so the API and a migration job running at
once cannot exhaust it.

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
UPLOAD_DIR=/home/you/erp-uploads
```

`UPLOAD_DIR` defaults to `./uploads`, inside the directory you upload to.
Point it somewhere outside that directory on a host where a release replaces
the application folder, or every deploy takes the product photos with it.
The database keeps the paths either way, so what you get afterwards is a
catalogue of broken images rather than an error.

Point the host's Node application at **`dist/main.js`**, with start command:

```bash
npm run start:prod
```

The API validates its configuration before it listens, so a missing or too-short
secret fails immediately and visibly rather than at the first request.

### cPanel / Plesk ("Setup Node.js App")

- **Application root**: the directory holding the root `package.json`. Keep it
  **outside** the document root, or `.env` is downloadable.
- **Application startup file**: `apps/api/dist/main.js` when the application
  root is the repository; `dist/main.js` when you uploaded only the API.
- **Node version**: 20 or newer.
- **Application URL**: putting it at `yourdomain.com/api` lets the web app keep
  the domain root, with no proxy rewrite to arrange — the panel routes `/api`
  to Node and everything else falls through to the static files. Then set
  `API_PREFIX=v1`, because the default `api/v1` under an `/api` mount answers
  at `/api/api/v1`. Some Passenger builds pass the full path through instead,
  in which case `api/v1` is right; `curl` the URL and keep whichever answers.
- **The panel supplies `PORT`.** Setting it yourself makes the app
  unreachable.
- **Environment variables**: prefer the panel's fields. They are set in the
  process environment, which the configuration reads directly. A `.env` file is
  read relative to the working directory — the application root, not
  `apps/api/` — so one placed beside the API source is silently ignored by the
  running application. Keep `apps/api/.env` anyway for SSH tasks such as
  `db:seed`, which run with that directory as their working directory, and keep
  `DATABASE_URL` identical in both.
- **The panel's Passenger block lives in the document root's `.htaccess`** when
  the application URL is under that domain. It is what routes `/api` to Node;
  publishing the web app over it is the quickest way to take the API down. See
  §4.
- **Do not use "Run NPM Install".** It installs with the application's
  environment, where `NODE_ENV=production` tells npm to skip `devDependencies`
  — which is every tool the build needs. Install over SSH instead, after
  activating the environment with the `source …/nodevenv/…/bin/activate`
  command the panel shows, and pass `--include=dev` explicitly.

---

## 4. The web app

Copy the **contents** of `apps/web/dist/` into your public web root.

Because it is a single-page application, every path must serve `index.html` or a
refresh on `/transfers/123` returns 404. On Apache, `apps/web/dist/.htaccess`
below does it; on nginx, `try_files $uri /index.html;`.

**If the web root already has an `.htaccess`, merge into it — never replace
it.** On a panel-managed host that file is also where the panel keeps its own
directives: cPanel writes its Passenger block there when the application URL
sits under this domain, and that block is the only thing routing `/api` to the
application. Overwriting it takes the API off the air while the site itself
keeps loading, so it reads as the API having crashed rather than as a change to
a file nobody touched. Re-saving the application in the panel writes the block
back; put the rules below underneath it. `scripts/deploy.sh` keeps whatever is
already there and says when it differs from the build's.

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

**Do not let the proxy buffer `/api/v1/events`.** The web app holds that
endpoint open as a Server-Sent Events stream and updates screens as things
happen. A proxy that buffers responses holds the stream in memory instead of
passing each event along, and the connection looks alive while delivering
nothing. On Apache, `SetEnv proxy-sendchunked 1` and no `mod_deflate` for that
path; on nginx, `proxy_buffering off;`.

Nothing breaks if you cannot arrange it — the app also refetches on a timer, so
screens go stale rather than wrong — but live updates are the point of the
stream.

---

## 5. Check it

```bash
curl -i https://erp.example.com/api/v1/auth/me          # expect 401 + JSON error
curl -i https://erp.example.com/api/v1/reports/dashboard # expect 401, never a stack trace
```

Then sign in through the web app and confirm: the dashboard loads, a scanned
IMEI resolves, and a warehouse user sees only their own warehouse.

Two checks worth making once, because the failures are quiet:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://erp.example.com/some/deep/route
curl -s -o /dev/null -w '%{http_code}\n' https://erp.example.com/assets/nope.js
```

`200` then `404`. A `200` on the second means missing assets are answered with
the shell, and after the next deploy a browser still running the previous
version receives HTML where it expects JavaScript.

---

## 6. Updating a deployment

Where the repository is cloned on the host, `scripts/deploy.sh` does the whole
round — pull, install, build, publish the web app, restart:

```bash
source ~/nodevenv/<app>/<version>/bin/activate && cd ~/<app-root>
WEB_ROOT=~/erp.example.com ./scripts/deploy.sh
```

It refuses to run on a dirty working tree, keeps each `dist` until the build
succeeds and puts it back if the build dies — which on shared hosting it does,
for memory — and restarts through `tmp/restart.txt`, which Passenger watches.
`--skip-web` leaves the static files alone. `--prune` drops the
devDependencies afterwards, and is opt-in for a reason: on at least one host
the prune also removes `node_modules/.prisma`, the generated client, which is
not a package and so is not protected from it. The application then dies on its
next restart with `Cannot find module '.prisma/client'`, and the obvious repair
is unavailable — `prisma` is itself a devDependency the prune has just taken.
A couple of hundred megabytes of disk is cheaper than that, so keeping them is
the default.

It installs with `--ignore-scripts`, then runs `prisma generate` itself and
checks that `argon2` and `@prisma/client` actually load before going any
further. Package install scripts are the part a shared host is most likely to
kill — thread and process caps are reached inside Prisma's postinstall, and
some hosts decline to run install scripts at all. That matters more than it
sounds: `npm ci` empties `node_modules` before refilling it, so an install
that dies halfway leaves the running application with a dependency tree that
no longer works, and it keeps serving from memory until something restarts it.
Doing that work explicitly turns a failure discovered at the next restart into
one reported here, while the previous build is still in place.

Deploy from a branch CI has passed. The point of keeping the default branch
green is that the host never pulls a commit the suite has not seen.

### When the change includes a migration

The script says so and stops short of applying it, because a migration outlives
a restart and the database is shared with anything else pointing at it. Apply
it deliberately — from the **Neon migrate** workflow, or `prisma migrate
deploy` against the database — and mind the order:

- **Additive** (a new table, a nullable column): apply before or after the
  restart. The running release ignores what it does not select.
- **Destructive** (dropping or renaming something the running release still
  reads): the release that drops must not be the release that stops reading.
  Ship code tolerating both shapes, deploy it, then drop in a later release.

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
