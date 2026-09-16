"""Supabase store and ingest pipeline. No network — the client is faked."""

from datetime import date, datetime, timezone

import pytest

from app.config import Settings
from app.database.supabase_store import (
    SupabaseError,
    SupabaseStore,
    article_row,
    monday_week_for,
)
from app.llm.article_reviewer import ArticleReviewer, ReviewOutcome
from app.llm.client import LLMClient
from app.schemas import ArticleCandidate, ArticleReview
from app.services.ingest_pipeline import deduplicate, run_ingest
from app.database.supabase_store import IngestStats

PERIOD_ID = "b0000000-0000-0000-0000-000000000001"


# --------------------------------------------------------------------------- #
# a minimal stand-in for supabase-py's fluent query builder
# --------------------------------------------------------------------------- #

class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeTable:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self._filters = []
        self._in = None

    def select(self, *_):
        return self

    def eq(self, column, value):
        self._filters.append((column, value))
        return self

    def in_(self, column, values):
        self._in = (column, list(values))
        return self

    def limit(self, _n):
        return self

    def insert(self, payload):
        rows = payload if isinstance(payload, list) else [payload]
        for row in rows:
            row.setdefault("id", f"{self.name}-{len(self.db.rows[self.name])}")
            self.db.rows[self.name].append(row)
        self.db.inserted.extend(rows)
        return _Executable(rows)

    def upsert(self, rows, on_conflict=None, ignore_duplicates=False):
        existing = {r.get(on_conflict) for r in self.db.rows[self.name]} if on_conflict else set()
        written = []
        for row in rows:
            key = row.get(on_conflict) if on_conflict else None
            if ignore_duplicates and key in existing:
                continue
            self.db.rows[self.name].append(row)
            written.append(row)
            existing.add(key)
        self.db.inserted.extend(written)
        return _Executable(written)

    def execute(self):
        rows = self.db.rows[self.name]
        for column, value in self._filters:
            rows = [r for r in rows if r.get(column) == value]
        if self._in:
            column, values = self._in
            rows = [r for r in rows if r.get(column) in values]
        return FakeResponse(rows)


class _Executable:
    def __init__(self, rows):
        self.rows = rows

    def execute(self):
        return FakeResponse(self.rows)


class FakeSupabase:
    def __init__(self, articles=None, periods=None):
        self.rows = {"articles": list(articles or []), "weekly_periods": list(periods or [])}
        self.inserted = []

    def table(self, name):
        return FakeTable(self, name)


ACTIVE_PERIOD = {
    "id": PERIOD_ID,
    "start_date": "2026-09-07",
    "end_date": "2026-09-13",
    "status": "active",
}

VALID_REVIEW = ArticleReview(
    nyc_relevance=9, informative=9, community_value=8, positive=6,
    local_event=2, credibility=9, appropriate=True,
    topic="Affordable Housing", borough="Bronx",
    summary="A housing lottery opened for 240 units.",
    why_post="Readers can apply and see which income bands qualify.",
)


def _candidate(title="A story", url="https://example.com/a") -> ArticleCandidate:
    return ArticleCandidate(title=title, url=url, source="City Limits", collector="rss")


# --------------------------------------------------------------------------- #
# the editorial week
# --------------------------------------------------------------------------- #

def test_week_runs_monday_to_sunday():
    """Hestia posts Monday covering the week just ended."""
    start, end = monday_week_for(date(2026, 9, 10))  # a Thursday
    assert (start, end) == (date(2026, 9, 7), date(2026, 9, 13))
    assert start.strftime("%A") == "Monday"
    assert end.strftime("%A") == "Sunday"


def test_week_is_stable_on_its_own_boundaries():
    assert monday_week_for(date(2026, 9, 7))[0] == date(2026, 9, 7)   # Monday
    assert monday_week_for(date(2026, 9, 13))[0] == date(2026, 9, 7)  # Sunday


# --------------------------------------------------------------------------- #
# row mapping
# --------------------------------------------------------------------------- #

def test_reviewed_article_maps_onto_the_schema():
    outcome = ReviewOutcome(candidate=_candidate(), review=VALID_REVIEW, ai_recommended=True)
    row = article_row(outcome.candidate, outcome, PERIOD_ID)

    assert row["status"] == "pending"
    assert row["ai_recommended"] is True
    assert row["description"] == VALID_REVIEW.summary
    assert row["why_post"] == VALID_REVIEW.why_post
    assert row["nyc_relevance_score"] == 9
    assert row["positivity_score"] == 6
    assert row["overall_score"] == pytest.approx(8.25)
    assert row["source_type"] == "rss"
    assert row["title_fingerprint"]


