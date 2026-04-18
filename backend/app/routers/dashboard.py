from datetime import date, datetime, timedelta

import pytz
from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import require_roles
from app.models.cash_drawer import CashDrawer
from app.models.location import Location
from app.models.payroll import PayrollRecord, PayrollStatus
from app.models.schedule import ScheduledShift, ShiftStatus
from app.models.time_clock import ClockStatus, TimeClock
from app.models.time_off import RequestStatus, TimeOffRequest
from app.models.user import User, UserRole
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
