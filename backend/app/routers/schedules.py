from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.schedule import ScheduledShift, ShiftTemplate
from app.models.user import User, UserRole
from app.schemas.schedule import (
    CopyWeekRequest,
    ScheduledShiftCreate,
    ScheduledShiftResponse,
    ScheduledShiftUpdate,
    ShiftTemplateCreate,
    ShiftTemplateResponse,
    ShiftTemplateUpdate,
    WeekScheduleResponse,
)
from app.services.audit_service import log_action
from app.services.schedule_service import copy_week_schedule, get_unavailable_employees
from app.utils.permissions import require_location_access

router = APIRouter()


# --- Shift Templates ---

@router.get("/templates", response_model=list[ShiftTemplateResponse])
async def list_templates(
    location_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(ShiftTemplate)
    if location_id:
        query = query.where(ShiftTemplate.location_id == location_id)
    result = await db.execute(query)
    return [ShiftTemplateResponse.model_validate(t) for t in result.scalars().all()]


@router.post("/templates", response_model=ShiftTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    data: ShiftTemplateCreate,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    require_location_access(current_user, data.location_id)
    template = ShiftTemplate(**data.model_dump())
    db.add(template)
    await db.flush()

    await log_action(db, current_user.id, "create_template", "shift_template", template.id)
    return ShiftTemplateResponse.model_validate(template)


@router.patch("/templates/{template_id}", response_model=ShiftTemplateResponse)
async def update_template(
    template_id: int,
    data: ShiftTemplateUpdate,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ShiftTemplate).where(ShiftTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    require_location_access(current_user, template.location_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(template, field, value)
    await db.flush()

    await log_action(db, current_user.id, "update_template", "shift_template", template.id)
    return ShiftTemplateResponse.model_validate(template)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: int,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ShiftTemplate).where(ShiftTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    require_location_access(current_user, template.location_id)
    await db.delete(template)
    await log_action(db, current_user.id, "delete_template", "shift_template", template.id)


# --- Scheduled Shifts ---

@router.get("/week", response_model=WeekScheduleResponse)
async def get_week_schedule(
    week_start: date = Query(...),
    location_id: int = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    week_end = week_start + timedelta(days=6)
    result = await db.execute(
        select(ScheduledShift)
        .options(selectinload(ScheduledShift.employee))
        .where(
            and_(
                ScheduledShift.location_id == location_id,
                ScheduledShift.date >= week_start,
                ScheduledShift.date <= week_end,
            )
        )
        .order_by(ScheduledShift.date, ScheduledShift.start_time)
    )
    shifts = result.scalars().all()

    # Get unavailable employees for availability info
    unavailable_by_date = {}
    for d in range(7):
        target = week_start + timedelta(days=d)
        unavailable_by_date[target] = await get_unavailable_employees(db, target, location_id)

    responses = []
    for s in shifts:
        emp_name = f"{s.employee.first_name} {s.employee.last_name}" if s.employee else None
        responses.append(ScheduledShiftResponse(
            id=s.id, template_id=s.template_id, location_id=s.location_id,
            employee_id=s.employee_id, date=s.date, start_time=s.start_time,
            end_time=s.end_time, status=s.status, manager_notes=s.manager_notes,
            created_at=s.created_at, updated_at=s.updated_at, employee_name=emp_name,
        ))

    return WeekScheduleResponse(shifts=responses, total=len(responses))


@router.post("/shifts", response_model=ScheduledShiftResponse, status_code=status.HTTP_201_CREATED)
async def create_shift(
    data: ScheduledShiftCreate,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    require_location_access(current_user, data.location_id)

    shift = ScheduledShift(**data.model_dump())
    db.add(shift)
    await db.flush()

    await log_action(db, current_user.id, "create_shift", "scheduled_shift", shift.id)
    return ScheduledShiftResponse(
        id=shift.id, template_id=shift.template_id, location_id=shift.location_id,
        employee_id=shift.employee_id, date=shift.date, start_time=shift.start_time,
        end_time=shift.end_time, status=shift.status, manager_notes=shift.manager_notes,
        created_at=shift.created_at, updated_at=shift.updated_at,
    )


@router.patch("/shifts/{shift_id}", response_model=ScheduledShiftResponse)
async def update_shift(
    shift_id: int,
    data: ScheduledShiftUpdate,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ScheduledShift).options(selectinload(ScheduledShift.employee)).where(ScheduledShift.id == shift_id)
    )
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    require_location_access(current_user, shift.location_id)

    old_values = {"employee_id": shift.employee_id, "status": shift.status.value if shift.status else None}
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(shift, field, value)
    await db.flush()

    await log_action(
        db, current_user.id, "update_shift", "scheduled_shift", shift.id,
        old_values=old_values,
    )

    emp_name = f"{shift.employee.first_name} {shift.employee.last_name}" if shift.employee else None
    return ScheduledShiftResponse(
        id=shift.id, template_id=shift.template_id, location_id=shift.location_id,
        employee_id=shift.employee_id, date=shift.date, start_time=shift.start_time,
        end_time=shift.end_time, status=shift.status, manager_notes=shift.manager_notes,
        created_at=shift.created_at, updated_at=shift.updated_at, employee_name=emp_name,
    )


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift(
    shift_id: int,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScheduledShift).where(ScheduledShift.id == shift_id))
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    require_location_access(current_user, shift.location_id)
    await db.delete(shift)
    await log_action(db, current_user.id, "delete_shift", "scheduled_shift", shift_id)


@router.post("/copy-week", response_model=WeekScheduleResponse)
async def copy_week(
    data: CopyWeekRequest,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    require_location_access(current_user, data.location_id)

    new_shifts = await copy_week_schedule(
        db, data.source_week_start, data.target_week_start, data.location_id
    )

    await log_action(
        db, current_user.id, "copy_week", "scheduled_shift", None,
        new_values={
            "source_week": data.source_week_start.isoformat(),
            "target_week": data.target_week_start.isoformat(),
            "location_id": data.location_id,
            "shifts_copied": len(new_shifts),
        },
    )

    responses = [
        ScheduledShiftResponse(
            id=s.id, template_id=s.template_id, location_id=s.location_id,
            employee_id=s.employee_id, date=s.date, start_time=s.start_time,
            end_time=s.end_time, status=s.status, manager_notes=s.manager_notes,
            created_at=s.created_at, updated_at=s.updated_at,
        )
        for s in new_shifts
    ]
    return WeekScheduleResponse(shifts=responses, total=len(responses))
