"""Job application endpoints for the public Apply Now form."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles
from app.models.job_application import JobApplication
from app.models.user import User, UserRole
from app.services.notification_service import send_sms

logger = logging.getLogger(__name__)

router = APIRouter()


class JobApplicationCreate(BaseModel):
    name: str
    email: str
    phone: str
    position: str
    location: str
    message: str | None = None


class JobApplicationResponse(BaseModel):
    id: int
    name: str
    email: str
    phone: str
    position: str
    location: str
    message: str | None
    created_at: str

    class Config:
        from_attributes = True


@router.post("/", status_code=status.HTTP_201_CREATED)
async def submit_application(
    data: JobApplicationCreate,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint - submit a job application from the landing page."""
    application = JobApplication(
        name=data.name,
        email=data.email,
        phone=data.phone,
        position=data.position,
        location=data.location,
        message=data.message,
    )
    db.add(application)
    await db.commit()
    await db.refresh(application)

    # Notify owners via SMS
    result = await db.execute(
        select(User).where(User.role == UserRole.owner, User.is_active.is_(True))
    )
    owners = result.scalars().all()
    for owner in owners:
        if owner.phone:
            await send_sms(
                owner.phone,
                f"Six Beans: New job application from {data.name} for {data.position} at {data.location}. Log in to review.",
            )

    return {"message": "Application submitted successfully", "id": application.id}


@router.get("/", response_model=list[JobApplicationResponse])
async def list_applications(
    _current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Owner only - list all job applications."""
    result = await db.execute(
        select(JobApplication).order_by(JobApplication.created_at.desc())
    )
    applications = result.scalars().all()
    return [
        JobApplicationResponse(
            id=app.id,
            name=app.name,
            email=app.email,
            phone=app.phone,
            position=app.position,
            location=app.location,
            message=app.message,
            created_at=app.created_at.isoformat(),
        )
        for app in applications
    ]


@router.delete("/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_application(
    application_id: int,
    _current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Owner only - delete a job application."""
    result = await db.execute(
        select(JobApplication).where(JobApplication.id == application_id)
    )
    application = result.scalar_one_or_none()
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )
    await db.delete(application)
    await db.commit()
