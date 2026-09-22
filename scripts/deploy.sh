#!/usr/bin/env bash
#
# Updates a deployment in place: pull, install, build, publish the web app,
# restart. Written for shared hosting reached over SSH, where the repository
# is cloned on the host and there is no CI runner to hand.
#
# Run it from an activated Node environment. On cPanel that means the
# `source …/nodevenv/<app>/<version>/bin/activate` line the panel shows you;
# without it there is no node on PATH and nothing below works.
#
#   ./scripts/deploy.sh                      # API and web
#   WEB_ROOT=~/example.com ./scripts/deploy.sh
#   ./scripts/deploy.sh --skip-web           # API only
#   ./scripts/deploy.sh --prune              # drop devDependencies afterwards
#
# The build writes over the directories the running application serves from,
# so a build that dies halfway — and on shared hosting it dies for memory —
# would otherwise leave a half-written dist behind. Each dist is kept until
# the build succeeds and put back if it does not.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_ROOT="${WEB_ROOT:-}"
SKIP_WEB=0
# Pruning is opt-in. It saves a couple of hundred megabytes of disk and, on at
# least one host, takes node_modules/.prisma with it — the generated client,
# which is not a package and so is not protected from a prune. The application
# then dies on its next restart with "Cannot find module '.prisma/client'", and
# the obvious repair is unavailable because prisma is itself a devDependency
# that the prune has just removed. Disk is cheaper than that.
PRUNE=0

for arg in "$@"; do
  case "$arg" in
    --skip-web) SKIP_WEB=1 ;;
    --prune) PRUNE=1 ;;
    # Accepted and ignored: keeping devDependencies is now the default.
    --keep-dev) ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "deploy: unknown option $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\ndeploy: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null || die "no node on PATH — activate the Node environment first"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node $NODE_MAJOR is too old; this needs 20 or newer"

if [ -n "$(git status --porcelain)" ]; then
  die "the working tree has local changes — commit or discard them, a pull will not be clean"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BEFORE="$(git rev-parse HEAD)"

say "Pulling $BRANCH"
git pull --ff-only

AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "Already at $(git rev-parse --short HEAD) — nothing new to deploy."
fi

# Whether a schema change came with this pull. Applying it is a separate,
# deliberate act: the database is shared and a migration outlives a restart.
if [ "$BEFORE" != "$AFTER" ] &&
   git diff --name-only "$BEFORE" "$AFTER" | grep -q '^apps/api/prisma/migrations/'; then
  MIGRATIONS_PENDING=1
else
  MIGRATIONS_PENDING=0
fi

DISTS=(apps/api/dist apps/web/dist packages/shared-types/dist)

restore() {
  for d in "${DISTS[@]}"; do
    if [ -d "$d.prev" ]; then
      rm -rf "$d"
      mv "$d.prev" "$d"
    fi
  done
  printf '\ndeploy: build failed — the previous build has been put back, nothing was published.\n' >&2
}

say "Installing dependencies"
# --include=dev explicitly: the application environment sets NODE_ENV=production,
# and npm reads that to mean "skip devDependencies" — which is every tool the
# build needs.
#
# --ignore-scripts because npm ci empties node_modules before it refills it, so
# an install that dies halfway leaves the running application with a dependency
# tree that no longer works — and it keeps serving from memory until something
# restarts it, which is a bad moment to find out. Package install scripts are
# the part most likely to die: shared hosts cap threads and processes, and
# Prisma's postinstall is where that cap gets hit. Some hosts refuse to run
# them at all.
#
# What those scripts would have done is done explicitly below instead, where a
# failure is named rather than silent.
npm ci --include=dev --ignore-scripts

say "Generating the Prisma client"
# Normally @prisma/client's postinstall. Without it the client throws
# "did not initialize yet" at the first query — at runtime, not here.
npx prisma generate --schema apps/api/prisma/schema.prisma

say "Checking the dependencies load"
# argon2 is a native module: an install that skipped its build, or one built
# against another platform, fails at the first login rather than at startup.
# Better to hear about it now, with the previous build still in place.
node -e "require('argon2')" ||
  die "argon2 will not load — every login would fail. Re-run npm ci, or rebuild it with npm rebuild argon2."
node -e "require('@prisma/client')" ||
  die "@prisma/client will not load — every query would fail."

for d in "${DISTS[@]}"; do
  rm -rf "$d.prev"
  if [ -d "$d" ]; then cp -r "$d" "$d.prev"; fi
done
trap restore ERR

say "Building"
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}" npm run build

trap - ERR
for d in "${DISTS[@]}"; do rm -rf "$d.prev"; done

if [ "$PRUNE" -eq 1 ]; then
  say "Removing devDependencies"
  npm prune --omit=dev
  # The generated client lives inside node_modules without being a package, so
  # a prune can take it. Regenerating needs the prisma CLI, which the prune has
  # also just removed, so the way back is a deploy without --prune.
  node -e "require('@prisma/client')" ||
    die "the prune removed the generated Prisma client. Re-run this deploy without --prune; regenerating is not possible now, because prisma is a devDependency the prune has taken as well."
fi

if [ "$SKIP_WEB" -eq 0 ]; then
  if [ -z "$WEB_ROOT" ]; then
    echo
    echo "deploy: WEB_ROOT is not set, so the web app was built but not published."
    echo "        Set it to your document root, or pass --skip-web to stop asking."
  else
    say "Publishing the web app to $WEB_ROOT"
    [ -d "$WEB_ROOT" ] || die "WEB_ROOT $WEB_ROOT does not exist"

    # A document root's .htaccess is not ours to replace. On a panel-managed
    # host it also carries the directives that route the API to the application
    # server — cPanel writes its Passenger block there when the application URL
    # sits under this domain — and overwriting it takes the API off the air
    # while the site itself keeps working, which reads as the API having
    # crashed. Keep whatever is there and put ours in only when there is none.
    KEPT=""
    if [ -e "$WEB_ROOT/.htaccess" ]; then
      KEPT="$(mktemp)"
      cp "$WEB_ROOT/.htaccess" "$KEPT"
    fi

    # dist/. and not dist/* — the glob skips dotfiles.
    cp -r apps/web/dist/. "$WEB_ROOT/"

    if [ -n "$KEPT" ]; then
      cp "$KEPT" "$WEB_ROOT/.htaccess"
      rm -f "$KEPT"
      if ! cmp -s apps/web/dist/.htaccess "$WEB_ROOT/.htaccess"; then
        echo
        echo "deploy: kept the .htaccess already in $WEB_ROOT; it differs from the"
        echo "        one in this build. If the build's rules changed, merge them"
        echo "        in by hand — see docs/deployment.md — rather than replacing"
        echo "        the file, which may hold your host's own routing."
      fi
    fi
  fi
fi

say "Restarting"
mkdir -p tmp
touch tmp/restart.txt
echo "Touched tmp/restart.txt — Passenger restarts on the next request."
echo "If your host does not use Passenger, restart the application from its panel."

if [ "$MIGRATIONS_PENDING" -eq 1 ]; then
  cat <<'EOF'

  ─────────────────────────────────────────────────────────────────────
  This pull brought new Prisma migrations. They have NOT been applied.

  Apply them from Actions → Neon migrate, or with migrate deploy against
  the database directly. An additive migration is safe to apply before or
  after this restart; one that drops or renames something the previous
  release still reads is not — see docs/deployment.md.
  ─────────────────────────────────────────────────────────────────────
EOF
fi

say "Done — $(git rev-parse --short HEAD)"
