import asyncio
import logging
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.location import Location
from app.models.schedule import ScheduledShift, ShiftTemplate
from app.models.user import User, UserRole, user_locations
from app.models.week_status import WeekScheduleStatus
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
from app.services.notification_service import notify_schedule_change, notify_shift_deleted
from app.services.schedule_service import copy_week_schedule, get_unavailable_employees
from app.utils.permissions import require_location_access

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/my-shifts", response_model=list[ScheduledShiftResponse])
async def get_my_shifts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current user's upcoming shifts for the next 14 days."""
    today = date.today()
    end_date = today + timedelta(days=14)

    result = await db.execute(
        select(ScheduledShift)
        .options(selectinload(ScheduledShift.employee), selectinload(ScheduledShift.location))
        .where(
            and_(
                ScheduledShift.employee_id == current_user.id,
                ScheduledShift.date >= today,
                ScheduledShift.date <= end_date,
            )
        )
        .order_by(ScheduledShift.date, ScheduledShift.start_time)
    )
    shifts = result.scalars().all()

    return [
        ScheduledShiftResponse(
            id=s.id,
            template_id=s.template_id,
            location_id=s.location_id,
            employee_id=s.employee_id,
            date=s.date,
            start_time=s.start_time,
            end_time=s.end_time,
            status=s.status,
            manager_notes=s.manager_notes,
            created_at=s.created_at,
            updated_at=s.updated_at,
            employee_name=f"{s.employee.first_name} {s.employee.last_name}" if s.employee else None,
            location_name=s.location.name if s.location else None,
        )
        for s in shifts
    ]


async def _is_week_published(db: AsyncSession, location_id: int, shift_date: date) -> bool:
    week_start = shift_date - timedelta(days=shift_date.weekday())
    result = await db.execute(
        select(WeekScheduleStatus).where(and_(
            WeekScheduleStatus.location_id == location_id,
            WeekScheduleStatus.week_start == week_start,
        ))
    )
    ws = result.scalar_one_or_none()
    return ws is not None and ws.status == "published"


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

    ws_result = await db.execute(
        select(WeekScheduleStatus).where(and_(
            WeekScheduleStatus.location_id == location_id,
            WeekScheduleStatus.week_start == week_start,
        ))
    )
    week_stat = ws_result.scalar_one_or_none()
    return WeekScheduleResponse(
        shifts=responses, total=len(responses),
        week_status=week_stat.status if week_stat else "draft",
        published_at=week_stat.published_at if week_stat else None,
    )


