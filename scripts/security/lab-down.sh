#!/usr/bin/env bash
# Security-Testlabor abbauen (siehe lab-up.sh).
#
# Die Datenbank bleibt absichtlich erhalten: Ein erneutes lab-up.sh ist so
# deutlich schneller, und die Testdaten sind für die Nachvollziehbarkeit
# eines Befundes oft noch nützlich. Mit --purge wird auch sie entfernt.
set -uo pipefail

PGDIR="${PGDIR:-/var/lib/postgresql/serveflow-lab}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"

echo "Stoppe API-Instanzen …"
pkill -f 'apps/api/dist/main.js' 2>/dev/null || true

echo "Stoppe Mail-Sink …"
pkill -f 'scripts/security/mail-sink.mjs' 2>/dev/null || true

echo "Stoppe Redis …"
redis-cli shutdown nosave >/dev/null 2>&1 || true

echo "Stoppe PostgreSQL …"
sudo -u postgres "$PGBIN/pg_ctl" -D "$PGDIR" stop -m fast >/dev/null 2>&1 || true

if [ "${1:-}" = "--purge" ]; then
  echo "Entferne Datenverzeichnis $PGDIR …"
  rm -rf "$PGDIR"
fi

echo "Labor abgebaut."
