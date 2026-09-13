"""Builds the Weekly Wrap-Up document.

This module owns the *shape* of the document and nothing else — it has no
Google dependency at all.  ``docs_writer`` turns the same structure into a real
Google Doc; ``render_text`` turns it into a local file you can read right now.
That split keeps the format testable offline and makes the destination
swappable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Sequence

from app.database.models import Article

SEPARATOR = "-" * 44
PLACEHOLDER_WHY_POST = "[Needs review — the LLM reviewer (Phase 3) has not written this yet.]"


@dataclass
class DocumentEntry:
    """One article as it appears in the Wrap-Up."""

    topic: str
    url: str
    description: str
    why_post: str
    title: str = ""
    source: str = ""
    overall_score: float | None = None


@dataclass
class WeeklyDocument:
    """The whole document, ready to render or upload."""

    start: datetime
    end: datetime
    entries: list[DocumentEntry] = field(default_factory=list)
    heading: str = "WEEKLY WRAP-UP"

    @property
    def date_range(self) -> str:
        """e.g. 'September 7, 2026 - September 13, 2026'."""
        return f"{_long_date(self.start)} - {_long_date(self.end)}"

    @property
    def title(self) -> str:
        return f"Weekly Wrap-Up — {_short_date(self.start)} to {_short_date(self.end)}"


def _long_date(value: datetime) -> str:
    # Built by hand rather than with %-d/%-m, which are not portable to Windows.
    return f"{value.strftime('%B')} {value.day}, {value.year}"


def _short_date(value: datetime) -> str:
    return f"{value.month}/{value.day}/{value.year % 100:02d}"


def build_document(
    articles: Sequence[Article],
    *,
    start: datetime,
    end: datetime,
) -> WeeklyDocument:
    """Turn stored articles into document entries."""
    entries = [_to_entry(article) for article in articles]
    return WeeklyDocument(start=start, end=end, entries=entries)


def _to_entry(article: Article) -> DocumentEntry:
    """Map one stored article onto the Wrap-Up fields.

    Until the LLM reviewer exists, ``Description`` falls back to the article's
    own summary text and ``Why post`` is an explicit placeholder — never an
    invented justification.
    """
    description = (article.llm_summary or article.raw_description or "").strip()
    if not description:
        description = f"[No summary available — see the article: {article.title}]"

    why_post = (article.why_post or "").strip() or PLACEHOLDER_WHY_POST

    return DocumentEntry(
        topic=(article.topic or "Uncategorized").strip(),
        url=article.url,
        description=description,
        why_post=why_post,
        title=article.title,
        source=article.source or "",
        overall_score=article.overall_score,
    )


def render_text(document: WeeklyDocument) -> str:
    """Plain-text rendering matching the Google Doc layout."""
    lines: list[str] = [document.heading, "", f"DATE: {document.date_range}", ""]

    if not document.entries:
        lines.append("No articles were collected for this period.")
        return "\n".join(lines) + "\n"

    for entry in document.entries:
        lines.extend(
            [
                "",
                f"Topic: {entry.topic}",
                "",
                "URL:",
                entry.url,
                "",
                "Description:",
                entry.description,
                "",
                "Why post:",
                entry.why_post,
                "",
                SEPARATOR,
            ]
        )

    return "\n".join(lines) + "\n"
