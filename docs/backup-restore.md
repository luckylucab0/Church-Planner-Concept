# Backup & Restore

ServeFlow-Daten liegen vollständig in PostgreSQL (plus hochgeladene Fotos im
`uploads`-Volume). Backups müssen **verschlüsselt** sein, da sie besonders
schützenswerte Personendaten enthalten.

## Backup (täglich per Cron auf dem Server)

Voraussetzung: [`age`](https://github.com/FiloSottile/age) installiert, Keypair erzeugt:

```bash
age-keygen -o /root/serveflow-backup.key   # Public Key notieren, Key-Datei sicher ablegen!
```

Backup-Skript (`/etc/cron.daily/serveflow-backup`):

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F)
BACKUP_DIR=/var/backups/serveflow
PUBKEY="age1..."   # Public Key aus age-keygen

mkdir -p "$BACKUP_DIR"

# 1. Datenbank-Dump aus dem Compose-Stack, direkt verschlüsselt (kein Klartext auf Platte)
docker compose -f /opt/serveflow/docker-compose.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | age -r "$PUBKEY" > "$BACKUP_DIR/db-$STAMP.sql.age"

# 2. Uploads (Fotos) verschlüsselt sichern
tar -C /opt/serveflow -cz uploads | age -r "$PUBKEY" > "$BACKUP_DIR/uploads-$STAMP.tgz.age"

# 3. Alte Backups nach 30 Tagen löschen
find "$BACKUP_DIR" -name '*.age' -mtime +30 -delete
```

**Wichtig:**

- Backups zusätzlich off-site kopieren (z. B. `restic` auf S3/Storage-Box – restic
  verschlüsselt selbst, dann kann `age` entfallen).
- `FIELD_ENCRYPTION_KEY` aus der `.env` **mitsichern** (z. B. im Passwortmanager):
  ohne ihn sind verschlüsselte Notizen im Restore unlesbar.
- Restore regelmäßig testen – ein ungetestetes Backup ist keins.

## Restore

```bash
# 1. Stack mit leerer DB starten
docker compose up -d db

# 2. Dump entschlüsseln und einspielen
age -d -i /root/serveflow-backup.key db-2026-07-05.sql.age \
  | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"

# 3. Uploads zurückspielen
age -d -i /root/serveflow-backup.key uploads-2026-07-05.tgz.age | tar -C /opt/serveflow -xz

# 4. Restliche Services starten
docker compose up -d
```
