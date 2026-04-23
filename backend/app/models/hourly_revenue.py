"""15-minute-resolution revenue facts for heatmaps.

One row per (location, date, hour, quarter, channel). `quarter` is 0..3
where 0 = :00-:14, 1 = :15-:29, 2 = :30-:44, 3 = :45-:59. Aggregating up
to 1-hour buckets = sum across `quarter`. Populated at GoDaddy / TapMango
ingest time from the per-transaction timestamps. DoorDash has no per-
order timestamps in the weekly email, so DoorDash rows never exist here.
"""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.models import Base


class HourlyRevenue(Base):
    __tablename__ = "hourly_revenue"
    __table_args__ = (
        UniqueConstraint(
            "location_id", "date", "hour", "quarter", "channel",
            name="uq_hourly_revenue_slot",
        ),
        CheckConstraint("hour BETWEEN 0 AND 23", name="ck_hourly_revenue_hour"),
        CheckConstraint("quarter BETWEEN 0 AND 3", name="ck_hourly_revenue_quarter"),
        CheckConstraint(
            "channel in ('godaddy','tapmango','doordash')",
            name="ck_hourly_revenue_channel",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    hour = Column(Integer, nullable=False)
    quarter = Column(Integer, nullable=False)
    channel = Column(String(20), nullable=False)

    txns = Column(Integer, nullable=False, default=0)
    gross = Column(Float, nullable=False, default=0.0)

    ingested_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False,
    )

    location = relationship("Location")
