"""RSS/Atom collector — the first and simplest source.

Feeds come from configuration (``config/rss_feeds.json`` or the ``RSS_FEEDS``
environment variable), never from this module.
"""

from __future__ import annotations

import html
import logging
import time
from calendar import timegm
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import feedparser
import requests

from app.collectors.base import NewsCollector
from app.config import FeedConfig, Settings, get_settings
from app.processing.url_normalizer import domain_of
from app.schemas import ArticleCandidate

logger = logging.getLogger(__name__)


class RSSCollector(NewsCollector):
    """Fetch and normalize entries from the configured feeds."""

    name = "rss"

    def __init__(
        self,
        settings: Settings | None = None,
        feeds: Iterable[FeedConfig] | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._feeds = list(feeds) if feeds is not None else None

    @property
    def enabled(self) -> bool:
        return self.settings.enable_rss

    @property
    def feeds(self) -> list[FeedConfig]:
        if self._feeds is not None:
            return self._feeds
        return self.settings.enabled_rss_feeds

    def fetch_articles(self) -> list[ArticleCandidate]:
        feeds = self.feeds
        if not feeds:
            logger.warning("No RSS feeds configured — nothing to collect.")
            return []

        cutoff = datetime.now(timezone.utc) - timedelta(days=self.settings.lookback_days)
        collected: list[ArticleCandidate] = []

        for feed in feeds:
            collected.extend(self._fetch_feed(feed, cutoff))

        return collected

    # ------------------------------------------------------------------ #
    # internals
    # ------------------------------------------------------------------ #

    def _fetch_feed(self, feed: FeedConfig, cutoff: datetime) -> list[ArticleCandidate]:
        """Fetch one feed. Network and parse errors are logged, never raised."""
        try:
            response = requests.get(
                feed.url,
                timeout=self.settings.http_timeout,
                headers={"User-Agent": self.settings.http_user_agent},
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            logger.warning("Could not fetch feed %s (%s): %s", feed.name, feed.url, exc)
            return []

        parsed = feedparser.parse(response.content)
        if parsed.bozo and not parsed.entries:
            logger.warning("Feed %s could not be parsed: %s", feed.name, parsed.get("bozo_exception"))
            return []

        feed_title = (parsed.feed.get("title") or "").strip() if hasattr(parsed, "feed") else ""
        # A configured name wins; an ad-hoc feed (name == url) uses the feed's
        # own title so the report reads like a publication, not a URL.
        configured_name = feed.name if feed.name and feed.name != feed.url else ""
        source_name = configured_name or feed_title or domain_of(feed.url) or feed.url

        candidates: list[ArticleCandidate] = []
        skipped_old = 0

        for entry in parsed.entries[: self.settings.max_articles_per_feed]:
            candidate = self._to_candidate(entry, source_name)
            if candidate is None:
                continue
            if candidate.published_at is not None and candidate.published_at < cutoff:
                skipped_old += 1
                continue
            candidates.append(candidate)

        logger.info(
            "Feed %-28s -> %2d candidate(s)%s",
            source_name,
            len(candidates),
            f" ({skipped_old} older than {self.settings.lookback_days}d)" if skipped_old else "",
        )
        return candidates

    def _to_candidate(self, entry: Any, source_name: str) -> ArticleCandidate | None:
        """Turn one feed entry into a candidate, or ``None`` if unusable."""
        try:
            title = _clean_text(entry.get("title"))
            url = (entry.get("link") or "").strip()
            if not title or not url:
                logger.debug("Skipping entry without a title or link from %s", source_name)
                return None

            return ArticleCandidate(
                title=title,
                url=url,
                source=source_name,
                published_at=_entry_published_at(entry),
                snippet=_entry_snippet(entry),
                author=_clean_text(entry.get("author")) or None,
                collector=self.name,
            )
        except Exception as exc:  # noqa: BLE001 - one bad entry must not stop a feed
            logger.debug("Skipping malformed entry from %s: %s", source_name, exc)
            return None


def _clean_text(value: Any) -> str:
    """Unescape entities and collapse whitespace."""
    if not value or not isinstance(value, str):
        return ""
    return " ".join(html.unescape(value).split())


def _entry_snippet(entry: Any) -> str | None:
    """Best available short description, with HTML tags stripped."""
    raw = entry.get("summary") or ""
    if not raw:
        content = entry.get("content") or []
        if content and isinstance(content, list):
            raw = content[0].get("value", "")

    if not raw:
        return None

    from bs4 import BeautifulSoup  # imported lazily; only needed for HTML summaries

    text = BeautifulSoup(raw, "html.parser").get_text(" ")
    return _clean_text(text) or None


def _entry_published_at(entry: Any) -> datetime | None:
    """Publication time as an aware UTC datetime, when the feed provides one."""
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        parsed_time = entry.get(key)
        if isinstance(parsed_time, time.struct_time):
            try:
                return datetime.fromtimestamp(timegm(parsed_time), tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                continue
    return None
