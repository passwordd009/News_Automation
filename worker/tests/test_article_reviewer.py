"""Reviewer tests. No Ollama required — the client is stubbed."""

import json

import pytest

from app.config import Settings
from app.llm.article_reviewer import ArticleReviewer, extract_json_object
from app.llm.client import LLMClient, LLMError, StubLLMClient, get_llm_client
from app.schemas import ArticleCandidate

VALID_REVIEW = {
    "nyc_relevance": 9,
    "informative": 9,
    "community_value": 8,
    "positive": 6,
    "local_event": 2,
    "credibility": 9,
    "appropriate": True,
    "topic": "Affordable Housing",
    "borough": "Bronx",
    "summary": "The city opened a housing lottery for 240 units in the Bronx.",
    "why_post": "Readers can apply, and it explains the income bands that qualify.",
    "rejection_reason": None,
}


@pytest.fixture
def candidate() -> ArticleCandidate:
    return ArticleCandidate(
        title="New affordable housing lottery opens in the Bronx",
        url="https://example.com/lottery",
        source="City Limits",
        snippet="Applications open for 240 units.",
    )


def _reviewer(response: str, **setting_overrides) -> ArticleReviewer:
    settings = Settings(min_article_score=7, min_nyc_relevance=6, min_credibility=6, **setting_overrides)
    return ArticleReviewer(client=StubLLMClient(response), settings=settings)


# --------------------------------------------------------------------------- #
# JSON extraction — models rarely return clean JSON
# --------------------------------------------------------------------------- #

def test_extracts_plain_json():
    assert extract_json_object('{"a": 1}') == {"a": 1}


def test_extracts_json_from_markdown_fence():
    assert extract_json_object('```json\n{"a": 1}\n```') == {"a": 1}


def test_extracts_json_despite_surrounding_prose():
    text = 'Sure! Here is the JSON:\n{"a": 1}\nLet me know if you need more.'
    assert extract_json_object(text) == {"a": 1}


def test_extracts_nested_objects_without_truncating():
    payload = {"a": {"b": {"c": 1}}, "d": 2}
    assert extract_json_object(f"noise {json.dumps(payload)} trailing") == payload


def test_braces_inside_strings_do_not_confuse_the_scan():
    payload = {"summary": "The rule is {weird} and \"quoted\"", "n": 1}
    assert extract_json_object(json.dumps(payload)) == payload


def test_rejects_unusable_responses():
    for bad in ["", "   ", "no json here", "{ unterminated", "[1, 2, 3]"]:
        with pytest.raises(ValueError):
            extract_json_object(bad)


# --------------------------------------------------------------------------- #
# review()
# --------------------------------------------------------------------------- #

def test_valid_response_produces_a_review(candidate):
    outcome = _reviewer(json.dumps(VALID_REVIEW)).review(candidate)

    assert outcome.ok
    assert outcome.error is None
    assert outcome.review.topic == "Affordable Housing"
    # 9(.30) + 8(.25) + 9(.20) + 9(.15) + 6(.05) + 2(.05)
    assert outcome.overall_score == pytest.approx(8.25)
    assert outcome.ai_recommended is True


def test_useful_but_unhappy_article_is_still_recommended(candidate):
    """Positivity is 5% of the score. A policy dispute should survive a low one."""
    payload = {**VALID_REVIEW, "positive": 2}
    outcome = _reviewer(json.dumps(payload)).review(candidate)

    assert outcome.ai_recommended is True


def test_low_nyc_relevance_blocks_the_recommendation(candidate):
    payload = {**VALID_REVIEW, "nyc_relevance": 3}
    outcome = _reviewer(json.dumps(payload)).review(candidate)

    assert outcome.ok
    assert outcome.ai_recommended is False


def test_scores_outside_the_range_are_rejected(candidate):
    payload = {**VALID_REVIEW, "credibility": 99}
    outcome = _reviewer(json.dumps(payload)).review(candidate)

    assert not outcome.ok
    assert "invalid model output" in outcome.error


def test_missing_fields_are_rejected(candidate):
    payload = {"nyc_relevance": 9, "topic": "Education"}
    outcome = _reviewer(json.dumps(payload)).review(candidate)

    assert not outcome.ok
    assert outcome.review is None


def test_malformed_output_is_retried_then_given_up_on(candidate):
    reviewer = _reviewer("not json at all", llm_max_attempts=2)
    outcome = reviewer.review(candidate)

    assert not outcome.ok
    assert outcome.attempts == 2
    assert reviewer.client.calls[1].endswith("Every score must be a number from 0 to 10.")


def test_retry_recovers_when_the_second_attempt_is_valid(candidate):
    class FlakyClient(LLMClient):
        def __init__(self):
            self.calls = 0

        def generate(self, prompt, *, system=None):
            self.calls += 1
            return "I cannot do that" if self.calls == 1 else json.dumps(VALID_REVIEW)

    reviewer = ArticleReviewer(client=FlakyClient(), settings=Settings())
    outcome = reviewer.review(candidate)

    assert outcome.ok
    assert outcome.attempts == 2


def test_unreachable_model_fails_fast_without_retrying(candidate):
    class DeadClient(LLMClient):
        def __init__(self):
            self.calls = 0

        def generate(self, prompt, *, system=None):
            self.calls += 1
            raise LLMError("connection refused")

    client = DeadClient()
    outcome = ArticleReviewer(client=client, settings=Settings(llm_max_attempts=3)).review(candidate)

    assert not outcome.ok
    assert "connection refused" in outcome.error
    # Rewording the prompt will not revive a dead daemon.
    assert client.calls == 1


def test_rejected_article_always_carries_a_reason(candidate):
    payload = {**VALID_REVIEW, "appropriate": False, "rejection_reason": None}
    outcome = _reviewer(json.dumps(payload)).review(candidate)

    assert outcome.ok
    assert outcome.review.rejection_reason
    assert outcome.ai_recommended is False


def test_prompt_carries_the_article_and_editorial_guidance(candidate):
    reviewer = _reviewer(json.dumps(VALID_REVIEW))
    reviewer.review(candidate)

    prompt = reviewer.client.calls[0]
    assert candidate.title in prompt
    assert "City Limits" in prompt
    assert "Applications open for 240 units." in prompt
    assert "JUDGE USEFULNESS, NOT JUST POSITIVITY." in prompt
    assert "Affordable Housing" in prompt  # the topic list


def test_batch_review_survives_a_failure_in_the_middle(candidate):
    class SometimesBrokenClient(LLMClient):
        def __init__(self):
            self.calls = 0

        def generate(self, prompt, *, system=None):
            self.calls += 1
            return "garbage" if self.calls == 2 else json.dumps(VALID_REVIEW)

    candidates = [
        ArticleCandidate(title=f"Story {n}", url=f"https://example.com/{n}", source="Example")
        for n in range(3)
    ]
    settings = Settings(llm_max_attempts=1)
    outcomes = ArticleReviewer(client=SometimesBrokenClient(), settings=settings).review_all(candidates)

    assert len(outcomes) == 3
    assert [o.ok for o in outcomes] == [True, False, True]


# --------------------------------------------------------------------------- #
# provider selection
# --------------------------------------------------------------------------- #

def test_factory_builds_the_configured_provider():
    client = get_llm_client(Settings(llm_provider="ollama", ollama_model="llama3.1"))
    assert client.name == "ollama"
    assert client.model == "llama3.1"


def test_unknown_provider_is_rejected_clearly():
    with pytest.raises(LLMError, match="Unknown LLM_PROVIDER"):
        get_llm_client(Settings(llm_provider="gpt-9"))
