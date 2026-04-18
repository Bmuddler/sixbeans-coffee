"""Payroll processing: CSV generation, Claude AI validation, hour calculations."""

import csv
import io
from datetime import date, timedelta

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.payroll import PayrollRecord, PayrollStatus
from app.models.time_clock import BreakType, ClockStatus, TimeClock
from app.models.user import User
from app.utils.california_labor import DAILY_OVERTIME_THRESHOLD_HOURS, WEEKLY_OVERTIME_THRESHOLD_HOURS


async def generate_payroll_records(
    db: AsyncSession,
    period_start: date,
    period_end: date,
    location_id: int | None = None,
) -> list[PayrollRecord]:
    """Generate payroll records from time clock entries for a pay period."""
    # Get all completed time clock entries for the period
    query = (
        select(TimeClock)
        .options(selectinload(TimeClock.breaks))
        .where(
            and_(
                TimeClock.status == ClockStatus.clocked_out,
                TimeClock.clock_in >= period_start.isoformat(),
                TimeClock.clock_out <= (period_end + timedelta(days=1)).isoformat(),
            )
        )
    )
    if location_id:
        query = query.where(TimeClock.location_id == location_id)

    result = await db.execute(query)
    entries = result.scalars().all()

    # Group by employee
    employee_entries: dict[int, list[TimeClock]] = {}
    for entry in entries:
        employee_entries.setdefault(entry.employee_id, []).append(entry)

    records = []
    for emp_id, emp_entries in employee_entries.items():
        total_hours = 0.0
        regular_hours = 0.0
        overtime_hours = 0.0
        break_deductions = 0.0

        # Group by date for daily OT calculation
        daily_hours: dict[date, float] = {}
        for entry in emp_entries:
            day = entry.clock_in.date()
            hours = entry.total_hours or 0.0
            daily_hours[day] = daily_hours.get(day, 0.0) + hours
            total_hours += hours

            # Calculate unpaid break deductions
            for brk in entry.breaks:
                if brk.break_type == BreakType.unpaid_30 and brk.end_time:
                    break_deductions += (brk.end_time - brk.start_time).total_seconds() / 3600

        # Calculate daily overtime
        weekly_regular = 0.0
        for day_total in daily_hours.values():
            if day_total > DAILY_OVERTIME_THRESHOLD_HOURS:
                daily_reg = DAILY_OVERTIME_THRESHOLD_HOURS
                daily_ot = day_total - DAILY_OVERTIME_THRESHOLD_HOURS
            else:
                daily_reg = day_total
                daily_ot = 0.0

            weekly_regular += daily_reg
            overtime_hours += daily_ot

        # Weekly overtime (hours over 40 not already counted as daily OT)
        if weekly_regular > WEEKLY_OVERTIME_THRESHOLD_HOURS:
            weekly_ot = weekly_regular - WEEKLY_OVERTIME_THRESHOLD_HOURS
            overtime_hours += weekly_ot
            regular_hours = WEEKLY_OVERTIME_THRESHOLD_HOURS
        else:
            regular_hours = weekly_regular

        record = PayrollRecord(
            employee_id=emp_id,
            period_start=period_start,
            period_end=period_end,
            total_hours=round(total_hours, 2),
            regular_hours=round(regular_hours, 2),
            overtime_hours=round(overtime_hours, 2),
            break_deductions=round(break_deductions, 2),
            status=PayrollStatus.pending_review,
        )
        db.add(record)
        records.append(record)

    await db.flush()
    return records


async def generate_adp_csv(
    db: AsyncSession,
    period_start: date,
    period_end: date,
) -> str:
    """Generate CSV file content compatible with ADP payroll import."""
    result = await db.execute(
        select(PayrollRecord)
        .where(
            and_(
                PayrollRecord.period_start == period_start,
                PayrollRecord.period_end == period_end,
                PayrollRecord.status == PayrollStatus.approved,
            )
        )
    )
    records = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)

    # ADP-compatible header
    writer.writerow([
        "Employee ID",
        "First Name",
        "Last Name",
        "Period Start",
        "Period End",
        "Regular Hours",
        "Overtime Hours",
        "Total Hours",
        "Break Deductions (hrs)",
    ])

    for record in records:
        # Fetch employee info
        emp_result = await db.execute(select(User).where(User.id == record.employee_id))
        emp = emp_result.scalar_one()

        writer.writerow([
            record.employee_id,
            emp.first_name,
            emp.last_name,
            record.period_start.isoformat(),
            record.period_end.isoformat(),
            record.regular_hours,
            record.overtime_hours,
            record.total_hours,
            record.break_deductions,
        ])

    # Mark as exported
    for record in records:
        record.csv_exported = True
    await db.flush()

    return output.getvalue()


async def validate_payroll_with_ai(records_data: list[dict]) -> dict:
    """Stub for Claude AI payroll validation.

    In production, this would call the Anthropic API to review
    payroll data for anomalies, CA labor law violations, etc.
    """
    # Stub response - would integrate with anthropic client
    warnings = []
    corrections = []

    for record in records_data:
        total = record.get("total_hours", 0)
        regular = record.get("regular_hours", 0)
        overtime = record.get("overtime_hours", 0)

        if abs(total - (regular + overtime)) > 0.01:
            corrections.append({
                "employee_id": record.get("employee_id"),
                "issue": "Hours don't add up",
                "expected_total": regular + overtime,
                "reported_total": total,
            })

        if total > 60:
            warnings.append(
                f"Employee {record.get('employee_id')}: {total} hours in period - verify this is correct"
            )

    return {
        "corrections": corrections,
        "warnings": warnings,
        "is_valid": len(corrections) == 0,
    }
