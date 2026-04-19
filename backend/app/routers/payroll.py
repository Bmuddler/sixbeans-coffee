import csv
import io
from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.location import Location
from app.models.payroll import PayrollRecord, PayrollStatus
from app.models.time_clock import ClockStatus, TimeClock
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
from app.utils.california_labor import DAILY_OVERTIME_THRESHOLD_HOURS, WEEKLY_OVERTIME_THRESHOLD_HOURS

router = APIRouter()

# ADP department codes by location name
ADP_DEPT_MAP = {
    "Six Beans - Apple Valley": "AV",
    "Six Beans - Hesperia": "",
    "Six Beans - Barstow": "BRSTW",
    "Six Beans - Victorville": "VV",
    "Six Beans - Apple Valley (Yucca Loma)": "",
    "Six Beans - Victorville (7th St)": "4",
}



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


# ---------------------------------------------------------------------------
# ADP ##GENERIC## V2.0 export helpers
# ---------------------------------------------------------------------------


def _calculate_ca_overtime(
    entries: list[TimeClock],
    period_start: date,
    period_end: date,
) -> tuple[float, float]:
    """Return (regular_hours, overtime_hours) applying CA daily + weekly OT rules.

    For biweekly periods the weekly OT is computed per calendar week (Mon-Sun).
    """
    # Gather total hours per calendar date
    daily_hours: dict[date, float] = defaultdict(float)
    for entry in entries:
        day = entry.clock_in.date()
        daily_hours[day] += entry.total_hours or 0.0

    # Group dates into ISO weeks (Mon=1 .. Sun=7)
    weeks: dict[int, list[date]] = defaultdict(list)
    for d in sorted(daily_hours):
        weeks[d.isocalendar()[1]].append(d)

    total_regular = 0.0
    total_ot = 0.0

    for _week_num, days in weeks.items():
        week_regular = 0.0
        week_daily_ot = 0.0
        for d in days:
            day_total = daily_hours[d]
            if day_total > DAILY_OVERTIME_THRESHOLD_HOURS:
                daily_reg = DAILY_OVERTIME_THRESHOLD_HOURS
                daily_ot = day_total - DAILY_OVERTIME_THRESHOLD_HOURS
            else:
                daily_reg = day_total
                daily_ot = 0.0
            week_regular += daily_reg
            week_daily_ot += daily_ot

        # Weekly OT: regular hours over 40 not already counted as daily OT
        if week_regular > WEEKLY_OVERTIME_THRESHOLD_HOURS:
            weekly_ot = week_regular - WEEKLY_OVERTIME_THRESHOLD_HOURS
            total_ot += weekly_ot
            total_regular += WEEKLY_OVERTIME_THRESHOLD_HOURS
        else:
            total_regular += week_regular

        total_ot += week_daily_ot

    return round(total_regular, 2), round(total_ot, 2)


