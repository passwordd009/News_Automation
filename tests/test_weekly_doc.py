"""Weekly document: selection, rendering and the Google Docs request payload."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import Settings
from app.database.models import Article, ArticleStatus, Base
from app.database.repository import (
    default_week_window,
    get_articles_in_window,
    mark_selected,
    save_candidates,
)
from app.google.document_builder import PLACEHOLDER_WHY_POST, build_document, render_text
from app.google.docs_writer import build_requests
from app.schemas import ArticleCandidate
from app.services.weekly_pipeline import build_weekly_document, select_articles

NOW = datetime.now(timezone.utc)
START, END = NOW - timedelta(days=7), NOW


@pytest.fixture
def session() -> Session:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    with Session(engine, future=True) as session:
        yield session


def _article(title: str, topic: str | None = None, score: float | None = None, **kwargs) -> Article:
    defaults = {
        "title": title,
        "url": f"https://example.com/{abs(hash(title))}",
        "source": "Example",
        "topic": topic,
        "overall_score": score,
        "discovered_at": NOW - timedelta(hours=1),
        "raw_description": f"Summary of {title}.",
    }
    defaults.update(kwargs)
    return Article(**defaults)


# --------------------------------------------------------------------------- #
# selection
# --------------------------------------------------------------------------- #

def test_selection_spreads_across_topics_before_doubling_up():
    articles = [
        _article("Housing story one", "Affordable Housing", 9.0),
        _article("Housing story two", "Affordable Housing", 8.9),
        _article("Housing story three", "Affordable Housing", 8.8),
        _article("School budget news", "Education", 7.0),
        _article("Ferry schedule change", "Transportation", 6.5),
    ]

    chosen = select_articles(articles, max_articles=3)

    assert [a.topic for a in chosen] == ["Affordable Housing", "Education", "Transportation"]


def test_per_topic_cap_is_respected_when_backfilling():
    articles = [
        _article("Housing one", "Affordable Housing", 9.0),
        _article("Housing two", "Affordable Housing", 8.0),
        _article("Housing three", "Affordable Housing", 7.0),
        _article("Jobs fair downtown", "Jobs", 6.0),
    ]

    chosen = select_articles(articles, max_articles=4, max_per_topic=2)

    topics = [a.topic for a in chosen]
    assert topics.count("Affordable Housing") == 2
    assert "Jobs" in topics


def test_same_story_from_two_outlets_is_only_listed_once():
    articles = [
        _article("City opens new library in the Bronx", "Community", 9.0),
        _article("New Bronx library opens city says", "Education", 8.5),
        _article("Ferry service expands to Coney Island", "Transportation", 8.0),
    ]

    chosen = select_articles(articles, max_articles=3)

    titles = [a.title for a in chosen]
    assert "City opens new library in the Bronx" in titles
    assert "New Bronx library opens city says" not in titles
    assert len(chosen) == 2


def test_unclassified_articles_are_not_capped_like_a_real_topic():
    """Before the LLM classifier runs every article is 'Uncategorized'.

    Treating that as a topic would apply the per-topic cap and shrink the whole
    document to two entries, regardless of how many articles were collected.
    """
    articles = [_article(f"Story number {n}", topic=None, score=None) for n in range(6)]

    chosen = select_articles(articles, max_articles=6, max_per_topic=2)

    assert len(chosen) == 6


def test_selection_handles_empty_and_zero_max():
    assert select_articles([], max_articles=5) == []
    assert select_articles([_article("Anything")], max_articles=0) == []


# --------------------------------------------------------------------------- #
# rendering
# --------------------------------------------------------------------------- #

def test_rendered_document_matches_the_wrap_up_layout():
    articles = [
        _article(
            "City launches grant program",
            "Small Business",
            9.0,
            url="https://example.com/grants",
            llm_summary="NYC announced $5 million in grants.",
            why_post="It tells owners about a funding opportunity.",
        )
    ]
    rendered = render_text(build_document(articles, start=START, end=END))

    assert rendered.startswith("WEEKLY WRAP-UP")
    assert f"DATE: {build_document(articles, start=START, end=END).date_range}" in rendered
    assert "Topic: Small Business" in rendered
    assert "URL:\nhttps://example.com/grants" in rendered
    assert "Description:\nNYC announced $5 million in grants." in rendered
    assert "Why post:\nIt tells owners about a funding opportunity." in rendered
    assert "-" * 44 in rendered


def test_date_range_is_human_readable():
    document = build_document(
        [],
        start=datetime(2026, 9, 7, tzinfo=timezone.utc),
        end=datetime(2026, 9, 13, tzinfo=timezone.utc),
    )
    assert document.date_range == "September 7, 2026 - September 13, 2026"
    assert document.title == "Weekly Wrap-Up — 9/7/26 to 9/13/26"


def test_missing_llm_fields_fall_back_without_inventing_content():
    articles = [_article("Something happened", topic=None, raw_description="The feed's own summary.")]
    document = build_document(articles, start=START, end=END)
    entry = document.entries[0]

    assert entry.topic == "Uncategorized"
    assert entry.description == "The feed's own summary."
    assert entry.why_post == PLACEHOLDER_WHY_POST  # flagged for a human, never fabricated


def test_empty_week_renders_a_readable_document():
    rendered = render_text(build_document([], start=START, end=END))
    assert "No articles were collected for this period." in rendered


# --------------------------------------------------------------------------- #
# Google Docs payload
# --------------------------------------------------------------------------- #

def test_google_docs_requests_insert_text_and_style_labels():
    articles = [_article("Grant program", "Small Business", 9.0, url="https://example.com/g")]
    requests = build_requests(build_document(articles, start=START, end=END))

    insert = requests[0]["insertText"]
    assert insert["location"]["index"] == 1
    assert "Topic: Small Business" in insert["text"]
    assert "https://example.com/g" in insert["text"]

    assert requests[1]["updateParagraphStyle"]["paragraphStyle"]["namedStyleType"] == "HEADING_1"

    body = insert["text"]
    for request in requests[2:]:
        rng = request["updateTextStyle"]["range"]
        # Ranges are 1-based document indices into the inserted body.
        label = body[rng["startIndex"] - 1 : rng["endIndex"] - 1]
        assert label in {"DATE:", "Topic:", "URL:", "Description:", "Why post:"}
        assert request["updateTextStyle"]["textStyle"]["bold"] is True


# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #

def test_saving_candidates_skips_duplicate_urls_and_titles(session):
    candidates = [
        ArticleCandidate(title="City opens new library", url="https://example.com/a", source="A"),
        ArticleCandidate(title="City opens new library", url="https://example.com/a?utm_source=x", source="A"),
        ArticleCandidate(title="New library opens city", url="https://example.com/b", source="B"),
        ArticleCandidate(title="Ferry service expands", url="https://example.com/c", source="C"),
    ]

    result = save_candidates(session, candidates)
    session.commit()

    assert result.saved == 2          # library story + ferry story
    assert result.duplicate_url == 1  # same URL once tracking params are stripped
    assert result.duplicate_title == 1
    assert result.failed == 0


def test_already_selected_articles_do_not_return_in_a_later_window(session):
    session.add(_article("Fresh story", "Community", 8.0))
    used = _article("Already used story", "Education", 9.0)
    used.status = ArticleStatus.SELECTED.value
    session.add(used)
    session.commit()

    start, end = default_week_window()
    found = get_articles_in_window(session, start=start, end=end)

    assert [a.title for a in found] == ["Fresh story"]


def test_articles_rank_by_score_then_recency(session):
    session.add_all(
        [
            _article("Low score", "A", 5.0),
            _article("High score", "B", 9.0),
            _article("Unscored but recent", "C", None, discovered_at=NOW),
        ]
    )
    session.commit()

    start, end = default_week_window()
    found = get_articles_in_window(session, start=start, end=end)

    assert [a.title for a in found[:2]] == ["High score", "Low score"]
    assert found[-1].title == "Unscored but recent"  # unscored sorts last


def test_generating_the_doc_marks_articles_as_used(session):
    session.add_all([_article("Story one", "Education", 9.0), _article("Story two", "Health", 8.0)])
    session.commit()

    start, end = default_week_window()
    articles = get_articles_in_window(session, start=start, end=end)
    _, chosen = build_weekly_document(articles, start=start, end=end, settings=Settings())
    mark_selected(session, chosen)
    session.commit()

    assert get_articles_in_window(session, start=start, end=end) == []
    assert all(a.selected_at is not None for a in chosen)


def test_approved_only_filters_out_unreviewed_articles(session):
    approved = _article("Approved story", "Education", 9.0)
    approved.approved = True
    session.add_all([approved, _article("Unreviewed story", "Health", None)])
    session.commit()

    start, end = default_week_window()
    found = get_articles_in_window(session, start=start, end=end, approved_only=True)

    assert [a.title for a in found] == ["Approved story"]
