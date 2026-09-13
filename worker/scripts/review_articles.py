#!/usr/bin/env python3
"""Run the AI reviewer over collected articles and print the verdicts.

Nothing is written to Supabase yet — that is the next migration step. This is
how you sanity-check the model and the prompt before wiring persistence up.

    python worker/scripts/review_articles.py --check        # is Ollama ready?
    python worker/scripts/review_articles.py --limit 5
    python worker/scripts/review_articles.py --limit 3 --show-json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import configure_logging, get_settings  # noqa: E402
from app.llm.article_reviewer import ArticleReviewer  # noqa: E402
from app.llm.client import LLMError, get_llm_client  # noqa: E402
from app.services.daily_pipeline import collect_articles  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Review collected articles with the configured LLM.")
    parser.add_argument("--limit", type=int, default=5, help="How many articles to review (default 5).")
    parser.add_argument("--check", action="store_true", help="Only check that the model is reachable.")
    parser.add_argument("--show-json", action="store_true", help="Print the full validated review JSON.")
    parser.add_argument("--log-level", default=None, help="DEBUG, INFO, WARNING, ERROR.")
    return parser.parse_args()


def check_model(settings) -> int:
    try:
        client = get_llm_client(settings)
    except LLMError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 1

    print(f"Provider: {client.name}")
    print(f"Model:    {settings.ollama_model}")
    print(f"URL:      {settings.ollama_url}")

    if client.is_available():
        print("\n✓ Model is reachable and pulled.")
        return 0

    print(
        "\n✗ Model is not ready.\n"
        "  Start the daemon:  ollama serve\n"
        f"  Pull the model:    ollama pull {settings.ollama_model}",
        file=sys.stderr,
    )
    return 1


def print_outcome(index: int, outcome) -> None:
    candidate = outcome.candidate
    print(f"\n{'─' * 74}")
    print(f"{index}. {candidate.title}")
    print(f"   {candidate.source}  |  {candidate.url}")

    if not outcome.ok:
        print(f"   ✗ REVIEW FAILED after {outcome.attempts} attempt(s): {outcome.error}")
        return

    review = outcome.review
    verdict = "RECOMMENDED" if outcome.ai_recommended else "not recommended"
    print(f"\n   {verdict}   overall {review.overall_score:.2f}   topic: {review.topic}  ({review.borough})")
    print(
        f"   relevance {review.nyc_relevance:.0f}  informative {review.informative:.0f}  "
        f"community {review.community_value:.0f}  credibility {review.credibility:.0f}  "
        f"positive {review.positive:.0f}  event {review.local_event:.0f}"
    )
    print(f"\n   Description:\n   {review.summary}")
    print(f"\n   Why post:\n   {review.why_post}")
    if review.rejection_reason:
        print(f"\n   Rejected because: {review.rejection_reason}")


def main() -> int:
    args = parse_args()
    configure_logging(args.log_level)
    settings = get_settings()

    if args.check:
        return check_model(settings)

    try:
        client = get_llm_client(settings)
    except LLMError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 1

    if not client.is_available():
        print(
            f"✗ {client.name} is not reachable at {settings.ollama_url}.\n"
            f"  Run 'ollama serve' and 'ollama pull {settings.ollama_model}', "
            "or re-run with --check for detail.",
            file=sys.stderr,
        )
        return 1

    print("Collecting articles…")
    candidates = collect_articles(settings)[: args.limit]
    if not candidates:
        print("No articles collected. Check worker/config/rss_feeds.json.")
        return 0

    print(f"Reviewing {len(candidates)} article(s) with {settings.ollama_model}…")
    outcomes = ArticleReviewer(client=client, settings=settings).review_all(candidates)

    for index, outcome in enumerate(outcomes, start=1):
        print_outcome(index, outcome)
        if args.show_json and outcome.ok:
            print(f"\n   {json.dumps(outcome.review.model_dump(), indent=2)}")

    recommended = sum(1 for o in outcomes if o.ai_recommended)
    failed = sum(1 for o in outcomes if not o.ok)
    print(f"\n{'═' * 74}")
    print(f"Reviewed: {len(outcomes)}   Recommended: {recommended}   Failed: {failed}")
    print("\nThe AI only recommends. Every article still needs a human decision.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
