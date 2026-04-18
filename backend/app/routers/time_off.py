from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.time_off import RequestStatus, TimeOffRequest, UnavailabilityRequest
from app.models.user import User, UserRole
from app.schemas.time_off import (
    TimeOffRequestCreate,
    TimeOffRequestResponse,
    TimeOffReviewRequest,
    UnavailabilityCreate,
    UnavailabilityResponse,
    UnavailabilityReviewRequest,
)
from app.services.audit_service import log_action
from app.services.notification_service import notify_time_off_decision

router = APIRouter()


# --- Time Off Requests ---

@router.post("/requests", response_model=TimeOffRequestResponse, status_code=status.HTTP_201_CREATED)
async def create_time_off_request(
    data: TimeOffRequestCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    req = TimeOffRequest(
        employee_id=current_user.id,
        start_date=data.start_date,
        end_date=data.end_date,
        reason=data.reason,
    )
    db.add(req)
    await db.flush()

    await log_action(db, current_user.id, "create_time_off_request", "time_off_request", req.id)

    return TimeOffRequestResponse(
        id=req.id, employee_id=req.employee_id, start_date=req.start_date,
        end_date=req.end_date, reason=req.reason, status=req.status,
        employee_name=f"{current_user.first_name} {current_user.last_name}",
        created_at=req.created_at,
    )


@router.get("/requests", response_model=list[TimeOffRequestResponse])
async def list_time_off_requests(
    status_filter: RequestStatus | None = None,
    employee_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(TimeOffRequest).options(selectinload(TimeOffRequest.employee))

    if current_user.role == UserRole.employee:
        query = query.where(TimeOffRequest.employee_id == current_user.id)
    elif employee_id:
        query = query.where(TimeOffRequest.employee_id == employee_id)

    if status_filter:
        query = query.where(TimeOffRequest.status == status_filter)

    query = query.order_by(TimeOffRequest.created_at.desc())
    result = await db.execute(query)
    requests = result.scalars().all()

    return [
        TimeOffRequestResponse(
            id=r.id, employee_id=r.employee_id, start_date=r.start_date,
            end_date=r.end_date, reason=r.reason, status=r.status,
            reviewed_by=r.reviewed_by, reviewed_at=r.reviewed_at, notes=r.notes,
            employee_name=f"{r.employee.first_name} {r.employee.last_name}" if r.employee else None,
            created_at=r.created_at,
        )
        for r in requests
    ]


@router.patch("/requests/{request_id}/review", response_model=TimeOffRequestResponse)
async def review_time_off_request(
    request_id: int,
    data: TimeOffReviewRequest,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TimeOffRequest).options(selectinload(TimeOffRequest.employee))
        .where(TimeOffRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    if req.status != RequestStatus.pending:
        raise HTTPException(status_code=400, detail="Request has already been reviewed")

    req.status = data.status
    req.reviewed_by = current_user.id
    req.reviewed_at = datetime.utcnow()
    req.notes = data.notes
    await db.flush()

    await log_action(
        db, current_user.id, "review_time_off", "time_off_request", req.id,
        new_values={"status": data.status.value},
    )

    # Notify employee
    if req.employee and req.employee.phone:
        dates = f"{req.start_date} to {req.end_date}"
        await notify_time_off_decision(req.employee.phone, data.status.value, dates)

    return TimeOffRequestResponse(
        id=req.id, employee_id=req.employee_id, start_date=req.start_date,
        end_date=req.end_date, reason=req.reason, status=req.status,
        reviewed_by=req.reviewed_by, reviewed_at=req.reviewed_at, notes=req.notes,
        employee_name=f"{req.employee.first_name} {req.employee.last_name}" if req.employee else None,
        created_at=req.created_at,
    )


# --- Unavailability ---

@router.post("/unavailability", response_model=UnavailabilityResponse, status_code=status.HTTP_201_CREATED)
async def create_unavailability(
    data: UnavailabilityCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    req = UnavailabilityRequest(
        employee_id=current_user.id,
        day_of_week=data.day_of_week,
        start_time=data.start_time,
        end_time=data.end_time,
        reason=data.reason,
    )
    db.add(req)
    await db.flush()

    await log_action(db, current_user.id, "create_unavailability", "unavailability_request", req.id)

    return UnavailabilityResponse(
        id=req.id, employee_id=req.employee_id, day_of_week=req.day_of_week,
        start_time=req.start_time, end_time=req.end_time, reason=req.reason,
        status=req.status,
        employee_name=f"{current_user.first_name} {current_user.last_name}",
        created_at=req.created_at,
    )


@router.get("/unavailability", response_model=list[UnavailabilityResponse])
async def list_unavailability(
    employee_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(UnavailabilityRequest).options(selectinload(UnavailabilityRequest.employee))

    if current_user.role == UserRole.employee:
        query = query.where(UnavailabilityRequest.employee_id == current_user.id)
    elif employee_id:
        query = query.where(UnavailabilityRequest.employee_id == employee_id)

    result = await db.execute(query)
    reqs = result.scalars().all()

    return [
        UnavailabilityResponse(
            id=r.id, employee_id=r.employee_id, day_of_week=r.day_of_week,
            start_time=r.start_time, end_time=r.end_time, reason=r.reason,
            status=r.status, reviewed_by=r.reviewed_by, reviewed_at=r.reviewed_at,
            employee_name=f"{r.employee.first_name} {r.employee.last_name}" if r.employee else None,
            created_at=r.created_at,
        )
        for r in reqs
    ]


@router.patch("/unavailability/{request_id}/review", response_model=UnavailabilityResponse)
async def review_unavailability(
    request_id: int,
    data: UnavailabilityReviewRequest,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UnavailabilityRequest).options(selectinload(UnavailabilityRequest.employee))
        .where(UnavailabilityRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    req.status = data.status
    req.reviewed_by = current_user.id
    req.reviewed_at = datetime.utcnow()
    await db.flush()

    await log_action(db, current_user.id, "review_unavailability", "unavailability_request", req.id)

    return UnavailabilityResponse(
        id=req.id, employee_id=req.employee_id, day_of_week=req.day_of_week,
        start_time=req.start_time, end_time=req.end_time, reason=req.reason,
        status=req.status, reviewed_by=req.reviewed_by, reviewed_at=req.reviewed_at,
        employee_name=f"{req.employee.first_name} {req.employee.last_name}" if req.employee else None,
        created_at=req.created_at,
    )
