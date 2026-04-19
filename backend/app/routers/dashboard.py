from datetime import date, datetime, time, timedelta

import pytz
from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies import require_roles
from app.models.cash_drawer import CashDrawer, UnexpectedExpense
from app.models.location import Location
from app.models.payroll import PayrollRecord, PayrollStatus
from app.models.schedule import ScheduledShift, ShiftStatus
from app.models.shift_swap import ShiftCoverageRequest, ShiftSwapRequest, SwapStatus
from app.models.time_clock import Break, ClockStatus, TimeClock
from app.models.time_off import RequestStatus, TimeOffRequest, UnavailabilityRequest
from app.models.user import User, UserRole, user_locations
from app.services.square_service import get_daily_sales

router = APIRouter()


@router.get("/summary")
async def owner_dashboard(
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    today = datetime.now(pytz.timezone(settings.timezone)).date()
    week_start = today - timedelta(days=today.weekday())

    # Active employees count
    emp_count = (await db.execute(
        select(func.count()).where(User.is_active.is_(True))
    )).scalar() or 0

    # Active locations
    loc_count = (await db.execute(
        select(func.count()).where(Location.is_active.is_(True))
    )).scalar() or 0

    # Currently clocked in
    clocked_in = (await db.execute(
        select(func.count()).where(TimeClock.status == ClockStatus.clocked_in)
    )).scalar() or 0

    # Today's scheduled shifts
    today_shifts = (await db.execute(
        select(func.count()).where(
            and_(ScheduledShift.date == today, ScheduledShift.status == ShiftStatus.scheduled)
        )
    )).scalar() or 0

    # Pending time off requests
    pending_time_off = (await db.execute(
        select(func.count()).where(TimeOffRequest.status == RequestStatus.pending)
    )).scalar() or 0

    # Pending payroll
    pending_payroll = (await db.execute(
        select(func.count()).where(PayrollRecord.status == PayrollStatus.pending_review)
    )).scalar() or 0

    # This week's total hours
    week_hours = (await db.execute(
        select(func.sum(TimeClock.total_hours)).where(
            and_(
                TimeClock.clock_in >= datetime.combine(week_start, datetime.min.time()),
                TimeClock.total_hours.isnot(None),
            )
        )
    )).scalar() or 0.0

    # Cash drawer variances today
    variance_result = await db.execute(
        select(func.sum(CashDrawer.variance)).where(
            and_(CashDrawer.date == today, CashDrawer.variance.isnot(None))
        )
    )
    today_variance = variance_result.scalar() or 0.0

    return {
        "active_employees": emp_count,
        "active_locations": loc_count,
        "currently_clocked_in": clocked_in,
        "today_scheduled_shifts": today_shifts,
        "pending_time_off_requests": pending_time_off,
        "pending_payroll_records": pending_payroll,
        "week_total_hours": round(week_hours, 2),
        "today_cash_variance": round(today_variance, 2),
        "date": today.isoformat(),
    }


@router.get("/location/{location_id}")
async def location_dashboard(
    location_id: int,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    today = datetime.now(pytz.timezone(settings.timezone)).date()

    # Today's shifts at this location
    shifts_result = await db.execute(
        select(ScheduledShift).where(
            and_(ScheduledShift.location_id == location_id, ScheduledShift.date == today)
        )
    )
    shifts = shifts_result.scalars().all()

    # Currently clocked in at location
    clocked_in = (await db.execute(
        select(func.count()).where(
            and_(TimeClock.location_id == location_id, TimeClock.status == ClockStatus.clocked_in)
        )
    )).scalar() or 0

    # Today's cash drawer
    drawer_result = await db.execute(
        select(CashDrawer).where(
            and_(CashDrawer.location_id == location_id, CashDrawer.date == today)
        )
    )
    drawer = drawer_result.scalar_one_or_none()

    # Sales data from Square
    sales = await get_daily_sales(location_id, today)

    return {
        "location_id": location_id,
        "date": today.isoformat(),
        "scheduled_shifts": len(shifts),
        "currently_clocked_in": clocked_in,
        "cash_drawer": {
            "opening_amount": drawer.opening_amount if drawer else None,
            "expected_closing": drawer.expected_closing if drawer else None,
            "actual_closing": drawer.actual_closing if drawer else None,
            "variance": drawer.variance if drawer else None,
        } if drawer else None,
        "sales": sales,
    }


@router.get("/manager")
async def manager_dashboard(
    location_id: int = Query(...),
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    tz = pytz.timezone(settings.timezone)
    now = datetime.now(tz)
    today = now.date()

    # Map day_of_week number to short string for unavailability matching
    day_names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    today_day_str = day_names[today.weekday()]

    # Monday-based week boundaries
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    week_start_dt = datetime.combine(week_start, time.min)

    # --- Location name ---
    loc_result = await db.execute(select(Location).where(Location.id == location_id))
    location = loc_result.scalar_one_or_none()
    location_name = location.name if location else "Unknown"

    # --- Who's Working Now ---
    # Active time clocks (clocked_in or on_break) at this location
    active_tc_result = await db.execute(
        select(TimeClock)
        .options(selectinload(TimeClock.employee), selectinload(TimeClock.breaks))
        .where(
            and_(
                TimeClock.location_id == location_id,
                TimeClock.status.in_([ClockStatus.clocked_in, ClockStatus.on_break]),
            )
        )
    )
    active_time_clocks = active_tc_result.scalars().all()

    clocked_in_list = []
    on_break_list = []
    active_employee_ids = set()

    for tc in active_time_clocks:
        emp = tc.employee
        active_employee_ids.add(emp.id)
        emp_name = f"{emp.first_name} {emp.last_name}"

        # Find the employee's scheduled shift today to get shift_end
        shift_end = None
        shift_result = await db.execute(
            select(ScheduledShift).where(
                and_(
                    ScheduledShift.employee_id == emp.id,
                    ScheduledShift.location_id == location_id,
                    ScheduledShift.date == today,
                )
            )
        )
        shift = shift_result.scalar_one_or_none()
        if shift:
            shift_end = shift.end_time.isoformat() if shift.end_time else None

        if tc.status == ClockStatus.clocked_in:
            clocked_in_list.append({
                "id": emp.id,
                "name": emp_name,
                "clock_in": tc.clock_in.isoformat(),
                "status": "clocked_in",
                "shift_end": shift_end,
            })
        elif tc.status == ClockStatus.on_break:
            # Find the active (open) break
            active_break = None
            for b in tc.breaks:
                if b.end_time is None:
                    active_break = b
                    break
            on_break_list.append({
                "id": emp.id,
                "name": emp_name,
                "clock_in": tc.clock_in.isoformat(),
                "break_type": active_break.break_type.value if active_break else None,
                "break_start": active_break.start_time.isoformat() if active_break else None,
            })

    # Scheduled but not clocked in
    scheduled_today_result = await db.execute(
        select(ScheduledShift)
        .options(selectinload(ScheduledShift.employee))
        .where(
            and_(
                ScheduledShift.location_id == location_id,
                ScheduledShift.date == today,
                ScheduledShift.status.in_([ShiftStatus.scheduled, ShiftStatus.confirmed]),
                ScheduledShift.employee_id.isnot(None),
            )
        )
    )
    scheduled_shifts_today = scheduled_today_result.scalars().all()

    scheduled_not_clocked_in = []
    for shift in scheduled_shifts_today:
        if shift.employee_id not in active_employee_ids:
            emp = shift.employee
            emp_name = f"{emp.first_name} {emp.last_name}"
            shift_start_dt = datetime.combine(today, shift.start_time)
            shift_start_aware = tz.localize(shift_start_dt)
            minutes_late = None
            if now > shift_start_aware:
                minutes_late = int((now - shift_start_aware).total_seconds() / 60)
            scheduled_not_clocked_in.append({
                "id": emp.id,
                "name": emp_name,
                "shift_start": shift.start_time.isoformat(),
                "shift_end": shift.end_time.isoformat(),
                "minutes_late": minutes_late,
            })

    # --- Overtime Alerts ---
    # Get all employees at this location
    loc_employees_result = await db.execute(
        select(User).join(user_locations).where(
            and_(user_locations.c.location_id == location_id, User.is_active.is_(True))
        )
    )
    loc_employees = loc_employees_result.scalars().all()

    overtime_alerts = []
    for emp in loc_employees:
        # Hours worked this week (completed entries with total_hours)
        hours_result = await db.execute(
            select(func.coalesce(func.sum(TimeClock.total_hours), 0.0)).where(
                and_(
                    TimeClock.employee_id == emp.id,
                    TimeClock.clock_in >= week_start_dt,
                    TimeClock.total_hours.isnot(None),
                )
            )
        )
        hours_this_week = float(hours_result.scalar() or 0.0)

        # Remaining scheduled hours this week (shifts not yet worked)
        remaining_shifts_result = await db.execute(
            select(ScheduledShift).where(
                and_(
                    ScheduledShift.employee_id == emp.id,
                    ScheduledShift.location_id == location_id,
                    ScheduledShift.date >= today,
                    ScheduledShift.date <= week_end,
                    ScheduledShift.status.in_([ShiftStatus.scheduled, ShiftStatus.confirmed]),
                )
            )
        )
        remaining_shifts = remaining_shifts_result.scalars().all()
        scheduled_remaining = 0.0
        for s in remaining_shifts:
            start_dt = datetime.combine(s.date, s.start_time)
            end_dt = datetime.combine(s.date, s.end_time)
            # Handle overnight shifts
            if end_dt <= start_dt:
                end_dt += timedelta(days=1)
            scheduled_remaining += (end_dt - start_dt).total_seconds() / 3600.0

        projected_total = hours_this_week + scheduled_remaining
        if projected_total > 40:
            overtime_alerts.append({
                "id": emp.id,
                "name": f"{emp.first_name} {emp.last_name}",
                "hours_this_week": round(hours_this_week, 2),
                "scheduled_remaining": round(scheduled_remaining, 2),
                "projected_total": round(projected_total, 2),
            })

    # --- Pending Approvals ---
    # Time off requests: pending, for employees at this location
    loc_employee_ids = [e.id for e in loc_employees]

    pending_timeoff_result = await db.execute(
        select(TimeOffRequest)
        .options(selectinload(TimeOffRequest.employee))
        .where(
            and_(
                TimeOffRequest.status == RequestStatus.pending,
                TimeOffRequest.employee_id.in_(loc_employee_ids) if loc_employee_ids else False,
            )
        )
    )
    pending_timeoff = pending_timeoff_result.scalars().all() if loc_employee_ids else []

    time_off_list = [
        {
            "id": r.id,
            "employee_name": f"{r.employee.first_name} {r.employee.last_name}",
            "start_date": r.start_date.isoformat(),
            "end_date": r.end_date.isoformat(),
            "reason": r.reason,
        }
        for r in pending_timeoff
    ]

    # Shift swap requests: pending, where either shift is at this location
    pending_swaps_result = await db.execute(
        select(ShiftSwapRequest)
        .options(
            selectinload(ShiftSwapRequest.requesting_employee),
            selectinload(ShiftSwapRequest.target_employee),
            selectinload(ShiftSwapRequest.requesting_shift),
            selectinload(ShiftSwapRequest.target_shift),
        )
        .where(
            and_(
                ShiftSwapRequest.status == SwapStatus.pending,
                or_(
                    ShiftSwapRequest.requesting_shift.has(ScheduledShift.location_id == location_id),
                    ShiftSwapRequest.target_shift.has(ScheduledShift.location_id == location_id),
                ),
            )
        )
    )
    pending_swaps = pending_swaps_result.scalars().all()

    shift_swaps_list = [
        {
            "id": sw.id,
            "requester_name": f"{sw.requesting_employee.first_name} {sw.requesting_employee.last_name}",
            "target_name": f"{sw.target_employee.first_name} {sw.target_employee.last_name}",
            "shift_date": sw.requesting_shift.date.isoformat(),
        }
        for sw in pending_swaps
    ]

    # Shift coverage requests: pending, where shift is at this location
    pending_coverage_result = await db.execute(
        select(ShiftCoverageRequest)
        .options(
            selectinload(ShiftCoverageRequest.posting_employee),
            selectinload(ShiftCoverageRequest.claiming_employee),
            selectinload(ShiftCoverageRequest.shift),
        )
        .where(
            and_(
                ShiftCoverageRequest.status == SwapStatus.pending,
                ShiftCoverageRequest.shift.has(ScheduledShift.location_id == location_id),
            )
        )
    )
    pending_coverage = pending_coverage_result.scalars().all()

    coverage_list = [
        {
            "id": cov.id,
            "poster_name": f"{cov.posting_employee.first_name} {cov.posting_employee.last_name}",
            "shift_date": cov.shift.date.isoformat(),
            "claimer_name": (
                f"{cov.claiming_employee.first_name} {cov.claiming_employee.last_name}"
                if cov.claiming_employee
                else None
            ),
        }
        for cov in pending_coverage
    ]

    # --- Cash Drawer ---
    drawer_result = await db.execute(
        select(CashDrawer)
        .options(selectinload(CashDrawer.employee), selectinload(CashDrawer.unexpected_expenses))
        .where(
            and_(
                CashDrawer.location_id == location_id,
                CashDrawer.date == today,
                CashDrawer.actual_closing.is_(None),
            )
        )
    )
    drawer = drawer_result.scalar_one_or_none()

    if drawer:
        expenses_total = sum(exp.amount for exp in drawer.unexpected_expenses)
        cash_drawer_data = {
            "is_open": True,
            "opening_amount": drawer.opening_amount,
            "expected_closing": drawer.expected_closing,
            "opened_by": f"{drawer.employee.first_name} {drawer.employee.last_name}",
            "opened_at": drawer.created_at.isoformat(),
            "expenses_total": round(expenses_total, 2),
        }
    else:
        cash_drawer_data = {
            "is_open": False,
            "opening_amount": None,
            "expected_closing": None,
            "opened_by": None,
            "opened_at": None,
            "expenses_total": 0.0,
        }

    # --- Available Today ---
    # Employees at this location who do NOT have:
    #   - a shift today
    #   - approved time off covering today
    #   - approved unavailability for today's day_of_week
    scheduled_employee_ids = {
        s.employee_id for s in scheduled_shifts_today if s.employee_id
    }

    # Employees with approved time off covering today
    timeoff_today_result = await db.execute(
        select(TimeOffRequest.employee_id).where(
            and_(
                TimeOffRequest.status == RequestStatus.approved,
                TimeOffRequest.start_date <= today,
                TimeOffRequest.end_date >= today,
                TimeOffRequest.employee_id.in_(loc_employee_ids) if loc_employee_ids else False,
            )
        )
    )
    timeoff_employee_ids = set(timeoff_today_result.scalars().all()) if loc_employee_ids else set()

    # Employees with approved unavailability for today's day
    unavail_result = await db.execute(
        select(UnavailabilityRequest.employee_id).where(
            and_(
                UnavailabilityRequest.status == RequestStatus.approved,
                UnavailabilityRequest.day_of_week == today_day_str,
                UnavailabilityRequest.employee_id.in_(loc_employee_ids) if loc_employee_ids else False,
            )
        )
    )
    unavail_employee_ids = set(unavail_result.scalars().all()) if loc_employee_ids else set()

    excluded_ids = scheduled_employee_ids | timeoff_employee_ids | unavail_employee_ids
    available_today = [
        {
            "id": emp.id,
            "name": f"{emp.first_name} {emp.last_name}",
            "phone": emp.phone,
        }
        for emp in loc_employees
        if emp.id not in excluded_ids
    ]

    # --- Today Summary ---
    # Total hours from completed time clock entries today
    today_hours_result = await db.execute(
        select(func.coalesce(func.sum(TimeClock.total_hours), 0.0)).where(
            and_(
                TimeClock.location_id == location_id,
                TimeClock.clock_in >= datetime.combine(today, time.min),
                TimeClock.clock_in < datetime.combine(today + timedelta(days=1), time.min),
                TimeClock.total_hours.isnot(None),
            )
        )
    )
    total_hours_today = float(today_hours_result.scalar() or 0.0)

    today_summary = {
        "scheduled_count": len(scheduled_shifts_today),
        "clocked_in_count": len(clocked_in_list),
        "on_break_count": len(on_break_list),
        "total_hours_today": round(total_hours_today, 2),
    }

    return {
        "location_id": location_id,
        "location_name": location_name,
        "whos_working_now": {
            "clocked_in": clocked_in_list,
            "on_break": on_break_list,
            "scheduled_not_clocked_in": scheduled_not_clocked_in,
        },
        "overtime_alerts": overtime_alerts,
        "pending_approvals": {
            "time_off": time_off_list,
            "shift_swaps": shift_swaps_list,
            "coverage": coverage_list,
        },
        "cash_drawer": cash_drawer_data,
        "available_today": available_today,
        "today_summary": today_summary,
    }
