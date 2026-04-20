"""Time clock business logic with CA labor law compliance."""

from datetime import datetime, timedelta

import pytz

PACIFIC = pytz.timezone("America/Los_Angeles")


def _now_pacific() -> datetime:
    return datetime.now(PACIFIC).replace(tzinfo=None)

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.schedule import ScheduledShift
from app.models.system_settings import SystemSettings
from app.models.time_clock import Break, BreakType, ClockStatus, TimeClock
from app.utils.california_labor import (
    MAX_EARLY_CLOCK_IN_MINUTES,
    calculate_break_deductions,
    required_breaks,
)


async def clock_in(
    db: AsyncSession,
    employee_id: int,
    location_id: int,
    now: datetime | None = None,
) -> TimeClock:
    """Clock in an employee with shift validation."""
    now = now or _now_pacific()

    # Check if already clocked in
    result = await db.execute(
        select(TimeClock).where(
            and_(
                TimeClock.employee_id == employee_id,
                TimeClock.status.in_([ClockStatus.clocked_in, ClockStatus.on_break]),
            )
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise ValueError("Employee is already clocked in")

    # Load system settings for early clock-in limit
    settings_result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    sys_settings = settings_result.scalar_one_or_none()
    early_clockin_limit = sys_settings.early_clockin_minutes if sys_settings else MAX_EARLY_CLOCK_IN_MINUTES

    # Check for scheduled shift within allowed window
    today = now.date()
    result = await db.execute(
        select(ScheduledShift).where(
            and_(
                ScheduledShift.employee_id == employee_id,
                ScheduledShift.location_id == location_id,
                ScheduledShift.date == today,
            )
        )
    )
    shift = result.scalar_one_or_none()

    is_unscheduled = False
    auto_clockout_at = None
    if shift:
        shift_start = datetime.combine(today, shift.start_time)
        minutes_before = (shift_start - now).total_seconds() / 60
        if minutes_before > early_clockin_limit:
            raise ValueError(
                f"Cannot clock in more than {early_clockin_limit} minutes before shift start"
            )
        # Calculate auto clock-out time: shift end + buffer
        auto_clockout_minutes = sys_settings.auto_clockout_minutes if sys_settings else 0
        auto_clockout_at = datetime.combine(today, shift.end_time) + timedelta(minutes=auto_clockout_minutes)
    else:
        is_unscheduled = True

    entry = TimeClock(
        employee_id=employee_id,
        location_id=location_id,
        clock_in=now,
        status=ClockStatus.clocked_in,
        is_unscheduled=is_unscheduled,
        auto_clockout_at=auto_clockout_at,
    )
    db.add(entry)
    await db.flush()
    return entry


async def clock_out(
    db: AsyncSession,
    employee_id: int,
    now: datetime | None = None,
    auto: bool = False,
) -> TimeClock:
    """Clock out an employee and calculate total hours."""
    now = now or _now_pacific()

    result = await db.execute(
        select(TimeClock)
        .options(selectinload(TimeClock.breaks))
        .where(
            and_(
                TimeClock.employee_id == employee_id,
                TimeClock.status.in_([ClockStatus.clocked_in, ClockStatus.on_break]),
            )
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise ValueError("Employee is not clocked in")

    # End any active break
    for brk in entry.breaks:
        if brk.end_time is None:
            brk.end_time = now

    entry.clock_out = now
    entry.auto_clocked_out = auto
    entry.status = ClockStatus.clocked_out

    # Calculate total hours minus unpaid breaks
    total_duration = now - entry.clock_in
    unpaid_break_minutes = sum(
        (b.end_time - b.start_time).total_seconds() / 60
        for b in entry.breaks
        if b.break_type == BreakType.unpaid_30 and b.end_time
    )
    deduction_hours = calculate_break_deductions(unpaid_break_minutes, 0)
    entry.total_hours = round(total_duration.total_seconds() / 3600 - deduction_hours, 2)

    await db.flush()
    return entry


async def start_break(
    db: AsyncSession,
    employee_id: int,
    break_type: BreakType,
    now: datetime | None = None,
) -> Break:
    """Start a break for a clocked-in employee."""
    now = now or _now_pacific()

    result = await db.execute(
        select(TimeClock).where(
            and_(
                TimeClock.employee_id == employee_id,
                TimeClock.status == ClockStatus.clocked_in,
            )
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise ValueError("Employee must be clocked in to start a break")

    entry.status = ClockStatus.on_break
    brk = Break(
        time_clock_id=entry.id,
        break_type=break_type,
        start_time=now,
    )
    db.add(brk)
    await db.flush()
    return brk


async def end_break(
    db: AsyncSession,
    employee_id: int,
    now: datetime | None = None,
) -> Break:
    """End the current break for an employee."""
    now = now or _now_pacific()

    result = await db.execute(
        select(TimeClock)
        .options(selectinload(TimeClock.breaks))
        .where(
            and_(
                TimeClock.employee_id == employee_id,
                TimeClock.status == ClockStatus.on_break,
            )
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise ValueError("Employee is not on a break")

    active_break = next((b for b in entry.breaks if b.end_time is None), None)
    if not active_break:
        raise ValueError("No active break found")

    active_break.end_time = now
    entry.status = ClockStatus.clocked_in
    await db.flush()
    return active_break


async def auto_clock_out_expired_shifts(db: AsyncSession) -> list[TimeClock]:
    """Auto clock-out employees whose auto_clockout_at has passed. Run periodically."""
    now = _now_pacific()

    result = await db.execute(
        select(TimeClock)
        .options(selectinload(TimeClock.breaks))
        .where(
            and_(
                TimeClock.status.in_([ClockStatus.clocked_in, ClockStatus.on_break]),
                TimeClock.auto_clockout_at.isnot(None),
                TimeClock.auto_clockout_at <= now,
            )
        )
    )
    active_entries = result.scalars().all()

    clocked_out = []
    for entry in active_entries:
        await clock_out(db, entry.employee_id, now=entry.auto_clockout_at, auto=True)
        clocked_out.append(entry)

    return clocked_out


def get_break_compliance(entry: TimeClock) -> dict:
    """Check if an employee's breaks comply with CA labor law."""
    if not entry.clock_out:
        duration = _now_pacific() - entry.clock_in
    else:
        duration = entry.clock_out - entry.clock_in

    required = required_breaks(duration)
    taken_meal = sum(1 for b in entry.breaks if b.break_type == BreakType.unpaid_30)
    taken_rest = sum(1 for b in entry.breaks if b.break_type == BreakType.paid_10)

    return {
        "required_meal_breaks": required["meal_breaks"],
        "taken_meal_breaks": taken_meal,
        "meal_break_compliant": taken_meal >= required["meal_breaks"],
        "required_rest_breaks": required["rest_breaks"],
        "taken_rest_breaks": taken_rest,
        "rest_break_compliant": taken_rest >= required["rest_breaks"],
    }
