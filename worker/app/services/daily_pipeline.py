"""Daily pipeline: fetch from every enabled collector and store what is new.

Both ``collect_articles.py`` and ``generate_weekly_doc.py`` call this, so
collection behaves identically no matter which command triggers it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Sequence

from app.collectors.base import NewsCollector
from app.collectors.rss_collector import RSSCollector
from app.config import FeedConfig, Settings, get_settings
from app.database.database import init_db, session_scope
from app.database.repository import SaveResult, save_candidates
from app.schemas import ArticleCandidate

logger = logging.getLogger(__name__)


@dataclass
class CollectionStats:
    """What one collection run did, for the CLI summary."""

    fetched: int = 0
    saved: int = 0
    duplicates: int = 0
    failed: int = 0
    articles: list[ArticleCandidate] = field(default_factory=list)

    def format_summary(self) -> str:
        parts = [f"Fetched: {self.fetched}", f"Duplicates: {self.duplicates}", f"Saved: {self.saved}"]
        if self.failed:
            parts.append(f"Failed: {self.failed}")
        return "   ".join(parts)


def build_collectors(settings: Settings, feeds: Iterable[FeedConfig] | None = None) -> list[NewsCollector]:
    """Every collector the configuration has switched on.

    Gmail (Phase 7) and the news API (Phase 8) join this list when built;
    nothing else needs to change.
    """
    collectors: list[NewsCollector] = [RSSCollector(settings=settings, feeds=feeds)]
    return [collector for collector in collectors if collector.enabled]


def collect_articles(
    settings: Settings | None = None,
    feeds: Iterable[FeedConfig] | None = None,
) -> list[ArticleCandidate]:
    """Fetch from all enabled collectors. Never raises on a source failure."""
    settings = settings or get_settings()
    collectors = build_collectors(settings, feeds)

    if not collectors:
        logger.warning("No collectors are enabled — check ENABLE_RSS in your .env.")
        return []

    articles: list[ArticleCandidate] = []
    for collector in collectors:
        articles.extend(collector.safe_fetch())

    # Newest first; entries with no publication date sort last.
    oldest = datetime.min.replace(tzinfo=timezone.utc)
    articles.sort(key=lambda item: item.published_at or oldest, reverse=True)
    return articles


def run_collection(
    settings: Settings | None = None,
    feeds: Iterable[FeedConfig] | None = None,
    *,
    save: bool = True,
    limit: int | None = None,
) -> CollectionStats:
    """Collect and (by default) store, returning the run's statistics."""
    settings = settings or get_settings()
    articles = collect_articles(settings, feeds)

    if limit is not None:
        articles = articles[:limit]

    stats = CollectionStats(fetched=len(articles), articles=articles)
    if not save or not articles:
        return stats

    result = _store(articles)
    stats.saved = result.saved
    stats.duplicates = result.duplicates
    stats.failed = result.failed
    return stats


def _store(articles: Sequence[ArticleCandidate]) -> SaveResult:
    init_db()
    with session_scope() as session:
        return save_candidates(session, articles)
