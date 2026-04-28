"""Daily revenue facts — one row per (location, date, channel).

Populated by the ingestion pipeline from GoDaddy, TapMango, and DoorDash
sources. Downstream analytics (weekly rollups, dashboards, action items)
read this table.
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


# Channel enum expressed as a plain string for portability (sqlite/postgres).
# Kept as a constant list so the UI and ingestion pipelines can share it.
CHANNEL_GODADDY = "godaddy"
CHANNEL_TAPMANGO = "tapmango"
CHANNEL_DOORDASH = "doordash"
ALL_CHANNELS = (CHANNEL_GODADDY, CHANNEL_TAPMANGO, CHANNEL_DOORDASH)


class DailyRevenue(Base):
    __tablename__ = "daily_revenues"
    __table_args__ = (
        # One row per store per day per channel.
        UniqueConstraint(
            "location_id", "date", "channel", name="uq_daily_revenue_location_date_channel"
        ),
        CheckConstraint(
            "channel in ('godaddy','tapmango','doordash')",
            name="ck_daily_revenue_channel",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    channel = Column(String(20), nullable=False, index=True)

    # Gross revenue before discounts, fees, and adjustments.
    gross_revenue = Column(Float, nullable=False, default=0.0)
    # Net revenue — what actually landed (gross - discounts - commissions + tips).
    # Nullable because DoorDash is the only source that computes a true net;
    # GoDaddy and TapMango store gross and let the analyzer derive net.
    net_revenue = Column(Float, nullable=True)

    # Breakdown fields (nullable — not every channel supplies every field)
    discount_total = Column(Float, nullable=True)
    tip_total = Column(Float, nullable=True)
    tax_total = Column(Float, nullable=True)
    commission_total = Column(Float, nullable=True)  # DoorDash commission, etc.
    fee_total = Column(Float, nullable=True)  # other fees (processing, tablet, etc.)

    transaction_count = Column(Integer, nullable=True)
    rejected_count = Column(Integer, nullable=True)  # e.g. DoorDash/TapMango rejected orders

    # Tender-method breakdown — populated by the GoDaddy parser from the
    # "Card Payments (N)" vs "Cash Payments (N)" sheets. Used to estimate
    # silent card-processing fees that are taken out before deposits hit
    # the bank (~2.3% on GoDaddy). Other channels leave these NULL.
    card_total = Column(Float, nullable=True)
    cash_total = Column(Float, nullable=True)

    # Book-keeping
    source_file = Column(String(300), nullable=True)  # path/name of ingested file
    ingested_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    location = relationship("Location", back_populates="daily_revenues")
