#!/usr/bin/env python3
"""Collect NYC news, screen it with the AI, and file it for human review.

This is the worker's main command. Everything it writes lands in Supabase as
`pending` — the AI only recommends, and every editorial decision belongs to an
Approver or Admin in the dashboard.

    python worker/scripts/ingest.py
    python worker/scripts/ingest.py --limit 10
    python worker/scripts/ingest.py --dry-run      # review, write nothing
    python worker/scripts/ingest.py --check        # verify config and connections
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import configure_logging, get_settings  # noqa: E402
from app.database.supabase_store import SupabaseError, SupabaseStore  # noqa: E402
from app.llm.client import LLMError, get_llm_client  # noqa: E402
from app.services.ingest_pipeline import run_ingest  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect, screen and file NYC articles for review.")
    parser.add_argument("--limit", type=int, default=None, help="Review at most N new articles.")
    parser.add_argument("--dry-run", action="store_true", help="Review but write nothing to Supabase.")
    parser.add_argument("--check", action="store_true", help="Verify Supabase and the model, then exit.")
    parser.add_argument("--log-level", default=None, help="DEBUG, INFO, WARNING, ERROR.")
    return parser.parse_args()


def check(settings) -> int:
    """Confirm both external dependencies before a real run."""
    ok = True

    print("Supabase")
    if not settings.supabase_url or not settings.supabase_service_role_key:
        print("  ✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in worker/.env")
        ok = False
    else:
        print(f"  URL: {settings.supabase_url}")
        try:
            period = SupabaseStore(settings=settings).active_period()
            if period:
                print(f"  ✓ Connected. Active week: {period['start_date']} to {period['end_date']}")
            else:
                print("  ✓ Connected, but no active weekly period — ingest will open one.")
        except SupabaseError as exc:
            print(f"  ✗ {exc}")
            ok = False

    print("\nModel")
    try:
        client = get_llm_client(settings)
        print(f"  Provider: {client.name}   Model: {settings.ollama_model}")
        if client.is_available():
            print("  ✓ Reachable and pulled.")
        else:
            print(f"  ✗ Not ready. Try: ollama serve  &&  ollama pull {settings.ollama_model}")
            ok = False
    except LLMError as exc:
        print(f"  ✗ {exc}")
        ok = False

    print("\n" + ("Ready to ingest." if ok else "Not ready — fix the items marked ✗ above."))
    return 0 if ok else 1


def main() -> int:
    args = parse_args()
    configure_logging(args.log_level)
    settings = get_settings()

    if args.check:
        return check(settings)

    try:
        stats = run_ingest(settings, limit=args.limit, dry_run=args.dry_run)
    except (SupabaseError, LLMError) as exc:
        print(f"\n✗ {exc}\n", file=sys.stderr)
        print("Run with --check to test both connections.", file=sys.stderr)
        return 1

    print(f"\n{stats.format_summary()}")

    if args.dry_run:
        print("\nDry run — nothing was written.")
    elif stats.inserted:
        print(f"\n{stats.inserted} article(s) are waiting in the review queue.")
        print("The AI recommended some of them. A human still decides on all of them.")
    else:
        print("\nNothing new to file — everything collected was already stored.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
