#!/usr/bin/env bash
# Run this ON THE SERVER, as root, on a fresh Ubuntu 24.04 box.
#
#   curl -fsSL https://raw.githubusercontent.com/AReg99/Abdullah-Ramadan/claude/furniture-factory-tracking-k4psgd/scripts/server-setup.sh -o setup.sh
#   bash setup.sh
#
# Installs Docker, fetches the code, generates the secrets, checks DNS actually
# points here, and brings the stack up.
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
ok()   { echo "${GREEN}✓${OFF} $1"; }
warn() { echo "${YELLOW}!${OFF} $1"; }
die()  { echo "${RED}✗${OFF} $1"; exit 1; }

BRANCH="claude/furniture-factory-tracking-k4psgd"
REPO="https://github.com/AReg99/Abdullah-Ramadan.git"
DIR="/opt/aura"

[ "$(id -u)" = "0" ] || die "Run this as root: sudo bash setup.sh"

echo "${BOLD}Aura — server setup${OFF}"
echo

# ---------- what we need to know ----------
read -rp "Your domain (e.g. aura.yourcompany.com): " DOMAIN
[ -n "$DOMAIN" ] || die "A domain is required — Caddy needs it to get an HTTPS certificate."
read -rp "Your email for signing in as owner: " OWNER_EMAIL
[ -n "$OWNER_EMAIL" ] || die "An email is required."
while :; do
  read -rsp "A password for that account (8+ characters): " OWNER_PASSWORD; echo
  [ ${#OWNER_PASSWORD} -ge 8 ] && break
  warn "Too short — 8 characters or more."
done
echo

# ---------- DNS has to point here before anything else ----------
# Getting this wrong is the most common way this deploy fails, and the symptom
# is Caddy silently never obtaining a certificate.
MYIP="$(curl -fsS4 https://api.ipify.org || curl -fsS4 https://ifconfig.me || echo "")"
# Only IPv4, so this compares like with like: `getent hosts` would happily hand
# back an AAAA record and look like a mismatch against the IPv4 above.
DNSIPS="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u)"
if [ -z "$DNSIPS" ]; then
  die "$DOMAIN does not resolve yet. Add an A record pointing at ${MYIP:-this server}, wait a few minutes, and run this again."
elif [ -z "$MYIP" ]; then
  warn "Could not work out this server's public IP — skipping the DNS check."
elif echo "$DNSIPS" | grep -qx "$MYIP"; then
  ok "$DOMAIN points at this server"
else
  warn "$DOMAIN resolves to $(echo "$DNSIPS" | tr '\n' ' ')but this server is $MYIP."
  echo "  ${DIM}If you are using Cloudflare, the record is probably proxied (orange cloud)."
  echo "  Set it to DNS only (grey cloud), or Caddy cannot get a certificate.${OFF}"
  read -rp "Continue anyway? [y/N] " GO
  [ "$GO" = "y" ] || exit 1
fi

# ---------- docker ----------
if ! command -v docker >/dev/null; then
  echo "${DIM}installing Docker…${OFF}"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || die "Docker install failed."
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is missing."
ok "Docker ready"

# ---------- code ----------
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin "$BRANCH" -q && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" reset --hard -q "origin/$BRANCH"
  ok "Code updated"
else
  command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
  git clone -q --branch "$BRANCH" "$REPO" "$DIR" || die "Could not fetch the code."
  ok "Code fetched to $DIR"
fi
cd "$DIR"

# ---------- secrets ----------
if [ -f .env.prod ]; then
  warn ".env.prod already exists — keeping it, so your existing secrets are not rotated"
else
  cat > .env.prod <<ENV
DOMAIN=$DOMAIN
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
OWNER_EMAIL=$OWNER_EMAIL
OWNER_PASSWORD=$OWNER_PASSWORD
ENV
  chmod 600 .env.prod
  ok "Secrets generated"
fi

# ---------- up ----------
echo
echo "${BOLD}Building and starting…${OFF} ${DIM}(first run takes a few minutes)${OFF}"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

echo
echo "${DIM}waiting for the certificate…${OFF}"
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "https://$DOMAIN/api/health" 2>/dev/null && break
  sleep 5
done

if curl -fsS -o /dev/null "https://$DOMAIN/api/health" 2>/dev/null; then
  echo
  ok "${BOLD}Live at https://$DOMAIN${OFF}"
  echo
  echo "  Sign in as ${BOLD}$OWNER_EMAIL${OFF} with the password you just set."
  echo "  Then: Setup → Products, Setup → Crews, New order."
  echo
  echo "${DIM}Logs:    docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f"
  echo "Backup:  ./scripts/backup.sh${OFF}"
else
  warn "Not answering on https://$DOMAIN yet."
  echo "  ${DIM}Certificates can take a minute. Check with:"
  echo "  docker compose -f docker-compose.prod.yml --env-file .env.prod logs caddy${OFF}"
fi
