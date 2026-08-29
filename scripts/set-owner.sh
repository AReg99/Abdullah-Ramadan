#!/usr/bin/env bash
# Set the owner's email and password on a running server.
#
#   bash scripts/set-owner.sh                          # show who can sign in
#   bash scripts/set-owner.sh you@example.com "secret" # change the owner
#
# The owner account is created once, when the database is first seeded, so
# editing OWNER_EMAIL in .env.prod afterwards has no effect. This does.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
if [ ! -f .env.prod ]; then
  COMPOSE="docker compose -f docker-compose.lite.yml"
fi

$COMPOSE exec -T api node prisma/set-owner.mjs "$@"