@router.post("/publish")
async def publish_week(
    week_start: date = Query(...),
    location_id: int = Query(...),
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    require_location_access(current_user, location_id)
    now = datetime.utcnow()

    result = await db.execute(
        select(WeekScheduleStatus).where(and_(
            WeekScheduleStatus.location_id == location_id,
            WeekScheduleStatus.week_start == week_start,
        ))
    )
    ws = result.scalar_one_or_none()
    if ws:
        ws.status = "published"
        ws.published_at = now
        ws.published_by = current_user.id
    else:
        ws = WeekScheduleStatus(
            location_id=location_id, week_start=week_start,
            status="published", published_at=now, published_by=current_user.id,
        )
        db.add(ws)

    await db.flush()
    await log_action(db, current_user.id, "publish_schedule", "week_schedule", ws.id,
        new_values={"week_start": week_start.isoformat(), "location_id": location_id})

    # Send SMS notifications to all employees with shifts this week
    week_end = week_start + timedelta(days=6)
    shift_result = await db.execute(
        select(ScheduledShift).options(selectinload(ScheduledShift.employee)).where(and_(
            ScheduledShift.location_id == location_id,
            ScheduledShift.date >= week_start,
            ScheduledShift.date <= week_end,
            ScheduledShift.employee_id.isnot(None),
        ))
    )
    shifts = shift_result.scalars().all()

    loc_result = await db.execute(select(Location.name).where(Location.id == location_id))
    loc_name = loc_result.scalar() or "your location"

    notified_ids = set()
    tasks = []
    for s in shifts:
        if s.employee and s.employee.phone and s.employee_id not in notified_ids:
            notified_ids.add(s.employee_id)
            tasks.append(notify_schedule_change(
                s.employee.phone, f"{s.employee.first_name}",
                "published", week_start, s.start_time, s.end_time,
            ))
    if tasks:
        try:
            asyncio.create_task(asyncio.gather(*tasks, return_exceptions=True))
        except Exception:
            logger.exception("Failed to send publish notifications")

    return {"status": "published", "notified": len(notified_ids)}


@router.post("/unpublish")
async def unpublish_week(
    week_start: date = Query(...),
    location_id: int = Query(...),
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    require_location_access(current_user, location_id)

    result = await db.execute(
        select(WeekScheduleStatus).where(and_(
            WeekScheduleStatus.location_id == location_id,
            WeekScheduleStatus.week_start == week_start,
        ))
    )
    ws = result.scalar_one_or_none()
    if ws:
        ws.status = "draft"
        ws.published_at = None
        ws.published_by = None
        await db.flush()

    await log_action(db, current_user.id, "unpublish_schedule", "week_schedule", ws.id if ws else None)
    return {"status": "draft"}


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

    # Only notify if week is published
    if shift.employee_id and await _is_week_published(db, shift.location_id, shift.date):
        try:
            emp_result = await db.execute(select(User).where(User.id == shift.employee_id))
            employee = emp_result.scalar_one_or_none()
            if employee and employee.phone:
                asyncio.create_task(notify_schedule_change(
                    employee.phone, f"{employee.first_name}",
                    "created", shift.date, shift.start_time, shift.end_time,
                ))
        except Exception:
            logger.exception("Failed to send SMS for new shift %s", shift.id)

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

    # Only notify if week is published
    if shift.employee_id and await _is_week_published(db, shift.location_id, shift.date):
        try:
            # Reload employee if not already loaded
            if not shift.employee:
                emp_result = await db.execute(select(User).where(User.id == shift.employee_id))
                employee = emp_result.scalar_one_or_none()
            else:
                employee = shift.employee
            if employee and employee.phone:
                asyncio.create_task(notify_schedule_change(
                    employee.phone,
                    f"{employee.first_name} {employee.last_name}",
                    "updated",
                    shift.date,
                    shift.start_time,
                    shift.end_time,
                ))
        except Exception:
            logger.exception("Failed to send SMS for updated shift %s", shift.id)

    emp_name = f"{shift.employee.first_name} {shift.employee.last_name}" if shift.employee else None
    return ScheduledShiftResponse(
        id=shift.id, template_id=shift.template_id, location_id=shift.location_id,
        employee_id=shift.employee_id, date=shift.date, start_time=shift.start_time,
        end_time=shift.end_time, status=shift.status, manager_notes=shift.manager_notes,
        created_at=shift.created_at, updated_at=shift.updated_at, employee_name=emp_name,
    )


@router.post("/generate-from-templates", response_model=WeekScheduleResponse)
async def generate_from_templates(
    week_start: date = Query(...),
    location_id: int = Query(...),
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    require_location_access(current_user, location_id)

    result = await db.execute(
        select(ShiftTemplate).where(ShiftTemplate.location_id == location_id)
    )
    templates = result.scalars().all()
    if not templates:
        raise HTTPException(status_code=404, detail="No templates found for this location")

    day_map = {"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}
    new_shifts = []

    for tmpl in templates:
        days_str = (tmpl.days_of_week or "").strip()
        if not days_str:
            target_days = list(range(7))
        else:
            target_days = [day_map[d.strip().lower()] for d in days_str.split(",") if d.strip().lower() in day_map]

        for day_offset in target_days:
            shift_date = week_start + timedelta(days=day_offset)
            existing = await db.execute(
                select(ScheduledShift).where(
                    and_(
                        ScheduledShift.location_id == location_id,
                        ScheduledShift.date == shift_date,
                        ScheduledShift.start_time == tmpl.start_time,
                        ScheduledShift.end_time == tmpl.end_time,
                    )
                )
            )
            if existing.scalar_one_or_none():
                continue

            shift = ScheduledShift(
                template_id=tmpl.id,
                location_id=location_id,
                date=shift_date,
                start_time=tmpl.start_time,
                end_time=tmpl.end_time,
                manager_notes=f"Generated from: {tmpl.name}",
            )
            db.add(shift)
            new_shifts.append(shift)

    await db.flush()
    await log_action(
        db, current_user.id, "generate_from_templates", "scheduled_shift", None,
        new_values={"location_id": location_id, "week_start": week_start.isoformat(), "shifts_created": len(new_shifts)},
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


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift(
    shift_id: int,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ScheduledShift).options(selectinload(ScheduledShift.employee))
        .where(ScheduledShift.id == shift_id)
    )
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    require_location_access(current_user, shift.location_id)

    # Capture shift info before deletion for SMS notification
    deleted_employee = shift.employee
    deleted_date = shift.date

    await db.delete(shift)
    await log_action(db, current_user.id, "delete_shift", "scheduled_shift", shift_id)

    # Only notify if week is published
    if deleted_employee and deleted_employee.phone and await _is_week_published(db, shift.location_id, deleted_date):
        try:
            asyncio.create_task(notify_shift_deleted(
                deleted_employee.phone,
                f"{deleted_employee.first_name} {deleted_employee.last_name}",
                deleted_date,
            ))
        except Exception:
            logger.exception("Failed to send SMS for deleted shift %s", shift_id)


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
