#!/bin/sh
# Daily SQLite backup — keeps the last 14 days.
# Usage on the server (host with docker):
#   ./scripts/backup-db.sh                      # backs up the prod volume
# Or add to crontab (run: crontab -e):
#   0 3 * * * /path/to/livingdairiesweb/scripts/backup-db.sh >> /var/log/ld-backup.log 2>&1

set -e
BACKUP_DIR="${BACKUP_DIR:-$HOME/livingdairies-backups}"
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$BACKUP_DIR"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q livingdairies-app-prod; then
  # Running under Docker: use sqlite's online .backup for a consistent copy
  docker exec livingdairies-app-prod sh -c \
    "node -e \"require('better-sqlite3')('/app/data/livingdairies.db').backup('/app/data/backup-tmp.db').then(()=>process.exit(0))\""
  docker cp livingdairies-app-prod:/app/data/backup-tmp.db "$BACKUP_DIR/livingdairies-$STAMP.db"
  docker exec livingdairies-app-prod rm -f /app/data/backup-tmp.db
else
  # Running directly on the host (npm start): copy from the local data folder
  DB="$(dirname "$0")/../data/livingdairies.db"
  sqlite3 "$DB" ".backup '$BACKUP_DIR/livingdairies-$STAMP.db'" 2>/dev/null || cp "$DB" "$BACKUP_DIR/livingdairies-$STAMP.db"
fi

# Keep only the newest 14 backups
ls -1t "$BACKUP_DIR"/livingdairies-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "Backup done: $BACKUP_DIR/livingdairies-$STAMP.db"
