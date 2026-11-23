"""Make audit_log append-only in PostgreSQL.

A trigger blocks UPDATE and DELETE for every role (including the table owner), and the
application role loses UPDATE/DELETE/TRUNCATE privileges on the table.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("""
        CREATE OR REPLACE FUNCTION audit_log_block_changes() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'audit_log is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER audit_log_no_update_delete
        BEFORE UPDATE OR DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_block_changes();
    """)
    op.execute("CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log "
               "FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_changes();")
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skj_app') THEN
            REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM skj_app;
          END IF;
        END $$;
    """)


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log")
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_update_delete ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_block_changes()")
