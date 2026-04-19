from datetime import datetime

from pydantic import BaseModel


class FormSubmissionCreate(BaseModel):
    form_type: str
    form_data: dict


class FormSubmissionResponse(BaseModel):
    id: int
    employee_id: int
    employee_name: str | None = None
    form_type: str
    form_data: dict
    submitted_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
