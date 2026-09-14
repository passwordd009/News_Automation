"""Application configuration.

All settings come from environment variables (optionally loaded from a local
``.env`` file).  Nothing here should import collectors, the database or the LLM
layer — configuration must stay dependency-free so every module can read it.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FEEDS_FILE = PROJECT_ROOT / "config" / "rss_feeds.json"

load_dotenv(PROJECT_ROOT / ".env")


def _env_str(name: str, default: str) -> str:
    value = os.getenv(name)
    return default if value is None or not value.strip() else value.strip()


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError:
        logger.warning("Invalid float for %s=%r, using default %s", name, value, default)
        return default


def _absolute_sqlite_url(url: str) -> str:
    """Anchor a relative SQLite path to the project root.

    ``sqlite:///hestia_news.db`` otherwise resolves against the current working
    directory, so collecting from one directory and generating the document
    from another would quietly use two different databases.
    """
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return url

    raw_path = url[len(prefix) :]
    if not raw_path or raw_path.startswith(":memory:"):
        return url

    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return url

    return f"{prefix}{(PROJECT_ROOT / path).resolve()}"


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning("Invalid int for %s=%r, using default %s", name, value, default)
        return default


@dataclass(frozen=True)
class FeedConfig:
    """A single configured RSS/Atom feed."""

    name: str
    url: str
    enabled: bool = True


@dataclass(frozen=True)
class Settings:
    """Runtime settings for the whole application."""

    # Storage — Supabase is the source of truth; SQLite is legacy only.
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    database_url: str = "sqlite:///hestia_news.db"

    # Collectors
    enable_rss: bool = True
    enable_gmail: bool = False
    enable_news_api: bool = False
    rss_feeds_file: Path = DEFAULT_FEEDS_FILE
    http_timeout: int = 20
    http_user_agent: str = "ProjectHestiaNewsBot/0.1 (+https://github.com/passwordd009/News_Automation)"
    max_articles_per_feed: int = 40
    lookback_days: int = 2

    # LLM — read here so nothing else needs to know which provider is in use
    llm_provider: str = "ollama"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1"
    llm_timeout: int = 120
    llm_temperature: float = 0.2
    llm_max_attempts: int = 2

    # Scoring thresholds (Phase 4)
    min_article_score: float = 7.0
    min_nyc_relevance: float = 6.0
    min_credibility: float = 6.0

    # Weekly doc (Phase 6)
    weekly_min_articles: int = 5
    weekly_max_articles: int = 10
    google_client_secret_file: str = "credentials.json"
    google_drive_folder_id: str = ""
    weekly_output_dir: Path = PROJECT_ROOT / "output"

    # The newsroom's clock. Week rotation happens Monday noon in this zone.
    timezone: str = "America/New_York"

    # Logging
    log_level: str = "INFO"

    # Cached feed list, populated lazily by ``rss_feeds``
    _feeds_cache: list = field(default_factory=list, repr=False, compare=False)

    @property
    def rss_feeds(self) -> list[FeedConfig]:
        """Feeds from ``RSS_FEEDS`` (comma-separated URLs) or the JSON file.

        Feeds are configuration, never application logic, so the feed list is
        swappable without touching any collector code.
        """
        if self._feeds_cache:
            return list(self._feeds_cache)

        feeds = _load_feeds_from_env() or _load_feeds_from_file(self.rss_feeds_file)
        self._feeds_cache.extend(feeds)
        return list(feeds)

    @property
    def enabled_rss_feeds(self) -> list[FeedConfig]:
        return [feed for feed in self.rss_feeds if feed.enabled]


def _load_feeds_from_env() -> list[FeedConfig]:
    raw = os.getenv("RSS_FEEDS", "").strip()
    if not raw:
        return []
    feeds: list[FeedConfig] = []
    for url in (part.strip() for part in raw.split(",")):
        if url:
            feeds.append(FeedConfig(name=url, url=url))
    return feeds


def _load_feeds_from_file(path: Path) -> list[FeedConfig]:
    if not path.exists():
        logger.warning("RSS feed file %s not found; no feeds configured.", path)
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Could not read RSS feed file %s: %s", path, exc)
        return []

    entries = payload.get("feeds", payload) if isinstance(payload, dict) else payload
    if not isinstance(entries, list):
        logger.error("RSS feed file %s must contain a list of feeds.", path)
        return []

    feeds: list[FeedConfig] = []
    for entry in entries:
        if isinstance(entry, str):
            feeds.append(FeedConfig(name=entry, url=entry))
            continue
        if not isinstance(entry, dict):
            logger.warning("Skipping malformed feed entry: %r", entry)
            continue
        url = (entry.get("url") or "").strip()
        if not url:
            logger.warning("Skipping feed entry without a url: %r", entry)
            continue
        feeds.append(
            FeedConfig(
                name=(entry.get("name") or url).strip(),
                url=url,
                enabled=bool(entry.get("enabled", True)),
            )
        )
    return feeds


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Load settings once per process."""
    feeds_file = os.getenv("RSS_FEEDS_FILE", "").strip()
    return Settings(
        supabase_url=_env_str("SUPABASE_URL", ""),
        # Supabase renamed service_role -> secret. Accept either, since new
        # projects show the new name and older ones still show the old.
        supabase_service_role_key=_env_str("SUPABASE_SECRET_KEY", "")
        or _env_str("SUPABASE_SERVICE_ROLE_KEY", ""),
        database_url=_absolute_sqlite_url(_env_str("DATABASE_URL", "sqlite:///hestia_news.db")),
        enable_rss=_env_bool("ENABLE_RSS", True),
        enable_gmail=_env_bool("ENABLE_GMAIL", False),
        enable_news_api=_env_bool("ENABLE_NEWS_API", False),
        rss_feeds_file=Path(feeds_file) if feeds_file else DEFAULT_FEEDS_FILE,
        http_timeout=_env_int("HTTP_TIMEOUT", 20),
        http_user_agent=_env_str(
            "HTTP_USER_AGENT",
            "ProjectHestiaNewsBot/0.1 (+https://github.com/passwordd009/News_Automation)",
        ),
        max_articles_per_feed=_env_int("MAX_ARTICLES_PER_FEED", 40),
        lookback_days=_env_int("LOOKBACK_DAYS", 2),
        llm_provider=_env_str("LLM_PROVIDER", "ollama"),
        ollama_url=_env_str("OLLAMA_URL", "http://localhost:11434"),
        ollama_model=_env_str("OLLAMA_MODEL", "llama3.1"),
        llm_timeout=_env_int("LLM_TIMEOUT", 120),
        llm_temperature=_env_float("LLM_TEMPERATURE", 0.2),
        llm_max_attempts=_env_int("LLM_MAX_ATTEMPTS", 2),
        min_article_score=_env_float("MIN_ARTICLE_SCORE", 7.0),
        min_nyc_relevance=_env_float("MIN_NYC_RELEVANCE", 6.0),
        min_credibility=_env_float("MIN_CREDIBILITY", 6.0),
        weekly_min_articles=_env_int("WEEKLY_MIN_ARTICLES", 5),
        weekly_max_articles=_env_int("WEEKLY_MAX_ARTICLES", 10),
        google_client_secret_file=_env_str("GOOGLE_CLIENT_SECRET_FILE", "credentials.json"),
        google_drive_folder_id=_env_str("GOOGLE_DRIVE_FOLDER_ID", ""),
        weekly_output_dir=Path(_env_str("WEEKLY_OUTPUT_DIR", str(PROJECT_ROOT / "output"))),
        timezone=_env_str("TIMEZONE", "America/New_York"),
        log_level=_env_str("LOG_LEVEL", "INFO").upper(),
    )


def configure_logging(level: str | None = None) -> None:
    """Set up console logging for the CLI scripts."""
    logging.basicConfig(
        level=getattr(logging, (level or get_settings().log_level), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
