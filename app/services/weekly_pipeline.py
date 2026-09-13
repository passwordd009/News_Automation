"""Weekly pipeline: pick the week's best articles and build the document."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Sequence

from app.config import Settings, get_settings
from app.database.models import Article
from app.google.document_builder import WeeklyDocument, build_document
from app.processing.deduplicator import titles_are_similar

logger = logging.getLogger(__name__)


def select_articles(
    articles: Sequence[Article],
    *,
    max_articles: int,
    max_per_topic: int = 2,
    similarity_threshold: float = 0.7,
) -> list[Article]:
    """Choose the articles that go in the doc.

    Articles arrive already ranked.  Two passes keep the doc varied:
    first take the best story per topic, then backfill with the next best
    remaining, capping each topic so one subject cannot dominate. Stories with
    near-identical headlines are collapsed so the same event is not listed
    twice from two outlets.
    """
    if max_articles <= 0:
        return []

    selected: list[Article] = []
    chosen_ids: set[int] = set()
    topic_counts: dict[str, int] = {}

    def is_repeat_story(candidate: Article) -> bool:
        return any(titles_are_similar(candidate.title, chosen.title, similarity_threshold) for chosen in selected)

    def take(article: Article, topic: str | None) -> None:
        selected.append(article)
        chosen_ids.add(id(article))
        if topic:
            topic_counts[topic] = topic_counts.get(topic, 0) + 1

    # Pass 1 — one article per known topic, best first, for maximum spread.
    for article in articles:
        if len(selected) >= max_articles:
            break
        topic = _known_topic(article)
        if topic is None or topic in topic_counts or is_repeat_story(article):
            continue
        take(article, topic)

    # Pass 2 — backfill. The per-topic cap only applies to articles whose topic
    # is actually known: before the classifier exists everything is
    # "Uncategorized", and capping that would shrink the doc to two entries.
    for article in articles:
        if len(selected) >= max_articles:
            break
        if id(article) in chosen_ids or is_repeat_story(article):
            continue
        topic = _known_topic(article)
        if topic is not None and topic_counts.get(topic, 0) >= max_per_topic:
            continue
        take(article, topic)

    logger.info(
        "Selected %d of %d article(s) across %d known topic(s).",
        len(selected),
        len(articles),
        len(topic_counts),
    )
    return selected


def _known_topic(article: Article) -> str | None:
    """Normalized topic, or ``None`` when the article has not been classified."""
    topic = (article.topic or "").strip().lower()
    if topic in {"", "uncategorized"}:
        return None
    return topic


def build_weekly_document(
    articles: Sequence[Article],
    *,
    start: datetime,
    end: datetime,
    settings: Settings | None = None,
) -> tuple[WeeklyDocument, list[Article]]:
    """Select articles and render them into a document structure."""
    settings = settings or get_settings()
    chosen = select_articles(articles, max_articles=settings.weekly_max_articles)

    if len(chosen) < settings.weekly_min_articles:
        logger.warning(
            "Only %d article(s) available — fewer than the target of %d.",
            len(chosen),
            settings.weekly_min_articles,
        )

    return build_document(chosen, start=start, end=end), list(chosen)
