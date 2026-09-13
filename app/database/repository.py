"""Database queries used by the pipelines.

Keeping SQL in one place means the collectors, the doc generator and the future
LLM reviewer never write queries themselves.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import Article, ArticleStatus, utcnow
from app.processing.deduplicator import title_fingerprint
from app.schemas import ArticleCandidate

logger = logging.getLogger(__name__)


@dataclass
class SaveResult:
    """Outcome of storing a batch of candidates."""

    saved: int = 0
    duplicate_url: int = 0
    duplicate_title: int = 0
    failed: int = 0

    @property
    def duplicates(self) -> int:
        return self.duplicate_url + self.duplicate_title


def save_candidates(session: Session, candidates: Iterable[ArticleCandidate]) -> SaveResult:
    """Store new candidates, skipping ones already seen.

    Level 1 dedup is the exact normalized URL; Level 2 is the title
    fingerprint.  A candidate that fails to store is logged and skipped so one
    bad row never aborts a collection run.
    """
    result = SaveResult()

    existing_urls = set(session.scalars(select(Article.url)).all())
    existing_fingerprints = {fp for fp in session.scalars(select(Article.title_fingerprint)).all() if fp}

    for candidate in candidates:
        try:
            if candidate.url in existing_urls:
                result.duplicate_url += 1
                continue

            fingerprint = title_fingerprint(candidate.title)
            if fingerprint and fingerprint in existing_fingerprints:
                result.duplicate_title += 1
                continue

            session.add(
                Article(
                    title=candidate.title,
                    url=candidate.url,
                    title_fingerprint=fingerprint,
                    source=candidate.source,
                    collector=candidate.collector,
                    author=candidate.author,
                    published_at=candidate.published_at,
                    discovered_at=candidate.discovered_at,
                    raw_description=candidate.snippet,
                    status=ArticleStatus.CANDIDATE.value,
                )
            )
            session.flush()

            existing_urls.add(candidate.url)
            if fingerprint:
                existing_fingerprints.add(fingerprint)
            result.saved += 1
        except Exception:  # noqa: BLE001 - one bad article never stops the run
            logger.exception("Could not store candidate %s", candidate.url)
            session.rollback()
            result.failed += 1

    return result


def get_articles_in_window(
    session: Session,
    *,
    start: datetime,
    end: datetime,
    approved_only: bool = False,
    exclude_selected: bool = True,
) -> list[Article]:
    """Articles discovered between ``start`` and ``end``.

    ``exclude_selected`` keeps a story that already appeared in one Weekly
    Wrap-Up from appearing in another.
    """
    statement = select(Article).where(Article.discovered_at >= start, Article.discovered_at <= end)

    if approved_only:
        statement = statement.where(Article.approved.is_(True))
    if exclude_selected:
        statement = statement.where(Article.status.notin_([ArticleStatus.SELECTED.value, ArticleStatus.POSTED.value]))

    articles = list(session.scalars(statement).all())

    # Highest scored first; unscored articles (no LLM review yet) fall back to
    # most recently published.
    oldest = datetime.min.replace(tzinfo=timezone.utc)
    articles.sort(
        key=lambda article: (
            article.overall_score if article.overall_score is not None else -1.0,
            article.published_at or article.discovered_at or oldest,
        ),
        reverse=True,
    )
    return articles


def mark_selected(session: Session, articles: Sequence[Article]) -> int:
    """Flag articles as used in a Weekly Wrap-Up."""
    stamp = utcnow()
    for article in articles:
        article.status = ArticleStatus.SELECTED.value
        article.selected_at = stamp
    return len(articles)


def default_week_window(reference: datetime | None = None, days: int = 7) -> tuple[datetime, datetime]:
    """The seven-day window ending now (inclusive)."""
    end = reference or datetime.now(timezone.utc)
    return end - timedelta(days=days), end


def count_by_status(session: Session) -> dict[str, int]:
    """Article counts per status, for the CLI summary."""
    counts: dict[str, int] = {}
    for status in session.scalars(select(Article.status)).all():
        counts[status] = counts.get(status, 0) + 1
    return counts
