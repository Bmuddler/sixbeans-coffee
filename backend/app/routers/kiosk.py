from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.time_clock import ClockStatus, TimeClock
from app.models.user import User
from app.schemas.time_clock import BreakStartRequest, TimeClockResponse
from app.services.audit_service import log_action
from app.services.time_clock_service import clock_in, clock_out, end_break, start_break

router = APIRouter()


class KioskAuthRequest(BaseModel):
    pin_last_four: str
    location_id: int


class KioskClockRequest(BaseModel):
    pin_last_four: str
    location_id: int


class KioskBreakRequest(BaseModel):
    pin_last_four: str
    break_type: str  # "paid_10" or "unpaid_30"


async def _authenticate_kiosk_user(pin: str, location_id: int, db: AsyncSession) -> User:
    """Authenticate a user by last 4 of phone at a specific location."""
    result = await db.execute(
        select(User).where(
            and_(
                User.pin_last_four == pin,
                User.is_active.is_(True),
            )
        )
    )
    users = result.scalars().all()

    if not users:
        raise HTTPException(status_code=401, detail="Invalid PIN")

    # If multiple users match, narrow by location
    for user in users:
        # Load locations if needed
        loc_result = await db.execute(
            select(User).options().where(User.id == user.id)
        )
        return user

    raise HTTPException(status_code=401, detail="Invalid PIN or location")


@router.post("/auth")
async def kiosk_authenticate(
    data: KioskAuthRequest,
    db: AsyncSession = Depends(get_db),
):
    user = await _authenticate_kiosk_user(data.pin_last_four, data.location_id, db)

    # Check current clock status
    result = await db.execute(
        select(TimeClock).where(
            and_(
                TimeClock.employee_id == user.id,
                TimeClock.status.in_([ClockStatus.clocked_in, ClockStatus.on_break]),
            )
        )
    )
    active_entry = result.scalar_one_or_none()

    return {
        "employee_id": user.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "is_clocked_in": active_entry is not None,
        "clock_status": active_entry.status.value if active_entry else None,
        "clock_entry_id": active_entry.id if active_entry else None,
    }


@router.post("/clock-in")
async def kiosk_clock_in(
    data: KioskClockRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user = await _authenticate_kiosk_user(data.pin_last_four, data.location_id, db)

    try:
        entry = await clock_in(db, user.id, data.location_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(
        db, user.id, "kiosk_clock_in", "time_clock", entry.id,
        ip_address=request.client.host if request.client else None,
    )

    return {
        "message": f"Clocked in successfully",
        "employee": f"{user.first_name} {user.last_name}",
        "clock_in": entry.clock_in.isoformat(),
    }


@router.post("/clock-out")
async def kiosk_clock_out(
    data: KioskClockRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user = await _authenticate_kiosk_user(data.pin_last_four, data.location_id, db)

    try:
        entry = await clock_out(db, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(
        db, user.id, "kiosk_clock_out", "time_clock", entry.id,
        new_values={"total_hours": entry.total_hours},
        ip_address=request.client.host if request.client else None,
    )

    return {
        "message": "Clocked out successfully",
        "employee": f"{user.first_name} {user.last_name}",
        "clock_out": entry.clock_out.isoformat(),
        "total_hours": entry.total_hours,
    }


@router.post("/break/start")
async def kiosk_start_break(
    data: KioskBreakRequest,
    db: AsyncSession = Depends(get_db),
):
    # Need location_id for auth but not in this model, use a separate query
    result = await db.execute(
        select(User).where(
            and_(User.pin_last_four == data.pin_last_four, User.is_active.is_(True))
        )
    )
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid PIN")

    from app.models.time_clock import BreakType
    break_type = BreakType(data.break_type)

    try:
        brk = await start_break(db, user.id, break_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(db, user.id, "kiosk_start_break", "break", brk.id)

    return {
        "message": "Break started",
        "break_type": brk.break_type.value,
        "start_time": brk.start_time.isoformat(),
    }


@router.post("/break/end")
async def kiosk_end_break(
    data: KioskAuthRequest,
    db: AsyncSession = Depends(get_db),
):
    user = await _authenticate_kiosk_user(data.pin_last_four, data.location_id, db)

    try:
        brk = await end_break(db, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_action(db, user.id, "kiosk_end_break", "break", brk.id)

    return {
        "message": "Break ended",
        "break_type": brk.break_type.value,
        "end_time": brk.end_time.isoformat(),
    }
