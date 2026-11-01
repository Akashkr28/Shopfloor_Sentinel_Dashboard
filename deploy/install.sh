#!/usr/bin/env bash
# Shopfloor Sentinel – install on a fresh Ubuntu/Debian VPS with Docker.
#
#   git clone https://github.com/Akashkr28/Shopfloor_Sentinel_Dashboard.git
#   cd Shopfloor_Sentinel_Dashboard
#   sudo ./deploy/install.sh sentinel.yourfactory.in
#
# Before running: point the domain's DNS A record at this server and open
# ports 80 and 443. Re-running is safe: existing secrets are kept.
set -euo pipefail

cd "$(dirname "$0")/.."
DOMAIN="${1:-${DOMAIN:-}}"
if [[ -z "$DOMAIN" ]]; then
  read -rp "Domain for the dashboard (e.g. sentinel.yourfactory.in): " DOMAIN
fi
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "That doesn't look like a domain name: $DOMAIN" >&2
  exit 1
fi

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# ---- Docker
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker (official convenience script from get.docker.com)"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (docker compose)." >&2; exit 1; }

# ---- Secrets: generated once, never overwritten
rand() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
setvar() { # setvar KEY VALUE FILE – replace or append
  if grep -qE "^$1=" "$3"; then sed -i "s|^$1=.*|$1=$2|" "$3"; else echo "$1=$2" >> "$3"; fi
}
if [[ ! -f backend/.env ]]; then
  say "Creating backend/.env with fresh secrets"
  cp backend/.env.example backend/.env
  setvar JWT_SECRET "$(rand 32)" backend/.env
  setvar GATEWAY_TOKEN "$(rand 24)" backend/.env
  setvar SEED_DEMO false backend/.env
  setvar NODE_ENV production backend/.env
  setvar PUBLIC_URL "https://$DOMAIN" backend/.env
  setvar INITIAL_OWNER_PASSWORD "" backend/.env
  chmod 600 backend/.env
else
  say "Keeping the existing backend/.env"
fi
echo "DOMAIN=$DOMAIN" > .env

# ---- Build and start
say "Building and starting (first build takes a few minutes)"
docker compose up -d --build

say "Waiting for Sentinel to be healthy"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q sentinel)" 2>/dev/null || true)"
  [[ "$status" == "healthy" ]] && break
  sleep 3
done
[[ "${status:-}" == "healthy" ]] || { echo "Sentinel did not become healthy – check: docker compose logs sentinel" >&2; exit 1; }

code="$(docker compose logs sentinel 2>/dev/null | grep -o 'Setup code: [A-Z0-9-]*' | tail -1 | cut -d' ' -f3 || true)"
token="$(grep -E '^GATEWAY_TOKEN=' backend/.env | cut -d= -f2-)"

cat <<EOF

  Shopfloor Sentinel is running.

  Dashboard     https://$DOMAIN
  Setup code    ${code:-"(already set up – sign in)"}
                Needed once, to create the Owner account. After that, invite everyone from Setup → Users.

  Gateways      backendUrl  https://$DOMAIN/api
                gatewayToken $token
                (put both in gateway/config.json on each Raspberry Pi)

  Next:  add ANTHROPIC_API_KEY and your WhatsApp/SMS provider to backend/.env, then:
         docker compose up -d
EOF
