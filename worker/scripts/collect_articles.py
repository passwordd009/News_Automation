#!/usr/bin/env python3
"""Collect articles, print them, and store them in the database.

Collection only. To collect *and* build the Weekly Wrap-Up in one step, use
``scripts/generate_weekly_doc.py`` instead — it does both.

    python scripts/collect_articles.py
    python scripts/collect_articles.py --limit 20
    python scripts/collect_articles.py --feed https://gothamist.com/feed
    python scripts/collect_articles.py --no-save
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.collectors.rss_collector import RSSCollector  # noqa: E402
from app.config import FeedConfig, configure_logging, get_settings  # noqa: E402
from app.processing.url_normalizer import domain_of  # noqa: E402
from app.schemas import ArticleCandidate  # noqa: E402
from app.services.daily_pipeline import run_collection  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect NYC articles and print them.")
    parser.add_argument("--limit", type=int, default=None, help="Print at most N articles.")
    parser.add_argument(
        "--feed",
        action="append",
        dest="feeds",
        metavar="URL",
        help="Collect from this feed URL only. Repeatable; overrides the config file.",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a readable list.")
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Preview only — do not store anything in the database.",
    )
    parser.add_argument("--log-level", default=None, help="DEBUG, INFO, WARNING, ERROR.")
    return parser.parse_args()


def print_human(articles: list[ArticleCandidate]) -> None:
    for index, article in enumerate(articles, start=1):
        published = article.published_at.strftime("%Y-%m-%d %H:%M UTC") if article.published_at else "unknown date"
        print(f"\n{index:>3}. {article.title}")
        print(f"     {article.source}  |  {published}")
        print(f"     {article.url}")
        if article.snippet:
            snippet = article.snippet[:200] + ("…" if len(article.snippet) > 200 else "")
            print(f"     {snippet}")


def print_summary(articles: list[ArticleCandidate]) -> None:
    print("\n" + "-" * 72)
    print(f"Collected: {len(articles)}")
    by_source: dict[str, int] = {}
    for article in articles:
        key = article.source or domain_of(article.url) or "unknown"
        by_source[key] = by_source.get(key, 0) + 1
    for source, count in sorted(by_source.items(), key=lambda item: (-item[1], item[0])):
        print(f"  {count:>3}  {source}")
    print("-" * 72)


def main() -> int:
    args = parse_args()
    configure_logging(args.log_level)
    settings = get_settings()

    feeds = [FeedConfig(name=url, url=url) for url in args.feeds] if args.feeds else None
    collector = RSSCollector(settings=settings, feeds=feeds)

    if not collector.enabled:
        print("RSS collection is disabled (ENABLE_RSS=false).", file=sys.stderr)
        return 1

    stats = run_collection(settings, feeds=feeds, save=not args.no_save, limit=args.limit)
    articles = stats.articles

    if args.json:
        print(json.dumps([article.model_dump(mode="json") for article in articles], indent=2))
        return 0

    if not articles:
        print("No articles collected. Check config/rss_feeds.json and your network connection.")
        return 0

    print_human(articles)
    print_summary(articles)

    if args.no_save:
        print("\nPreview only — nothing was saved (--no-save).")
        return 0

    print(f"\n{stats.format_summary()}")
    print(f"Stored in {settings.database_url}")
    print("Build the Weekly Wrap-Up with: python scripts/generate_weekly_doc.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
