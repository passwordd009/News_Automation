"""Engine and session management.

The rest of the application only ever asks for a session — swapping SQLite for
Postgres later means changing ``DATABASE_URL`` and nothing else.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.database.models import Base

logger = logging.getLogger(__name__)

_engine: Engine | None = None
_SessionFactory: sessionmaker[Session] | None = None


def _ensure_sqlite_dir(database_url: str) -> None:
    """Create the parent directory for a file-backed SQLite database."""
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        return
    raw_path = database_url[len(prefix) :]
    if not raw_path or raw_path == ":memory:":
        return
    parent = Path(raw_path).expanduser().resolve().parent
    parent.mkdir(parents=True, exist_ok=True)


def get_engine() -> Engine:
    """Process-wide engine, created on first use."""
    global _engine
    if _engine is None:
        url = get_settings().database_url
        _ensure_sqlite_dir(url)
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, future=True, connect_args=connect_args)
        logger.debug("Database engine created for %s", url)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _SessionFactory
    if _SessionFactory is None:
        _SessionFactory = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _SessionFactory


def init_db() -> None:
    """Create any missing tables. Safe to call on every run."""
    Base.metadata.create_all(get_engine())
    logger.debug("Database schema ready.")


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional session: commits on success, rolls back on failure."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def reset_engine() -> None:
    """Drop cached engine/session factory (used by tests)."""
    global _engine, _SessionFactory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionFactory = None
