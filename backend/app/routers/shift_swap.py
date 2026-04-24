import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.schedule import ScheduledShift
from app.models.shift_swap import ShiftCoverageRequest, ShiftSwapRequest, SwapStatus
from app.models.user import User, UserRole
from app.schemas.shift_swap import (
    CoverageClaimRequest,
    CoverageRequestCreate,
    CoverageRequestResponse,
    CoverageReviewRequest,
    ShiftSwapCreate,
    ShiftSwapResponse,
    ShiftSwapReviewRequest,
)
from app.services.audit_service import log_action
from app.utils.permissions import can_manage_location, require_location_access
from app.services.notification_service import (
    notify_shift_swap_request,
    notify_shift_swap_decision,
    notify_coverage_posted,
    notify_coverage_claimed,
    notify_coverage_decision,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# --- Shift Swap ---

@router.post("/swap", response_model=ShiftSwapResponse, status_code=status.HTTP_201_CREATED)
async def create_swap_request(
    data: ShiftSwapCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify requesting shift belongs to current user
    result = await db.execute(
        select(ScheduledShift).where(ScheduledShift.id == data.requesting_shift_id)
    )
    req_shift = result.scalar_one_or_none()
    if not req_shift or req_shift.employee_id != current_user.id:
        raise HTTPException(status_code=400, detail="Requesting shift not found or not yours")

    # Verify target shift belongs to target employee
    result = await db.execute(
        select(ScheduledShift).where(ScheduledShift.id == data.target_shift_id)
    )
    target_shift = result.scalar_one_or_none()
    if not target_shift or target_shift.employee_id != data.target_employee_id:
        raise HTTPException(status_code=400, detail="Target shift not found or not assigned to target employee")

    swap = ShiftSwapRequest(
        requesting_employee_id=current_user.id,
        target_employee_id=data.target_employee_id,
        requesting_shift_id=data.requesting_shift_id,
        target_shift_id=data.target_shift_id,
        notes=data.notes,
    )
    db.add(swap)
    await db.flush()

    await log_action(db, current_user.id, "create_swap_request", "shift_swap_request", swap.id)

    # Notify target employee via SMS
    try:
        result = await db.execute(select(User).where(User.id == data.target_employee_id))
        target_user = result.scalar_one_or_none()
        if target_user and target_user.phone:
            asyncio.create_task(notify_shift_swap_request(
                target_user.phone,
                f"{current_user.first_name} {current_user.last_name}",
                req_shift.date,
            ))
    except Exception:
        logger.exception("Failed to send SMS for swap request %s", swap.id)

    return ShiftSwapResponse(
        id=swap.id, requesting_employee_id=swap.requesting_employee_id,
        target_employee_id=swap.target_employee_id,
        requesting_shift_id=swap.requesting_shift_id,
        target_shift_id=swap.target_shift_id, status=swap.status,
        notes=swap.notes,
        requesting_employee_name=f"{current_user.first_name} {current_user.last_name}",
        created_at=swap.created_at,
    )


@router.get("/swap", response_model=list[ShiftSwapResponse])
async def list_swap_requests(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(ShiftSwapRequest).options(
        selectinload(ShiftSwapRequest.requesting_employee),
        selectinload(ShiftSwapRequest.target_employee),
    )

    if current_user.role == UserRole.employee:
        query = query.where(
            or_(
                ShiftSwapRequest.requesting_employee_id == current_user.id,
                ShiftSwapRequest.target_employee_id == current_user.id,
            )
        )

    query = query.order_by(ShiftSwapRequest.created_at.desc())
    result = await db.execute(query)
    swaps = result.scalars().all()

    return [
        ShiftSwapResponse(
            id=s.id, requesting_employee_id=s.requesting_employee_id,
            target_employee_id=s.target_employee_id,
            requesting_shift_id=s.requesting_shift_id,
            target_shift_id=s.target_shift_id, status=s.status,
            reviewed_by=s.reviewed_by, reviewed_at=s.reviewed_at, notes=s.notes,
            requesting_employee_name=f"{s.requesting_employee.first_name} {s.requesting_employee.last_name}" if s.requesting_employee else None,
            target_employee_name=f"{s.target_employee.first_name} {s.target_employee.last_name}" if s.target_employee else None,
            created_at=s.created_at,
        )
        for s in swaps
    ]


@router.patch("/swap/{swap_id}/review", response_model=ShiftSwapResponse)
async def review_swap_request(
    swap_id: int,
    data: ShiftSwapReviewRequest,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ShiftSwapRequest).options(
            selectinload(ShiftSwapRequest.requesting_employee),
            selectinload(ShiftSwapRequest.target_employee),
        ).where(ShiftSwapRequest.id == swap_id)
    )
    swap = result.scalar_one_or_none()
    if not swap:
        raise HTTPException(status_code=404, detail="Swap request not found")

    if swap.status != SwapStatus.pending:
        raise HTTPException(status_code=400, detail="Request already reviewed")

    # Scope manager access to shifts they actually manage — either the
    # requesting or the target shift must live at one of their locations.
    shift_locs = (await db.execute(
        select(ScheduledShift.location_id).where(
            ScheduledShift.id.in_([swap.requesting_shift_id, swap.target_shift_id])
        )
    )).scalars().all()
    if shift_locs and not any(can_manage_location(current_user, lid) for lid in shift_locs):
        raise HTTPException(status_code=403, detail="You do not have access to this shift")

    swap.status = data.status
    swap.reviewed_by = current_user.id
    swap.reviewed_at = datetime.utcnow()
    swap.notes = data.notes

    # If approved, actually swap the employees on the shifts
    if data.status == SwapStatus.approved:
        req_shift = await db.execute(select(ScheduledShift).where(ScheduledShift.id == swap.requesting_shift_id))
        tgt_shift = await db.execute(select(ScheduledShift).where(ScheduledShift.id == swap.target_shift_id))
        req_shift = req_shift.scalar_one()
        tgt_shift = tgt_shift.scalar_one()
        req_shift.employee_id, tgt_shift.employee_id = tgt_shift.employee_id, req_shift.employee_id

    await db.flush()
    await log_action(db, current_user.id, "review_swap", "shift_swap_request", swap.id)

    # Notify requester about swap decision
    try:
        if swap.requesting_employee and swap.requesting_employee.phone:
            # Look up the requesting shift date for the notification
            req_shift_result = await db.execute(
                select(ScheduledShift).where(ScheduledShift.id == swap.requesting_shift_id)
            )
            req_shift = req_shift_result.scalar_one_or_none()
            shift_date = req_shift.date if req_shift else None
            if shift_date:
                asyncio.create_task(notify_shift_swap_decision(
                    swap.requesting_employee.phone,
                    f"{swap.requesting_employee.first_name} {swap.requesting_employee.last_name}",
                    data.status.value,
                    shift_date,
                ))
    except Exception:
        logger.exception("Failed to send SMS for swap review %s", swap.id)

    return ShiftSwapResponse(
        id=swap.id, requesting_employee_id=swap.requesting_employee_id,
        target_employee_id=swap.target_employee_id,
        requesting_shift_id=swap.requesting_shift_id,
        target_shift_id=swap.target_shift_id, status=swap.status,
        reviewed_by=swap.reviewed_by, reviewed_at=swap.reviewed_at, notes=swap.notes,
        requesting_employee_name=f"{swap.requesting_employee.first_name} {swap.requesting_employee.last_name}" if swap.requesting_employee else None,
        target_employee_name=f"{swap.target_employee.first_name} {swap.target_employee.last_name}" if swap.target_employee else None,
        created_at=swap.created_at,
    )


# --- Coverage Requests ---

@router.post("/coverage", response_model=CoverageRequestResponse, status_code=status.HTTP_201_CREATED)
async def create_coverage_request(
    data: CoverageRequestCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScheduledShift).where(ScheduledShift.id == data.shift_id))
    shift = result.scalar_one_or_none()
    if not shift or shift.employee_id != current_user.id:
        raise HTTPException(status_code=400, detail="Shift not found or not yours")

    coverage = ShiftCoverageRequest(
        shift_id=data.shift_id,
        posting_employee_id=current_user.id,
        notes=data.notes,
    )
    db.add(coverage)
    await db.flush()

    await log_action(db, current_user.id, "create_coverage_request", "shift_coverage_request", coverage.id)

    # Notify coworkers at the same location about coverage availability
    try:
        from app.models.user import user_locations
        loc_result = await db.execute(
            select(user_locations.c.user_id).where(user_locations.c.location_id == shift.location_id)
        )
        coworker_ids = [row[0] for row in loc_result.all() if row[0] != current_user.id]
        if coworker_ids:
            coworker_result = await db.execute(select(User).where(User.id.in_(coworker_ids)))
            coworkers = coworker_result.scalars().all()
            poster_name = f"{current_user.first_name} {current_user.last_name}"
            tasks = [
                notify_coverage_posted(u.phone, poster_name, shift.date, shift.start_time)
                for u in coworkers if u.phone
            ]
            if tasks:
                asyncio.create_task(asyncio.gather(*tasks, return_exceptions=True))
    except Exception:
        logger.exception("Failed to send SMS for coverage request %s", coverage.id)

    return CoverageRequestResponse(
        id=coverage.id, shift_id=coverage.shift_id,
        posting_employee_id=coverage.posting_employee_id,
        status=coverage.status, notes=coverage.notes,
        posting_employee_name=f"{current_user.first_name} {current_user.last_name}",
        created_at=coverage.created_at,
    )


@router.get("/coverage", response_model=list[CoverageRequestResponse])
async def list_coverage_requests(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(ShiftCoverageRequest)
        .options(
            selectinload(ShiftCoverageRequest.posting_employee),
            selectinload(ShiftCoverageRequest.claiming_employee),
        )
        .where(ShiftCoverageRequest.status == SwapStatus.pending)
        .order_by(ShiftCoverageRequest.created_at.desc())
    )
    result = await db.execute(query)
    requests = result.scalars().all()

    return [
        CoverageRequestResponse(
            id=r.id, shift_id=r.shift_id, posting_employee_id=r.posting_employee_id,
            claiming_employee_id=r.claiming_employee_id, status=r.status,
            reviewed_by=r.reviewed_by, reviewed_at=r.reviewed_at, notes=r.notes,
            posting_employee_name=f"{r.posting_employee.first_name} {r.posting_employee.last_name}" if r.posting_employee else None,
            claiming_employee_name=f"{r.claiming_employee.first_name} {r.claiming_employee.last_name}" if r.claiming_employee else None,
            created_at=r.created_at,
        )
        for r in requests
    ]


@router.post("/coverage/{coverage_id}/claim", response_model=CoverageRequestResponse)
async def claim_coverage(
    coverage_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Row-lock the posting so two employees hitting "Claim" at the same
    # instant can't both succeed — whoever gets the lock first wins, the
    # second sees claiming_employee_id already set and is rejected.
    result = await db.execute(
        select(ShiftCoverageRequest)
        .where(ShiftCoverageRequest.id == coverage_id)
        .with_for_update()
    )
    coverage = result.scalar_one_or_none()
    if not coverage:
        raise HTTPException(status_code=404, detail="Coverage request not found")

    if coverage.status != SwapStatus.pending:
        raise HTTPException(status_code=400, detail="Coverage request no longer available")

    if coverage.claiming_employee_id is not None:
        raise HTTPException(status_code=409, detail="Someone else already claimed this shift")

    if coverage.posting_employee_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot claim your own coverage request")

    # Refuse claims that would put the claimer on two overlapping shifts.
    cov_shift_row = (await db.execute(
        select(ScheduledShift).where(ScheduledShift.id == coverage.shift_id)
    )).scalar_one_or_none()
    if cov_shift_row:
        conflicts = (await db.execute(
            select(ScheduledShift).where(
                ScheduledShift.employee_id == current_user.id,
                ScheduledShift.date == cov_shift_row.date,
                ScheduledShift.start_time < cov_shift_row.end_time,
                ScheduledShift.end_time > cov_shift_row.start_time,
            )
        )).scalars().all()
        if conflicts:
            raise HTTPException(
                status_code=400,
                detail="You already have a shift that overlaps this one.",
            )

    coverage.claiming_employee_id = current_user.id
    await db.flush()

    await log_action(db, current_user.id, "claim_coverage", "shift_coverage_request", coverage.id)

    # Notify poster that their shift has been claimed
    try:
        poster_result = await db.execute(select(User).where(User.id == coverage.posting_employee_id))
        poster = poster_result.scalar_one_or_none()
        if poster and poster.phone:
            shift_result = await db.execute(select(ScheduledShift).where(ScheduledShift.id == coverage.shift_id))
            cov_shift = shift_result.scalar_one_or_none()
            if cov_shift:
                asyncio.create_task(notify_coverage_claimed(
                    poster.phone,
                    f"{poster.first_name} {poster.last_name}",
                    f"{current_user.first_name} {current_user.last_name}",
                    cov_shift.date,
                ))
    except Exception:
        logger.exception("Failed to send SMS for coverage claim %s", coverage.id)

    return CoverageRequestResponse(
        id=coverage.id, shift_id=coverage.shift_id,
        posting_employee_id=coverage.posting_employee_id,
        claiming_employee_id=coverage.claiming_employee_id,
        status=coverage.status, notes=coverage.notes,
        claiming_employee_name=f"{current_user.first_name} {current_user.last_name}",
        created_at=coverage.created_at,
    )


@router.patch("/coverage/{coverage_id}/review", response_model=CoverageRequestResponse)
async def review_coverage(
    coverage_id: int,
    data: CoverageReviewRequest,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ShiftCoverageRequest)
        .options(
            selectinload(ShiftCoverageRequest.posting_employee),
            selectinload(ShiftCoverageRequest.claiming_employee),
        )
        .where(ShiftCoverageRequest.id == coverage_id)
    )
    coverage = result.scalar_one_or_none()
    if not coverage:
        raise HTTPException(status_code=404, detail="Coverage request not found")

    # Scope manager access to the shift's location.
    cov_shift_loc = (await db.execute(
        select(ScheduledShift.location_id).where(ScheduledShift.id == coverage.shift_id)
    )).scalar_one_or_none()
    if cov_shift_loc is not None:
        require_location_access(current_user, cov_shift_loc)

    coverage.status = data.status
    coverage.reviewed_by = current_user.id
    coverage.reviewed_at = datetime.utcnow()
    coverage.notes = data.notes

    # If approved and claimed, reassign the shift
    if data.status == SwapStatus.approved and coverage.claiming_employee_id:
        shift_result = await db.execute(select(ScheduledShift).where(ScheduledShift.id == coverage.shift_id))
        shift = shift_result.scalar_one()
        shift.employee_id = coverage.claiming_employee_id

    await db.flush()
    await log_action(db, current_user.id, "review_coverage", "shift_coverage_request", coverage.id)

    # Notify poster and claimer about coverage decision
    try:
        shift_result = await db.execute(select(ScheduledShift).where(ScheduledShift.id == coverage.shift_id))
        cov_shift = shift_result.scalar_one_or_none()
        shift_date = cov_shift.date if cov_shift else None
        if shift_date:
            sms_tasks = []
            if coverage.posting_employee and coverage.posting_employee.phone:
                sms_tasks.append(notify_coverage_decision(
                    coverage.posting_employee.phone,
                    f"{coverage.posting_employee.first_name} {coverage.posting_employee.last_name}",
                    data.status.value,
                    shift_date,
                ))
            if coverage.claiming_employee and coverage.claiming_employee.phone:
                sms_tasks.append(notify_coverage_decision(
                    coverage.claiming_employee.phone,
                    f"{coverage.claiming_employee.first_name} {coverage.claiming_employee.last_name}",
                    data.status.value,
                    shift_date,
                ))
            if sms_tasks:
                asyncio.create_task(asyncio.gather(*sms_tasks, return_exceptions=True))
    except Exception:
        logger.exception("Failed to send SMS for coverage review %s", coverage.id)

    return CoverageRequestResponse(
        id=coverage.id, shift_id=coverage.shift_id,
        posting_employee_id=coverage.posting_employee_id,
        claiming_employee_id=coverage.claiming_employee_id,
        status=coverage.status, reviewed_by=coverage.reviewed_by,
        reviewed_at=coverage.reviewed_at, notes=coverage.notes,
        posting_employee_name=f"{coverage.posting_employee.first_name} {coverage.posting_employee.last_name}" if coverage.posting_employee else None,
        claiming_employee_name=f"{coverage.claiming_employee.first_name} {coverage.claiming_employee.last_name}" if coverage.claiming_employee else None,
        created_at=coverage.created_at,
    )
