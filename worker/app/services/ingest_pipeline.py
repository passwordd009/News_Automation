"""Ingestion: collect → deduplicate → AI review → Supabase, as pending.

This replaces the Google-Docs pipeline. The worker's job ends when an article
lands in the review queue; every editorial decision after that is a human's.
"""

from __future__ import annotations

import logging
from datetime import date as date_type, datetime, time, timedelta
from typing import Iterable
from zoneinfo import ZoneInfo

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


def day_bounds(day: date_type, timezone_name: str) -> tuple[datetime, datetime]:
    """Midnight to midnight for ``day``, in the newsroom's timezone.

    The dashboard groups articles into days of the editorial week, so the
    worker has to agree with it about where a day starts — 00:00 in New York,
    not in UTC.
    """
    zone = ZoneInfo(timezone_name)
    start = datetime.combine(day, time.min, tzinfo=zone)
    return start, start + timedelta(days=1)


def published_on(candidate: ArticleCandidate, day: date_type, timezone_name: str) -> bool:
    """Whether a candidate belongs to ``day``.

    Uses the publication time when the feed gave one, and the discovery time
    when it did not — the same rule as the database's effective_date column.
    """
    start, end = day_bounds(day, timezone_name)
    moment = candidate.published_at or candidate.discovered_at
    return start <= moment < end


def run_ingest(
    settings: Settings | None = None,
    *,
    store: SupabaseStore | None = None,
    reviewer: ArticleReviewer | None = None,
    feeds: Iterable[FeedConfig] | None = None,
    limit: int | None = None,
    dry_run: bool = False,
    review: str = "auto",
    for_date: date_type | None = None,
) -> IngestStats:
    """One full ingestion run.

    ``review`` decides what happens to the AI screening step:

    ``never``   collect and file without touching the model. Articles arrive
                with no scores, for a human to judge from the headline and the
                feed's own summary.
    ``require`` refuse to run if the model is unavailable. What the scheduled
                job uses: quietly filing a whole day unscored would bury the
                queue.
    ``auto``    review when the model is there, collect without it when it is
                not. The default, so a click still produces articles.

    ``for_date`` keeps only the articles that appeared on that day, for the
    per-day collection the review queue offers. Feeds only carry their recent
    entries, so a day already scrolled off the end of every feed yields
    nothing — that is a property of RSS, not a failure here.

    **Only screened articles are stored**, except under ``review='never'``
    where collecting unscored is the whole point. An article the model could
    not score cannot be ranked, cannot be recommended, and arrives in the queue
    as a bare headline — which is work for a human, not help. Dropping it is
    not a loss: the feeds still carry it, so the next run picks it up again
    once the model is answering.
    """
    settings = settings or get_settings()
    store = store or SupabaseStore(settings=settings)
    stats = IngestStats()

    if review not in {"auto", "require", "never"}:
        raise ValueError(f"review must be auto, require or never — got {review!r}")

    if reviewer is None and review != "never":
        client = get_llm_client(settings)
        if client.is_available():
            reviewer = ArticleReviewer(client=client, settings=settings)
        elif review == "require":
            raise LLMError(
                f"The {client.name} model is not reachable at {settings.ollama_url}.\n"
                f"Start it with 'ollama serve' and 'ollama pull {settings.ollama_model}', "
                "or check with: python worker/scripts/review_articles.py --check"
            )
        else:
            logger.warning(
                "The model is not reachable — collecting without AI screening. "
                "Articles will arrive unscored for manual review."
            )

    period = store.ensure_active_period()
    logger.info(
        "Active week: %s to %s", period.get("start_date"), period.get("end_date")
    )

    candidates = collect_articles(settings, feeds)
    stats.fetched = len(candidates)

    if for_date is not None:
        before = len(candidates)
        candidates = [c for c in candidates if published_on(c, for_date, settings.timezone)]
        logger.info(
            "%d of %d fetched article(s) appeared on %s.", len(candidates), before, for_date
        )

    if limit is not None:
        candidates = candidates[:limit]

    candidates = deduplicate(candidates, store, stats)
    logger.info("%d new article(s) after deduplication.", len(candidates))
    if not candidates:
        return stats

    # Under review='never' the caller asked for unscored articles explicitly,
    # so the screening requirement does not apply to them.
    store_unscored = review == "never"

    rows = []
    for index, candidate in enumerate(candidates, start=1):
        if reviewer is None:
            if store_unscored:
                rows.append(article_row(candidate, None, period["id"]))
            else:
                stats.skipped_unscored += 1
            continue

        logger.info("Reviewing %d/%d: %s", index, len(candidates), candidate.title[:70])
        outcome = reviewer.review(candidate)

        if outcome.ok:
            stats.reviewed += 1
            if outcome.ai_recommended:
                stats.recommended += 1
        else:
            stats.review_failed += 1
            if not store_unscored:
                # Unscorable, so unrankable. The feed still has it; the next
                # run will try again.
                logger.warning(
                    "Dropping %r — the model could not score it: %s",
                    candidate.title[:70],
                    outcome.error,
                )
                continue

        rows.append(article_row(candidate, outcome, period["id"]))

    if not rows:
        logger.info("Nothing to store: %d article(s) went unscored.", stats.skipped_unscored)
        return stats

    if dry_run:
        logger.info("Dry run — %d row(s) built but not written.", len(rows))
        return stats

    stats.inserted = store.insert_articles(rows)
    logger.info("Inserted %d article(s) as pending.", stats.inserted)
    return stats
