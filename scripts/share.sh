#!/usr/bin/env bash
# Puts Aura on your phone as a real app, over the internet, in about a minute.
#
# Your Mac stays the server. A Cloudflare quick tunnel gives it a public HTTPS
# address with a genuine certificate — which is what the phone needs for the
# camera, the service worker, and Add to Home Screen. No server to rent, no
# domain to buy, no account to create.
#
# The address is temporary and changes each run. For something permanent, see
# DEPLOY.md.
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
ok()   { echo "${GREEN}✓${OFF} $1"; }
warn() { echo "${YELLOW}!${OFF} $1"; }
die()  { echo "${RED}✗${OFF} $1"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for d in /opt/homebrew/bin /usr/local/bin; do [ -d "$d" ] && export PATH="$PATH:$d"; done
for d in /Applications/Postgres.app/Contents/Versions/*/bin; do [ -d "$d" ] && export PATH="$PATH:$d" && break; done

command -v node >/dev/null || die "Node is not installed. Run ./scripts/mac-setup.sh first."
[ -d api/node_modules ] && [ -d web/node_modules ] || die "Run ./scripts/mac-setup.sh first."

# ---------- cloudflared ----------
if ! command -v cloudflared >/dev/null; then
  if command -v brew >/dev/null; then
    echo "${BOLD}Installing cloudflared…${OFF} ${DIM}(one time)${OFF}"
    brew install cloudflared
  else
    echo "${BOLD}Downloading cloudflared…${OFF} ${DIM}(one time, no install needed)${OFF}"
    mkdir -p "$ROOT/.tools"
    ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="amd64" || ARCH="arm64"
    curl -fsSL -o "$ROOT/.tools/cloudflared" \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${ARCH}" \
      || die "Could not download cloudflared. Install Homebrew (https://brew.sh) then: brew install cloudflared"
    chmod +x "$ROOT/.tools/cloudflared"
    export PATH="$ROOT/.tools:$PATH"
  fi
fi
ok "cloudflared ready"

API_PID=""; WEB_PID=""; TUN_PID=""
cleanup() {
  echo; echo "${DIM}stopping…${OFF}"
  for p in "$TUN_PID" "$WEB_PID" "$API_PID"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---------- the stack ----------
echo "${BOLD}Starting Aura${OFF}"
(cd api && npm run dev >/tmp/aura-api.log 2>&1) & API_PID=$!
for _ in $(seq 1 40); do curl -fsS http://localhost:4000/health >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS http://localhost:4000/health >/dev/null 2>&1 || { cat /tmp/aura-api.log | tail -20; die "The API did not start."; }
ok "API running"

# Plain HTTP behind the tunnel: Cloudflare terminates TLS with a real certificate.
(cd web && TUNNEL=1 npx vite --host 127.0.0.1 --port 5173 >/tmp/aura-web.log 2>&1) & WEB_PID=$!
for _ in $(seq 1 40); do curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1 || { tail -20 /tmp/aura-web.log; die "The app did not start."; }
ok "App running"

# ---------- the tunnel ----------
echo "${DIM}opening a public address…${OFF}"
: > /tmp/aura-tunnel.log
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:5173 >/tmp/aura-tunnel.log 2>&1 & TUN_PID=$!

URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/aura-tunnel.log | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { tail -20 /tmp/aura-tunnel.log; die "The tunnel did not open. Check your internet connection."; }
ok "Public address ready"

echo
echo "${BOLD}Scan this with your phone camera${OFF}"
echo
(cd web && node --input-type=module -e "
import QRCode from 'qrcode';
console.log(await QRCode.toString(process.argv[1], { type: 'terminal', small: true }));
" "$URL") || true

echo "${BOLD}$URL${OFF}"
echo
echo "${BOLD}On the phone${OFF}"
echo "  1. Open that address in Safari"
echo "  2. Share button → ${BOLD}Add to Home Screen${OFF}"
echo "  3. It installs with the Aura icon and opens fullscreen"
echo
echo "${BOLD}Sign in${OFF}   owner@aura.test / aura1234   ·   worker +201000000010 code 1234"
echo
echo "${DIM}Works anywhere — mobile data included. Your Mac is the server, so keep${OFF}"
echo "${DIM}this running. The address changes each time; DEPLOY.md covers permanent.${OFF}"
echo "${DIM}Ctrl-C stops everything.${OFF}"
echo

wait
