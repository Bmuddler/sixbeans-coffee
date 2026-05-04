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
    # Pack price — what we pay for one pack/case/jug. Used as the numerator
    # for cost-per-unit calculations.
    price = Column(Float, nullable=True)
    square_token = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    # ----- Recipe-costing fields -----
    # How much product is in one pack at `price`. e.g. a $42 case of milk
    # might be pack_size=128, pack_unit='oz' → cost $0.328/oz.
    pack_size = Column(Float, nullable=True)
    # Native pack unit. Use lowercase canonical strings:
    #   weight: 'oz', 'lb', 'g', 'kg'
    #   volume: 'floz', 'cup', 'tbsp', 'tsp', 'gal', 'qt', 'pt', 'ml', 'l'
    #   count:  'each'
    pack_unit = Column(String(20), nullable=True)
    # True if the item is countable (eggs, bagels, lids, cups). Recipes can
    # only ask for whole/half units of these — no oz conversion.
    is_count_item = Column(Boolean, default=False, nullable=False)
    # Optional density for items that need volume↔weight conversion
    # (flour, sugar). Stored as oz of weight per 1 cup of volume.
    density_oz_per_cup = Column(Float, nullable=True)
    # Cached cost-per-base-unit. For weight items: $/oz. For volume items:
    # $/floz. For count items: $/each. Kept in sync via a service helper
    # whenever price or pack_size changes; the UI also displays this.
    cost_per_base_unit = Column(Float, nullable=True)
    # Which supplier this item is ordered from. Must be one of the keys
    # in TAG_MAPPING from supply_report_service.py (WAREHOUSE, BAKERY,
    # DAIRY, US FOODS, COSTCO, WINCO, WEBSTAURANT, KLATCH,
    # OLD TOWN BAKING, BANK, OTHER) — same vocabulary the legacy
    # Square-tagged report uses. Lets the Mon/Fri 9 AM supply report
    # cron group portal orders into the same supplier buckets.
    supplier = Column(String(40), nullable=True)
    # US Foods catalog product number (7-digit PN). Required for the
    # Monday US Foods generator to include a portal-placed order on the
    # weekly CSV. Matched against USFoodsProduct.product_number; nullable
    # for items that aren't ordered from US Foods.
    usfoods_pn = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


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
