#!/usr/bin/env bash
# Backs up the database and the photos. Run it on a schedule — the first day
# you need this is the day you find out whether you set it up.
#
#   ./scripts/backup.sh                  → ./backups
#   ./scripts/backup.sh /path/to/dir     → somewhere else, ideally another disk
set -euo pipefail

GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/backups}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$OUT"

# An explicitly passed DATABASE_URL wins; .env only fills in what is missing.
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/api/.env" ]; then
  set -a; . "$ROOT/api/.env"; set +a
fi
: "${DATABASE_URL:?DATABASE_URL is not set — is api/.env missing?}"

# Write to a temporary name and only publish it once it is whole. A truncated
# file sitting in the backup folder is worse than no file: it looks like a
# backup right up until the day it is needed.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

publish() {
  local src="$1" dest="$2" min="$3"
  local size; size=$(wc -c < "$src")
  if [ "$size" -lt "$min" ]; then
    echo "${RED}✗${OFF} $(basename "$dest") came out at ${size} bytes — refusing to keep it"
    return 1
  fi
  mv "$src" "$dest"
}

if [[ "$DATABASE_URL" == file:* ]]; then
  DB="${DATABASE_URL#file:}"
  [ -f "$DB" ] || { echo "${RED}✗${OFF} No database at $DB"; exit 1; }
  # .backup is safe on a live database; copying the file is not.
  sqlite3 "$DB" ".backup '$TMP/aura.db'" 2>/dev/null || cp "$DB" "$TMP/aura.db"
  gzip -f "$TMP/aura.db"
  publish "$TMP/aura.db.gz" "$OUT/aura-$STAMP.db.gz" 1000
  echo "${GREEN}✓${OFF} Database → $OUT/aura-$STAMP.db.gz"
else
  command -v pg_dump >/dev/null || { echo "${RED}✗${OFF} pg_dump not found"; exit 1; }
  pg_dump "$DATABASE_URL" | gzip > "$TMP/aura.sql.gz"
  publish "$TMP/aura.sql.gz" "$OUT/aura-$STAMP.sql.gz" 1000
  echo "${GREEN}✓${OFF} Database → $OUT/aura-$STAMP.sql.gz"
fi

UPLOADS="${UPLOAD_DIR:-$ROOT/api/uploads}"
if [ -d "$UPLOADS" ] && [ -n "$(ls -A "$UPLOADS" 2>/dev/null)" ]; then
  tar -czf "$TMP/photos.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
  publish "$TMP/photos.tar.gz" "$OUT/photos-$STAMP.tar.gz" 100
  echo "${GREEN}✓${OFF} Photos   → $OUT/photos-$STAMP.tar.gz"
fi

# Keep a month. Older copies belong somewhere off this machine anyway.
find "$OUT" -name 'aura-*' -mtime +30 -delete 2>/dev/null || true
find "$OUT" -name 'photos-*' -mtime +30 -delete 2>/dev/null || true

echo "${DIM}Backups older than 30 days removed. Copy $OUT somewhere off this machine —"
echo "a backup on the same disk as the database is not a backup.${OFF}"
