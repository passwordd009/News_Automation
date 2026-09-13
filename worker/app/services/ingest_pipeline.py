"""Ingestion: collect → deduplicate → AI review → Supabase, as pending.

This replaces the Google-Docs pipeline. The worker's job ends when an article
lands in the review queue; every editorial decision after that is a human's.
"""

from __future__ import annotations

import logging
from typing import Iterable

from app.config import FeedConfig, Settings, get_settings
from app.database.supabase_store import IngestStats, SupabaseStore, article_row
from app.llm.article_reviewer import ArticleReviewer
from app.llm.client import LLMError, get_llm_client
from app.processing.deduplicator import title_fingerprint
from app.schemas import ArticleCandidate
from app.services.daily_pipeline import collect_articles

logger = logging.getLogger(__name__)


def deduplicate(
    candidates: list[ArticleCandidate],
    store: SupabaseStore,
    stats: IngestStats,
) -> list[ArticleCandidate]:
    """Drop candidates already stored, and near-duplicates within this batch.

    Level 1 is the normalized URL, Level 2 the title fingerprint. Both are
    checked against Supabase and against the rest of this run, so two outlets
    covering one story in the same batch do not both get through.
    """
    if not candidates:
        return []

    seen_urls = store.existing_urls([c.url for c in candidates])
    fingerprints = {c.url: title_fingerprint(c.title) for c in candidates}
    seen_fingerprints = store.existing_fingerprints(
        [fp for fp in fingerprints.values() if fp]
    )

    kept: list[ArticleCandidate] = []
    for candidate in candidates:
        if candidate.url in seen_urls:
            stats.duplicate_url += 1
            continue

        fingerprint = fingerprints[candidate.url]
        if fingerprint and fingerprint in seen_fingerprints:
            stats.duplicate_title += 1
            continue

        kept.append(candidate)
        seen_urls.add(candidate.url)
        if fingerprint:
            seen_fingerprints.add(fingerprint)

    return kept


def run_ingest(
    settings: Settings | None = None,
    *,
    store: SupabaseStore | None = None,
    reviewer: ArticleReviewer | None = None,
    feeds: Iterable[FeedConfig] | None = None,
    limit: int | None = None,
    dry_run: bool = False,
) -> IngestStats:
    """One full ingestion run."""
    settings = settings or get_settings()
    store = store or SupabaseStore(settings=settings)
    stats = IngestStats()

    # Fail before collecting if the model is down. Ingesting a whole run's worth
    # of unreviewed articles would bury the review queue in unscored noise.
    if reviewer is None:
        client = get_llm_client(settings)
        if not client.is_available():
            raise LLMError(
                f"The {client.name} model is not reachable at {settings.ollama_url}.\n"
                f"Start it with 'ollama serve' and 'ollama pull {settings.ollama_model}', "
                "or check with: python worker/scripts/review_articles.py --check"
            )
        reviewer = ArticleReviewer(client=client, settings=settings)

    period = store.ensure_active_period()
    logger.info(
        "Active week: %s to %s", period.get("start_date"), period.get("end_date")
    )

    candidates = collect_articles(settings, feeds)
    stats.fetched = len(candidates)
    if limit is not None:
        candidates = candidates[:limit]

    candidates = deduplicate(candidates, store, stats)
    logger.info("%d new article(s) after deduplication.", len(candidates))
    if not candidates:
        return stats

    rows = []
    for index, candidate in enumerate(candidates, start=1):
        logger.info("Reviewing %d/%d: %s", index, len(candidates), candidate.title[:70])
        outcome = reviewer.review(candidate)

        if outcome.ok:
            stats.reviewed += 1
            if outcome.ai_recommended:
                stats.recommended += 1
        else:
            # Keep it anyway — a human can judge what the model could not.
            stats.review_failed += 1

        rows.append(article_row(candidate, outcome, period["id"]))

    if dry_run:
        logger.info("Dry run — %d row(s) built but not written.", len(rows))
        return stats

    stats.inserted = store.insert_articles(rows)
    logger.info("Inserted %d article(s) as pending.", stats.inserted)
    return stats
