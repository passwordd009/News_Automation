"""Article collectors. Each one produces ``ArticleCandidate`` objects."""

from app.collectors.base import CollectorError, NewsCollector

__all__ = ["NewsCollector", "CollectorError"]
