#!/bin/sh
# DISASTER RECOVERY ONLY. Restores a database backup over the running database.
# Stop api and worker first:  docker compose stop api worker
#   sh infra/backup/restore.sh /var/backups/skj/db-<ts>.dump.enc /var/backups/skj/files-<ts>.tar.enc
set -eu
cd "$(dirname "$0")/../.."
DB_FILE="$1"; FILES_FILE="${2:-}"
PASS="${BACKUP_PASSPHRASE_FILE:-/etc/skj/backup.pass}"
printf "This will REPLACE the production database with %s. Type RESTORE to continue: " "$DB_FILE"
read -r answer
[ "$answer" = "RESTORE" ] || { echo "aborted"; exit 1; }

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS" -in "$DB_FILE" \
  | docker compose exec -T db pg_restore -U postgres -d skj --clean --if-exists --no-owner --role=skj_owner

if [ -n "$FILES_FILE" ]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS" -in "$FILES_FILE" \
    | docker compose run --rm -T --no-deps --entrypoint tar api -C /data/storage -xf -
fi
echo "Restore finished. Start services: docker compose start api worker; then run python -m app.cli verify-audit"
