from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.time_clock import TimeClock
from app.models.user import User, UserRole
from app.schemas.time_clock import (
    BreakEndRequest,
    BreakStartRequest,
    ClockInRequest,
    ClockOutRequest,
    TimeAdjustmentRequest,
    TimeClockListResponse,
    TimeClockResponse,
)
from app.services.audit_service import log_action
from app.utils.permissions import require_location_access
from app.services.time_clock_service import (
    auto_clock_out_expired_shifts,
    clock_in,
    clock_out,
    end_break,
    get_break_compliance,
    start_break,
)

router = APIRouter()


@router.post("/auto-clockout")
async def trigger_auto_clockout(
    db: AsyncSession = Depends(get_db),
):
    """Trigger auto clock-out for employees whose shifts have ended.
    Can be called by a cron job or external scheduler."""
    clocked_out = await auto_clock_out_expired_shifts(db)
    return {"auto_clocked_out": len(clocked_out)}


def _to_response(entry: TimeClock, employee_name: str | None = None) -> TimeClockResponse:
    return TimeClockResponse(
        id=entry.id, employee_id=entry.employee_id, location_id=entry.location_id,
        clock_in=entry.clock_in, clock_out=entry.clock_out,
        auto_clocked_out=entry.auto_clocked_out,
        auto_clockout_at=entry.auto_clockout_at,
        is_unscheduled=getattr(entry, "is_unscheduled", False),
        total_hours=entry.total_hours,
        status=entry.status, notes=entry.notes,
        breaks=[
            {"id": b.id, "break_type": b.break_type, "start_time": b.start_time, "end_time": b.end_time}
            for b in (entry.breaks or [])
        ],
        employee_name=employee_name, created_at=entry.created_at,
    )


