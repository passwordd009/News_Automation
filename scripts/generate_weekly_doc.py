#!/usr/bin/env python3
"""Generate the Weekly Wrap-Up document.

By default this writes a local file you can read immediately — no Google
account required:

    python scripts/generate_weekly_doc.py

Add --google to create a real Google Doc instead (needs credentials.json):

    python scripts/generate_weekly_doc.py --google

Other options:

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
    default_week_window,
    get_articles_in_window,
    mark_selected,
)
from app.google.document_builder import PLACEHOLDER_WHY_POST, render_text  # noqa: E402
from app.services.weekly_pipeline import build_weekly_document  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the Weekly Wrap-Up document.")
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

    start, end = default_week_window(days=args.days)

    init_db()
    with session_scope() as session:
        articles = get_articles_in_window(
            session,
            start=start,
            end=end,
            approved_only=args.approved_only,
        )

        if not articles:
            print(
                f"No articles found between {start:%Y-%m-%d} and {end:%Y-%m-%d}.\n"
                "Collect some first:  python scripts/collect_articles.py"
            )
            return 0

        document, chosen = build_weekly_document(articles, start=start, end=end, settings=settings)
        rendered = render_text(document)

        if args.dry_run:
            print(rendered)
            print("Dry run — nothing written, no articles marked as used.")
            return 0

        if args.google:
            from app.google.docs_writer import GoogleDocsError, create_weekly_doc

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
