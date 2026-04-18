from datetime import date, datetime

from pydantic import BaseModel

from app.models.payroll import PayrollStatus


class PayrollGenerateRequest(BaseModel):
    period_start: date
    period_end: date
    location_id: int | None = None  # null = all locations


class PayrollApproveRequest(BaseModel):
    notes: str | None = None


class PayrollValidationRequest(BaseModel):
    records: list[dict]  # list of payroll data for Claude AI validation


class PayrollValidationResponse(BaseModel):
    corrections: list[dict]
    warnings: list[str]
    is_valid: bool


class PayrollRecordResponse(BaseModel):
    id: int
    employee_id: int
    period_start: date
    period_end: date
    total_hours: float
    regular_hours: float
    overtime_hours: float
    break_deductions: float
    status: PayrollStatus
    approved_by: int | None = None
    approved_at: datetime | None = None
    csv_exported: bool
    employee_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PayrollListResponse(BaseModel):
    items: list[PayrollRecordResponse]
    total: int
    page: int
    per_page: int