def test_ai_recommendation_never_becomes_approval():
    """The strongest possible AI verdict still arrives as pending."""
    outcome = ReviewOutcome(candidate=_candidate(), review=VALID_REVIEW, ai_recommended=True)
    row = article_row(outcome.candidate, outcome, PERIOD_ID)

    assert row["status"] == "pending"
    assert "approved_by" not in row
    assert "approved_at" not in row


def test_failed_review_still_produces_a_reviewable_row():
    outcome = ReviewOutcome(candidate=_candidate(), error="invalid model output: boom")
    row = article_row(outcome.candidate, outcome, PERIOD_ID)

    assert row["status"] == "pending"
    assert row["ai_recommended"] is False
    assert "AI review failed" in row["ai_rejection_reason"]
    # No scores are invented for an article the model could not read.
    assert "overall_score" not in row
    assert "description" not in row


def test_unknown_collector_falls_back_to_a_valid_source_type():
    """source_type has a check constraint; an unmapped collector must not break it."""
    candidate = ArticleCandidate(
        title="t", url="https://example.com/x", source="s", collector="carrier_pigeon"
    )
    assert article_row(candidate, None, PERIOD_ID)["source_type"] == "manual"


# --------------------------------------------------------------------------- #
# store
# --------------------------------------------------------------------------- #

def test_store_refuses_to_write_anything_but_pending():
    store = SupabaseStore(client=FakeSupabase(), settings=Settings())

    with pytest.raises(SupabaseError, match="never approves"):
        store.insert_articles([{"normalized_url": "https://example.com/a", "status": "approved"}])


def test_existing_urls_are_looked_up_in_batches():
    articles = [{"normalized_url": f"https://example.com/{n}"} for n in range(250)]
    store = SupabaseStore(client=FakeSupabase(articles=articles), settings=Settings())

    wanted = [f"https://example.com/{n}" for n in range(300)]
    found = store.existing_urls(wanted)

    assert len(found) == 250  # survives chunking past the 100-item batch size


def test_active_period_is_created_when_missing():
    store = SupabaseStore(client=FakeSupabase(), settings=Settings())
    period = store.ensure_active_period()

    start, end = monday_week_for()
    assert period["start_date"] == start.isoformat()
    assert period["end_date"] == end.isoformat()
    assert period["status"] == "active"


def test_existing_active_period_is_reused():
    store = SupabaseStore(client=FakeSupabase(periods=[ACTIVE_PERIOD]), settings=Settings())
    assert store.ensure_active_period()["id"] == PERIOD_ID


def test_upsert_ignores_articles_that_are_already_stored():
    existing = [{"normalized_url": "https://example.com/a", "status": "pending"}]
    store = SupabaseStore(client=FakeSupabase(articles=existing), settings=Settings())

    written = store.insert_articles(
        [
            {"normalized_url": "https://example.com/a", "status": "pending"},
            {"normalized_url": "https://example.com/b", "status": "pending"},
        ]
    )
    assert written == 1


# --------------------------------------------------------------------------- #
# deduplication
# --------------------------------------------------------------------------- #

def test_deduplicate_skips_urls_already_in_supabase():
    stored = [{"normalized_url": "https://example.com/a", "title_fingerprint": None}]
    store = SupabaseStore(client=FakeSupabase(articles=stored), settings=Settings())
    stats = IngestStats()

    kept = deduplicate([_candidate(url="https://example.com/a"), _candidate(url="https://example.com/b")], store, stats)

    assert [c.url for c in kept] == ["https://example.com/b"]
    assert stats.duplicate_url == 1


def test_deduplicate_collapses_near_identical_titles_within_one_batch():
    store = SupabaseStore(client=FakeSupabase(), settings=Settings())
    stats = IngestStats()

    kept = deduplicate(
        [
            _candidate("City opens new library in the Bronx", "https://example.com/a"),
            _candidate("City opens new library in the Bronx", "https://example.com/b"),
            _candidate("Ferry service expands to Coney Island", "https://example.com/c"),
        ],
        store,
        stats,
    )

    assert len(kept) == 2
    assert stats.duplicate_title == 1


# --------------------------------------------------------------------------- #
# pipeline
# --------------------------------------------------------------------------- #

