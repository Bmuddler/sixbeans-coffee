"""Job application endpoints for the public Apply Now form."""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles
from app.models.job_application import JobApplication
from app.models.location import Location
from app.models.user import User, UserRole, user_locations
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
    status: str
    forwarded_to_location_id: int | None
    forwarded_to_location_name: str | None
    forwarded_at: str | None

    class Config:
        from_attributes = True


class ForwardRequest(BaseModel):
    location_id: int


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


def _to_response(app: JobApplication, loc_name: str | None) -> JobApplicationResponse:
    return JobApplicationResponse(
        id=app.id,
        name=app.name,
        email=app.email,
        phone=app.phone,
        position=app.position,
        location=app.location,
        message=app.message,
        created_at=app.created_at.isoformat(),
        status=app.status or "new",
        forwarded_to_location_id=app.forwarded_to_location_id,
        forwarded_to_location_name=loc_name,
        forwarded_at=app.forwarded_at.isoformat() if app.forwarded_at else None,
    )


@router.get("/", response_model=list[JobApplicationResponse])
async def list_applications(
    include_archived: bool = False,
    _current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Owner only - list all job applications."""
    query = select(JobApplication).order_by(JobApplication.created_at.desc())
    if not include_archived:
        query = query.where(JobApplication.status != "archived")
    result = await db.execute(query)
    applications = result.scalars().all()

    loc_ids = {a.forwarded_to_location_id for a in applications if a.forwarded_to_location_id}
    loc_lookup: dict[int, str] = {}
    if loc_ids:
        loc_rows = (await db.execute(
            select(Location).where(Location.id.in_(loc_ids))
        )).scalars().all()
        loc_lookup = {loc.id: loc.name for loc in loc_rows}

    return [
        _to_response(app, loc_lookup.get(app.forwarded_to_location_id) if app.forwarded_to_location_id else None)
        for app in applications
    ]


@router.post("/{application_id}/forward", response_model=JobApplicationResponse)
async def forward_application(
    application_id: int,
    payload: ForwardRequest,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Forward a job application to the managers at a specific location.

    Sends each active manager assigned to that location an SMS with the
    applicant's contact info. Marks the application as 'forwarded' and
    records who forwarded it.
    """
    app = (await db.execute(
        select(JobApplication).where(JobApplication.id == application_id)
    )).scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    location = (await db.execute(
        select(Location).where(Location.id == payload.location_id)
    )).scalar_one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    managers = (await db.execute(
        select(User)
        .join(user_locations, User.id == user_locations.c.user_id)
        .where(
            user_locations.c.location_id == payload.location_id,
            User.role == UserRole.manager,
            User.is_active.is_(True),
        )
    )).scalars().all()

    sent = 0
    for mgr in managers:
        if not mgr.phone:
            continue
        body = (
            f"Six Beans: {current_user.first_name} forwarded a job applicant to {location.name}. "
            f"{app.name} — {app.position}. "
            f"Phone: {app.phone}. Email: {app.email}."
        )
        try:
            await send_sms(mgr.phone, body)
            sent += 1
        except Exception:
            logger.exception("Failed to SMS manager %s for application %s", mgr.id, app.id)

    app.status = "forwarded"
    app.forwarded_to_location_id = location.id
    app.forwarded_at = datetime.utcnow()
    app.forwarded_by = current_user.id
    await db.commit()
    await db.refresh(app)

    return _to_response(app, location.name)


@router.post("/{application_id}/archive", response_model=JobApplicationResponse)
async def archive_application(
    application_id: int,
    _current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Owner only - mark an application as archived (hidden from the default list)."""
    app = (await db.execute(
        select(JobApplication).where(JobApplication.id == application_id)
    )).scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    app.status = "archived"
    await db.commit()
    await db.refresh(app)

    loc_name = None
    if app.forwarded_to_location_id:
        loc = (await db.execute(
            select(Location).where(Location.id == app.forwarded_to_location_id)
        )).scalar_one_or_none()
        loc_name = loc.name if loc else None
    return _to_response(app, loc_name)


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
