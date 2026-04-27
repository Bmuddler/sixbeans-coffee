import base64
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.company_document import CompanyDocument
from app.models.form_submission import FormSubmission
from app.models.user import User, UserRole
from app.schemas.form_submission import FormSubmissionCreate, FormSubmissionResponse
from app.services.w4_pdf import render_w4_pdf

# Fields that may contain full SSN. We never persist these in form_submissions.
SENSITIVE_FORM_FIELDS = {"ssn"}

router = APIRouter()


def _to_response(submission: FormSubmission) -> FormSubmissionResponse:
    employee_name = None
    if submission.employee:
        employee_name = f"{submission.employee.first_name} {submission.employee.last_name}"
    return FormSubmissionResponse(
        id=submission.id,
        employee_id=submission.employee_id,
        employee_name=employee_name,
        form_type=submission.form_type,
        form_data=json.loads(submission.form_data),
        submitted_at=submission.submitted_at,
        updated_at=submission.updated_at,
    )


@router.post("/", response_model=FormSubmissionResponse)
async def submit_form(
    payload: FormSubmissionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit or update a form. If user already has a submission for this form_type, update it."""
    submitted_at = datetime.utcnow()
    employee_name = f"{current_user.first_name} {current_user.last_name}".strip()

    # For W-4: render the full form (including full SSN) into a PDF stored as
    # an owner-only CompanyDocument. The SSN is then stripped before the
    # submission row is persisted, so form_submissions.form_data never contains it.
    if payload.form_type == "w4":
        pdf_bytes = render_w4_pdf(payload.form_data, employee_name, submitted_at)
        safe_filename = (
            "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in employee_name)
            or f"employee-{current_user.id}"
        )
        date_str = submitted_at.strftime("%Y-%m-%d")
        pdf_doc = CompanyDocument(
            title=f"W-4 — {employee_name} ({date_str})",
            category="Tax Forms",
            filename=f"W4_{safe_filename}_{date_str}.pdf",
            file_data=base64.b64encode(pdf_bytes).decode("utf-8"),
            file_type="application/pdf",
            file_size=len(pdf_bytes),
            uploaded_by=current_user.id,
            visibility="owner",
        )
        db.add(pdf_doc)

    safe_form_data = {
        k: v for k, v in payload.form_data.items() if k not in SENSITIVE_FORM_FIELDS
    }

    result = await db.execute(
        select(FormSubmission)
        .options(selectinload(FormSubmission.employee))
        .where(
            FormSubmission.employee_id == current_user.id,
            FormSubmission.form_type == payload.form_type,
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.form_data = json.dumps(safe_form_data)
        existing.updated_at = submitted_at
        await db.commit()
        await db.refresh(existing)
        result = await db.execute(
            select(FormSubmission)
            .options(selectinload(FormSubmission.employee))
            .where(FormSubmission.id == existing.id)
        )
        submission = result.scalar_one()
    else:
        submission = FormSubmission(
            employee_id=current_user.id,
            form_type=payload.form_type,
            form_data=json.dumps(safe_form_data),
            submitted_at=submitted_at,
            updated_at=submitted_at,
        )
        db.add(submission)
        await db.commit()
        await db.refresh(submission)
        result = await db.execute(
            select(FormSubmission)
            .options(selectinload(FormSubmission.employee))
            .where(FormSubmission.id == submission.id)
        )
        submission = result.scalar_one()

    return _to_response(submission)


@router.get("/my", response_model=list[FormSubmissionResponse])
async def get_my_submissions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current user's form submissions."""
    result = await db.execute(
        select(FormSubmission)
        .options(selectinload(FormSubmission.employee))
        .where(FormSubmission.employee_id == current_user.id)
        .order_by(FormSubmission.submitted_at.desc())
    )
    submissions = result.scalars().all()
    return [_to_response(s) for s in submissions]


@router.get("/status")
async def get_form_status(
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    """Get form completion status for all employees (owner/manager only)."""
    users_result = await db.execute(
        select(User).where(User.is_active == True)  # noqa: E712
    )
    all_users = users_result.scalars().all()

    submissions_result = await db.execute(select(FormSubmission))
    all_submissions = submissions_result.scalars().all()

    # Build lookup: (employee_id, form_type) -> submission
    lookup: dict[tuple[int, str], FormSubmission] = {}
    for sub in all_submissions:
        lookup[(sub.employee_id, sub.form_type)] = sub

    statuses = []
    for user in all_users:
        w4 = lookup.get((user.id, "w4"))
        emergency = lookup.get((user.id, "emergency_contact"))
        statuses.append({
            "employee_id": user.id,
            "employee_name": f"{user.first_name} {user.last_name}",
            "w4_completed": w4 is not None,
            "emergency_contact_completed": emergency is not None,
            "w4_date": w4.submitted_at if w4 else None,
            "emergency_date": emergency.submitted_at if emergency else None,
        })

    return statuses


@router.get("/{submission_id}", response_model=FormSubmissionResponse)
async def get_submission(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific submission (owner/manager, or the employee who submitted it)."""
    result = await db.execute(
        select(FormSubmission)
        .options(selectinload(FormSubmission.employee))
        .where(FormSubmission.id == submission_id)
    )
    submission = result.scalar_one_or_none()

    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    # Only the submitter or owner/manager can view
    if submission.employee_id != current_user.id and current_user.role not in (
        UserRole.owner,
        UserRole.manager,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    return _to_response(submission)


@router.get("/", response_model=list[FormSubmissionResponse])
async def list_submissions(
    form_type: str | None = Query(None),
    employee_id: int | None = Query(None),
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    """List all submissions (owner/manager only). Optional filters by form_type and employee_id."""
    query = select(FormSubmission).options(selectinload(FormSubmission.employee))

    if form_type:
        query = query.where(FormSubmission.form_type == form_type)
    if employee_id:
        query = query.where(FormSubmission.employee_id == employee_id)

    query = query.order_by(FormSubmission.submitted_at.desc())
    result = await db.execute(query)
    submissions = result.scalars().all()
    return [_to_response(s) for s in submissions]
