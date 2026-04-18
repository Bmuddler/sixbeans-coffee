from datetime import datetime

from pydantic import BaseModel


class LocationBase(BaseModel):
    name: str
    address: str
    city: str
    state: str = "CA"
    zip_code: str
    phone: str | None = None


class LocationCreate(LocationBase):
    pass


class LocationUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    phone: str | None = None
    is_active: bool | None = None


class LocationResponse(LocationBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
