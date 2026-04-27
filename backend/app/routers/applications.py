"""Job application endpoints for the public Apply Now form."""

import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles
from app.models.job_application import JobApplication
from app.models.location import Location
from app.models.user import User, UserRole, user_locations
from app.services.gmail_watcher import send_email
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
    rating: str | None
    forwarded_to_location_id: int | None
    forwarded_to_location_name: str | None
    forwarded_at: str | None
    rejected_at: str | None

    class Config:
        from_attributes = True


class ForwardRequest(BaseModel):
    location_id: int


class RateRequest(BaseModel):
    rating: Literal["yes", "maybe", "never"] | None


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
        rating=app.rating,
        forwarded_to_location_id=app.forwarded_to_location_id,
        forwarded_to_location_name=loc_name,
        forwarded_at=app.forwarded_at.isoformat() if app.forwarded_at else None,
        rejected_at=app.rejected_at.isoformat() if app.rejected_at else None,
    )


async def _resolve_location_name(db: AsyncSession, app: JobApplication) -> str | None:
    if not app.forwarded_to_location_id:
        return None
    loc = (await db.execute(
        select(Location).where(Location.id == app.forwarded_to_location_id)
    )).scalar_one_or_none()
    return loc.name if loc else None


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


def _format_forward_email(app: JobApplication, location_name: str, sender_name: str) -> tuple[str, str]:
    subject = f"[Six Beans] Job applicant for {location_name}: {app.name}"
    lines = [
        f"{sender_name} forwarded a job application to {location_name}.",
        "",
        "Applicant",
        f"  Name:     {app.name}",
        f"  Position: {app.position}",
        f"  Phone:    {app.phone}",
        f"  Email:    {app.email}",
        f"  Applied for shop: {app.location}",
        f"  Submitted: {app.created_at.strftime('%Y-%m-%d %H:%M UTC')}",
    ]
    if app.message:
        lines += ["", "Their message:", app.message]
    lines += [
        "",
        "Reach out directly to schedule an interview if you're interested.",
        "— Six Beans Coffee Co.",
    ]
    return subject, "\n".join(lines)


@router.post("/{application_id}/forward", response_model=JobApplicationResponse)
async def forward_application(
    application_id: int,
    payload: ForwardRequest,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Forward a job application to the managers at a specific location.

    Emails each active manager assigned to that location with the full
    application body. Marks the application as 'forwarded'.
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

    recipients = [m for m in managers if m.email and "@placeholder.sixbeans.local" not in m.email.lower()]
    if not recipients:
        raise HTTPException(
            status_code=400,
            detail=f"No managers with a real email address are assigned to {location.name}.",
        )

    subject, body = _format_forward_email(app, location.name, current_user.first_name)
    sent = 0
    failed: list[str] = []
    for mgr in recipients:
        try:
            await send_email(db, to=mgr.email, subject=subject, body=body)
            sent += 1
        except Exception as exc:
            logger.exception("Failed to email manager %s for application %s", mgr.id, app.id)
            failed.append(f"{mgr.email}: {exc}")

    if sent == 0:
        raise HTTPException(
            status_code=502,
            detail=f"Could not send to any manager. Errors: {'; '.join(failed) or 'unknown'}",
        )

    app.status = "forwarded"
    app.forwarded_to_location_id = location.id
    app.forwarded_at = datetime.utcnow()
    app.forwarded_by = current_user.id
    await db.commit()
    await db.refresh(app)

    return _to_response(app, location.name)


def _format_rejection_email(app: JobApplication) -> tuple[str, str]:
    subject = "Six Beans Coffee — Application Update"
    body = (
        f"Hi {app.name.split()[0] if app.name else 'there'},\n\n"
        f"Thank you for applying for the {app.position} position at Six Beans Coffee. "
        "We really appreciate your interest in joining our team.\n\n"
        "We are not currently hiring for this role, but we will keep your application "
        "on file and will reach out when we have an opening that matches your background.\n\n"
        "Best,\nThe Six Beans Team"
    )
    return subject, body


@router.post("/{application_id}/reject", response_model=JobApplicationResponse)
async def reject_application(
    application_id: int,
    _current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Send the canned 'not currently hiring' email and mark as rejected."""
    app = (await db.execute(
        select(JobApplication).where(JobApplication.id == application_id)
    )).scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if not app.email or "@" not in app.email:
        raise HTTPException(status_code=400, detail="Applicant has no usable email on file")

    subject, body = _format_rejection_email(app)
    try:
        await send_email(db, to=app.email, subject=subject, body=body)
    except Exception as exc:
        logger.exception("Rejection email send failed for application %s", app.id)
        raise HTTPException(status_code=502, detail=f"Email send failed: {exc}") from exc

    app.status = "rejected"
    app.rejected_at = datetime.utcnow()
    await db.commit()
    await db.refresh(app)
    return _to_response(app, await _resolve_location_name(db, app))


@router.post("/{application_id}/rate", response_model=JobApplicationResponse)
async def rate_application(
    application_id: int,
    payload: RateRequest,
    _current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Set or clear the owner's hiring rating: yes / maybe / never / null."""
    app = (await db.execute(
        select(JobApplication).where(JobApplication.id == application_id)
    )).scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    app.rating = payload.rating
    await db.commit()
    await db.refresh(app)
    return _to_response(app, await _resolve_location_name(db, app))


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
    return _to_response(app, await _resolve_location_name(db, app))


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
