"""POS sales — one row per item line on a GoDaddy Items export.

The Items export (commerce.godaddy.com → Reports → Items) includes the
"Item Details" sheet with one row per line on each transaction, plus
the structured modifier list packed into the Name/SKU column. We parse
that into PosSale (the line) + PosSaleModifier (one row per modifier
group/value pair).

Dedup: a sha1 of (transaction_id, sku, sale_datetime ISO, unit_price,
quantity, raw_modifier_text). Re-uploading the same file is a no-op;
overlapping exports merge cleanly.
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.models import Base


class PosSale(Base):
    __tablename__ = "pos_sales"
    __table_args__ = (
        UniqueConstraint("dedup_hash", name="uq_pos_sales_dedup"),
    )

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True, index=True)
    sale_datetime = Column(DateTime, nullable=False, index=True)
    transaction_id = Column(String(80), nullable=False, index=True)
    order_id = Column(String(80), nullable=True)
    sku = Column(String(120), nullable=True, index=True)
    item_name = Column(String(255), nullable=False)
    raw_modifier_text = Column(Text, nullable=True)
    unit_price = Column(Float, nullable=False, default=0.0)
    quantity = Column(Float, nullable=False, default=1.0)
    subtotal = Column(Float, nullable=False, default=0.0)
    item_discount = Column(Float, nullable=False, default=0.0)
    item_fee = Column(Float, nullable=False, default=0.0)
    total_taxes = Column(Float, nullable=False, default=0.0)
    grand_total = Column(Float, nullable=False, default=0.0)
    status = Column(String(40), nullable=True)
    source = Column(String(40), nullable=False, default="godaddy_items")
    source_filename = Column(String(255), nullable=True)
    dedup_hash = Column(String(64), nullable=False, index=True)
    imported_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    location = relationship("Location")
    modifiers = relationship("PosSaleModifier", back_populates="sale", cascade="all, delete-orphan")


class PosSaleModifier(Base):
    __tablename__ = "pos_sale_modifiers"

    id = Column(Integer, primary_key=True, index=True)
    pos_sale_id = Column(Integer, ForeignKey("pos_sales.id", ondelete="CASCADE"), nullable=False, index=True)
    group_name = Column(String(120), nullable=False)
    value = Column(String(255), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)

    sale = relationship("PosSale", back_populates="modifiers")
