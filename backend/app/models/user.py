import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, String, Boolean, Table
from sqlalchemy.orm import relationship

from app.models import Base


class UserRole(str, enum.Enum):
    owner = "owner"
    manager = "manager"
    employee = "employee"


user_locations = Table(
    "user_locations",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
    Column("location_id", Integer, ForeignKey("locations.id"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    phone = Column(String(20), nullable=True)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.employee)
    hashed_password = Column(String(255), nullable=False)
    pin_last_four = Column(String(4), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    locations = relationship("Location", secondary=user_locations, back_populates="users")
    scheduled_shifts = relationship("ScheduledShift", back_populates="employee")
    time_clocks = relationship("TimeClock", back_populates="employee")
    time_off_requests = relationship("TimeOffRequest", back_populates="employee", foreign_keys="TimeOffRequest.employee_id")
    unavailability_requests = relationship("UnavailabilityRequest", back_populates="employee", foreign_keys="UnavailabilityRequest.employee_id")
    sent_messages = relationship("Message", back_populates="sender")
    cash_drawers = relationship("CashDrawer", back_populates="employee")
    payroll_records = relationship("PayrollRecord", back_populates="employee", foreign_keys="PayrollRecord.employee_id")