class _StubReviewer(ArticleReviewer):
    """Reviews without touching a model."""

    def __init__(self, recommended=True, fail=False):
        self.recommended, self.fail = recommended, fail
        self.settings = Settings()

    def review(self, candidate, article_text=None):
        if self.fail:
            return ReviewOutcome(candidate=candidate, error="model said no")
        return ReviewOutcome(candidate=candidate, review=VALID_REVIEW, ai_recommended=self.recommended)


def _feeds(monkeypatch, candidates):
    monkeypatch.setattr(
        "app.services.ingest_pipeline.collect_articles",
        lambda settings, feeds=None: list(candidates),
    )


def test_ingest_files_everything_as_pending(monkeypatch):
    _feeds(monkeypatch, [_candidate("Story one", "https://example.com/1"),
                         _candidate("Ferry expands", "https://example.com/2")])
    fake = FakeSupabase(periods=[ACTIVE_PERIOD])
    store = SupabaseStore(client=fake, settings=Settings())

    stats = run_ingest(Settings(), store=store, reviewer=_StubReviewer())

    assert stats.inserted == 2
    assert stats.recommended == 2
    assert all(row["status"] == "pending" for row in fake.inserted)
    assert all(row["weekly_period_id"] == PERIOD_ID for row in fake.inserted)


def test_dry_run_writes_nothing(monkeypatch):
    _feeds(monkeypatch, [_candidate()])
    fake = FakeSupabase(periods=[ACTIVE_PERIOD])
    store = SupabaseStore(client=fake, settings=Settings())

    stats = run_ingest(Settings(), store=store, reviewer=_StubReviewer(), dry_run=True)

    assert stats.reviewed == 1
    assert stats.inserted == 0
    assert fake.inserted == []


def test_articles_the_model_could_not_review_are_kept_not_dropped(monkeypatch):
    """Losing a story silently is worse than queueing it unscored."""
    _feeds(monkeypatch, [_candidate()])
    fake = FakeSupabase(periods=[ACTIVE_PERIOD])
    store = SupabaseStore(client=fake, settings=Settings())

    stats = run_ingest(Settings(), store=store, reviewer=_StubReviewer(fail=True))

    assert stats.review_failed == 1
    assert stats.inserted == 1
    assert "AI review failed" in fake.inserted[0]["ai_rejection_reason"]


def test_ingest_opens_a_week_when_none_is_active(monkeypatch):
    _feeds(monkeypatch, [_candidate()])
    fake = FakeSupabase()
    store = SupabaseStore(client=fake, settings=Settings())

    run_ingest(Settings(), store=store, reviewer=_StubReviewer())

    assert len(fake.rows["weekly_periods"]) == 1
    assert fake.rows["weekly_periods"][0]["status"] == "active"


def test_second_run_over_the_same_feed_inserts_nothing_new(monkeypatch):
    candidates = [_candidate("Story one", "https://example.com/1")]
    _feeds(monkeypatch, candidates)
    fake = FakeSupabase(periods=[ACTIVE_PERIOD])
    store = SupabaseStore(client=fake, settings=Settings())

    first = run_ingest(Settings(), store=store, reviewer=_StubReviewer())
    second = run_ingest(Settings(), store=store, reviewer=_StubReviewer())

    assert first.inserted == 1
    assert second.inserted == 0
    assert second.duplicate_url == 1


class DeadClient(LLMClient):
    """A model that cannot be reached."""

    name = "ollama"

    def generate(self, prompt, *, system=None):
        raise AssertionError("should never be called")

    def is_available(self):
        return False


def _dead_model(monkeypatch):
    monkeypatch.setattr(
        "app.services.ingest_pipeline.get_llm_client", lambda settings: DeadClient()
    )


def test_require_stops_rather_than_filing_a_day_unscored(monkeypatch):
    """What the scheduled job uses: a silent unscored day would bury the queue."""
    _feeds(monkeypatch, [_candidate()])
    _dead_model(monkeypatch)
    fake = FakeSupabase(periods=[ACTIVE_PERIOD])
    store = SupabaseStore(client=fake, settings=Settings())

    from app.llm.client import LLMError

    with pytest.raises(LLMError, match="not reachable"):
        run_ingest(Settings(), store=store, review="require")

    assert fake.inserted == []


