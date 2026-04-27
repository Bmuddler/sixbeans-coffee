from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models.user import UserRole


class UserBase(BaseModel):
    email: EmailStr
    phone: str | None = None
    first_name: str
    last_name: str
    role: UserRole = UserRole.employee


class UserCreate(UserBase):
    password: str
    pin_last_four: str | None = None
    location_ids: list[int] = []


class UserUpdate(BaseModel):
    # Plain str rather than EmailStr because pydantic's EmailStr rejects the
    # `.local` placeholder addresses we generate for employees with no real
    # email — existing rows must remain editable.
    email: str | None = None
    phone: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    role: UserRole | None = None
    pin_last_four: str | None = None
    is_active: bool | None = None
    location_ids: list[int] | None = None


class UserResponse(BaseModel):
    id: int
    email: str
    phone: str | None = None
    first_name: str
    last_name: str
    role: UserRole
    is_active: bool
    pin_last_four: str | None = None
    adp_employee_code: str | None = None
    location_ids: list[int] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    items: list[UserResponse]
    total: int
    page: int
    per_page: int
