"""US Foods order management models."""

import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.models import Base


class RunStatus(str, enum.Enum):
    generating = "generating"
    reviewing = "reviewing"
    failed = "failed"


class USFoodsProduct(Base):
    __tablename__ = "usfoods_products"

    id = Column(Integer, primary_key=True, index=True)
    product_number = Column(String(20), unique=True, nullable=False, index=True)
    description = Column(String(500), nullable=False)
    brand = Column(String(200), nullable=True)
    pack_size = Column(String(100), nullable=True)
    storage_class = Column(String(50), nullable=True)
    default_unit = Column(String(2), nullable=False, default="CS")  # CS or EA
    current_price = Column(Float, nullable=True)
    previous_price = Column(Float, nullable=True)
    price_updated_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    run_items = relationship("USFoodsRunItem", back_populates="product")
    price_history = relationship("USFoodsPriceHistory", back_populates="product")


class USFoodsShopMapping(Base):
    __tablename__ = "usfoods_shop_mappings"

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    customer_number = Column(String(20), nullable=False)
    us_foods_account_name = Column(String(200), nullable=False)
    distributor = Column(String(10), nullable=False, default="0")
    department = Column(String(10), nullable=False, default="0")
    match_keywords = Column(String(500), nullable=False)
    is_routing_alias = Column(Boolean, default=False, nullable=False)
    notes = Column(Text, nullable=True)

    location = relationship("Location")
    run_items = relationship("USFoodsRunItem", back_populates="shop_mapping")


class USFoodsWeeklyRun(Base):
    __tablename__ = "usfoods_weekly_runs"

    id = Column(Integer, primary_key=True, index=True)
    run_date = Column(Date, nullable=False)
    order_window_start = Column(DateTime, nullable=False)
    order_window_end = Column(DateTime, nullable=False)
    status = Column(Enum(RunStatus), nullable=False, default=RunStatus.generating)
    csv_data = Column(Text, nullable=True)
    square_orders_count = Column(Integer, default=0, nullable=False)
    total_line_items = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    items = relationship("USFoodsRunItem", back_populates="run", cascade="all, delete-orphan")


class USFoodsRunItem(Base):
    __tablename__ = "usfoods_run_items"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("usfoods_weekly_runs.id"), nullable=False)
    shop_mapping_id = Column(Integer, ForeignKey("usfoods_shop_mappings.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("usfoods_products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit = Column(String(2), nullable=False, default="CS")  # CS or EA
    square_item_name = Column(String(500), nullable=True)
    is_flagged = Column(Boolean, default=False, nullable=False)
    flag_reason = Column(String(50), nullable=True)
    is_filler = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    run = relationship("USFoodsWeeklyRun", back_populates="items")
    shop_mapping = relationship("USFoodsShopMapping", back_populates="run_items")
    product = relationship("USFoodsProduct", back_populates="run_items")


class USFoodsPriceHistory(Base):
    __tablename__ = "usfoods_price_history"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("usfoods_products.id"), nullable=False)
    price = Column(Float, nullable=False)
    recorded_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    product = relationship("USFoodsProduct", back_populates="price_history")