@router.post("/clock-in", response_model=TimeClockResponse)
async def api_clock_in(
    data: ClockInRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        entry = await clock_in(db, current_user.id, data.location_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(
        db, current_user.id, "clock_in", "time_clock", entry.id,
        ip_address=request.client.host if request.client else None,
    )
    return _to_response(entry)


@router.post("/clock-out", response_model=TimeClockResponse)
async def api_clock_out(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        entry = await clock_out(db, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(
        db, current_user.id, "clock_out", "time_clock", entry.id,
        new_values={"total_hours": entry.total_hours},
        ip_address=request.client.host if request.client else None,
    )
    return _to_response(entry)


@router.post("/break/start")
async def api_start_break(
    data: BreakStartRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        brk = await start_break(db, current_user.id, data.break_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(db, current_user.id, "start_break", "break", brk.id)
    return {"id": brk.id, "break_type": brk.break_type, "start_time": brk.start_time}


@router.post("/break/end")
async def api_end_break(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        brk = await end_break(db, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(db, current_user.id, "end_break", "break", brk.id)
    return {"id": brk.id, "break_type": brk.break_type, "start_time": brk.start_time, "end_time": brk.end_time}


@router.get("/entries", response_model=TimeClockListResponse)
async def list_entries(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    location_id: int | None = None,
    employee_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(TimeClock).options(
        selectinload(TimeClock.breaks), selectinload(TimeClock.employee)
    )

    # Employees can only see their own entries
    if current_user.role == UserRole.employee:
        query = query.where(TimeClock.employee_id == current_user.id)
    elif employee_id:
        query = query.where(TimeClock.employee_id == employee_id)

    if location_id:
        query = query.where(TimeClock.location_id == location_id)
    if start_date:
        query = query.where(TimeClock.clock_in >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        query = query.where(TimeClock.clock_in <= datetime.combine(end_date, datetime.max.time()))

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    query = query.order_by(TimeClock.clock_in.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    entries = result.unique().scalars().all()

    return TimeClockListResponse(
        entries=[
            _to_response(e, f"{e.employee.first_name} {e.employee.last_name}" if e.employee else None)
            for e in entries
        ],
        total=total, page=page, per_page=per_page,
    )


@router.get("/my-summary")
async def get_my_summary(
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current user's hours summary for a given period."""
    from app.models.time_clock import BreakType
    from app.utils.california_labor import DAILY_OVERTIME_THRESHOLD_HOURS, WEEKLY_OVERTIME_THRESHOLD_HOURS

    result = await db.execute(
        select(TimeClock)
        .options(selectinload(TimeClock.breaks))
        .where(
            and_(
                TimeClock.employee_id == current_user.id,
                TimeClock.status == "clocked_out",
                TimeClock.clock_in >= datetime.combine(period_start, datetime.min.time()),
                TimeClock.clock_out <= datetime.combine(period_end + timedelta(days=1), datetime.min.time()),
            )
        )
        .order_by(TimeClock.clock_in)
    )
    entries = result.unique().scalars().all()

    total_hours = 0.0
    overtime_hours = 0.0

    # Group by date for daily OT
    daily_hours: dict[date, float] = {}
    for entry in entries:
        day = entry.clock_in.date()
        hours = entry.total_hours or 0.0
        daily_hours[day] = daily_hours.get(day, 0.0) + hours
        total_hours += hours

    weekly_regular = 0.0
    for day_total in daily_hours.values():
        if day_total > DAILY_OVERTIME_THRESHOLD_HOURS:
            daily_ot = day_total - DAILY_OVERTIME_THRESHOLD_HOURS
            weekly_regular += DAILY_OVERTIME_THRESHOLD_HOURS
        else:
            daily_ot = 0.0
            weekly_regular += day_total
        overtime_hours += daily_ot

    # Weekly overtime (over 40 not already counted as daily OT)
    if weekly_regular > WEEKLY_OVERTIME_THRESHOLD_HOURS:
        weekly_ot = weekly_regular - WEEKLY_OVERTIME_THRESHOLD_HOURS
        overtime_hours += weekly_ot
        regular_hours = WEEKLY_OVERTIME_THRESHOLD_HOURS
    else:
        regular_hours = weekly_regular

    entry_responses = [
        _to_response(e, f"{current_user.first_name} {current_user.last_name}")
        for e in entries
    ]

    return {
        "total_hours": round(total_hours, 2),
        "regular_hours": round(regular_hours, 2),
        "overtime_hours": round(overtime_hours, 2),
        "total_shifts": len(entries),
        "entries": entry_responses,
    }


@router.patch("/{entry_id}/adjust", response_model=TimeClockResponse)
async def adjust_time(
    entry_id: int,
    data: TimeAdjustmentRequest,
    request: Request,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TimeClock).options(selectinload(TimeClock.breaks), selectinload(TimeClock.employee))
        .where(TimeClock.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Time clock entry not found")
    if entry.location_id is not None:
        require_location_access(current_user, entry.location_id)

    old_values = {"clock_in": entry.clock_in.isoformat(), "clock_out": entry.clock_out.isoformat() if entry.clock_out else None}

    if data.clock_in:
        entry.clock_in = data.clock_in
    if data.clock_out:
        entry.clock_out = data.clock_out
        # Recalculate total hours
        if entry.clock_in and entry.clock_out:
            duration = (entry.clock_out - entry.clock_in).total_seconds() / 3600
            entry.total_hours = round(duration, 2)

    entry.notes = data.notes
    await db.flush()

    await log_action(
        db, current_user.id, "adjust_time", "time_clock", entry.id,
        old_values=old_values,
        new_values={"clock_in": entry.clock_in.isoformat(), "clock_out": entry.clock_out.isoformat() if entry.clock_out else None},
        notes=data.notes,
        ip_address=request.client.host if request.client else None,
    )

    emp_name = f"{entry.employee.first_name} {entry.employee.last_name}" if entry.employee else None
    return _to_response(entry, emp_name)


@router.get("/{entry_id}/compliance")
async def check_compliance(
    entry_id: int,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TimeClock).options(selectinload(TimeClock.breaks)).where(TimeClock.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Time clock entry not found")
    if entry.location_id is not None:
        require_location_access(current_user, entry.location_id)

    return get_break_compliance(entry)
