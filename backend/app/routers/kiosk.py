"""Kiosk endpoints for time clock operations via PIN-based authentication."""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.schedule import ScheduledShift
from app.models.time_clock import BreakType, ClockStatus, TimeClock
from app.models.user import User
from app.services.audit_service import log_action
from app.services.auth_service import create_access_token, decode_token
from app.services.time_clock_service import clock_in, clock_out, end_break, start_break

router = APIRouter()

# Short-lived kiosk sessions (15 minutes)
KIOSK_TOKEN_EXPIRE_MINUTES = 15


# ---------- Request / Response models ----------


class KioskAuthRequest(BaseModel):
    pin_code: str
    location_id: int


class KioskClockInRequest(BaseModel):
    session_token: str
    location_id: int


class KioskClockOutRequest(BaseModel):
    session_token: str
    time_clock_id: int


class KioskBreakStartRequest(BaseModel):
    session_token: str
    time_clock_id: int
    break_type: str  # "paid_10" or "unpaid_30"


class KioskBreakEndRequest(BaseModel):
    session_token: str
    time_clock_id: int


# ---------- Helpers ----------


async def _get_user_from_token(session_token: str, db: AsyncSession) -> User:
    """Decode a kiosk JWT and return the authenticated user."""
    try:
        payload = decode_token(session_token)
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid session token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")

    result = await db.execute(
        select(User).options(selectinload(User.locations)).where(User.id == int(user_id))
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


# ---------- Endpoints ----------


@router.post("/authenticate")
async def kiosk_authenticate(
    data: KioskAuthRequest,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate by PIN code. Matches the last 4 digits against pin_last_four."""
    pin_last_four = data.pin_code[-4:] if len(data.pin_code) >= 4 else data.pin_code

    result = await db.execute(
        select(User).where(
            and_(
                User.pin_last_four == pin_last_four,
                User.is_active.is_(True),
            )
        )
    )
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid PIN")

    # Create a short-lived JWT for kiosk session
    session_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(minutes=KIOSK_TOKEN_EXPIRE_MINUTES),
    )

    # Get today's shifts at this location for this employee
    today = datetime.utcnow().date()
    shifts_result = await db.execute(
        select(ScheduledShift).where(
            and_(
                ScheduledShift.employee_id == user.id,
                ScheduledShift.location_id == data.location_id,
                ScheduledShift.date == today,
            )
        )
    )
    shifts = shifts_result.scalars().all()

    # Check for active time clock entry
    tc_result = await db.execute(
        select(TimeClock).where(
            and_(
                TimeClock.employee_id == user.id,
                TimeClock.status.in_([ClockStatus.clocked_in, ClockStatus.on_break]),
            )
        )
    )
    active_entry = tc_result.scalar_one_or_none()

    return {
        "session_token": session_token,
        "employee_id": user.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "shifts": [
            {
                "id": s.id,
                "start_time": s.start_time.isoformat(),
                "end_time": s.end_time.isoformat(),
                "status": s.status.value,
            }
            for s in shifts
        ],
        "active_time_clock": {
            "id": active_entry.id,
            "status": active_entry.status.value,
            "clock_in": active_entry.clock_in.isoformat(),
        }
        if active_entry
        else None,
    }


@router.post("/clock-in")
async def kiosk_clock_in(
    data: KioskClockInRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Clock in the authenticated kiosk user."""
    user = await _get_user_from_token(data.session_token, db)

    try:
        entry = await clock_in(db, user.id, data.location_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(
        db,
        user.id,
        "kiosk_clock_in",
        "time_clock",
        entry.id,
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()

    return {
        "message": "Clocked in successfully",
        "employee": f"{user.first_name} {user.last_name}",
        "time_clock_id": entry.id,
        "clock_in": entry.clock_in.isoformat(),
    }


@router.post("/clock-out")
async def kiosk_clock_out(
    data: KioskClockOutRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Clock out the authenticated kiosk user."""
    user = await _get_user_from_token(data.session_token, db)

    try:
        entry = await clock_out(db, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(
        db,
        user.id,
        "kiosk_clock_out",
        "time_clock",
        entry.id,
        new_values={"total_hours": entry.total_hours},
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()

    return {
        "message": "Clocked out successfully",
        "employee": f"{user.first_name} {user.last_name}",
        "time_clock_id": entry.id,
        "clock_out": entry.clock_out.isoformat(),
        "total_hours": entry.total_hours,
    }


@router.post("/break/start")
async def kiosk_start_break(
    data: KioskBreakStartRequest,
    db: AsyncSession = Depends(get_db),
):
    """Start a break for the authenticated kiosk user."""
    user = await _get_user_from_token(data.session_token, db)

    break_type = BreakType(data.break_type)

    try:
        brk = await start_break(db, user.id, break_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(db, user.id, "kiosk_start_break", "break", brk.id)
    await db.commit()

    return {
        "message": "Break started",
        "break_type": brk.break_type.value,
        "start_time": brk.start_time.isoformat(),
    }


@router.post("/break/end")
async def kiosk_end_break(
    data: KioskBreakEndRequest,
    db: AsyncSession = Depends(get_db),
):
    """End the current break for the authenticated kiosk user."""
    user = await _get_user_from_token(data.session_token, db)

    try:
        brk = await end_break(db, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(db, user.id, "kiosk_end_break", "break", brk.id)
    await db.commit()

    return {
        "message": "Break ended",
        "break_type": brk.break_type.value,
        "end_time": brk.end_time.isoformat(),
    }


@router.get("/schedule/{location_id}")
async def kiosk_get_schedule(
    location_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Return today's scheduled shifts at a location with employee names."""
    today = datetime.utcnow().date()

    result = await db.execute(
        select(ScheduledShift)
        .options(selectinload(ScheduledShift.employee))
        .where(
            and_(
                ScheduledShift.location_id == location_id,
                ScheduledShift.date == today,
            )
        )
        .order_by(ScheduledShift.start_time)
    )
    shifts = result.scalars().all()

    return {
        "date": today.isoformat(),
        "location_id": location_id,
        "shifts": [
            {
                "id": s.id,
                "employee_id": s.employee_id,
                "employee_name": f"{s.employee.first_name} {s.employee.last_name}"
                if s.employee
                else "Unassigned",
                "start_time": s.start_time.isoformat(),
                "end_time": s.end_time.isoformat(),
                "status": s.status.value,
            }
            for s in shifts
        ],
    }
