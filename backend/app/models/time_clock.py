import enum
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.models import Base


class ClockStatus(str, enum.Enum):
    clocked_in = "clocked_in"
    on_break = "on_break"
    clocked_out = "clocked_out"


class BreakType(str, enum.Enum):
    paid_10 = "paid_10"
    unpaid_30 = "unpaid_30"


class TimeClock(Base):
    __tablename__ = "time_clocks"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)
    clock_in = Column(DateTime, nullable=False)
    clock_out = Column(DateTime, nullable=True)
    auto_clocked_out = Column(Boolean, default=False, nullable=False)
    auto_clockout_at = Column(DateTime, nullable=True)
    is_unscheduled = Column(Boolean, default=False, nullable=False)
    total_hours = Column(Float, nullable=True)
    status = Column(Enum(ClockStatus), default=ClockStatus.clocked_in, nullable=False)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    employee = relationship("User", back_populates="time_clocks")
    location = relationship("Location", back_populates="time_clocks")
    breaks = relationship("Break", back_populates="time_clock", cascade="all, delete-orphan")


class Break(Base):
    __tablename__ = "breaks"

    id = Column(Integer, primary_key=True, index=True)
    time_clock_id = Column(Integer, ForeignKey("time_clocks.id"), nullable=False)
    break_type = Column(Enum(BreakType), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    time_clock = relationship("TimeClock", back_populates="breaks")
