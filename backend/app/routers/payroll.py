from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.payroll import PayrollRecord, PayrollStatus
from app.models.user import User, UserRole
from app.schemas.payroll import (
    PayrollApproveRequest,
    PayrollGenerateRequest,
    PayrollListResponse,
    PayrollRecordResponse,
    PayrollValidationRequest,
    PayrollValidationResponse,
)
from app.services.audit_service import log_action
from app.services.payroll_service import generate_adp_csv, generate_payroll_records, validate_payroll_with_ai

router = APIRouter()


@router.post("/generate", response_model=list[PayrollRecordResponse])
async def api_generate_payroll(
    data: PayrollGenerateRequest,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    records = await generate_payroll_records(db, data.period_start, data.period_end, data.location_id)

    await log_action(
        db, current_user.id, "generate_payroll", "payroll_record", None,
        new_values={
            "period_start": data.period_start.isoformat(),
            "period_end": data.period_end.isoformat(),
            "records_count": len(records),
        },
    )

    # Fetch employee names
    responses = []
    for r in records:
        emp_result = await db.execute(select(User).where(User.id == r.employee_id))
        emp = emp_result.scalar_one_or_none()
        emp_name = f"{emp.first_name} {emp.last_name}" if emp else None
        responses.append(PayrollRecordResponse(
            id=r.id, employee_id=r.employee_id, period_start=r.period_start,
            period_end=r.period_end, total_hours=r.total_hours,
            regular_hours=r.regular_hours, overtime_hours=r.overtime_hours,
            break_deductions=r.break_deductions, status=r.status,
            csv_exported=r.csv_exported, employee_name=emp_name,
            created_at=r.created_at,
        ))

    return responses


@router.get("/", response_model=PayrollListResponse)
async def list_payroll(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    status_filter: PayrollStatus | None = None,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    query = select(PayrollRecord)

    if status_filter:
        query = query.where(PayrollRecord.status == status_filter)

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    query = query.order_by(PayrollRecord.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    records = result.scalars().all()

    responses = []
    for r in records:
        emp_result = await db.execute(select(User).where(User.id == r.employee_id))
        emp = emp_result.scalar_one_or_none()
        emp_name = f"{emp.first_name} {emp.last_name}" if emp else None
        responses.append(PayrollRecordResponse(
            id=r.id, employee_id=r.employee_id, period_start=r.period_start,
            period_end=r.period_end, total_hours=r.total_hours,
            regular_hours=r.regular_hours, overtime_hours=r.overtime_hours,
            break_deductions=r.break_deductions, status=r.status,
            approved_by=r.approved_by, approved_at=r.approved_at,
            csv_exported=r.csv_exported, employee_name=emp_name,
            created_at=r.created_at,
        ))

    return PayrollListResponse(records=responses, total=total, page=page, per_page=per_page)


@router.patch("/{record_id}/approve", response_model=PayrollRecordResponse)
async def approve_payroll(
    record_id: int,
    data: PayrollApproveRequest,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PayrollRecord).where(PayrollRecord.id == record_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Payroll record not found")

    record.status = PayrollStatus.approved
    record.approved_by = current_user.id
    record.approved_at = datetime.utcnow()
    await db.flush()

    await log_action(
        db, current_user.id, "approve_payroll", "payroll_record", record.id,
        notes=data.notes,
    )

    emp_result = await db.execute(select(User).where(User.id == record.employee_id))
    emp = emp_result.scalar_one_or_none()

    return PayrollRecordResponse(
        id=record.id, employee_id=record.employee_id, period_start=record.period_start,
        period_end=record.period_end, total_hours=record.total_hours,
        regular_hours=record.regular_hours, overtime_hours=record.overtime_hours,
        break_deductions=record.break_deductions, status=record.status,
        approved_by=record.approved_by, approved_at=record.approved_at,
        csv_exported=record.csv_exported,
        employee_name=f"{emp.first_name} {emp.last_name}" if emp else None,
        created_at=record.created_at,
    )


@router.post("/export-csv")
async def export_csv(
    data: PayrollGenerateRequest,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    csv_content = await generate_adp_csv(db, data.period_start, data.period_end)

    await log_action(
        db, current_user.id, "export_payroll_csv", "payroll_record", None,
        new_values={"period_start": data.period_start.isoformat(), "period_end": data.period_end.isoformat()},
    )

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=payroll_{data.period_start}_{data.period_end}.csv"},
    )


@router.post("/validate", response_model=PayrollValidationResponse)
async def validate_payroll(
    data: PayrollValidationRequest,
    current_user: User = Depends(require_roles(UserRole.owner)),
):
    result = await validate_payroll_with_ai(data.records)
    return PayrollValidationResponse(**result)
