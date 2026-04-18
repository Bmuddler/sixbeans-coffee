from datetime import datetime

from pydantic import BaseModel


class MessageCreate(BaseModel):
    content: str
    location_id: int | None = None
    is_announcement: bool = False
    is_direct: bool = False
    recipient_ids: list[int] = []


class MessageResponse(BaseModel):
    id: int
    sender_id: int
    location_id: int | None = None
    content: str
    is_announcement: bool
    is_direct: bool = False
    sender_name: str | None = None
    created_at: datetime
    recipients: list["RecipientInfo"] = []
    read_count: int = 0
    total_recipients: int = 0

    model_config = {"from_attributes": True}


class RecipientInfo(BaseModel):
    user_id: int
    user_name: str | None = None
    read_at: datetime | None = None


class MarkReadRequest(BaseModel):
    message_ids: list[int]


class MessageListResponse(BaseModel):
    items: list[MessageResponse]
    total: int
    page: int
    per_page: int
