"""RSS collector tests. No network access — feed XML is served from fixtures."""

from datetime import datetime, timedelta, timezone

import pytest
import requests

from app.collectors.rss_collector import RSSCollector
from app.config import FeedConfig, Settings

NOW = datetime.now(timezone.utc)


def _rss(items: str) -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <title>Test NYC Feed</title>
      {items}
    </channel></rss>""".encode()


def _item(title: str, link: str, published: datetime, description: str = "") -> str:
    stamp = published.strftime("%a, %d %b %Y %H:%M:%S +0000")
    return f"""<item>
        <title>{title}</title>
        <link>{link}</link>
        <pubDate>{stamp}</pubDate>
        <description>{description}</description>
      </item>"""


class _FakeResponse:
    def __init__(self, content: bytes):
        self.content = content

    def raise_for_status(self) -> None:
        return None


@pytest.fixture
def settings() -> Settings:
    return Settings(lookback_days=2, max_articles_per_feed=10)


def _patch_get(monkeypatch, content: bytes | Exception):
    def fake_get(url, **kwargs):
        if isinstance(content, Exception):
            raise content
        return _FakeResponse(content)

    monkeypatch.setattr(requests, "get", fake_get)


def test_parses_entries_into_candidates(monkeypatch, settings):
    feed = _rss(
        _item(
            "City opens new youth job program",
            "https://www.example.com/jobs?utm_source=rss",
            NOW - timedelta(hours=3),
            "&lt;p&gt;The city   announced   500 paid slots.&lt;/p&gt;",
        )
    )
    _patch_get(monkeypatch, feed)

    articles = RSSCollector(settings=settings, feeds=[FeedConfig("Example", "https://example.com/feed")]).fetch_articles()

    assert len(articles) == 1
    article = articles[0]
    assert article.title == "City opens new youth job program"
    assert article.url == "https://example.com/jobs"  # tracking param and www stripped
    assert article.source == "Example"
    assert article.collector == "rss"
    assert article.snippet == "The city announced 500 paid slots."
    assert article.published_at is not None and article.published_at.tzinfo is not None


def test_entries_older_than_lookback_are_skipped(monkeypatch, settings):
    feed = _rss(
        _item("Fresh story", "https://example.com/new", NOW - timedelta(hours=1))
        + _item("Stale story", "https://example.com/old", NOW - timedelta(days=30))
    )
    _patch_get(monkeypatch, feed)

    articles = RSSCollector(settings=settings, feeds=[FeedConfig("Example", "https://example.com/feed")]).fetch_articles()

    assert [a.title for a in articles] == ["Fresh story"]


def test_malformed_entry_does_not_drop_the_rest(monkeypatch, settings):
    feed = _rss(
        "<item><title>No link here</title></item>"
        + _item("Good story", "https://example.com/good", NOW - timedelta(hours=1))
    )
    _patch_get(monkeypatch, feed)

    articles = RSSCollector(settings=settings, feeds=[FeedConfig("Example", "https://example.com/feed")]).fetch_articles()

    assert [a.title for a in articles] == ["Good story"]


def test_network_failure_on_one_feed_does_not_stop_the_others(monkeypatch, settings):
    good = _rss(_item("Working feed story", "https://example.com/ok", NOW - timedelta(hours=1)))

    def fake_get(url, **kwargs):
        if "broken" in url:
            raise requests.ConnectionError("boom")
        return _FakeResponse(good)

    monkeypatch.setattr(requests, "get", fake_get)

    collector = RSSCollector(
        settings=settings,
        feeds=[
            FeedConfig("Broken", "https://broken.example.com/feed"),
            FeedConfig("Working", "https://example.com/feed"),
        ],
    )
    articles = collector.fetch_articles()

    assert [a.title for a in articles] == ["Working feed story"]


def test_safe_fetch_swallows_unexpected_errors(monkeypatch, settings):
    collector = RSSCollector(settings=settings, feeds=[FeedConfig("Example", "https://example.com/feed")])
    monkeypatch.setattr(collector, "fetch_articles", lambda: (_ for _ in ()).throw(RuntimeError("unexpected")))

    assert collector.safe_fetch() == []


def test_disabled_collector_returns_nothing(monkeypatch):
    settings = Settings(enable_rss=False)
    collector = RSSCollector(settings=settings, feeds=[FeedConfig("Example", "https://example.com/feed")])

    assert collector.enabled is False
    assert collector.safe_fetch() == []


def test_no_feeds_configured_is_not_an_error(settings):
    assert RSSCollector(settings=settings, feeds=[]).fetch_articles() == []
