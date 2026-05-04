from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, String
from sqlalchemy.types import JSON

from app.models import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, default=1)
    early_clockin_minutes = Column(Integer, default=5, nullable=False)
    auto_clockout_minutes = Column(Integer, default=0, nullable=False)
    # Multiplier applied to raw Homebase labor_cost to approximate fully-
    # loaded labor for the Elite analytics (FICA + FUTA + SUTA + workers'
    # comp + benefits). 1.25 is a conservative default for CA food service.
    labor_burden_multiplier = Column(Float, default=1.25, nullable=False)
    # Cost of goods sold as a share of revenue. Used by Elite to estimate
    # profit when the actual COGS total isn't entered yet. 0.22 = 22%.
    cogs_percent = Column(Float, default=0.22, nullable=False)
    # GoDaddy card-processing fee taken silently from card sales before they
    # land in the bank. Default 2.3% per their published rate. Multiplied
    # against daily_revenue.card_total to estimate the silent fee cost.
    card_processing_fee_pct = Column(Float, default=0.023, nullable=False)
    # TapMango processing fee — applied to 100% of TapMango gross since the
    # loyalty/online ordering app is entirely card-based. Default 3%.
    tapmango_fee_pct = Column(Float, default=0.03, nullable=False)
    # Monotonic marker for one-shot analytics-data self-healing migrations.
    # Bump the hard-coded TARGET below and boot will wipe & expect reload.
    analytics_reset_version = Column(Integer, default=0, nullable=False)
    # Monotonic marker for one-shot supply catalog price adjustments.
    # Bump the TARGET in main.py and boot multiplies every active
    # catalog price by the corresponding factor, exactly once.
    catalog_price_version = Column(Integer, default=0, nullable=False)
    # Marker for the one-shot Square-catalog supplier/PN backfill.
    catalog_supplier_version = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
