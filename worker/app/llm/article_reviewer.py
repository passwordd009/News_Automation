"""Turns an article into a validated ``ArticleReview``.

Two rules shape this module:

1. Model output is never trusted. Every response must survive JSON extraction
   and Pydantic validation before it can affect anything.
2. One bad article never stops the run. ``review()`` returns an outcome object
   and does not raise.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from pydantic import ValidationError

from app.config import Settings, get_settings
from app.llm.client import LLMClient, LLMError, get_llm_client
from app.llm.prompts import RETRY_SUFFIX, SYSTEM_PROMPT, build_review_prompt
from app.schemas import ArticleCandidate, ArticleReview

logger = logging.getLogger(__name__)


@dataclass
class ReviewOutcome:
    """Result of reviewing one article. Never an exception."""

    candidate: ArticleCandidate
    review: ArticleReview | None = None
    ai_recommended: bool = False
    error: str | None = None
    raw_response: str | None = None
    attempts: int = 0

    @property
    def ok(self) -> bool:
        return self.review is not None

    @property
    def overall_score(self) -> float | None:
        return self.review.overall_score if self.review else None


def extract_json_object(text: str) -> dict:
    """Pull the first complete JSON object out of a model response.

    Models wrap JSON in markdown fences, prefix it with "Here is the JSON:", or
    append a closing remark despite instructions. Scanning for a balanced brace
    pair survives all three, where ``json.loads`` on the whole string does not.
    """
    if not text or not text.strip():
        raise ValueError("empty response")

    stripped = text.strip()

    # The happy path: the whole response is the object.
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = stripped.find("{")
    if start == -1:
        raise ValueError("no JSON object found in the response")

    depth = 0
    in_string = False
    escaped = False

    for index in range(start, len(stripped)):
        char = stripped[index]

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                chunk = stripped[start : index + 1]
                parsed = json.loads(chunk)
                if not isinstance(parsed, dict):
                    raise ValueError("response JSON was not an object")
                return parsed

    raise ValueError("JSON object in the response is unterminated")


class ArticleReviewer:
    """Reviews candidates with the configured model."""

    def __init__(self, client: LLMClient | None = None, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.client = client or get_llm_client(self.settings)

    def review(self, candidate: ArticleCandidate, article_text: str | None = None) -> ReviewOutcome:
        """Review one article. Logs and reports failures instead of raising."""
        prompt = build_review_prompt(
            title=candidate.title,
            source=candidate.source,
            published_at=candidate.published_at,
            description=candidate.snippet,
            article_text=article_text,
        )

        outcome = ReviewOutcome(candidate=candidate)
        attempts = max(1, self.settings.llm_max_attempts)
        last_error = "not attempted"

        for attempt in range(1, attempts + 1):
            outcome.attempts = attempt
            # Only the retry carries the corrective suffix.
            attempt_prompt = prompt if attempt == 1 else prompt + RETRY_SUFFIX

            try:
                raw = self.client.generate(attempt_prompt, system=SYSTEM_PROMPT)
            except LLMError as exc:
                # A transport failure will not fix itself on a reworded retry.
                logger.warning("LLM unreachable while reviewing %s: %s", candidate.url, exc)
                outcome.error = str(exc)
                return outcome

            outcome.raw_response = raw

            try:
                payload = extract_json_object(raw)
                review = ArticleReview.model_validate(payload)
            except (ValueError, ValidationError) as exc:
                last_error = f"invalid model output: {exc}"
                logger.debug(
                    "Attempt %d/%d for %s produced unusable output: %s",
                    attempt,
                    attempts,
                    candidate.url,
                    exc,
                )
                continue

            outcome.review = review
            outcome.ai_recommended = review.is_approved(
                min_overall=self.settings.min_article_score,
                min_nyc_relevance=self.settings.min_nyc_relevance,
                min_credibility=self.settings.min_credibility,
            )
            return outcome

        logger.warning("Giving up on %s after %d attempt(s): %s", candidate.url, attempts, last_error)
        outcome.error = last_error
        return outcome

    def review_all(
        self,
        candidates: list[ArticleCandidate],
    ) -> list[ReviewOutcome]:
        """Review a batch, carrying on past individual failures."""
        outcomes: list[ReviewOutcome] = []
        for index, candidate in enumerate(candidates, start=1):
            logger.info("Reviewing %d/%d: %s", index, len(candidates), candidate.title[:70])
            outcomes.append(self.review(candidate))

        recommended = sum(1 for o in outcomes if o.ai_recommended)
        failed = sum(1 for o in outcomes if not o.ok)
        logger.info(
            "Reviewed %d article(s): %d recommended, %d not recommended, %d failed.",
            len(outcomes),
            recommended,
            len(outcomes) - recommended - failed,
            failed,
        )
        return outcomes
