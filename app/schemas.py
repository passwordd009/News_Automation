"""Pydantic models shared by every layer of the application.

``ArticleCandidate`` is what *every* collector must produce, regardless of where
the article came from (RSS, Gmail newsletter, news API).  ``ArticleReview`` is
the validated shape of the LLM's JSON response — LLM output is never trusted
without passing through it.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.processing.url_normalizer import normalize_url

Score = Annotated[float, Field(ge=0, le=10)]

# Weighting used to turn the LLM's individual scores into one overall score.
# "Positive" is deliberately a small slice: an informative housing-policy story
# is valuable even when its positivity score is low.
SCORE_WEIGHTS: dict[str, float] = {
    "nyc_relevance": 0.30,
    "community_value": 0.25,
    "informative": 0.20,
    "credibility": 0.15,
    "positive": 0.05,
    "local_event": 0.05,
}

TOPICS: tuple[str, ...] = (
    "Education",
    "Affordable Housing",
    "Small Business",
    "Community",
    "Government",
    "Transportation",
    "Technology",
    "Health",
    "Environment",
    "Jobs",
    "Youth",
    "Arts & Culture",
    "Local Events",
)

BOROUGHS: tuple[str, ...] = (
    "Citywide",
    "Bronx",
    "Brooklyn",
    "Manhattan",
    "Queens",
    "Staten Island",
)


class ArticleCandidate(BaseModel):
    """A normalized article discovered by a collector, before review."""

    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=500)
    url: str = Field(min_length=1)
    source: str = Field(min_length=1, max_length=200)
    published_at: Optional[datetime] = None
    snippet: Optional[str] = None
    author: Optional[str] = None
    collector: str = "unknown"
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("url")
    @classmethod
    def _normalize(cls, value: str) -> str:
        """Strip tracking parameters so the same story has one canonical URL."""
        normalized = normalize_url(value)
        if not normalized:
            raise ValueError(f"Not a usable http(s) URL: {value!r}")
        return normalized

    @field_validator("published_at")
    @classmethod
    def _tz_aware(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    @field_validator("snippet")
    @classmethod
    def _trim_snippet(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = " ".join(value.split())
        return cleaned[:2000] or None


class ArticleReview(BaseModel):
    """Validated LLM verdict for one article (Phase 3/4).

    Defined now so the collector output and the review output are designed
    together; nothing in Phase 1 calls the LLM.
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    nyc_relevance: Score
    informative: Score
    community_value: Score
    positive: Score
    local_event: Score
    credibility: Score
    appropriate: bool
    topic: str = Field(min_length=1, max_length=100)
    borough: str = "Citywide"
    summary: str = Field(min_length=1, max_length=1200)
    why_post: str = Field(min_length=1, max_length=1200)
    rejection_reason: Optional[str] = None

    @field_validator("rejection_reason")
    @classmethod
    def _blank_to_none(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @model_validator(mode="after")
    def _require_reason_when_rejected(self) -> "ArticleReview":
        if not self.appropriate and not self.rejection_reason:
            object.__setattr__(self, "rejection_reason", "Marked inappropriate without a stated reason.")
        return self

    @property
    def overall_score(self) -> float:
        """Weighted blend of the individual scores, rounded to 2 decimals."""
        total = sum(getattr(self, name) * weight for name, weight in SCORE_WEIGHTS.items())
        return round(total, 2)

    def is_approved(
        self,
        *,
        min_overall: float,
        min_nyc_relevance: float,
        min_credibility: float,
    ) -> bool:
        """Approval gate. Thresholds are configurable, never hardcoded here."""
        return (
            self.appropriate
            and self.overall_score >= min_overall
            and self.nyc_relevance >= min_nyc_relevance
            and self.credibility >= min_credibility
        )
