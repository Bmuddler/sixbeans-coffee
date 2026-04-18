"""Cash drawer reconciliation calculations."""

from datetime import date

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.cash_drawer import CashDrawer, UnexpectedExpense
from app.services.godaddy_service import get_expected_cash_for_date


async def open_drawer(
    db: AsyncSession,
    employee_id: int,
    location_id: int,
    drawer_date: date,
    opening_amount: float,
) -> CashDrawer:
    """Open a cash drawer for the day."""
    drawer = CashDrawer(
        employee_id=employee_id,
        location_id=location_id,
        date=drawer_date,
        opening_amount=opening_amount,
    )
    db.add(drawer)
    await db.flush()
    return drawer


async def close_drawer(
    db: AsyncSession,
    drawer_id: int,
    actual_closing: float,
    notes: str | None = None,
) -> CashDrawer:
    """Close a cash drawer and calculate variance."""
    result = await db.execute(
        select(CashDrawer)
        .options(selectinload(CashDrawer.unexpected_expenses))
        .where(CashDrawer.id == drawer_id)
    )
    drawer = result.scalar_one_or_none()
    if not drawer:
        raise ValueError("Cash drawer not found")

    total_expenses = sum(e.amount for e in drawer.unexpected_expenses)

    # Use manually set expected amount, or calculate from GoDaddy
    if drawer.expected_closing is None:
        expected = await get_expected_cash_for_date(drawer.location_id, drawer.date)
        drawer.expected_closing = drawer.opening_amount + expected - total_expenses
    drawer.actual_closing = actual_closing
    drawer.variance = round(actual_closing - drawer.expected_closing, 2)
    drawer.notes = notes

    await db.flush()
    return drawer


async def add_unexpected_expense(
    db: AsyncSession,
    drawer_id: int,
    amount: float,
    category: str,
    notes: str | None = None,
) -> UnexpectedExpense:
    """Add an unexpected expense to a cash drawer."""
    expense = UnexpectedExpense(
        cash_drawer_id=drawer_id,
        amount=amount,
        category=category,
        notes=notes,
    )
    db.add(expense)
    await db.flush()
    return expense