def test_a_missing_model_still_collects_by_default(monkeypatch):
    """The button has to produce articles even with no model running."""
    _feeds(monkeypatch, [_candidate("A story", "https://example.com/1")])
    _dead_model(monkeypatch)
    fake = FakeSupabase(periods=[ACTIVE_PERIOD])
    store = SupabaseStore(client=fake, settings=Settings())

    stats = run_ingest(Settings(), store=store)  # review="auto"

    assert stats.inserted == 1
    assert stats.reviewed == 0
    row = fake.inserted[0]
    assert row["status"] == "pending"
    # Nothing is invented for an article the model never saw.
    assert "overall_score" not in row
    assert row["ai_recommended"] is False


def test_review_never_does_not_touch_the_model(monkeypatch):
    _feeds(monkeypatch, [_candidate()])

    def explode(settings):
        raise AssertionError("the model must not be consulted")

    monkeypatch.setattr("app.services.ingest_pipeline.get_llm_client", explode)
    fake = FakeSupabase(periods=[ACTIVE_PERIOD])
    store = SupabaseStore(client=fake, settings=Settings())

    stats = run_ingest(Settings(), store=store, review="never")

    assert stats.inserted == 1
    assert fake.inserted[0]["status"] == "pending"


def test_an_unknown_review_mode_is_rejected():
    store = SupabaseStore(client=FakeSupabase(periods=[ACTIVE_PERIOD]), settings=Settings())
    with pytest.raises(ValueError, match="auto, require or never"):
        run_ingest(Settings(), store=store, review="maybe")


def test_missing_credentials_give_an_actionable_error():
    store = SupabaseStore(settings=Settings(supabase_url="", supabase_service_role_key=""))

    with pytest.raises(SupabaseError, match="SUPABASE_URL"):
        store.active_period()


# --------------------------------------------------------------------------- #
# collecting one day at a time
# --------------------------------------------------------------------------- #

def _at(iso: str) -> ArticleCandidate:
    """A candidate published at a given instant."""
    return ArticleCandidate(
        title=f"Story {iso}",
        url=f"https://example.com/{iso}",
        source="Example",
        collector="rss",
        published_at=datetime.fromisoformat(iso),
    )


def test_day_bounds_follow_the_newsroom_clock():
    from datetime import date as date_type
    from app.services.ingest_pipeline import day_bounds

    start, end = day_bounds(date_type(2026, 9, 14), "America/New_York")

    # September is EDT, so a New York day starts at 04:00 UTC.
    assert start.isoformat() == "2026-09-14T00:00:00-04:00"
    assert (end - start).days == 1


def test_only_that_day_is_kept(monkeypatch):
    from datetime import date as date_type

    _feeds(monkeypatch, [
        _at("2026-09-13T20:00:00+00:00"),  # Sunday evening ET
        _at("2026-09-14T13:00:00+00:00"),  # Monday morning ET
        _at("2026-09-14T22:00:00+00:00"),  # Monday evening ET
        _at("2026-09-15T13:00:00+00:00"),  # Tuesday ET
    ])
    fake = FakeSupabase(periods=[ACTIVE_PERIOD])
    store = SupabaseStore(client=fake, settings=Settings())

    stats = run_ingest(
        Settings(), store=store, reviewer=None, review="never",
        for_date=date_type(2026, 9, 14),
    )

    assert stats.fetched == 4
    assert stats.inserted == 2


def test_a_day_boundary_is_local_not_utc(monkeypatch):
    """03:00 UTC on Tuesday is still Monday evening in New York."""
    from datetime import date as date_type

    _feeds(monkeypatch, [_at("2026-09-15T03:00:00+00:00")])
    fake = FakeSupabase(periods=[ACTIVE_PERIOD])
    store = SupabaseStore(client=fake, settings=Settings())

    stats = run_ingest(
        Settings(), store=store, review="never", for_date=date_type(2026, 9, 14)
    )

    assert stats.inserted == 1


def test_undated_articles_fall_back_to_when_they_were_found(monkeypatch):
    """Matches the database's effective_date: published_at, else fetched_at."""
    from datetime import date as date_type

    undated = ArticleCandidate(
        title="No date given", url="https://example.com/undated", source="Example",
        discovered_at=datetime(2026, 9, 14, 15, 0, tzinfo=timezone.utc),
    )
    _feeds(monkeypatch, [undated])
    fake = FakeSupabase(periods=[ACTIVE_PERIOD])
    store = SupabaseStore(client=fake, settings=Settings())

    stats = run_ingest(
        Settings(), store=store, review="never", for_date=date_type(2026, 9, 14)
    )

    assert stats.inserted == 1
