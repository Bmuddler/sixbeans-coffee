from datetime import datetime

from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    id: int
    user_id: int | None = None
    action: str
    entity_type: str
    entity_id: int | None = None
    old_values: str | None = None
    new_values: str | None = None
    notes: str | None = None
    ip_address: str | None = None
    user_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogListResponse(BaseModel):
    items: list[AuditLogResponse]
    total: int
    page: int
    per_page: int
