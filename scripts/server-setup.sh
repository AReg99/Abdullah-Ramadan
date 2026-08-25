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
echo "${DIM}Aura needs an HTTPS address. If you have a domain, enter it now."
echo "If you do not, press Enter and one is derived from this server's IP —"
echo "free, instant, and it gets a real certificate just the same.${OFF}"
read -rp "Your domain (or Enter for a free one): " DOMAIN
read -rp "Your email for signing in as owner: " OWNER_EMAIL
[ -n "$OWNER_EMAIL" ] || die "An email is required."
while :; do
  read -rsp "A password for that account (8+ characters): " OWNER_PASSWORD; echo
  [ ${#OWNER_PASSWORD} -ge 8 ] && break
  warn "Too short — 8 characters or more."
done
echo

# ---------- the address has to reach this machine ----------
# Caddy proves control of the hostname over port 80 to get its certificate, so
# the hostname must already resolve here. Getting this wrong is the usual way
# the deploy fails, and the symptom is Caddy silently never obtaining a
# certificate: the stack looks healthy and the site never loads.
MYIP="$(curl -fsS4 https://api.ipify.org || curl -fsS4 https://ifconfig.me || echo "")"

# Only IPv4, so this compares like with like: `getent hosts` will hand back an
# AAAA record and read as a mismatch against the IPv4 the server reports.
resolves_to_us() {
  getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u | grep -qx "$MYIP"
}

if [ -z "$DOMAIN" ]; then
  # sslip.io and nip.io are wildcard resolvers: any address-shaped name under
  # them answers with that address. Nothing to register, nothing to configure,
  # and both are on the Public Suffix List so the certificate rate limit is per
  # server rather than shared with everyone else using the service.
  [ -n "$MYIP" ] || die "Could not detect this server's public IP, so a free hostname cannot be built. Pass a domain instead."
  DASHED="${MYIP//./-}"
  for SUFFIX in sslip.io nip.io; do
    if resolves_to_us "$DASHED.$SUFFIX"; then DOMAIN="$DASHED.$SUFFIX"; break; fi
  done
  [ -n "$DOMAIN" ] || die "Neither sslip.io nor nip.io answered. Check this server can make DNS queries, or pass a domain."
  ok "Using the free address ${BOLD}$DOMAIN${OFF}"
  echo "  ${DIM}Works exactly like a bought domain — real certificate, installs on phones."
  echo "  To move to your own domain later: point it here, then run this again${OFF}"
elif [ -z "$MYIP" ]; then
  warn "Could not work out this server's public IP — skipping the DNS check."
elif resolves_to_us "$DOMAIN"; then
  ok "$DOMAIN points at this server"
else
  RESOLVED="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
  if [ -z "$RESOLVED" ]; then
    warn "$DOMAIN does not resolve yet. Add an A record pointing at $MYIP and give it a few minutes."
  else
    warn "$DOMAIN resolves to ${RESOLVED}but this server is $MYIP."
    echo "  ${DIM}If you are using Cloudflare, the record is probably proxied (orange cloud)."
    echo "  Set it to DNS only (grey cloud), or Caddy cannot get a certificate.${OFF}"
  fi
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
  # Re-run: keep the generated secrets exactly as they are, since rotating
  # JWT_SECRET signs everyone out and rotating POSTGRES_PASSWORD locks the API
  # out of its own database. Only the domain moves, which is the whole point of
  # running this again after buying one.
  OLD_DOMAIN="$(grep -E '^DOMAIN=' .env.prod | cut -d= -f2-)"
  if [ "$OLD_DOMAIN" != "$DOMAIN" ]; then
    sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env.prod
    ok "Moving from $OLD_DOMAIN to $DOMAIN — your data and sign-ins are untouched"
  else
    ok "Existing settings kept"
  fi
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
