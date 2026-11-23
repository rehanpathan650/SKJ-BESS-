"""Alembic migrations. Uses MIGRATION_DATABASE_URL (the schema-owner role) when set, so the
application role never needs DDL rights; falls back to DATABASE_URL."""
import os

from alembic import context
from sqlalchemy import create_engine

from app import models  # noqa: F401  (register tables)
from app.config import get_settings
from app.db import Base

target_metadata = Base.metadata


def _url() -> str:
    return os.environ.get("MIGRATION_DATABASE_URL") or get_settings().database_url


def run_offline():
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_online():
    engine = create_engine(_url())
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_offline()
else:
    run_online()
