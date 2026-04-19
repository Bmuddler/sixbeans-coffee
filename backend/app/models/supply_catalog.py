from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.models import Base


class SupplyItem(Base):
    __tablename__ = "supply_items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    category = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    price = Column(Float, nullable=True)
    square_token = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class SupplyOrder(Base):
    __tablename__ = "supply_orders"

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)
    ordered_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(20), default="pending", nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    location = relationship("Location")
    orderer = relationship("User")
    items = relationship("SupplyOrderItem", back_populates="order", cascade="all, delete-orphan")


class SupplyOrderItem(Base):
    __tablename__ = "supply_order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("supply_orders.id", ondelete="CASCADE"), nullable=False)
    supply_item_id = Column(Integer, ForeignKey("supply_items.id"), nullable=False)
    quantity = Column(Integer, default=1, nullable=False)
    item_name = Column(String(255), nullable=False)
    item_price = Column(Float, nullable=True)

    order = relationship("SupplyOrder", back_populates="items")
    supply_item = relationship("SupplyItem")
