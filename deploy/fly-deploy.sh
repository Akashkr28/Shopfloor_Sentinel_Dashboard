#!/usr/bin/env bash
# First deployment to Fly.io. Safe to re-run: existing app, volume and secrets are kept.
#   fly auth login
#   ./deploy/fly-deploy.sh [app-name]
# The app name must be unique across Fly; the site is https://<app-name>.fly.dev
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-shopfloor-sentinel}"
REGION="sin"
say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

fly auth whoami >/dev/null

if ! fly status --app "$APP" >/dev/null 2>&1; then
  say "Creating app $APP"
  fly apps create "$APP" --org "${FLY_ORG:-personal}"
fi

if ! fly volumes list --app "$APP" | grep -q sentinel_data; then
  say "Creating the 3 GB persistent volume in $REGION"
  fly volumes create sentinel_data --app "$APP" --region "$REGION" --size 3 --yes
fi

# Secrets are generated here and go straight to Fly; they are never printed or stored in the repo.
if ! fly secrets list --app "$APP" | grep -q JWT_SECRET; then
  say "Setting secrets"
  fly secrets set --app "$APP" --stage \
    "JWT_SECRET=$(openssl rand -hex 32)" \
    "GATEWAY_TOKEN=$(openssl rand -hex 24)" \
    "SETUP_CODE=$(openssl rand -hex 6 | tr a-f A-F)" \
    "PUBLIC_URL=https://$APP.fly.dev"
fi

say "Building on Fly's servers and deploying (first build takes a few minutes)"
fly deploy --app "$APP" --ha=false --remote-only --wait-timeout 10m

say "Done: https://$APP.fly.dev"
echo "Setup code (needed once):"
fly logs --app "$APP" --no-tail | grep -o 'Setup code: [A-Z0-9-]*' | tail -1 || echo "  not found yet – run: fly logs --app $APP"
