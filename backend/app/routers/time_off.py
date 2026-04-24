import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.schedule import ScheduledShift
from app.models.time_off import RequestStatus, TimeOffRequest, UnavailabilityRequest
from app.models.user import User, UserRole, user_locations
from app.schemas.time_off import (
    TimeOffRequestCreate,
    TimeOffRequestResponse,
    TimeOffReviewRequest,
    UnavailabilityCreate,
    UnavailabilityResponse,
    UnavailabilityReviewRequest,
)
from app.services.audit_service import log_action
from app.services.notification_service import notify_time_off_decision, notify_time_off_submitted, send_sms
from app.utils.permissions import require_employee_access

logger = logging.getLogger(__name__)

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
        start_time=data.start_time,
        end_time=data.end_time,
        reason=data.reason,
    )
    db.add(req)
    await db.flush()

    await log_action(db, current_user.id, "create_time_off_request", "time_off_request", req.id)

    # Notify managers at the employee's locations about the time off request
    try:
        loc_ids_result = await db.execute(
            select(user_locations.c.location_id).where(user_locations.c.user_id == current_user.id)
        )
        loc_ids = [row[0] for row in loc_ids_result.all()]
        if loc_ids:
            manager_result = await db.execute(
                select(User).where(
                    User.id.in_(
                        select(user_locations.c.user_id).where(user_locations.c.location_id.in_(loc_ids))
                    ),
                    User.role.in_([UserRole.manager, UserRole.owner]),
                )
            )
            managers = manager_result.scalars().all()
            employee_name = f"{current_user.first_name} {current_user.last_name}"
            tasks = [
                notify_time_off_submitted(
                    m.phone,
                    f"{m.first_name} {m.last_name}",
                    employee_name,
                    req.start_date,
                    req.end_date,
                )
                for m in managers if m.phone
            ]
            if tasks:
                asyncio.create_task(asyncio.gather(*tasks, return_exceptions=True))
    except Exception:
        logger.exception("Failed to send SMS for time off request %s", req.id)

    return TimeOffRequestResponse(
        id=req.id, employee_id=req.employee_id, start_date=req.start_date,
        end_date=req.end_date, start_time=getattr(req, 'start_time', None), end_time=getattr(req, 'end_time', None),
        reason=req.reason, status=req.status,
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
            end_date=r.end_date, start_time=getattr(r, 'start_time', None), end_time=getattr(r, 'end_time', None),
            reason=r.reason, status=r.status,
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
        select(TimeOffRequest).options(
            selectinload(TimeOffRequest.employee).selectinload(User.locations)
        ).where(TimeOffRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.employee:
        require_employee_access(current_user, req.employee)

    if req.status != RequestStatus.pending:
        raise HTTPException(status_code=400, detail="Request has already been reviewed")

    req.status = data.status
    req.reviewed_by = current_user.id
    req.reviewed_at = datetime.utcnow()
    req.notes = data.notes

    # On approval, unassign any of this employee's shifts that fall inside
    # the time-off window so the dashboard doesn't flag them as "scheduled
    # not clocked in" and payroll doesn't double-count scheduled hours
    # that the employee isn't going to work.
    unassigned_shift_ids: list[int] = []
    if data.status == RequestStatus.approved:
        shift_rows = (await db.execute(
            select(ScheduledShift).where(
                ScheduledShift.employee_id == req.employee_id,
                ScheduledShift.date >= req.start_date,
                ScheduledShift.date <= req.end_date,
            )
        )).scalars().all()
        for s in shift_rows:
            s.employee_id = None
            unassigned_shift_ids.append(s.id)

    await db.flush()

    await log_action(
        db, current_user.id, "review_time_off", "time_off_request", req.id,
        new_values={
            "status": data.status.value,
            "unassigned_shift_ids": unassigned_shift_ids,
        },
    )

    # Notify employee about decision via SMS
    try:
        if req.employee and req.employee.phone:
            asyncio.create_task(notify_time_off_decision(
                req.employee.phone,
                f"{req.employee.first_name} {req.employee.last_name}",
                data.status.value,
                req.start_date,
                req.end_date,
            ))
    except Exception:
        logger.exception("Failed to send SMS for time off review %s", req.id)

    return TimeOffRequestResponse(
        id=req.id, employee_id=req.employee_id, start_date=req.start_date,
        end_date=req.end_date, start_time=getattr(req, 'start_time', None), end_time=getattr(req, 'end_time', None),
        reason=req.reason, status=req.status,
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

    # Notify managers about the unavailability request
    try:
        loc_ids_result = await db.execute(
            select(user_locations.c.location_id).where(user_locations.c.user_id == current_user.id)
        )
        loc_ids = [row[0] for row in loc_ids_result.all()]
        if loc_ids:
            manager_result = await db.execute(
                select(User).where(
                    User.id.in_(
                        select(user_locations.c.user_id).where(user_locations.c.location_id.in_(loc_ids))
                    ),
                    User.role.in_([UserRole.manager, UserRole.owner]),
                    User.is_active.is_(True),
                )
            )
            managers = manager_result.scalars().all()
            emp_name = f"{current_user.first_name} {current_user.last_name}"
            tasks = [
                send_sms(
                    m.phone,
                    f"Six Beans: {emp_name} submitted an unavailability request for {req.day_of_week}. Log in to review.",
                )
                for m in managers if m.phone and m.id != current_user.id
            ]
            if tasks:
                asyncio.create_task(asyncio.gather(*tasks, return_exceptions=True))
    except Exception:
        logger.exception("Failed to send SMS for unavailability request %s", req.id)

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
        select(UnavailabilityRequest).options(
            selectinload(UnavailabilityRequest.employee).selectinload(User.locations)
        ).where(UnavailabilityRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.employee:
        require_employee_access(current_user, req.employee)

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
