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

# Node and Postgres often live outside the default PATH on macOS. Look where
# the common installers actually put them before deciding anything is missing.
for d in /opt/homebrew/bin /usr/local/bin; do
  [ -d "$d" ] && export PATH="$PATH:$d"
done
for d in /Applications/Postgres.app/Contents/Versions/*/bin; do
  [ -d "$d" ] && export PATH="$PATH:$d" && POSTGRES_APP=1 && break
done
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

echo "${BOLD}Aura setup${OFF}"
echo "${DIM}$ROOT${OFF}"
echo

# ---------- prerequisites ----------
if ! command -v node >/dev/null; then
  echo "${RED}✗ Node is not installed.${OFF}"
  echo
  echo "  ${BOLD}Easiest fix${OFF} — no terminal needed:"
  echo "    1. Open ${BOLD}https://nodejs.org${OFF}"
  echo "    2. Download the ${BOLD}macOS Installer (.pkg)${OFF} — take the LTS one"
  echo "    3. Double-click it, click through, done"
  echo "    4. ${BOLD}Quit Terminal completely${OFF} (⌘Q) and reopen it — this step matters,"
  echo "       a Terminal window opened before the install will not see Node"
  echo "    5. Run this script again"
  echo
  echo "  ${DIM}If you have Homebrew: brew install node${OFF}"
  echo
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || die "Node $NODE_MAJOR is too old. Aura needs Node 20 or newer."
ok "Node $(node -v)"

USE_SQLITE=0
if command -v psql >/dev/null && pg_isready -q 2>/dev/null; then
  ok "PostgreSQL is running${POSTGRES_APP:+ (Postgres.app)}"
elif [ "${AURA_DB:-}" = "sqlite" ]; then
  USE_SQLITE=1
  ok "Using SQLite (AURA_DB=sqlite)"
elif command -v brew >/dev/null; then
  warn "PostgreSQL is not running — starting it with Homebrew"
  brew list postgresql@16 >/dev/null 2>&1 || brew install postgresql@16
  brew services start postgresql@16
  for _ in $(seq 1 20); do pg_isready -q 2>/dev/null && break; sleep 1; done
  pg_isready -q 2>/dev/null || die "PostgreSQL still is not answering. Try: brew services restart postgresql@16"
  ok "PostgreSQL started"
else
  # No database server and no way to install one. Rather than dead-end, fall
  # back to SQLite — a single file, no server, no install. PostgreSQL stays the
  # production target; this is for trying it on a laptop.
  USE_SQLITE=1
  warn "No PostgreSQL found — using SQLite instead (a file, no server to install)"
  echo "${DIM}    For the production database later: https://postgresapp.com, or${OFF}"
  echo "${DIM}    brew install postgresql@16 — then re-run this script.${OFF}"
fi

# ---------- database ----------
if [ "$USE_SQLITE" = "1" ]; then
  # Absolute path: Prisma resolves a relative SQLite URL against the schema
  # directory, which is a good way to end up pointing at the wrong file.
  DB_URL="file:${ROOT}/api/prisma/dev.db"
else
  DB_USER="${AURA_DB_USER:-$(whoami)}"
  if psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw aura; then
    ok "Database 'aura' exists"
  else
    createdb aura && ok "Created database 'aura'"
  fi
  DB_URL="postgresql://${DB_USER}@localhost:5432/aura?schema=public"
fi

if [ ! -f api/.env ]; then
  cat > api/.env <<ENV
DATABASE_URL="${DB_URL}"
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

if [ "$USE_SQLITE" = "1" ]; then
  (cd api && node prisma/make-sqlite-schema.mjs >/dev/null \
    && npx prisma db push --schema prisma/schema.sqlite.prisma --accept-data-loss >/dev/null 2>&1)
  ok "Schema applied (SQLite)"
else
  (cd api && npx prisma db push --skip-generate >/dev/null && npx prisma generate >/dev/null)
  ok "Schema applied (PostgreSQL)"
fi
(cd api && SEED_IF_EMPTY=1 npx tsx prisma/seed.ts >/dev/null)
ok "Database seeded"

# ---------- addresses ----------
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"

echo
echo "${BOLD}Ready.${OFF} Start it with one command, from anywhere in this folder:"
echo
echo "  ${BOLD}./scripts/start.sh${OFF}"
echo
echo "${DIM}It runs both the API and the app. Ctrl-C stops both.${OFF}"
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
