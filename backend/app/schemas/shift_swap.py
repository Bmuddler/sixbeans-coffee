from datetime import datetime

from pydantic import BaseModel

from app.models.shift_swap import SwapStatus


class ShiftSwapCreate(BaseModel):
    target_employee_id: int
    requesting_shift_id: int
    target_shift_id: int
    notes: str | None = None


class ShiftSwapReviewRequest(BaseModel):
    status: SwapStatus
    notes: str | None = None


class ShiftSwapResponse(BaseModel):
    id: int
    requesting_employee_id: int
    target_employee_id: int
    requesting_shift_id: int
    target_shift_id: int
    status: SwapStatus
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    notes: str | None = None
    requesting_employee_name: str | None = None
    target_employee_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CoverageRequestCreate(BaseModel):
    shift_id: int
    notes: str | None = None


class CoverageClaimRequest(BaseModel):
    pass


class CoverageReviewRequest(BaseModel):
    status: SwapStatus
    notes: str | None = None


class CoverageRequestResponse(BaseModel):
    id: int
    shift_id: int
    posting_employee_id: int
    claiming_employee_id: int | None = None
    status: SwapStatus
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    notes: str | None = None
    posting_employee_name: str | None = None
    claiming_employee_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
