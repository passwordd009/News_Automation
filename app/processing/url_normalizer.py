"""URL normalization.

Two collectors can find the same story behind slightly different links — one
carrying newsletter tracking parameters, one with a trailing slash, one with
``www.``.  Normalizing before storage makes exact-URL deduplication (Level 1)
actually work.
"""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Tracking/campaign parameters that never change which article you land on.
TRACKING_PARAMS: frozenset[str] = frozenset(
    {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "utm_id",
        "utm_name",
        "utm_reader",
        "utm_brand",
        "utm_social",
        "utm_social-type",
        "fbclid",
        "gclid",
        "dclid",
        "msclkid",
        "twclid",
        "igshid",
        "mc_cid",
        "mc_eid",
        "mkt_tok",
        "ref",
        "referrer",
        "source",
        "cmpid",
        "campaign_id",
        "ito",
        "at_medium",
        "at_campaign",
        "spm",
        "yclid",
        "_hsenc",
        "_hsmi",
        "vgo_ee",
        "smid",
        "smtyp",
        "partner",
    }
)

ALLOWED_SCHEMES: frozenset[str] = frozenset({"http", "https"})


def normalize_url(url: str | None) -> str | None:
    """Return a canonical form of ``url``, or ``None`` if it is not usable.

    - forces a lowercase scheme and host
    - drops ``www.`` and default ports
    - removes tracking parameters, keeping the rest sorted for stability
    - drops the fragment and any trailing slash on the path
    """
    if not url:
        return None

    candidate = url.strip()
    if not candidate:
        return None

    # Protocol-relative links appear in newsletter HTML.
    if candidate.startswith("//"):
        candidate = f"https:{candidate}"

    try:
        parts = urlsplit(candidate)
    except ValueError:
        return None

    scheme = parts.scheme.lower()
    if not scheme:
        # Bare "example.com/article" — assume https so it parses as a host.
        try:
            parts = urlsplit(f"https://{candidate}")
        except ValueError:
            return None
        scheme = "https"

    if scheme not in ALLOWED_SCHEMES:
        return None

    host = (parts.hostname or "").lower()
    if not host or "." not in host:
        return None
    if host.startswith("www."):
        host = host[4:]

    netloc = host
    port = parts.port
    if port is not None and port not in (80, 443):
        netloc = f"{host}:{port}"

    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/") or "/"

    kept = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in TRACKING_PARAMS
    ]
    query = urlencode(sorted(kept))

    return urlunsplit((scheme, netloc, path, query, ""))


def domain_of(url: str | None) -> str | None:
    """Bare hostname for a URL, used as a fallback source name."""
    normalized = normalize_url(url)
    if not normalized:
        return None
    return urlsplit(normalized).hostname
