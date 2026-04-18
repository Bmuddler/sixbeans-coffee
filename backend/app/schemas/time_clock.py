from datetime import datetime

from pydantic import BaseModel

from app.models.time_clock import BreakType, ClockStatus


class ClockInRequest(BaseModel):
    location_id: int


class ClockOutRequest(BaseModel):
    pass


class BreakStartRequest(BaseModel):
    break_type: BreakType


class BreakEndRequest(BaseModel):
    pass


class TimeAdjustmentRequest(BaseModel):
    clock_in: datetime | None = None
    clock_out: datetime | None = None
    notes: str  # required for audit trail


class BreakResponse(BaseModel):
    id: int
    break_type: BreakType
    start_time: datetime
    end_time: datetime | None = None

    model_config = {"from_attributes": True}


class TimeClockResponse(BaseModel):
    id: int
    employee_id: int
    location_id: int
    clock_in: datetime
    clock_out: datetime | None = None
    auto_clocked_out: bool
    is_unscheduled: bool = False
    total_hours: float | None = None
    status: ClockStatus
    notes: str | None = None
    breaks: list[BreakResponse] = []
    employee_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TimeClockListResponse(BaseModel):
    items: list[TimeClockResponse]
    total: int
    page: int
    per_page: int
