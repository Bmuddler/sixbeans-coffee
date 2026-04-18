from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse
from app.services.auth_service import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.services.audit_service import log_action
from app.utils.password_rules import validate_password, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES

router = APIRouter()


class UserInfo(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    role: str
    is_active: bool
    must_change_password: bool = False
    phone: str | None = None
    pin_last_four: str | None = None
    location_ids: list[int] = []


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserInfo


class RefreshRequest(BaseModel):
    refresh_token: str


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


class ChangePasswordRequest(BaseModel):
    new_password: str


def _user_info(user: User) -> UserInfo:
    return UserInfo(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role.value if hasattr(user.role, 'value') else user.role,
        is_active=user.is_active,
        must_change_password=getattr(user, 'must_change_password', False) or False,
        phone=user.phone,
        pin_last_four=user.pin_last_four,
        location_ids=[],
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    # Check lockout
    locked_until = getattr(user, 'locked_until', None)
    if locked_until and locked_until > datetime.utcnow():
        remaining = int((locked_until - datetime.utcnow()).total_seconds() / 60) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account locked. Try again in {remaining} minutes.",
        )

    if not verify_password(form_data.password, user.hashed_password):
        # Increment failed attempts
        attempts = getattr(user, 'failed_login_attempts', 0) or 0
        user.failed_login_attempts = attempts + 1
        if user.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
            user.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
            await db.flush()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed attempts. Account locked for {LOCKOUT_MINUTES} minutes.",
            )
        await db.flush()
        remaining = MAX_FAILED_ATTEMPTS - user.failed_login_attempts
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Incorrect email or password. {remaining} attempts remaining.",
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated")

    # Reset failed attempts on successful login
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.flush()

    access_token = create_access_token(data={"sub": str(user.id)})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})

    await log_action(db, user.id, "login", "user", user.id)

    return TokenResponse(access_token=access_token, refresh_token=refresh_token, user=_user_info(user))


@router.post("/change-password")
async def change_password(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    errors = validate_password(data.new_password)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))

    current_user.hashed_password = hash_password(data.new_password)
    current_user.must_change_password = False
    await db.flush()

    await log_action(db, current_user.id, "change_password", "user", current_user.id)
    return {"message": "Password changed successfully"}


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    errors = validate_password(user_data.password)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))

    user = User(
        email=user_data.email, phone=user_data.phone,
        first_name=user_data.first_name, last_name=user_data.last_name,
        role=user_data.role, hashed_password=hash_password(user_data.password),
        pin_last_four=user_data.pin_last_four, must_change_password=False,
    )
    db.add(user)
    await db.flush()

    await log_action(db, user.id, "register", "user", user.id)
    return UserResponse(
        id=user.id, email=user.email, phone=user.phone,
        first_name=user.first_name, last_name=user.last_name,
        role=user.role, is_active=user.is_active, pin_last_four=user.pin_last_four,
        location_ids=[], created_at=user.created_at, updated_at=user.updated_at,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = payload.get("sub")
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="User not found or inactive")
        access_token = create_access_token(data={"sub": str(user.id)})
        refresh_token = create_refresh_token(data={"sub": str(user.id)})
        return TokenResponse(access_token=access_token, refresh_token=refresh_token, user=_user_info(user))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


@router.post("/password-reset-request")
async def request_password_reset(body: PasswordResetRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if user:
        await log_action(db, user.id, "password_reset_request", "user", user.id)
    return {"message": "If an account with that email exists, a reset link has been sent"}


@router.post("/password-reset-confirm")
async def confirm_password_reset(body: PasswordResetConfirm, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(body.token)
        user_id = payload.get("sub")
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        errors = validate_password(body.new_password)
        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors))

        user.hashed_password = hash_password(body.new_password)
        user.must_change_password = False
        await log_action(db, user.id, "password_reset", "user", user.id)
        return {"message": "Password has been reset"}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
