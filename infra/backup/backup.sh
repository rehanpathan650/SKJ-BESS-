#!/bin/sh
# Encrypted backup of the database and the (already encrypted) file store.
# Schedule daily via cron on the host, e.g.:  15 2 * * *  /opt/skj/infra/backup/backup.sh
#
# Requires: BACKUP_PASSPHRASE_FILE (a root-only file holding the backup passphrase), docker compose.
# Copy the output directory to off-site storage (different account/region). Keep 30 daily copies.
set -eu
cd "$(dirname "$0")/../.."
OUT="${BACKUP_DIR:-/var/backups/skj}"
PASS="${BACKUP_PASSPHRASE_FILE:-/etc/skj/backup.pass}"
KEEP_DAYS="${KEEP_DAYS:-30}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$OUT"

[ -r "$PASS" ] || { echo "passphrase file $PASS not readable" >&2; exit 1; }

# 1. Database (custom format), read via the read-only backup role, encrypted with AES-256.
docker compose exec -T -e PGPASSWORD="$(cat /etc/skj/db_backup.pass 2>/dev/null || echo "${DB_BACKUP_PASSWORD:-}")" db \
  pg_dump -h 127.0.0.1 -U skj_backup -d skj -Fc --no-owner \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASS" -out "$OUT/db-$TS.dump.enc"

# 2. File store (files are already Fernet-encrypted at rest; encrypted again for transport).
docker compose run --rm -T --no-deps --entrypoint tar api -C /data/storage -cf - files \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASS" -out "$OUT/files-$TS.tar.enc"

# 3. Checksums for integrity verification
( cd "$OUT" && sha256sum "db-$TS.dump.enc" "files-$TS.tar.enc" > "SHA256SUMS-$TS" )

# 4. Retention
find "$OUT" -type f -mtime "+$KEEP_DAYS" -delete

echo "Backup $TS written to $OUT"
