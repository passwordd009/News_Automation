#!/usr/bin/env python3
"""Close the editorial week and open the next one.

Hestia posts Monday morning covering the week just ended, so the week being
posted stays active until **Monday at 12:00** local time. Run this on a cron:

    0 12 * * 1  cd /path/to/repo && .venv/bin/python worker/scripts/rotate_week.py

Safe to run at any time — it checks whether rotation is actually due and does
nothing if it is not, so a retry or a misfire cannot cut a week short.

    python worker/scripts/rotate_week.py            # rotate if due
    python worker/scripts/rotate_week.py --status   # report, change nothing
    python worker/scripts/rotate_week.py --force    # rotate regardless
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import configure_logging, get_settings  # noqa: E402
from app.database.supabase_store import SupabaseError, SupabaseStore  # noqa: E402
from app.services.week_rotation import local_now, rotate_week, should_rotate  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rotate the Hestia editorial week.")
    parser.add_argument("--status", action="store_true", help="Report the current week and exit.")
    parser.add_argument("--force", action="store_true", help="Rotate even if it is not due.")
    parser.add_argument("--log-level", default=None, help="DEBUG, INFO, WARNING, ERROR.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    configure_logging(args.log_level)
    settings = get_settings()
    moment = local_now(settings)

    try:
        store = SupabaseStore(settings=settings)
        period = store.active_period()

        print(f"Now: {moment:%A %d %B %Y, %H:%M} ({settings.timezone})")
        if period:
            print(f"Active week: {period['start_date']} to {period['end_date']}")
        else:
            print("Active week: none")

        due, reason = should_rotate(period, moment)

        if args.status:
            print(f"\n{'Due to rotate' if due else 'Not due'}: {reason}")
            return 0

        result = rotate_week(settings, store=store, moment=moment, force=args.force)

        if not result.rotated:
            print(f"\nNothing to do: {result.reason}")
            print("Use --force to rotate anyway.")
            return 0

        current = result.current
        print(f"\n✓ Opened {current['start_date']} to {current['end_date']}.")
        if result.previous:
            print(f"  Closed {result.previous['start_date']} to {result.previous['end_date']}.")
            print("  Undecided articles moved to the new week; decided ones stayed put.")
        return 0

    except SupabaseError as exc:
        print(f"\n✗ {exc}\n", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
