#!/usr/bin/env python3
"""Collect articles and generate the Weekly Wrap-Up document.

One command does the whole job: it collects fresh articles from every enabled
source, stores them, then builds the document from the last seven days.

    python scripts/generate_weekly_doc.py

By default it writes a local file you can read immediately — no Google account
required. Add --google to create a real Google Doc (needs credentials.json):

    python scripts/generate_weekly_doc.py --google

Other options:

    --no-collect       build from what is already stored, fetch nothing
    --days 14          widen the window from the default seven days
    --max 8            cap how many articles are included
    --approved-only    only articles the LLM approved (Phase 3+)
    --dry-run          print the document without saving or marking anything
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import configure_logging, get_settings  # noqa: E402
from app.database.database import init_db, session_scope  # noqa: E402
from app.database.repository import (  # noqa: E402
    count_by_status,
    default_week_window,
    get_articles_in_window,
    mark_selected,
)
from legacy.google.document_builder import PLACEHOLDER_WHY_POST, render_text  # noqa: E402
from app.services.daily_pipeline import run_collection  # noqa: E402
from legacy.weekly_pipeline import build_weekly_document  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect articles and generate the Weekly Wrap-Up document.")
    parser.add_argument(
        "--no-collect",
        action="store_true",
        help="Skip collection and build the document from what is already stored.",
    )
    parser.add_argument("--days", type=int, default=7, help="Size of the window in days (default 7).")
    parser.add_argument("--max", type=int, default=None, help="Maximum articles to include.")
    parser.add_argument(
        "--approved-only",
        action="store_true",
        help="Only include LLM-approved articles (nothing is approved until Phase 3).",
    )
    parser.add_argument("--google", action="store_true", help="Create a Google Doc instead of a local file.")
    parser.add_argument("--out", type=Path, default=None, help="Path for the local file.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the document without writing a file or marking articles as used.",
    )
    parser.add_argument("--log-level", default=None, help="DEBUG, INFO, WARNING, ERROR.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    configure_logging(args.log_level)
    settings = get_settings()

    if args.max is not None:
        settings = replace_max(settings, args.max)

    init_db()

    if args.no_collect:
        print("Skipping collection (--no-collect); using articles already stored.\n")
    else:
        print("Collecting articles…")
        stats = run_collection(settings, save=not args.dry_run)
        print(f"{stats.format_summary()}\n")
        if args.dry_run and stats.fetched:
            print("Dry run — the articles just fetched were not stored.\n")

    # Computed *after* collection: articles discovered during this run must fall
    # inside the window, and an end timestamp taken earlier would exclude them.
    start, end = default_week_window(days=args.days)

    with session_scope() as session:
        # No upper bound: anything discovered since `start`, including what the
        # collection above just added. `end` is used for the document's dates.
        articles = get_articles_in_window(
            session,
            start=start,
            approved_only=args.approved_only,
        )

        if not articles:
            print(explain_empty_result(start, end, args))
            return 0

        document, chosen = build_weekly_document(articles, start=start, end=end, settings=settings)
        rendered = render_text(document)

        if args.dry_run:
            print(rendered)
            print("Dry run — nothing written, no articles marked as used.")
            return 0

        if args.google:
            from legacy.google.docs_writer import GoogleDocsError, create_weekly_doc

            try:
                url = create_weekly_doc(document, folder_id=settings.google_drive_folder_id or None)
            except GoogleDocsError as exc:
                print(f"\nCould not create the Google Doc:\n{exc}\n", file=sys.stderr)
                print("The local file still works: python scripts/generate_weekly_doc.py", file=sys.stderr)
                return 1
            destination = url
        else:
            destination = str(write_local(document, rendered, args.out, settings))

        mark_selected(session, chosen)

    print(rendered)
    print("=" * 72)
    print(f"Articles included: {len(chosen)} of {len(articles)} available")
    print(f"Document: {destination}")

    placeholders = sum(1 for entry in document.entries if entry.why_post == PLACEHOLDER_WHY_POST)
    if placeholders:
        print(
            f"\nNote: {placeholders} entr{'y' if placeholders == 1 else 'ies'} need a 'Why post' written by hand.\n"
            "Phase 3 (the LLM reviewer) fills these in automatically."
        )
    return 0


def explain_empty_result(start: datetime, end: datetime, args: argparse.Namespace) -> str:
    """Say *why* the window is empty instead of just reporting that it is."""
    with session_scope() as session:
        counts = count_by_status(session)

    total = sum(counts.values())
    lines = [f"No articles to include for {start:%Y-%m-%d} to {end:%Y-%m-%d}."]

    if total == 0:
        lines += [
            "",
            "The database is empty. Most likely the feeds could not be reached —",
            "re-run with --log-level DEBUG to see what each feed returned, and check",
            "that config/rss_feeds.json has feeds enabled.",
        ]
        return "\n".join(lines)

    used = counts.get("selected", 0) + counts.get("posted", 0)
    if args.approved_only:
        lines += [
            "",
            f"{total} article(s) are stored, but --approved-only keeps just the ones the",
            "LLM approved, and the reviewer (Phase 3) does not exist yet — so nothing",
            "qualifies. Re-run without --approved-only.",
        ]
    elif used >= total:
        lines += [
            "",
            f"All {total} stored article(s) already appeared in a previous Wrap-Up.",
            "Collect newer articles, or widen the window with --days 14.",
        ]
    else:
        lines += [
            "",
            f"{total} article(s) are stored but none were discovered in the last",
            f"{args.days} day(s). Widen the window with --days 30.",
        ]
    return "\n".join(lines)


def write_local(document, rendered: str, out: Path | None, settings) -> Path:
    """Write the rendered document next to the project by default."""
    if out is None:
        settings.weekly_output_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        out = settings.weekly_output_dir / f"weekly-wrap-up-{stamp}.txt"
    else:
        out.parent.mkdir(parents=True, exist_ok=True)

    out.write_text(rendered, encoding="utf-8")
    return out


def replace_max(settings, maximum: int):
    """Settings are frozen, so build a copy with the CLI override applied."""
    from dataclasses import replace

    return replace(settings, weekly_max_articles=maximum)


if __name__ == "__main__":
    raise SystemExit(main())
