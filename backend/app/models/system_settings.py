from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.types import JSON

from app.models import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, default=1)
    early_clockin_minutes = Column(Integer, default=5, nullable=False)
    auto_clockout_minutes = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
