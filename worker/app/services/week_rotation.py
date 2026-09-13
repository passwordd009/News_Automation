"""Closing one editorial week and opening the next.

Hestia posts Monday morning covering the week just ended, so a period stays
active until **Monday at 12:00 local time**. That keeps the week being posted
as the active period right up to the moment it goes out — the dashboard never
has to guess which week a reader means.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import Settings, get_settings
from app.database.supabase_store import SupabaseError, SupabaseStore, monday_week_for

logger = logging.getLogger(__name__)

MONDAY = 0
ROTATION_HOUR = 12


@dataclass
class RotationResult:
    rotated: bool
    reason: str
    previous: dict | None = None
    current: dict | None = None


def local_now(settings: Settings | None = None) -> datetime:
    """Now, in the newsroom's timezone."""
    settings = settings or get_settings()
    try:
        zone = ZoneInfo(settings.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning("Unknown TIMEZONE %r; falling back to UTC.", settings.timezone)
        zone = ZoneInfo("UTC")
    return datetime.now(zone)


def is_rotation_time(moment: datetime) -> bool:
    """Monday, from noon onwards."""
    return moment.weekday() == MONDAY and moment.hour >= ROTATION_HOUR


def should_rotate(period: dict | None, moment: datetime) -> tuple[bool, str]:
    """Whether the active period is due to be closed.

    Two conditions, both required: the clock has reached Monday noon, and the
    week the period covers has actually ended. The second guard means running
    this off-schedule — a manual run, a cron misfire, a retry — cannot cut a
    week short.
    """
    if period is None:
        return True, "no active period exists"

    if not is_rotation_time(moment):
        return False, (
            f"not rotation time — it is {moment:%A %H:%M}, "
            f"rotation runs Monday from {ROTATION_HOUR}:00"
        )

    end_date = period.get("end_date")
    if isinstance(end_date, str):
        end_date = date.fromisoformat(end_date)

    if end_date and end_date >= moment.date():
        return False, f"the active week has not ended yet (runs through {end_date})"

    return True, f"the week ending {end_date} is over"


def rotate_week(
    settings: Settings | None = None,
    *,
    store: SupabaseStore | None = None,
    moment: datetime | None = None,
    force: bool = False,
) -> RotationResult:
    """Close the active period and open the next, if it is due."""
    settings = settings or get_settings()
    store = store or SupabaseStore(settings=settings)
    moment = moment or local_now(settings)

    period = store.active_period()
    due, reason = should_rotate(period, moment)

    if not due and not force:
        logger.info("Not rotating: %s", reason)
        return RotationResult(rotated=False, reason=reason, current=period)

    if force and not due:
        logger.warning("Rotating anyway (--force): %s", reason)

    start, end = monday_week_for(moment.date())
    logger.info("Opening the week %s to %s.", start, end)

    try:
        new_period = store.rotate_period(start, end)
    except SupabaseError:
        raise

    return RotationResult(
        rotated=True,
        reason=reason if due else "forced",
        previous=period,
        current=new_period,
    )
