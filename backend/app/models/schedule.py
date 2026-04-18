import enum
from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Enum, ForeignKey, Integer, String, Time
from sqlalchemy.orm import relationship

from app.models import Base


class ShiftStatus(str, enum.Enum):
    scheduled = "scheduled"
    confirmed = "confirmed"
    completed = "completed"
    cancelled = "cancelled"
    no_show = "no_show"


class ShiftTemplate(Base):
    __tablename__ = "shift_templates"

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)
    name = Column(String(100), nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    role_needed = Column(String(50), nullable=True)
    days_of_week = Column(String(50), nullable=True)  # comma-separated: "mon,tue,wed"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    location = relationship("Location", back_populates="shift_templates")
    scheduled_shifts = relationship("ScheduledShift", back_populates="template")


class ScheduledShift(Base):
    __tablename__ = "scheduled_shifts"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("shift_templates.id"), nullable=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    date = Column(Date, nullable=False, index=True)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    status = Column(Enum(ShiftStatus), default=ShiftStatus.scheduled, nullable=False)
    manager_notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    template = relationship("ShiftTemplate", back_populates="scheduled_shifts")
    location = relationship("Location", back_populates="scheduled_shifts")
    employee = relationship("User", back_populates="scheduled_shifts")
    swap_requests_as_requesting = relationship(
        "ShiftSwapRequest", back_populates="requesting_shift", foreign_keys="ShiftSwapRequest.requesting_shift_id"
    )
    swap_requests_as_target = relationship(
        "ShiftSwapRequest", back_populates="target_shift", foreign_keys="ShiftSwapRequest.target_shift_id"
    )
    coverage_requests = relationship("ShiftCoverageRequest", back_populates="shift")
