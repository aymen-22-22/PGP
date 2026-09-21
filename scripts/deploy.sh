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
#   ./scripts/deploy.sh --keep-dev           # leave devDependencies installed
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
KEEP_DEV=0

for arg in "$@"; do
  case "$arg" in
    --skip-web) SKIP_WEB=1 ;;
    --keep-dev) KEEP_DEV=1 ;;
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
npm ci --include=dev

for d in "${DISTS[@]}"; do
  rm -rf "$d.prev"
  if [ -d "$d" ]; then cp -r "$d" "$d.prev"; fi
done
trap restore ERR

say "Building"
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}" npm run build

trap - ERR
for d in "${DISTS[@]}"; do rm -rf "$d.prev"; done

if [ "$KEEP_DEV" -eq 0 ]; then
  say "Removing devDependencies"
  npm prune --omit=dev
fi

if [ "$SKIP_WEB" -eq 0 ]; then
  if [ -z "$WEB_ROOT" ]; then
    echo
    echo "deploy: WEB_ROOT is not set, so the web app was built but not published."
    echo "        Set it to your document root, or pass --skip-web to stop asking."
  else
    say "Publishing the web app to $WEB_ROOT"
    [ -d "$WEB_ROOT" ] || die "WEB_ROOT $WEB_ROOT does not exist"
    # dist/. and not dist/* — the glob skips .htaccess, which carries the
    # single-page rewrite, and the site then 404s on every refresh.
    cp -r apps/web/dist/. "$WEB_ROOT/"
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
