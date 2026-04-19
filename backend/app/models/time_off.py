import enum
from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Enum, ForeignKey, Integer, String, Time
from sqlalchemy.orm import relationship

from app.models import Base


class RequestStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    denied = "denied"


class TimeOffRequest(Base):
    __tablename__ = "time_off_requests"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    reason = Column(String(500), nullable=True)
    status = Column(Enum(RequestStatus), default=RequestStatus.pending, nullable=False)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    employee = relationship("User", back_populates="time_off_requests", foreign_keys=[employee_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])


class UnavailabilityRequest(Base):
    __tablename__ = "unavailability_requests"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    day_of_week = Column(String(10), nullable=False)  # mon, tue, wed, etc.
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    reason = Column(String(500), nullable=True)
    status = Column(Enum(RequestStatus), default=RequestStatus.pending, nullable=False)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    employee = relationship("User", back_populates="unavailability_requests", foreign_keys=[employee_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
