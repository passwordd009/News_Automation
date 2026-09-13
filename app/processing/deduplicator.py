"""Deduplication helpers.

Level 1 is exact normalized-URL matching, enforced by the unique ``url`` column.
Level 2 is near-identical titles, handled here by reducing a headline to a
fingerprint so two outlets running the same wire story collapse together.
Level 3 (embeddings) is deliberately not implemented yet.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

# Words that carry no signal when comparing headlines.
_STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "the", "and", "or", "but", "of", "for", "to", "in", "on",
        "at", "by", "with", "from", "as", "is", "are", "was", "were", "be",
        "been", "it", "its", "this", "that", "these", "those", "will", "new",
        "nyc", "nys", "ny",
    }
)

_NON_WORD = re.compile(r"[^a-z0-9\s]")
_WHITESPACE = re.compile(r"\s+")


def title_tokens(title: str) -> list[str]:
    """Lowercase, accent-folded, stopword-free words of a headline."""
    if not title:
        return []
    folded = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    cleaned = _NON_WORD.sub(" ", folded.lower())
    return [word for word in _WHITESPACE.split(cleaned) if word and word not in _STOPWORDS]


def title_fingerprint(title: str) -> str | None:
    """Stable hash of a headline's significant words, order-independent.

    "City Opens New Library in the Bronx" and "Bronx city library opens"
    produce the same fingerprint, so only one of them reaches the doc.
    """
    tokens = title_tokens(title)
    if not tokens:
        return None
    joined = " ".join(sorted(set(tokens)))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:32]


def titles_are_similar(first: str, second: str, threshold: float = 0.7) -> bool:
    """Jaccard overlap of significant words, for near-duplicate detection."""
    left, right = set(title_tokens(first)), set(title_tokens(second))
    if not left or not right:
        return False
    overlap = len(left & right) / len(left | right)
    return overlap >= threshold
