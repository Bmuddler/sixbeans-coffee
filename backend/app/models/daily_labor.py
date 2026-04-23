"""Daily labor facts — one row per (location, date).

Populated by the Homebase timesheets CSV upload. Joined with DailyRevenue
to compute the Elite dashboard metrics (labor %, sales per labor hour,
estimated profit, labor opportunity).
"""

from datetime import datetime

from sqlalchemy import (
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


class DailyLabor(Base):
    __tablename__ = "daily_labor"
    __table_args__ = (
        UniqueConstraint("location_id", "date", name="uq_daily_labor_location_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)

    # Hour totals — `total_hours` is what we divide revenue by for SPLH.
    total_hours = Column(Float, nullable=False, default=0.0)
    regular_hours = Column(Float, nullable=False, default=0.0)
    ot_hours = Column(Float, nullable=False, default=0.0)

    # Labor cost = sum(hours * wage_rate) per shift. This is the pre-tax,
    # pre-payroll-burden wage cost. The P&L "Payroll" line will include
    # payroll taxes and burden on top — those are added in the analyzer.
    labor_cost = Column(Float, nullable=False, default=0.0)

    # Distinct employees worked that day (headcount, not shift count).
    headcount = Column(Integer, nullable=False, default=0)

    # Book-keeping
    source_file = Column(String(300), nullable=True)
    ingested_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    location = relationship("Location")
