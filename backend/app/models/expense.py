"""Current-snapshot monthly expenses per location / company.

One row per (location, category). When `location_id` is NULL the row is a
company-wide overhead or shared-COGS expense (the "Overall Monthly" and
"All 6 Shops COGS" sections of the owner's Store P&L spreadsheet).

There is no month dimension — each row holds the *current* monthly amount.
The owner edits rows when something changes (rent increase, new
subscription, etc.). Analytics prorates each row to daily values when
computing per-day margins:

    daily_share = amount / 30.44

30.44 is the mean days-per-month across a year, which keeps February
from producing an artificial profit dip.

Payroll / labor is intentionally NOT stored here — daily labor comes
from Homebase timesheets via the `daily_labor` table. The owner can
inflate that raw wage cost with `SystemSettings.labor_burden_multiplier`
to approximate fully-loaded payroll (taxes, benefits, workers' comp).
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.models import Base


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    # NULL location_id = company-wide overhead or shared COGS.
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True, index=True)
    category = Column(String(120), nullable=False)
    amount = Column(Float, nullable=False, default=0.0)
    notes = Column(Text, nullable=True)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    location = relationship("Location")
