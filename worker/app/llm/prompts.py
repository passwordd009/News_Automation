"""Prompts for article review.

Kept separate from the calling code so the editorial guidance can be tuned
without touching pipeline logic.
"""

from __future__ import annotations

from datetime import datetime

from app.schemas import BOROUGHS, TOPICS

SYSTEM_PROMPT = """\
You are an editorial assistant for Project Hestia, a New York City community \
news account that publishes a weekly Instagram "Weekly Wrap-Up" helping New \
Yorkers learn about useful, informative, community-focused developments.

You evaluate one article at a time and reply with STRICT JSON only. No prose, \
no markdown fences, no commentary before or after the JSON object.

You recommend. You never decide — a human editor makes the final call."""


_EDITORIAL_GUIDANCE = """\
JUDGE USEFULNESS, NOT JUST POSITIVITY.
An article can be extremely valuable while scoring low on positivity. A piece
explaining an affordable-housing policy dispute helps residents understand an
issue that affects them, so it earns a high community_value even with a
positive score of 4. Do not confuse "positive" with "appropriate".

SCORE HIGHLY:
- affordable housing opportunities, lotteries and tenant resources
- education developments and school announcements
- youth programs and job opportunities
- free or low-cost community events
- grants and small-business resources
- transportation and transit updates
- public benefits and how to access them
- local health resources and clinics
- neighborhood improvements and new community spaces
- arts, culture and nonprofit initiatives

SCORE LOW:
- violent crime reporting with no broader community value
- celebrity gossip
- ragebait and outrage content
- rumors and unverified claims
- national political stories with no meaningful NYC connection
- sensational or clickbait headlines
- sports scores with no community angle
- opinion pieces carrying no useful information"""


def _scoring_fields() -> str:
    return """\
  "nyc_relevance":   0-10  how directly this affects people living in NYC
  "informative":     0-10  how much a reader learns from it
  "community_value": 0-10  usefulness to a Hestia follower's daily life
  "positive":        0-10  tone only; a low score is not disqualifying
  "local_event":     0-10  whether it is a specific event readers can attend
  "credibility":     0-10  source reliability and factual grounding"""


def build_review_prompt(
    *,
    title: str,
    source: str,
    published_at: datetime | None,
    description: str | None = None,
    article_text: str | None = None,
    max_text_chars: int = 6000,
) -> str:
    """The review prompt for one article."""
    published = published_at.strftime("%B %d, %Y") if published_at else "unknown"

    body = (article_text or "").strip()
    if body:
        body = body[:max_text_chars]
        body_block = f"\nARTICLE TEXT:\n{body}\n"
    else:
        body_block = "\nARTICLE TEXT:\n(not available — judge from the title and description)\n"

    return f"""\
{_EDITORIAL_GUIDANCE}

---

ARTICLE TO EVALUATE

TITLE: {title}
SOURCE: {source}
PUBLISHED: {published}

DESCRIPTION:
{(description or "(none provided)").strip()}
{body_block}
---

Score each dimension from 0 to 10:

{_scoring_fields()}

Choose "topic" from this list where one fits, otherwise supply a short, better one:
{", ".join(TOPICS)}

Choose "borough" from: {", ".join(BOROUGHS)}

"summary" — 1 to 3 sentences stating WHAT happened. Plain and factual. No
editorialising, no "this important story".

"why_post" — why a Hestia follower benefits from seeing this. Must NOT restate
the summary; explain the value to the reader.

"appropriate" — true if this belongs in a community wrap-up at all. Set it to
false for crime blotter items, gossip, ragebait or content with no NYC
relevance, and give a one-line "rejection_reason".

Reply with this JSON object and nothing else:

{{
  "nyc_relevance": 0,
  "informative": 0,
  "community_value": 0,
  "positive": 0,
  "local_event": 0,
  "credibility": 0,
  "appropriate": true,
  "topic": "",
  "borough": "Citywide",
  "summary": "",
  "why_post": "",
  "rejection_reason": null
}}"""


RETRY_SUFFIX = """

Your previous reply was not valid JSON matching the required shape.
Reply with ONLY the JSON object. No markdown fences. No explanation.
Every score must be a number from 0 to 10."""
