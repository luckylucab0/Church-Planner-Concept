#!/usr/bin/env bash
# Lokales Security-Testlabor starten.
#
# Warum nicht docker compose: Das Labor soll auch dort laufen, wo kein
# Docker-Daemon verfügbar ist (CI-Container, Remote-Sessions). Postgres und
# Redis werden deshalb direkt als Prozesse gestartet.
#
# Startet:
#   - PostgreSQL auf :5432 (Datenbanken serveflow + serveflow_test)
#   - Redis auf :6379
#   - Mail-Sink auf :1025 (SMTP) und :8025 (HTTP-API)
#   - API auf :3000 (NODE_ENV=development, echter Mailversand an den Sink)
#   - API auf :3002 (NODE_ENV=test, Rate Limiting abgeschaltet)
#
# Zwei API-Instanzen, weil sich die beiden Anforderungen ausschließen:
# Token-Flows brauchen echten Mailversand (also NICHT NODE_ENV=test),
# Bruteforce-Checks brauchen ein abgeschaltetes Rate Limit (also
# NODE_ENV=test). Siehe README.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAB_DIR="${LAB_DIR:-${TMPDIR:-/tmp}/serveflow-security-lab}"
PGDIR="${PGDIR:-/var/lib/postgresql/serveflow-lab}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DB_URL="postgresql://serveflow:serveflow@127.0.0.1:5432/serveflow"

mkdir -p "$LAB_DIR"
echo "Labor-Verzeichnis: $LAB_DIR"

# --- PostgreSQL ---------------------------------------------------
# initdb weigert sich, als root zu laufen – deshalb der postgres-Systemnutzer.
if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "Starte PostgreSQL …"
  if [ ! -d "$PGDIR/base" ]; then
    install -d -o postgres -g postgres -m 700 "$PGDIR"
    sudo -u postgres "$PGBIN/initdb" -D "$PGDIR" --auth=trust --encoding=UTF8 >"$LAB_DIR/initdb.log" 2>&1
  fi
  sudo -u postgres "$PGBIN/pg_ctl" -D "$PGDIR" -l "$LAB_DIR/postgres.log" \
    -o "-p 5432 -k /tmp -h 127.0.0.1" start >/dev/null
  for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && break; sleep 1; done

  sudo -u postgres "$PGBIN/psql" -h 127.0.0.1 -p 5432 -d postgres -q \
    -c "CREATE USER serveflow WITH PASSWORD 'serveflow' CREATEDB SUPERUSER;" 2>/dev/null || true
  sudo -u postgres "$PGBIN/createdb" -h 127.0.0.1 -p 5432 -O serveflow serveflow 2>/dev/null || true
  sudo -u postgres "$PGBIN/createdb" -h 127.0.0.1 -p 5432 -O serveflow serveflow_test 2>/dev/null || true
fi
echo "  PostgreSQL läuft"

# --- Redis --------------------------------------------------------
if ! redis-cli ping >/dev/null 2>&1; then
  redis-server --port 6379 --daemonize yes --dir "$LAB_DIR" --save '' >/dev/null
  sleep 1
fi
echo "  Redis läuft"

# --- Mail-Sink ----------------------------------------------------
if ! curl -sS -m 3 http://127.0.0.1:8025/messages >/dev/null 2>&1; then
  setsid nohup node "$REPO_ROOT/scripts/security/mail-sink.mjs" \
    >"$LAB_DIR/mail-sink.log" 2>&1 </dev/null &
  sleep 2
fi
echo "  Mail-Sink läuft (SMTP :1025, HTTP :8025)"

# --- Anwendung bauen und Daten anlegen ----------------------------
cd "$REPO_ROOT"
echo "Baue Anwendung …"
pnpm install --frozen-lockfile >"$LAB_DIR/install.log" 2>&1
pnpm --filter @serveflow/shared build >>"$LAB_DIR/install.log" 2>&1
pnpm --filter @serveflow/api exec prisma generate >>"$LAB_DIR/install.log" 2>&1
DATABASE_URL="$DB_URL" pnpm --filter @serveflow/api exec prisma migrate deploy >>"$LAB_DIR/install.log" 2>&1
DATABASE_URL="${DB_URL}_test" pnpm --filter @serveflow/api exec prisma migrate deploy >>"$LAB_DIR/install.log" 2>&1
DATABASE_URL="$DB_URL" pnpm --filter @serveflow/api exec prisma db seed >>"$LAB_DIR/install.log" 2>&1 || true
pnpm --filter @serveflow/api build >>"$LAB_DIR/install.log" 2>&1

# --- API-Instanzen ------------------------------------------------
start_api() {
  local port="$1" node_env="$2" logfile="$3"
  setsid nohup env \
    DATABASE_URL="$DB_URL" REDIS_URL=redis://127.0.0.1:6379 \
    NODE_ENV="$node_env" API_PORT="$port" APP_URL=http://localhost:5173 \
    SMTP_HOST=127.0.0.1 SMTP_PORT=1025 \
    node "$REPO_ROOT/apps/api/dist/main.js" >"$logfile" 2>&1 </dev/null &
  for _ in $(seq 1 30); do
    curl -sS -m 2 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "  FEHLER: API auf :$port ist nicht hochgekommen – siehe $logfile" >&2
  return 1
}

pkill -f 'apps/api/dist/main.js' 2>/dev/null || true
sleep 1
start_api 3000 development "$LAB_DIR/api-dev.log"
echo "  API :3000 (development, Mailversand aktiv)"
start_api 3002 test "$LAB_DIR/api-nothrottle.log"
echo "  API :3002 (test, ohne Rate Limiting)"

cat <<EOF

Labor bereit.

  Voller Testlauf (Token-Flows):        node scripts/security/pentest.mjs
  Bruteforce-Checks ohne Rate Limit:    BASE=http://127.0.0.1:3002 node scripts/security/pentest.mjs
  Abbauen:                              scripts/security/lab-down.sh

  Logs: $LAB_DIR
EOF
