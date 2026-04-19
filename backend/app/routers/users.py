import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.location import Location
from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserListResponse, UserResponse, UserUpdate
from app.services.audit_service import log_action
from app.services.auth_service import hash_password

router = APIRouter()


@router.get("/", response_model=UserListResponse)
async def list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    location_id: int | None = None,
    role: UserRole | None = None,
    is_active: bool | None = None,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    query = select(User).options(selectinload(User.locations))

    if location_id:
        query = query.join(User.locations).where(Location.id == location_id)
    if role:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)

    # Manager can only see users at their locations
    if current_user.role == UserRole.manager:
        loc_ids = [loc.id for loc in current_user.locations]
        query = query.join(User.locations).where(Location.id.in_(loc_ids))

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    users = result.unique().scalars().all()

    return UserListResponse(
        items=[
            UserResponse(
                id=u.id, email=u.email, phone=u.phone, first_name=u.first_name,
                last_name=u.last_name, role=u.role, is_active=u.is_active,
                pin_last_four=u.pin_last_four,
                adp_employee_code=u.adp_employee_code,
                location_ids=[loc.id for loc in u.locations],
                created_at=u.created_at, updated_at=u.updated_at,
            )
            for u in users
        ],
        total=total, page=page, per_page=per_page,
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id, email=current_user.email, phone=current_user.phone,
        first_name=current_user.first_name, last_name=current_user.last_name,
        role=current_user.role, is_active=current_user.is_active,
        pin_last_four=current_user.pin_last_four,
        adp_employee_code=current_user.adp_employee_code,
        location_ids=[loc.id for loc in current_user.locations],
        created_at=current_user.created_at, updated_at=current_user.updated_at,
    )


@router.patch("/me", response_model=UserResponse)
async def update_me(
    user_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Allow any authenticated user to update their own profile (limited fields)."""
    allowed_fields = {"first_name", "last_name", "phone", "pin_last_four"}
    update_data = user_data.model_dump(exclude_unset=True)

    # Only apply allowed fields; ignore role, is_active, location_ids, email
    for field, value in update_data.items():
        if field in allowed_fields:
            setattr(current_user, field, value)

    await db.flush()
    await db.refresh(current_user, attribute_names=["locations"])

    return UserResponse(
        id=current_user.id, email=current_user.email, phone=current_user.phone,
        first_name=current_user.first_name, last_name=current_user.last_name,
        role=current_user.role, is_active=current_user.is_active,
        pin_last_four=current_user.pin_last_four,
        adp_employee_code=current_user.adp_employee_code,
        location_ids=[loc.id for loc in current_user.locations],
        created_at=current_user.created_at, updated_at=current_user.updated_at,
    )


class SmsPreferences(BaseModel):
    sms_shift_reminders: bool = True
    sms_schedule_changes: bool = True
    sms_time_off_updates: bool = True
    sms_swap_requests: bool = True
    sms_announcements: bool = True
    sms_messages: bool = True


DEFAULT_SMS_PREFS = SmsPreferences()


@router.get("/me/sms-preferences")
async def get_sms_preferences(current_user: User = Depends(get_current_user)):
    prefs = DEFAULT_SMS_PREFS.model_dump()
    if getattr(current_user, 'sms_preferences', None):
        try:
            saved = json.loads(current_user.sms_preferences)
            prefs.update(saved)
        except Exception:
            pass
    return prefs


@router.patch("/me/sms-preferences")
async def update_sms_preferences(
    data: SmsPreferences,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.sms_preferences = json.dumps(data.model_dump())
    await db.flush()
    return data.model_dump()


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).options(selectinload(User.locations)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return UserResponse(
        id=user.id, email=user.email, phone=user.phone,
        first_name=user.first_name, last_name=user.last_name,
        role=user.role, is_active=user.is_active,
        pin_last_four=user.pin_last_four,
        adp_employee_code=user.adp_employee_code,
        location_ids=[loc.id for loc in user.locations],
        created_at=user.created_at, updated_at=user.updated_at,
    )


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: UserCreate,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    # Check email uniqueness
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    # Only owners can create managers/owners
    if user_data.role in (UserRole.owner, UserRole.manager) and current_user.role != UserRole.owner:
        raise HTTPException(status_code=403, detail="Only owners can create manager/owner accounts")

    user = User(
        email=user_data.email, phone=user_data.phone,
        first_name=user_data.first_name, last_name=user_data.last_name,
        role=user_data.role, hashed_password=hash_password(user_data.password),
        pin_last_four=user_data.pin_last_four,
    )

    # Assign locations
    if user_data.location_ids:
        result = await db.execute(select(Location).where(Location.id.in_(user_data.location_ids)))
        locations = result.scalars().all()
        user.locations = list(locations)

    db.add(user)
    await db.flush()

    await log_action(
        db, current_user.id, "create_user", "user", user.id,
        new_values={"email": user.email, "role": user.role.value},
    )

    return UserResponse(
        id=user.id, email=user.email, phone=user.phone,
        first_name=user.first_name, last_name=user.last_name,
        role=user.role, is_active=user.is_active,
        pin_last_four=user.pin_last_four,
        adp_employee_code=user.adp_employee_code,
        location_ids=[loc.id for loc in user.locations],
        created_at=user.created_at, updated_at=user.updated_at,
    )


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).options(selectinload(User.locations)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    old_values = {"email": user.email, "role": user.role.value, "is_active": user.is_active}

    # Only owners can change roles
    if user_data.role and user_data.role != user.role and current_user.role != UserRole.owner:
        raise HTTPException(status_code=403, detail="Only owners can change user roles")

    update_data = user_data.model_dump(exclude_unset=True)
    location_ids = update_data.pop("location_ids", None)

    for field, value in update_data.items():
        setattr(user, field, value)

    if location_ids is not None:
        result = await db.execute(select(Location).where(Location.id.in_(location_ids)))
        user.locations = list(result.scalars().all())

    await db.flush()

    await log_action(
        db, current_user.id, "update_user", "user", user.id,
        old_values=old_values,
        new_values={"email": user.email, "role": user.role.value, "is_active": user.is_active},
    )

    return UserResponse(
        id=user.id, email=user.email, phone=user.phone,
        first_name=user.first_name, last_name=user.last_name,
        role=user.role, is_active=user.is_active,
        pin_last_four=user.pin_last_four,
        adp_employee_code=user.adp_employee_code,
        location_ids=[loc.id for loc in user.locations],
        created_at=user.created_at, updated_at=user.updated_at,
    )
