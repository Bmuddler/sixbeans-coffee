from datetime import date, datetime, time

from pydantic import BaseModel

from app.models.schedule import ShiftStatus


class ShiftTemplateBase(BaseModel):
    location_id: int
    name: str
    start_time: time
    end_time: time
    role_needed: str | None = None
    days_of_week: str | None = None


class ShiftTemplateCreate(ShiftTemplateBase):
    pass


class ShiftTemplateUpdate(BaseModel):
    name: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    role_needed: str | None = None
    days_of_week: str | None = None


class ShiftTemplateResponse(ShiftTemplateBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ScheduledShiftBase(BaseModel):
    template_id: int | None = None
    location_id: int
    employee_id: int | None = None
    date: date
    start_time: time
    end_time: time
    manager_notes: str | None = None


class ScheduledShiftCreate(ScheduledShiftBase):
    pass


class ScheduledShiftUpdate(BaseModel):
    employee_id: int | None = None
    start_time: time | None = None
    end_time: time | None = None
    status: ShiftStatus | None = None
    manager_notes: str | None = None


class ScheduledShiftResponse(ScheduledShiftBase):
    id: int
    status: ShiftStatus
    created_at: datetime
    updated_at: datetime
    employee_name: str | None = None

    model_config = {"from_attributes": True}


class CopyWeekRequest(BaseModel):
    source_week_start: date
    target_week_start: date
    location_id: int


class WeekScheduleResponse(BaseModel):
    shifts: list[ScheduledShiftResponse]
    total: int
    week_status: str = "draft"
    published_at: datetime | None = None
