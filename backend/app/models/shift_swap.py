import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.models import Base


class SwapStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    denied = "denied"
    cancelled = "cancelled"


class ShiftSwapRequest(Base):
    __tablename__ = "shift_swap_requests"

    id = Column(Integer, primary_key=True, index=True)
    requesting_employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    requesting_shift_id = Column(Integer, ForeignKey("scheduled_shifts.id"), nullable=False)
    target_shift_id = Column(Integer, ForeignKey("scheduled_shifts.id"), nullable=False)
    status = Column(Enum(SwapStatus), default=SwapStatus.pending, nullable=False)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    requesting_employee = relationship("User", foreign_keys=[requesting_employee_id])
    target_employee = relationship("User", foreign_keys=[target_employee_id])
    requesting_shift = relationship("ScheduledShift", back_populates="swap_requests_as_requesting", foreign_keys=[requesting_shift_id])
    target_shift = relationship("ScheduledShift", back_populates="swap_requests_as_target", foreign_keys=[target_shift_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])


class ShiftCoverageRequest(Base):
    __tablename__ = "shift_coverage_requests"

    id = Column(Integer, primary_key=True, index=True)
    shift_id = Column(Integer, ForeignKey("scheduled_shifts.id"), nullable=False)
    posting_employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    claiming_employee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(Enum(SwapStatus), default=SwapStatus.pending, nullable=False)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    shift = relationship("ScheduledShift", back_populates="coverage_requests")
    posting_employee = relationship("User", foreign_keys=[posting_employee_id])
    claiming_employee = relationship("User", foreign_keys=[claiming_employee_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
