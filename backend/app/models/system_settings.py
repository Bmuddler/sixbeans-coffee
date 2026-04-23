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
    # Monotonic marker for one-shot analytics-data self-healing migrations.
    # Bump the hard-coded TARGET below and boot will wipe & expect reload.
    analytics_reset_version = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
