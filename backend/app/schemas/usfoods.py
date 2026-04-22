"""Pydantic schemas for US Foods order management."""

from datetime import date, datetime

from pydantic import BaseModel


class USFoodsProductResponse(BaseModel):
    id: int
    product_number: str
    description: str
    brand: str | None = None
    pack_size: str | None = None
    storage_class: str | None = None
    default_unit: str
    current_price: float | None = None
    previous_price: float | None = None
    price_updated_at: datetime | None = None
    is_active: bool

    class Config:
        from_attributes = True


class USFoodsRunItemResponse(BaseModel):
    id: int
    run_id: int
    shop_mapping_id: int
    product_id: int
    product_number: str | None = None
    product_description: str | None = None
    quantity: int
    unit: str
    square_item_name: str | None = None
    is_flagged: bool
    flag_reason: str | None = None
    is_filler: bool
    created_at: datetime

    class Config:
        from_attributes = True


class USFoodsShopSummary(BaseModel):
    shop_name: str
    customer_number: str
    item_count: int
    flagged_count: int
    meets_minimum: bool


class USFoodsRunResponse(BaseModel):
    id: int
    run_date: date
    order_window_start: datetime
    order_window_end: datetime
    status: str
    square_orders_count: int
    total_line_items: int
    created_at: datetime
    updated_at: datetime
    shops: list[USFoodsShopSummary] = []
    items: list[USFoodsRunItemResponse] = []

    class Config:
        from_attributes = True


class USFoodsRunListItem(BaseModel):
    id: int
    run_date: date
    status: str
    square_orders_count: int
    total_line_items: int
    created_at: datetime

    class Config:
        from_attributes = True


class USFoodsShopMappingResponse(BaseModel):
    id: int
    location_id: int | None = None
    customer_number: str
    us_foods_account_name: str
    distributor: str
    department: str
    match_keywords: str
    is_routing_alias: bool
    notes: str | None = None

    class Config:
        from_attributes = True


# Request schemas

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


class ValidationResultItem(BaseModel):
    product_number: str
    status: str  # "ok", "out_of_stock", "discontinued", "substituted"
    substitute_product_number: str | None = None
    message: str | None = None


class ValidationResultPayload(BaseModel):
    run_id: int
    results: list[ValidationResultItem]


class SubmitResultPayload(BaseModel):
    run_id: int
    success: bool
    order_confirmation: str | None = None
    error_message: str | None = None
