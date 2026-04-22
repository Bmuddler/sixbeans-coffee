"""Pydantic schemas for US Foods order management."""

from pydantic import BaseModel


class RunItemUpdate(BaseModel):
    quantity: int | None = None
    unit: str | None = None
    is_flagged: bool | None = None
    flag_reason: str | None = None
    shop_mapping_id: int | None = None


class RunItemCreate(BaseModel):
    product_id: int
    shop_mapping_id: int
    quantity: int
    unit: str = "CS"
