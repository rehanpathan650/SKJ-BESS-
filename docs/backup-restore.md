# Backup and disaster recovery

| What | How | Frequency | Retention |
|---|---|---|---|
| PostgreSQL | `pg_dump` via read-only `skj_backup` role, AES-256 encrypted (`openssl enc -pbkdf2`) | Daily 02:15 | 30 days on server + off-site copy |
| Uploaded/generated files | tar of the file volume (files are already Fernet-encrypted), AES-256 encrypted again | Daily | 30 days |
| Secrets (`.env`, `DATA_ENCRYPTION_KEY`, backup passphrase, DB CA key) | SKJ password manager / vault, 2 named custodians | On change | Permanent |

Targets: **RPO 24 h, RTO 4 h.** Lower RPO needs PostgreSQL WAL archiving (e.g. pgBackRest) — recommended once usage grows.

## Set up
```sh
sudo install -m 700 -d /etc/skj
sudo sh -c 'openssl rand -base64 48 > /etc/skj/backup.pass' && sudo chmod 600 /etc/skj/backup.pass
echo "<DB_BACKUP_PASSWORD from .env>" | sudo tee /etc/skj/db_backup.pass >/dev/null && sudo chmod 600 /etc/skj/db_backup.pass
sudo crontab -e
# 15 2 * * *  cd /opt/skj && sh infra/backup/backup.sh >> /var/log/skj-backup.log 2>&1
```
Copy `/var/backups/skj` off-site daily (separate cloud account or SKJ NAS), e.g. with `rclone` to write-once storage.

## Test restores (monthly — required)
```sh
sh infra/backup/restore-test.sh
```
Restores the newest backup into a throw-away PostgreSQL container with **no network**, prints row counts and
verifies the audit hash chain. Record each run below.

| Date | Backup tested | Result | By |
|---|---|---|---|
| _not yet run — needs the production/staging server_ | | | |

## Disaster recovery
1. New server per `deployment.md` steps 1–2 (restore `.env` from the vault).
2. `docker compose up -d db` then `sh infra/backup/restore.sh <db backup> <files backup>`.
3. `docker compose up -d`, run `python -m app.cli verify-audit`, log in and spot-check customers, bills, proposals.
4. Revoke all sessions (Security → Active sessions) and ask users to log in again.
