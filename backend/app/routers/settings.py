from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles
from app.models.system_settings import SystemSettings
from app.models.user import User, UserRole

router = APIRouter()


class SystemSettingsResponse(BaseModel):
    id: int
    early_clockin_minutes: int
    auto_clockout_minutes: int

    model_config = {"from_attributes": True}


class SystemSettingsUpdate(BaseModel):
    early_clockin_minutes: int | None = None
    auto_clockout_minutes: int | None = None


@router.get("", response_model=SystemSettingsResponse)
async def get_settings(
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if not settings:
        raise HTTPException(status_code=404, detail="System settings not found")
    return settings


@router.patch("", response_model=SystemSettingsResponse)
async def update_settings(
    data: SystemSettingsUpdate,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if not settings:
        raise HTTPException(status_code=404, detail="System settings not found")

    if data.early_clockin_minutes is not None:
        settings.early_clockin_minutes = data.early_clockin_minutes
    if data.auto_clockout_minutes is not None:
        settings.auto_clockout_minutes = data.auto_clockout_minutes

    await db.flush()
    await db.commit()
    return settings
