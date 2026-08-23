#!/usr/bin/env bash
# Aura — one-command setup for macOS.
# Checks what you have, installs what you need, seeds the database, and prints
# the URLs for your Mac and your phone.
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
ok()   { echo "${GREEN}✓${OFF} $1"; }
warn() { echo "${YELLOW}!${OFF} $1"; }
die()  { echo "${RED}✗${OFF} $1"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "${BOLD}Aura setup${OFF}"
echo "${DIM}$ROOT${OFF}"
echo

# ---------- prerequisites ----------
command -v node >/dev/null || die "Node is not installed. Install Node 20+ from https://nodejs.org (or: brew install node)"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || die "Node $NODE_MAJOR is too old. Aura needs Node 20 or newer."
ok "Node $(node -v)"

if command -v psql >/dev/null && pg_isready -q 2>/dev/null; then
  ok "PostgreSQL is running"
else
  if command -v brew >/dev/null; then
    warn "PostgreSQL is not running — starting it with Homebrew"
    brew list postgresql@16 >/dev/null 2>&1 || brew install postgresql@16
    brew services start postgresql@16
    for _ in $(seq 1 20); do pg_isready -q 2>/dev/null && break; sleep 1; done
    pg_isready -q 2>/dev/null || die "PostgreSQL still is not answering. Try: brew services restart postgresql@16"
    ok "PostgreSQL started"
  else
    die "PostgreSQL is not running and Homebrew is not installed. Install Postgres 16, or install Homebrew from https://brew.sh"
  fi
fi

# ---------- database ----------
DB_USER="${AURA_DB_USER:-$(whoami)}"
if psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw aura; then
  ok "Database 'aura' exists"
else
  createdb aura && ok "Created database 'aura'"
fi

if [ ! -f api/.env ]; then
  cat > api/.env <<ENV
DATABASE_URL="postgresql://${DB_USER}@localhost:5432/aura?schema=public"
JWT_SECRET="dev-only-$(openssl rand -hex 16)"
PORT=4000
UPLOAD_DIR="./uploads"
DEV_OTP="1234"
ENV
  ok "Wrote api/.env"
else
  ok "api/.env already present — leaving it alone"
fi

# ---------- install ----------
echo
echo "${BOLD}Installing…${OFF} ${DIM}(first run takes a minute)${OFF}"
(cd api && npm install --silent) & API_PID=$!
(cd web && npm install --silent) & WEB_PID=$!
wait $API_PID $WEB_PID
ok "Dependencies installed"

(cd api && npx prisma db push --skip-generate >/dev/null && npx prisma generate >/dev/null)
ok "Schema applied"
(cd api && SEED_IF_EMPTY=1 npx tsx prisma/seed.ts >/dev/null)
ok "Database seeded"

# ---------- addresses ----------
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"

echo
echo "${BOLD}Ready.${OFF} Start it with two terminals:"
echo
echo "  ${DIM}Terminal 1${OFF}   cd api && npm run dev"
echo "  ${DIM}Terminal 2${OFF}   cd web && npm run dev:https"
echo
echo "${BOLD}On this Mac${OFF}      https://localhost:5173"
if [ -n "$LAN_IP" ]; then
  echo "${BOLD}On your phone${OFF}    https://${LAN_IP}:5173"
  echo "${DIM}                 Same Wi-Fi. Safari will warn about the certificate —${OFF}"
  echo "${DIM}                 tap Show Details → visit this website. The camera and${OFF}"
  echo "${DIM}                 Add to Home Screen need HTTPS, which is why.${OFF}"
else
  warn "Could not detect your Wi-Fi address — run: ipconfig getifaddr en0"
fi
echo
echo "${BOLD}Sign in${OFF}"
echo "  Owner    owner@aura.test / aura1234"
echo "  Worker   +201000000010   code 1234"
echo
