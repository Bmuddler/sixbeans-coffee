from datetime import datetime

from pydantic import BaseModel


class MessageCreate(BaseModel):
    location_id: int | None = None
    content: str
    is_announcement: bool = False


class MessageResponse(BaseModel):
    id: int
    sender_id: int
    location_id: int | None = None
    content: str
    is_announcement: bool
    sender_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    total: int
    page: int
    per_page: int
