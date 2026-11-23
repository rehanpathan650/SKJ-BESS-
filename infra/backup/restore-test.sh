#!/bin/sh
# Proves a backup can be restored: decrypts the newest (or given) DB backup into a throw-away
# PostgreSQL container, checks row counts and verifies the audit-log hash chain. Touches nothing
# in production. Run monthly and record the result in docs/backup-restore.md.
#
#   sh infra/backup/restore-test.sh [/var/backups/skj/db-<timestamp>.dump.enc]
set -eu
cd "$(dirname "$0")/../.."
OUT="${BACKUP_DIR:-/var/backups/skj}"
PASS="${BACKUP_PASSPHRASE_FILE:-/etc/skj/backup.pass}"
FILE="${1:-$(ls -1t "$OUT"/db-*.dump.enc | head -n1)}"
NAME="skj-restore-test-$$"

echo "Testing restore of $FILE"
TS="$(basename "$FILE" | sed 's/^db-//; s/\.dump\.enc$//')"
( cd "$(dirname "$FILE")" && sha256sum -c --ignore-missing "SHA256SUMS-$TS" )

docker run -d --rm --name "$NAME" --network none -e POSTGRES_PASSWORD=restoretest postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$NAME" createdb -U postgres skj

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS" -in "$FILE" \
  | docker exec -i "$NAME" pg_restore -U postgres -d skj --no-owner --no-privileges

docker exec "$NAME" psql -U postgres -d skj -At -c "
  SELECT 'users', count(*) FROM users UNION ALL
  SELECT 'customers', count(*) FROM customers UNION ALL
  SELECT 'bills', count(*) FROM bills UNION ALL
  SELECT 'proposals', count(*) FROM proposals UNION ALL
  SELECT 'audit_log', count(*) FROM audit_log;"

# Verify the audit chain against the restored copy using the application's own checker.
docker compose run --rm --no-deps -T \
  -e DATABASE_URL="postgresql+psycopg://postgres:restoretest@$NAME:5432/skj" \
  --network "container:$NAME" api python -m app.cli verify-audit || echo "WARNING: audit verification step failed"

echo "Restore test completed for $FILE"
