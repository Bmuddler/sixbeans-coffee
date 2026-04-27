from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.models import Base


class JobApplication(Base):
    __tablename__ = "job_applications"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=False)
    position = Column(String(100), nullable=False)
    location = Column(String(100), nullable=False)
    message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # 'new' | 'forwarded' | 'archived'
    status = Column(String(20), nullable=False, default="new")
    forwarded_to_location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    forwarded_at = Column(DateTime, nullable=True)
    forwarded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
