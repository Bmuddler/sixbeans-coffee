from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.cash_drawer import CashDrawer
from app.models.user import User, UserRole
from app.schemas.cash_drawer import (
    CashDrawerClose,
    CashDrawerCreate,
    CashDrawerResponse,
    CashDrawerSetExpected,
    CashDrawerUpdate,
    UnexpectedExpenseCreate,
    UnexpectedExpenseResponse,
)
from app.services.audit_service import log_action
from app.services.cash_drawer_service import add_unexpected_expense, close_drawer, open_drawer
from app.utils.permissions import require_location_access

router = APIRouter()


@router.post("/", response_model=CashDrawerResponse, status_code=status.HTTP_201_CREATED)
async def api_open_drawer(
    data: CashDrawerCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    drawer = await open_drawer(db, current_user.id, data.location_id, data.date, data.opening_amount)

    await log_action(
        db, current_user.id, "open_drawer", "cash_drawer", drawer.id,
        new_values={"opening_amount": data.opening_amount},
    )

    return CashDrawerResponse(
        id=drawer.id, employee_id=drawer.employee_id, location_id=drawer.location_id,
        date=drawer.date, opening_amount=drawer.opening_amount,
        employee_name=f"{current_user.first_name} {current_user.last_name}",
        created_at=drawer.created_at,
    )


@router.patch("/{drawer_id}/close", response_model=CashDrawerResponse)
async def api_close_drawer(
    drawer_id: int,
    data: CashDrawerClose,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        drawer = await close_drawer(db, drawer_id, data.actual_closing, data.notes)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    await log_action(
        db, current_user.id, "close_drawer", "cash_drawer", drawer.id,
        new_values={
            "actual_closing": drawer.actual_closing,
            "expected_closing": drawer.expected_closing,
            "variance": drawer.variance,
        },
    )

    return CashDrawerResponse(
        id=drawer.id, employee_id=drawer.employee_id, location_id=drawer.location_id,
        date=drawer.date, opening_amount=drawer.opening_amount,
        expected_closing=drawer.expected_closing, actual_closing=drawer.actual_closing,
        variance=drawer.variance, notes=drawer.notes,
        unexpected_expenses=[
            UnexpectedExpenseResponse.model_validate(e) for e in drawer.unexpected_expenses
        ],
        created_at=drawer.created_at,
    )


@router.patch("/{drawer_id}", response_model=CashDrawerResponse)
async def api_edit_drawer(
    drawer_id: int,
    data: CashDrawerUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CashDrawer).options(selectinload(CashDrawer.unexpected_expenses)).where(CashDrawer.id == drawer_id)
    )
    drawer = result.scalar_one_or_none()
    if not drawer:
        raise HTTPException(status_code=404, detail="Drawer not found")

    # Only allow edits on the same day (Pacific time)
    from datetime import datetime as dt
    import pytz
    pacific = pytz.timezone(settings.timezone)
    today_pacific = dt.now(pacific).date()
    if drawer.date != today_pacific:
        raise HTTPException(status_code=403, detail="Can only edit drawer entries from today")

    old_values = {
        "opening_amount": drawer.opening_amount,
        "expected_closing": drawer.expected_closing,
        "actual_closing": drawer.actual_closing,
    }

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(drawer, field, value)

    # Recalculate variance if both expected and actual are set
    if drawer.expected_closing is not None and drawer.actual_closing is not None:
        drawer.variance = round(drawer.actual_closing - drawer.expected_closing, 2)

    await db.flush()
    await db.commit()

    await log_action(
        db, current_user.id, "edit_drawer", "cash_drawer", drawer.id,
        old_values=old_values,
        new_values=update_data,
    )

    return CashDrawerResponse(
        id=drawer.id, employee_id=drawer.employee_id, location_id=drawer.location_id,
        date=drawer.date, opening_amount=drawer.opening_amount,
        expected_closing=drawer.expected_closing, actual_closing=drawer.actual_closing,
        variance=drawer.variance, notes=drawer.notes,
        unexpected_expenses=[UnexpectedExpenseResponse.model_validate(e) for e in drawer.unexpected_expenses],
        employee_name=f"{current_user.first_name} {current_user.last_name}",
        created_at=drawer.created_at,
    )


@router.patch("/{drawer_id}/expected", response_model=CashDrawerResponse)
async def api_set_expected(
    drawer_id: int,
    data: CashDrawerSetExpected,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CashDrawer).options(selectinload(CashDrawer.unexpected_expenses)).where(CashDrawer.id == drawer_id)
    )
    drawer = result.scalar_one_or_none()
    if not drawer:
        raise HTTPException(status_code=404, detail="Drawer not found")

    drawer.expected_closing = data.expected_closing
    await db.flush()
    await db.commit()

    await log_action(
        db, current_user.id, "set_expected", "cash_drawer", drawer.id,
        new_values={"expected_closing": data.expected_closing},
    )

    return CashDrawerResponse(
        id=drawer.id, employee_id=drawer.employee_id, location_id=drawer.location_id,
        date=drawer.date, opening_amount=drawer.opening_amount,
        expected_closing=drawer.expected_closing, actual_closing=drawer.actual_closing,
        variance=drawer.variance, notes=drawer.notes,
        unexpected_expenses=[UnexpectedExpenseResponse.model_validate(e) for e in drawer.unexpected_expenses],
        employee_name=f"{current_user.first_name} {current_user.last_name}",
        created_at=drawer.created_at,
    )


@router.post("/{drawer_id}/expenses", response_model=UnexpectedExpenseResponse, status_code=status.HTTP_201_CREATED)
async def api_add_expense(
    drawer_id: int,
    data: UnexpectedExpenseCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    expense = await add_unexpected_expense(db, drawer_id, data.amount, data.category, data.notes)

    await log_action(
        db, current_user.id, "add_expense", "unexpected_expense", expense.id,
        new_values={"amount": data.amount, "category": data.category},
    )

    return UnexpectedExpenseResponse.model_validate(expense)


@router.get("/", response_model=list[CashDrawerResponse])
async def list_drawers(
    location_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(CashDrawer).options(
        selectinload(CashDrawer.unexpected_expenses),
        selectinload(CashDrawer.employee),
    )

    if location_id:
        query = query.where(CashDrawer.location_id == location_id)
    if start_date:
        query = query.where(CashDrawer.date >= start_date)
    if end_date:
        query = query.where(CashDrawer.date <= end_date)

    # Manager can only see their locations
    if current_user.role == UserRole.manager:
        loc_ids = [loc.id for loc in current_user.locations]
        query = query.where(CashDrawer.location_id.in_(loc_ids))

    query = query.order_by(CashDrawer.date.desc())
    result = await db.execute(query)
    drawers = result.unique().scalars().all()

    return [
        CashDrawerResponse(
            id=d.id, employee_id=d.employee_id, location_id=d.location_id,
            date=d.date, opening_amount=d.opening_amount,
            expected_closing=d.expected_closing, actual_closing=d.actual_closing,
            variance=d.variance, notes=d.notes,
            unexpected_expenses=[UnexpectedExpenseResponse.model_validate(e) for e in d.unexpected_expenses],
            employee_name=f"{d.employee.first_name} {d.employee.last_name}" if d.employee else None,
            created_at=d.created_at,
        )
        for d in drawers
    ]
