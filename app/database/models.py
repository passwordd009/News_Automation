"""SQLAlchemy models.

Article history is kept permanently so a story never shows up in two different
Weekly Wrap-Ups.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ArticleStatus(str, Enum):
    """Lifecycle of an article through the weekly process."""

    CANDIDATE = "candidate"   # collected, not yet reviewed
    REVIEWED = "reviewed"     # LLM returned a verdict
    APPROVED = "approved"     # passed the scoring thresholds
    REJECTED = "rejected"     # failed the thresholds or was inappropriate
    SELECTED = "selected"     # chosen for a Weekly Wrap-Up doc
    POSTED = "posted"         # published by the Hestia team


class Article(Base):
    """One discovered article and everything we know about it."""

    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Identity / provenance
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False, unique=True, index=True)
    title_fingerprint: Mapped[str | None] = mapped_column(String(64), index=True)
    source: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    collector: Mapped[str | None] = mapped_column(String(50))
    author: Mapped[str | None] = mapped_column(String(200))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    # Content
    raw_description: Mapped[str | None] = mapped_column(Text)
    article_text: Mapped[str | None] = mapped_column(Text)

    # Classification
    topic: Mapped[str | None] = mapped_column(String(100), index=True)
    borough: Mapped[str | None] = mapped_column(String(50))

    # Scores (populated in Phase 3/4)
    relevance_score: Mapped[float | None] = mapped_column(Float)
    usefulness_score: Mapped[float | None] = mapped_column(Float)
    informative_score: Mapped[float | None] = mapped_column(Float)
    positivity_score: Mapped[float | None] = mapped_column(Float)
    local_event_score: Mapped[float | None] = mapped_column(Float)
    credibility_score: Mapped[float | None] = mapped_column(Float)
    overall_score: Mapped[float | None] = mapped_column(Float, index=True)

    # Review outcome
    status: Mapped[str] = mapped_column(String(20), default=ArticleStatus.CANDIDATE.value, nullable=False, index=True)
    approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    llm_summary: Mapped[str | None] = mapped_column(Text)
    why_post: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    selected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_articles_status_score", "status", "overall_score"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Article id={self.id} status={self.status!r} title={self.title[:40]!r}>"
