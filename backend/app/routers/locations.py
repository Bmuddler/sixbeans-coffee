from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.cash_drawer import CashDrawer
from app.models.location import Location
from app.models.schedule import ScheduledShift
from app.models.time_clock import TimeClock
from app.models.user import User, UserRole
from app.schemas.location import LocationCreate, LocationPublic, LocationResponse, LocationUpdate
from app.services.audit_service import log_action

router = APIRouter()


@router.get("/homepage", response_model=list[LocationPublic])
async def list_homepage_locations(db: AsyncSession = Depends(get_db)):
    """Public, unauthenticated. Powers the marketing site's location cards.
    Only returns active locations flagged show_on_homepage with a display_name set."""
    result = await db.execute(
        select(Location).where(
            Location.is_active.is_(True),
            Location.show_on_homepage.is_(True),
            Location.display_name.is_not(None),
        ).order_by(Location.display_name)
    )
    return [LocationPublic.model_validate(loc) for loc in result.scalars().all()]


@router.get("/", response_model=list[LocationResponse])
async def list_locations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == UserRole.owner:
        result = await db.execute(select(Location))
    else:
        loc_ids = [loc.id for loc in current_user.locations]
        result = await db.execute(select(Location).where(Location.id.in_(loc_ids)))

    return [LocationResponse.model_validate(loc) for loc in result.scalars().all()]


@router.get("/{location_id}", response_model=LocationResponse)
async def get_location(
    location_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Location).where(Location.id == location_id))
    location = result.scalar_one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return LocationResponse.model_validate(location)


@router.post("/", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
async def create_location(
    data: LocationCreate,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    location = Location(**data.model_dump())
    db.add(location)
    await db.flush()

    await log_action(
        db, current_user.id, "create_location", "location", location.id,
        new_values=data.model_dump(),
    )

    return LocationResponse.model_validate(location)


@router.patch("/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: int,
    data: LocationUpdate,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Location).where(Location.id == location_id))
    location = result.scalar_one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    old_values = {"name": location.name, "is_active": location.is_active}
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(location, field, value)

    await db.flush()

    await log_action(
        db, current_user.id, "update_location", "location", location.id,
        old_values=old_values,
        new_values=data.model_dump(exclude_unset=True),
    )

    return LocationResponse.model_validate(location)


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_location(
    location_id: int,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Hard-delete a location. Refuses if any time clocks, shifts, or drawers
    reference it — those rows would orphan otherwise."""
    result = await db.execute(select(Location).where(Location.id == location_id))
    location = result.scalar_one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    for model, label in (
        (TimeClock, "time clock entries"),
        (ScheduledShift, "scheduled shifts"),
        (CashDrawer, "cash drawer entries"),
    ):
        count = await db.scalar(
            select(func.count()).select_from(model).where(model.location_id == location_id)
        )
        if count:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot delete: location has {count} {label}. Mark inactive instead.",
            )

    await log_action(
        db, current_user.id, "delete_location", "location", location.id,
        old_values={"name": location.name},
    )
    await db.delete(location)
    await db.flush()
