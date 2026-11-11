#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

STAMP="$(date +%Y%m%d%H%M%S)"
DRILL_DB="vertexlearn_restore_drill_${STAMP}"
DUMP_PATH="$(mktemp "/tmp/vertexlearn-dump-${STAMP}-XXXXXX.sql")"
COMPOSE=(docker compose --env-file .env -f infra/docker-compose.yml)

cleanup() {
  "${COMPOSE[@]}" exec -T postgres psql -U vertexlearn -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE);" >/dev/null 2>&1 || true
  rm -f "$DUMP_PATH"
}
trap cleanup EXIT

START_NS="$(date +%s%N 2>/dev/null || echo 0)"

"${COMPOSE[@]}" exec -T postgres pg_dump -U vertexlearn -d vertexlearn -F p --no-owner --no-privileges > "$DUMP_PATH"
test -s "$DUMP_PATH"

"${COMPOSE[@]}" exec -T postgres psql -U vertexlearn -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DRILL_DB};" >/dev/null
"${COMPOSE[@]}" exec -T postgres psql -U vertexlearn -d "$DRILL_DB" -v ON_ERROR_STOP=1 -q < "$DUMP_PATH" >/dev/null

VERIFY_SQL="SELECT (SELECT count(*) FROM users) || ',' || (SELECT count(*) FROM courses) || ',' || (SELECT count(*) FROM discussion_threads) || ',' || (SELECT count(*) FROM notifications) || ',' || (SELECT count(*) FROM outbox);"
SRC_COUNTS="$("${COMPOSE[@]}" exec -T postgres psql -U vertexlearn -d vertexlearn -t -A -c "$VERIFY_SQL" | tr -d '[:space:]')"
DST_COUNTS="$("${COMPOSE[@]}" exec -T postgres psql -U vertexlearn -d "$DRILL_DB" -t -A -c "$VERIFY_SQL" | tr -d '[:space:]')"

if [[ "$SRC_COUNTS" != "$DST_COUNTS" ]]; then
  echo "Restore drill mismatch: source=$SRC_COUNTS restored=$DST_COUNTS" >&2
  exit 1
fi

END_NS="$(date +%s%N 2>/dev/null || echo 0)"
ELAPSED="completed"
if [[ "$START_NS" != "0" && "$END_NS" != "0" ]]; then
  ELAPSED="$(( (END_NS - START_NS) / 1000000 ))ms"
fi
echo "Restore drill passed in ${ELAPSED} (counts: ${DST_COUNTS})"

