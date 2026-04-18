from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.location import Location
from app.models.user import User, UserRole
from app.schemas.location import LocationCreate, LocationResponse, LocationUpdate
from app.services.audit_service import log_action

router = APIRouter()


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
