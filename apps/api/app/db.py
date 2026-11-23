from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    settings = get_settings()
    url = settings.database_url
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        # Development/test only. Wait for locks instead of failing (API + worker share the file).
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    else:
        # PostgreSQL: bounded connection pool per process (sized via env for horizontal scaling).
        kwargs.update(pool_size=settings.db_pool_size, max_overflow=settings.db_max_overflow,
                      pool_recycle=1800, pool_timeout=10)
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")  # enforce foreign keys in SQLite (dev/test)
            if ":memory:" not in url and url != "sqlite://":
                cur.execute("PRAGMA journal_mode=WAL")  # readers don't block the writer
                cur.execute("PRAGMA synchronous=NORMAL")
            cur.close()

    return engine


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
