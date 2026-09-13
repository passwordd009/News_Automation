"""Week rotation: Monday at noon, and not a moment sooner."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.config import Settings
from app.services.week_rotation import (
    is_rotation_time,
    rotate_week,
    should_rotate,
)
from tests.test_supabase_ingest import ACTIVE_PERIOD, FakeSupabase
from app.database.supabase_store import SupabaseStore

NY = ZoneInfo("America/New_York")


def at(year, month, day, hour=0, minute=0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=NY)


# 2026-09-14 is a Monday; the week 2026-09-07 to 2026-09-13 has just ended.
MONDAY_NOON = at(2026, 9, 14, 12, 0)
MONDAY_MORNING = at(2026, 9, 14, 9, 0)


def test_rotation_time_is_monday_from_noon():
    assert is_rotation_time(MONDAY_NOON)
    assert is_rotation_time(at(2026, 9, 14, 23, 59))
    assert not is_rotation_time(MONDAY_MORNING)
    assert not is_rotation_time(at(2026, 9, 13, 23, 59))  # Sunday night
    assert not is_rotation_time(at(2026, 9, 15, 12, 0))   # Tuesday noon


def test_monday_morning_keeps_the_posted_week_active():
    """The week being posted must still be the active one while it goes out."""
    due, reason = should_rotate(ACTIVE_PERIOD, MONDAY_MORNING)

    assert due is False
    assert "not rotation time" in reason


def test_rotation_is_due_once_monday_noon_passes():
    due, reason = should_rotate(ACTIVE_PERIOD, MONDAY_NOON)

    assert due is True
    assert "2026-09-13" in reason


def test_a_week_still_running_is_never_cut_short():
    """Guards against an off-schedule run ending the current week early."""
    current_week = {**ACTIVE_PERIOD, "start_date": "2026-09-14", "end_date": "2026-09-20"}

    due, reason = should_rotate(current_week, at(2026, 9, 21, 12, 0))
    assert due is True  # that week has ended by the 21st

    due, reason = should_rotate(current_week, MONDAY_NOON)
    assert due is False
    assert "has not ended yet" in reason


def test_missing_period_is_always_due():
    due, _ = should_rotate(None, MONDAY_MORNING)
    assert due is True


# --------------------------------------------------------------------------- #
# rotate_week
# --------------------------------------------------------------------------- #

class RotatingFakeSupabase(FakeSupabase):
    """Adds the rpc() call that rotate_period uses."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.rpc_calls = []

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        for period in self.rows["weekly_periods"]:
            if period["status"] == "active":
                period["status"] = "closed"
        new_period = {
            "id": "new-period",
            "start_date": params["p_start"],
            "end_date": params["p_end"],
            "status": "active",
        }
        self.rows["weekly_periods"].append(new_period)

        # supabase-py's rpc() returns a builder you then .execute().
        class _Rpc:
            def execute(self):
                class _Response:
                    data = [new_period]

                return _Response()

        return _Rpc()


def test_rotating_opens_the_week_that_just_started():
    fake = RotatingFakeSupabase(periods=[dict(ACTIVE_PERIOD)])
    store = SupabaseStore(client=fake, settings=Settings())

    result = rotate_week(Settings(), store=store, moment=MONDAY_NOON)

    assert result.rotated
    assert fake.rpc_calls[0][0] == "rotate_weekly_period"
    assert result.current["start_date"] == "2026-09-14"
    assert result.current["end_date"] == "2026-09-20"


def test_nothing_happens_on_monday_morning():
    fake = RotatingFakeSupabase(periods=[dict(ACTIVE_PERIOD)])
    store = SupabaseStore(client=fake, settings=Settings())

    result = rotate_week(Settings(), store=store, moment=MONDAY_MORNING)

    assert result.rotated is False
    assert fake.rpc_calls == []


def test_force_overrides_the_schedule():
    fake = RotatingFakeSupabase(periods=[dict(ACTIVE_PERIOD)])
    store = SupabaseStore(client=fake, settings=Settings())

    result = rotate_week(Settings(), store=store, moment=MONDAY_MORNING, force=True)

    assert result.rotated
    assert len(fake.rpc_calls) == 1


def test_rotation_leaves_exactly_one_active_period():
    fake = RotatingFakeSupabase(periods=[dict(ACTIVE_PERIOD)])
    store = SupabaseStore(client=fake, settings=Settings())

    rotate_week(Settings(), store=store, moment=MONDAY_NOON)

    active = [p for p in fake.rows["weekly_periods"] if p["status"] == "active"]
    assert len(active) == 1
