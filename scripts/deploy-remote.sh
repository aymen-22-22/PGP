#!/usr/bin/env bash
#
# Runs on the host, invoked over SSH by .github/workflows/deploy-shared-host.yml
# after it has already built everything on the runner and shipped the result
# as /tmp/pgp-deploy-payload.tar.gz. This script never builds anything itself —
# the host's thread cap is exactly what pushed the build off it in the first
# place (see build-artifacts.yml).
#
# Usage: deploy-remote.sh <app-dir> <web-root>
# Both accept a leading ~, expanded here against $HOME since a variable's
# value is not tilde-expanded by the shell the way a literal ~ token is.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <app-dir> <web-root>" >&2
  exit 2
fi

app_dir="${1/#\~/$HOME}"
web_root="${2/#\~/$HOME}"

cd "$app_dir"

# node is not on PATH in a bare, non-interactive SSH command — cPanel's
# Node apps only get it through the nodevenv it creates, which has to be
# sourced explicitly (same as every manual deploy in this project's docs).
# Matched by app folder name so a future Node version bump on the host
# still finds it without editing this script.
nodevenv_activate="$(ls -d "$HOME"/nodevenv/"$(basename "$app_dir")"/*/bin/activate 2>/dev/null | head -n1)"
if [ -n "$nodevenv_activate" ]; then
  # shellcheck disable=SC1090
  source "$nodevenv_activate"
else
  echo "::warning::No nodevenv found for $(basename "$app_dir") under \$HOME/nodevenv — relying on node already being on PATH." >&2
fi

git fetch origin main
git checkout main
git reset --hard origin/main

rm -rf node_modules/.prisma apps/api/dist apps/web/dist packages/shared-types/dist
tar xzf /tmp/pgp-deploy-payload.tar.gz
rm -f /tmp/pgp-deploy-payload.tar.gz

node -e "require('@prisma/client')" || { echo "Prisma client did not load after deploy" >&2; exit 1; }

# The doc root's .htaccess is not ours to replace — it carries cPanel's
# Passenger routing block. Keep it, publish everything else.
if [ -e "$web_root/.htaccess" ]; then
  cp "$web_root/.htaccess" /tmp/pgp-deploy-htaccess.bak
fi
cp -r apps/web/dist/. "$web_root/"
if [ -e /tmp/pgp-deploy-htaccess.bak ]; then
  cp /tmp/pgp-deploy-htaccess.bak "$web_root/.htaccess"
  rm -f /tmp/pgp-deploy-htaccess.bak
fi

mkdir -p tmp
touch tmp/restart.txt
echo "Deployed $(git rev-parse --short HEAD)"
