from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.models import Base


class CashDrawer(Base):
    __tablename__ = "cash_drawers"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    opening_amount = Column(Float, nullable=False)
    expected_closing = Column(Float, nullable=True)
    actual_closing = Column(Float, nullable=True)
    variance = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    employee = relationship("User", back_populates="cash_drawers")
    location = relationship("Location", back_populates="cash_drawers")
    unexpected_expenses = relationship("UnexpectedExpense", back_populates="cash_drawer", cascade="all, delete-orphan")


class UnexpectedExpense(Base):
    __tablename__ = "unexpected_expenses"

    id = Column(Integer, primary_key=True, index=True)
    cash_drawer_id = Column(Integer, ForeignKey("cash_drawers.id"), nullable=False)
    amount = Column(Float, nullable=False)
    category = Column(String(100), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    cash_drawer = relationship("CashDrawer", back_populates="unexpected_expenses")
