#!/usr/bin/env bash
# Starts the API and the web app together, from anywhere in the repo.
# Ctrl-C stops both. No second terminal, no cd-ing into the wrong folder.
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Postgres.app keeps its binaries outside the default PATH.
for d in /Applications/Postgres.app/Contents/Versions/*/bin; do
  [ -d "$d" ] && export PATH="$d:$PATH" && break
done

command -v node >/dev/null || { echo "${RED}✗${OFF} Node is not installed. Run ./scripts/mac-setup.sh first."; exit 1; }
[ -d api/node_modules ] && [ -d web/node_modules ] || {
  echo "${RED}✗${OFF} Dependencies are not installed. Run ./scripts/mac-setup.sh first."; exit 1; }

API_PID=""; WEB_PID=""
cleanup() {
  echo
  echo "${DIM}stopping…${OFF}"
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "${BOLD}Starting Aura${OFF}"
(cd api && npm run dev) & API_PID=$!

# Wait for the API before starting the web app, so the first page load has data.
for _ in $(seq 1 40); do
  curl -fsS http://localhost:4000/health >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS http://localhost:4000/health >/dev/null 2>&1 \
  && echo "${GREEN}✓${OFF} API on http://localhost:4000" \
  || echo "${YELLOW}!${OFF} API did not answer yet — it may still be starting"

(cd web && npm run dev:https) & WEB_PID=$!
sleep 3

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"
echo
echo "${BOLD}On this Mac${OFF}     https://localhost:5173"
[ -n "$LAN_IP" ] && echo "${BOLD}On your phone${OFF}   https://${LAN_IP}:5173"
echo "${DIM}Safari will warn about the certificate — Show Details → visit this website.${OFF}"
echo
echo "${BOLD}Sign in${OFF}   owner@aura.test / aura1234   ·   worker +201000000010 code 1234"
echo "${DIM}Ctrl-C stops both.${OFF}"
echo

wait