async def _build_adp_data(
    db: AsyncSession,
    period_start: date,
    period_end: date,
) -> tuple[list[dict], list[str]]:
    """Compute per-employee hours and return (employees_list, warnings)."""
    query = (
        select(TimeClock)
        .where(
            and_(
                TimeClock.status == ClockStatus.clocked_out,
                TimeClock.clock_in >= datetime.combine(period_start, datetime.min.time()),
                TimeClock.clock_out <= datetime.combine(period_end + timedelta(days=1), datetime.min.time()),
            )
        )
    )
    result = await db.execute(query)
    entries = result.scalars().all()

    # Group by employee
    employee_entries: dict[int, list[TimeClock]] = defaultdict(list)
    for entry in entries:
        employee_entries[entry.employee_id].append(entry)

    # Fetch all relevant users
    emp_ids = list(employee_entries.keys())
    if not emp_ids:
        return [], []
    users_result = await db.execute(select(User).where(User.id.in_(emp_ids)))
    users_by_id: dict[int, User] = {u.id: u for u in users_result.scalars().all()}

    # Build location lookup for department codes
    loc_ids = set()
    for entries_list in employee_entries.values():
        for entry in entries_list:
            if entry.location_id:
                loc_ids.add(entry.location_id)
    locations_by_id: dict[int, str] = {}
    if loc_ids:
        loc_result = await db.execute(select(Location).where(Location.id.in_(list(loc_ids))))
        for loc in loc_result.scalars().all():
            locations_by_id[loc.id] = loc.name

    employees = []
    warnings = []

    for emp_id, emp_entries in sorted(employee_entries.items()):
        user = users_by_id.get(emp_id)
        if not user:
            continue

        reg, ot = _calculate_ca_overtime(emp_entries, period_start, period_end)
        name = f"{user.first_name} {user.last_name}"

        if not user.adp_employee_code:
            warnings.append(f"{name} (no ADP code)")

        # Determine primary location (most clock-ins)
        loc_counts: dict[int, int] = defaultdict(int)
        for entry in emp_entries:
            if entry.location_id:
                loc_counts[entry.location_id] += 1
        primary_loc_id = max(loc_counts, key=loc_counts.get) if loc_counts else None
        loc_name = locations_by_id.get(primary_loc_id, "") if primary_loc_id else ""
        dept_code = ADP_DEPT_MAP.get(loc_name, "")

        if not dept_code and loc_name:
            warnings.append(f"{name} — location '{loc_name}' has no ADP department code")

        employees.append({
            "name": name,
            "adp_code": user.adp_employee_code or "",
            "department": dept_code,
            "location": loc_name,
            "regular_hours": reg,
            "overtime_hours": ot,
            "total_hours": round(reg + ot, 2),
        })

    return employees, warnings


@router.get("/adp-preview")
async def adp_preview(
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Preview ADP export data as JSON."""
    employees, warnings = await _build_adp_data(db, period_start, period_end)

    return {
        "period_start": period_start.strftime("%m/%d/%Y"),
        "period_end": period_end.strftime("%m/%d/%Y"),
        "employees": employees,
        "warnings": warnings,
        "total_regular": round(sum(e["regular_hours"] for e in employees), 2),
        "total_overtime": round(sum(e["overtime_hours"] for e in employees), 2),
    }


@router.get("/adp-export")
async def adp_export(
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Generate ADP ##GENERIC## V2.0 CSV and return as downloadable file."""
    employees, warnings = await _build_adp_data(db, period_start, period_end)

    output = io.StringIO()
    writer = csv.writer(output)

    # ADP generic header row
    writer.writerow(["##GENERIC## V2.0", "", "", "", "", "", "", "", "", "", "", ""])
    # Column header row
    writer.writerow([
        "IID", "Pay Frequency", "Pay Period Start", "Pay Period End",
        "Employee Id", "Earnings Code", "Pay Hours", "Dollars",
        "Separate Check", "Department Number", "Rate Code", "Job Code",
    ])

    ps_str = period_start.strftime("%m/%d/%Y")
    pe_str = period_end.strftime("%m/%d/%Y")

    for emp in employees:
        if not emp["adp_code"]:
            continue  # skip employees without ADP code

        dept = emp.get("department", "")

        # Regular hours row
        if emp["regular_hours"] > 0:
            writer.writerow([
                "", "B", ps_str, pe_str,
                emp["adp_code"], "REG", f"{emp['regular_hours']:.2f}", "",
                "", dept, "", "",
            ])

        # Overtime hours row
        if emp["overtime_hours"] > 0:
            writer.writerow([
                "", "B", ps_str, pe_str,
                emp["adp_code"], "OT", f"{emp['overtime_hours']:.2f}", "",
                "", dept, "", "",
            ])

    await log_action(
        db, current_user.id, "export_adp_csv", "payroll_record", None,
        new_values={"period_start": period_start.isoformat(), "period_end": period_end.isoformat()},
    )

    csv_content = output.getvalue()
    filename = f"adp_payroll_{period_start.isoformat()}_{period_end.isoformat()}.csv"

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-ADP-Warnings": "; ".join(warnings) if warnings else "",
        },
    )
