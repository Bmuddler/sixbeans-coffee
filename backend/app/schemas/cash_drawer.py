from datetime import date, datetime

from pydantic import BaseModel


class UnexpectedExpenseCreate(BaseModel):
    amount: float
    category: str
    notes: str | None = None


class UnexpectedExpenseResponse(BaseModel):
    id: int
    cash_drawer_id: int
    amount: float
    category: str
    notes: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CashDrawerCreate(BaseModel):
    location_id: int
    date: date
    opening_amount: float


class CashDrawerSetExpected(BaseModel):
    expected_closing: float


class CashDrawerClose(BaseModel):
    actual_closing: float
    notes: str | None = None


class CashDrawerResponse(BaseModel):
    id: int
    employee_id: int
    location_id: int
    date: date
    opening_amount: float
    expected_closing: float | None = None
    actual_closing: float | None = None
    variance: float | None = None
    notes: str | None = None
    unexpected_expenses: list[UnexpectedExpenseResponse] = []
    employee_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
