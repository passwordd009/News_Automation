"""The common collector interface.

Every source — RSS today, Gmail newsletters and a news API later — implements
this same tiny surface, so the daily pipeline never needs to know where an
article came from.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod

from app.schemas import ArticleCandidate

logger = logging.getLogger(__name__)


class CollectorError(RuntimeError):
    """Raised when a collector cannot run at all (bad config, missing auth)."""


class NewsCollector(ABC):
    """Base class for all collectors.

    Implementations must be resilient: a single broken feed, malformed entry or
    network timeout should be logged and skipped, never raised, so one bad
    source cannot stop the daily run.
    """

    #: Short identifier stored on each candidate, e.g. ``"rss"``.
    name: str = "base"

    @abstractmethod
    def fetch_articles(self) -> list[ArticleCandidate]:
        """Return the candidates this source currently offers."""

    @property
    def enabled(self) -> bool:
        """Whether this collector should run. Overridden per collector."""
        return True

    def safe_fetch(self) -> list[ArticleCandidate]:
        """``fetch_articles`` with a guard rail around it.

        Used by the pipeline so an unexpected failure in one collector degrades
        the run instead of ending it.
        """
        if not self.enabled:
            logger.info("Collector %s is disabled, skipping.", self.name)
            return []
        try:
            articles = self.fetch_articles()
        except Exception:  # noqa: BLE001 - deliberate: never break the pipeline
            logger.exception("Collector %s failed; continuing without it.", self.name)
            return []
        logger.info("Collector %s returned %d article(s).", self.name, len(articles))
        return articles
