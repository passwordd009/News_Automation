"""Supabase persistence for the ingestion worker.

The worker connects with the service-role key, which bypasses RLS — so the
rules the database enforces for human users do not protect us here. The
invariant that matters is enforced in code instead: **every row this module
writes has status 'pending'**. The AI recommends; only a human approves.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

from app.config import Settings, get_settings
from app.llm.article_reviewer import ReviewOutcome
from app.processing.deduplicator import title_fingerprint
from app.schemas import ArticleCandidate

logger = logging.getLogger(__name__)

# PostgREST puts filters in the query string, so a huge `in` list can exceed the
# URL limit. Look duplicates up in batches.
_LOOKUP_BATCH = 100

_COLLECTOR_TO_SOURCE_TYPE = {
    "rss": "rss",
    "gmail": "gmail",
    "news_api": "news_api",
}


class SupabaseError(RuntimeError):
    """Supabase could not be reached, or rejected the request."""


@dataclass
class IngestStats:
    """What one ingestion run did."""

    fetched: int = 0
    duplicate_url: int = 0
    duplicate_title: int = 0
    reviewed: int = 0
    review_failed: int = 0
    recommended: int = 0
    inserted: int = 0

    @property
    def duplicates(self) -> int:
        return self.duplicate_url + self.duplicate_title

    def format_summary(self) -> str:
        return (
            f"Fetched: {self.fetched}   Duplicates: {self.duplicates}   "
            f"Reviewed: {self.reviewed}   Recommended: {self.recommended}   "
            f"Inserted: {self.inserted}"
            + (f"   Review failures: {self.review_failed}" if self.review_failed else "")
        )


def build_client(settings: Settings | None = None):
    """Create a service-role Supabase client."""
    settings = settings or get_settings()

    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise SupabaseError(
            "SUPABASE_URL and SUPABASE_SECRET_KEY must be set in worker/.env.\n"
            "Find them under Project Settings -> API in the Supabase dashboard.\n"
            "(Older projects call it SUPABASE_SERVICE_ROLE_KEY; either name works.)\n"
            "This key bypasses RLS — keep it out of the frontend and out of git."
        )

    try:
        from supabase import create_client
    except ImportError as exc:  # pragma: no cover - depends on optional dep
        raise SupabaseError("The supabase package is missing. Run: pip install -r worker/requirements.txt") from exc

    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def monday_week_for(moment: date | None = None) -> tuple[date, date]:
    """The Monday–Sunday week containing ``moment``.

    Hestia posts on Monday covering the week just ended, so periods run Monday
    through Sunday.
    """
    today = moment or datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    return monday, monday + timedelta(days=6)


def article_row(
    candidate: ArticleCandidate,
    outcome: ReviewOutcome | None,
    weekly_period_id: str,
) -> dict[str, Any]:
    """Map a reviewed candidate onto an ``articles`` row.

    ``status`` is hardcoded to 'pending' and is never taken from the AI. An
    article the model loved and one it hated both arrive the same way: awaiting
    a human decision.
    """
    row: dict[str, Any] = {
        "weekly_period_id": weekly_period_id,
        "title": candidate.title,
        "url": candidate.url,
        "normalized_url": candidate.url,  # normalized during ArticleCandidate validation
        "title_fingerprint": title_fingerprint(candidate.title),
        "source": candidate.source,
        "source_type": _COLLECTOR_TO_SOURCE_TYPE.get(candidate.collector, "manual"),
        "published_at": candidate.published_at.isoformat() if candidate.published_at else None,
        "fetched_at": candidate.discovered_at.isoformat(),
        "raw_description": candidate.snippet,
        "status": "pending",
        "ai_recommended": False,
    }

    if outcome is None or not outcome.ok:
        # Keep the article rather than dropping it: a human can still judge a
        # story the model failed to process. The reason says what went wrong.
        if outcome is not None and outcome.error:
            row["ai_rejection_reason"] = f"AI review failed: {outcome.error}"[:500]
        return row

    review = outcome.review
    row.update(
        {
            "topic": review.topic,
            "borough": review.borough,
            "description": review.summary,
            "why_post": review.why_post,
            "nyc_relevance_score": review.nyc_relevance,
            "informative_score": review.informative,
            "community_value_score": review.community_value,
            "positivity_score": review.positive,
            "local_event_score": review.local_event,
            "credibility_score": review.credibility,
            "overall_score": review.overall_score,
            "ai_recommended": outcome.ai_recommended,
            "ai_rejection_reason": review.rejection_reason,
        }
    )
    return row


class SupabaseStore:
    """The handful of queries the worker needs."""

    def __init__(self, client: Any | None = None, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            self._client = build_client(self.settings)
        return self._client

    # ------------------------------------------------------------------ #
    # weekly periods
    # ------------------------------------------------------------------ #

    def active_period(self) -> dict[str, Any] | None:
        """The one period currently collecting articles."""
        try:
            response = (
                self.client.table("weekly_periods")
                .select("id, start_date, end_date, status")
                .eq("status", "active")
                .limit(1)
                .execute()
            )
        except Exception as exc:  # noqa: BLE001 - surface as our own error type
            raise SupabaseError(f"Could not read weekly_periods: {exc}") from exc

        rows = response.data or []
        return rows[0] if rows else None

    def ensure_active_period(self) -> dict[str, Any]:
        """Return the active period, opening this week's if none exists."""
        period = self.active_period()
        if period is not None:
            return period

        start, end = monday_week_for()
        logger.info("No active weekly period; opening %s to %s.", start, end)
        try:
            response = (
                self.client.table("weekly_periods")
                .insert(
                    {
                        "start_date": start.isoformat(),
                        "end_date": end.isoformat(),
                        "status": "active",
                    }
                )
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            raise SupabaseError(
                f"No active weekly period exists and one could not be created: {exc}"
            ) from exc

        rows = response.data or []
        if not rows:
            raise SupabaseError("Creating the weekly period returned no row.")
        return rows[0]

    def rotate_period(self, start: date, end: date) -> dict[str, Any]:
        """Close the active period and open ``start``-``end`` in one call.

        Delegates to the SQL function so closing, opening and carrying pending
        articles forward happen in a single transaction — doing it in steps
        from here would leave a window with no active period, or two.
        """
        try:
            response = self.client.rpc(
                "rotate_weekly_period",
                {"p_start": start.isoformat(), "p_end": end.isoformat()},
            ).execute()
        except Exception as exc:  # noqa: BLE001
            raise SupabaseError(f"Could not rotate the weekly period: {exc}") from exc

        data = response.data
        period = data[0] if isinstance(data, list) and data else data
        if not period:
            raise SupabaseError("Rotating the weekly period returned no row.")
        return period

    # ------------------------------------------------------------------ #
    # deduplication
    # ------------------------------------------------------------------ #

    def _existing_values(self, column: str, values: Sequence[str]) -> set[str]:
        """Which of ``values`` already appear in ``column``."""
        found: set[str] = set()
        wanted = [value for value in values if value]

        for start in range(0, len(wanted), _LOOKUP_BATCH):
            batch = wanted[start : start + _LOOKUP_BATCH]
            try:
                response = (
                    self.client.table("articles").select(column).in_(column, batch).execute()
                )
            except Exception as exc:  # noqa: BLE001
                raise SupabaseError(f"Could not check existing {column}: {exc}") from exc

            for row in response.data or []:
                value = row.get(column)
                if value:
                    found.add(value)

        return found

    def existing_urls(self, urls: Sequence[str]) -> set[str]:
        return self._existing_values("normalized_url", urls)

    def existing_fingerprints(self, fingerprints: Sequence[str]) -> set[str]:
        return self._existing_values("title_fingerprint", fingerprints)

    # ------------------------------------------------------------------ #
    # writes
    # ------------------------------------------------------------------ #

    def insert_articles(self, rows: Iterable[dict[str, Any]]) -> int:
        """Insert pending articles, ignoring any that raced in meanwhile.

        Guards the one invariant the service-role key lets us break: the worker
        may never write an article that is already approved.
        """
        batch = list(rows)
        if not batch:
            return 0

        offenders = [row for row in batch if row.get("status") != "pending"]
        if offenders:
            raise SupabaseError(
                f"Refusing to write {len(offenders)} article(s) with a status other than "
                "'pending'. The worker never approves — that is a human decision."
            )

        try:
            response = (
                self.client.table("articles")
                .upsert(batch, on_conflict="normalized_url", ignore_duplicates=True)
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            raise SupabaseError(f"Could not insert articles: {exc}") from exc

        return len(response.data or [])
