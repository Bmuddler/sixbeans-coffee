from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Boolean
from sqlalchemy.orm import relationship

from app.models import Base
from app.models.user import user_locations


class Location(Base):
    __tablename__ = "locations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    address = Column(String(300), nullable=False)
    city = Column(String(100), nullable=False)
    state = Column(String(2), nullable=False, default="CA")
    zip_code = Column(String(10), nullable=False)
    phone = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Canonical short identifier used across analytics (e.g. "BARSTOW", "HESPERIA").
    # Stable even when the public-facing `name` changes.
    canonical_short_name = Column(String(50), nullable=True, unique=True, index=True)

    # External IDs for ingestion mapping. Nullable because not every location
    # participates in every channel, and new IDs get auto-discovered on ingest.
    godaddy_dropdown_label = Column(String(200), nullable=True)
    tapmango_location_id = Column(Integer, nullable=True, unique=True, index=True)
    doordash_store_id = Column(Integer, nullable=True, unique=True, index=True)

    users = relationship("User", secondary=user_locations, back_populates="locations")
    shift_templates = relationship("ShiftTemplate", back_populates="location")
    scheduled_shifts = relationship("ScheduledShift", back_populates="location")
    time_clocks = relationship("TimeClock", back_populates="location")
    cash_drawers = relationship("CashDrawer", back_populates="location")
    messages = relationship("Message", back_populates="location")
    daily_revenues = relationship("DailyRevenue", back_populates="location", cascade="all, delete-orphan")
