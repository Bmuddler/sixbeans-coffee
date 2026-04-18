from datetime import date, datetime, time

from pydantic import BaseModel

from app.models.time_off import RequestStatus


class TimeOffRequestCreate(BaseModel):
    start_date: date
    end_date: date
    reason: str | None = None


class TimeOffReviewRequest(BaseModel):
    status: RequestStatus
    notes: str | None = None


class TimeOffRequestResponse(BaseModel):
    id: int
    employee_id: int
    start_date: date
    end_date: date
    reason: str | None = None
    status: RequestStatus
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    notes: str | None = None
    employee_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UnavailabilityCreate(BaseModel):
    day_of_week: str
    start_time: time | None = None
    end_time: time | None = None
    reason: str | None = None


class UnavailabilityReviewRequest(BaseModel):
    status: RequestStatus


class UnavailabilityResponse(BaseModel):
    id: int
    employee_id: int
    day_of_week: str
    start_time: time | None = None
    end_time: time | None = None
    reason: str | None = None
    status: RequestStatus
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    employee_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
