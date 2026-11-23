#!/bin/sh
# Runs once when the database volume is first created.
# Least privilege: skj_owner owns the schema and runs migrations; skj_app (used by the API/worker)
# can only read/write rows; skj_backup can only read. The superuser is never used by the application.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE skj_owner LOGIN PASSWORD '${DB_OWNER_PASSWORD}';
  CREATE ROLE skj_app LOGIN PASSWORD '${DB_APP_PASSWORD}' CONNECTION LIMIT 60;
  CREATE ROLE skj_backup LOGIN PASSWORD '${DB_BACKUP_PASSWORD}' CONNECTION LIMIT 2;

  REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO skj_owner, skj_app, skj_backup;

  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  ALTER SCHEMA public OWNER TO skj_owner;
  GRANT USAGE ON SCHEMA public TO skj_app, skj_backup;

  -- Privileges on tables that skj_owner creates later through migrations
  ALTER DEFAULT PRIVILEGES FOR ROLE skj_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skj_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE skj_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO skj_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE skj_owner IN SCHEMA public
    GRANT SELECT ON TABLES TO skj_backup;
  ALTER DEFAULT PRIVILEGES FOR ROLE skj_owner IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO skj_backup;
EOSQL
