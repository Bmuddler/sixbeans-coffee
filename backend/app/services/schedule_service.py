"""Schedule management logic: copy week, availability checks."""

from datetime import date, timedelta

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schedule import ScheduledShift, ShiftStatus
from app.models.time_off import RequestStatus, TimeOffRequest, UnavailabilityRequest


async def copy_week_schedule(
    db: AsyncSession,
    source_week_start: date,
    target_week_start: date,
    location_id: int,
) -> list[ScheduledShift]:
    """Copy all shifts from one week to another for a given location."""
    source_end = source_week_start + timedelta(days=6)

    result = await db.execute(
        select(ScheduledShift).where(
            and_(
                ScheduledShift.location_id == location_id,
                ScheduledShift.date >= source_week_start,
                ScheduledShift.date <= source_end,
                ScheduledShift.status != ShiftStatus.cancelled,
            )
        )
    )
    source_shifts = result.scalars().all()

    new_shifts = []
    day_offset = (target_week_start - source_week_start).days

    for shift in source_shifts:
        new_date = shift.date + timedelta(days=day_offset)
        new_shift = ScheduledShift(
            template_id=shift.template_id,
            location_id=shift.location_id,
            employee_id=shift.employee_id,
            date=new_date,
            start_time=shift.start_time,
            end_time=shift.end_time,
            status=ShiftStatus.scheduled,
            manager_notes=None,
        )
        db.add(new_shift)
        new_shifts.append(new_shift)

    await db.flush()
    return new_shifts


async def get_unavailable_employees(
    db: AsyncSession,
    target_date: date,
    location_id: int,
) -> dict[int, list[str]]:
    """Get employees unavailable on a given date with reasons.

    Returns dict mapping employee_id -> list of reasons.
    """
    day_name = target_date.strftime("%a").lower()
    unavailable: dict[int, list[str]] = {}

    # Check time off requests
    result = await db.execute(
        select(TimeOffRequest).where(
            and_(
                TimeOffRequest.start_date <= target_date,
                TimeOffRequest.end_date >= target_date,
                TimeOffRequest.status == RequestStatus.approved,
            )
        )
    )
    for req in result.scalars().all():
        time_info = ""
        st = getattr(req, 'start_time', None)
        et = getattr(req, 'end_time', None)
        if st and et:
            time_info = f" ({st.strftime('%I:%M%p')}-{et.strftime('%I:%M%p')})"
        elif st:
            time_info = f" (from {st.strftime('%I:%M%p')})"
        unavailable.setdefault(req.employee_id, []).append(
            f"Time off{time_info}: {req.reason or 'No reason given'}"
        )

    # Check unavailability
    result = await db.execute(
        select(UnavailabilityRequest).where(
            and_(
                UnavailabilityRequest.day_of_week == day_name,
                UnavailabilityRequest.status == RequestStatus.approved,
            )
        )
    )
    for req in result.scalars().all():
        unavailable.setdefault(req.employee_id, []).append(
            f"Unavailable: {req.reason or 'Recurring unavailability'}"
        )

    return unavailable
