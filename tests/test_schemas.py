from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas import ArticleCandidate, ArticleReview


def test_candidate_normalizes_url_on_construction():
    candidate = ArticleCandidate(
        title="  New grant program  ",
        url="https://www.gothamist.com/news/story?utm_campaign=x",
        source="Gothamist",
    )
    assert candidate.url == "https://gothamist.com/news/story"
    assert candidate.title == "New grant program"
    assert candidate.collector == "unknown"


def test_candidate_rejects_bad_url():
    with pytest.raises(ValidationError):
        ArticleCandidate(title="t", url="mailto:a@b.com", source="s")


def test_candidate_makes_naive_dates_utc():
    candidate = ArticleCandidate(
        title="t",
        url="https://example.com/a",
        source="s",
        published_at=datetime(2026, 9, 1, 12, 0),
    )
    assert candidate.published_at == datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def _review(**overrides) -> ArticleReview:
    payload = {
        "nyc_relevance": 9,
        "informative": 9,
        "community_value": 8,
        "positive": 6,
        "local_event": 2,
        "credibility": 9,
        "appropriate": True,
        "topic": "Affordable Housing",
        "borough": "Citywide",
        "summary": "NYC officials are debating a housing plan.",
        "why_post": "It helps residents understand a policy that affects rents.",
        "rejection_reason": None,
    }
    payload.update(overrides)
    return ArticleReview(**payload)


def test_overall_score_uses_documented_weights():
    review = _review()
    expected = 9 * 0.30 + 8 * 0.25 + 9 * 0.20 + 9 * 0.15 + 6 * 0.05 + 2 * 0.05
    assert review.overall_score == round(expected, 2)


def test_useful_article_approved_despite_low_positivity():
    review = _review(positive=4)
    assert review.is_approved(min_overall=7, min_nyc_relevance=6, min_credibility=6)


def test_low_relevance_blocks_approval_even_with_high_overall():
    review = _review(nyc_relevance=3, community_value=10, informative=10, credibility=10)
    assert not review.is_approved(min_overall=7, min_nyc_relevance=6, min_credibility=6)


def test_scores_must_be_within_range():
    with pytest.raises(ValidationError):
        _review(nyc_relevance=11)
    with pytest.raises(ValidationError):
        _review(credibility=-1)


def test_rejected_review_always_has_a_reason():
    review = _review(appropriate=False, rejection_reason="  ")
    assert review.rejection_reason
    assert not review.is_approved(min_overall=0, min_nyc_relevance=0, min_credibility=0)
