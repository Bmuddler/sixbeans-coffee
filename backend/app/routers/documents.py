import base64
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.company_document import CompanyDocument
from app.models.user import User, UserRole

router = APIRouter()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/", status_code=status.HTTP_201_CREATED)
async def upload_document(
    title: str = Form(...),
    category: str = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    """Upload a document (manager/owner only)."""
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File size exceeds 10MB limit",
        )

    encoded = base64.b64encode(contents).decode("utf-8")

    document = CompanyDocument(
        title=title,
        category=category,
        filename=file.filename or "unknown",
        file_data=encoded,
        file_type=file.content_type or "application/octet-stream",
        file_size=len(contents),
        uploaded_by=current_user.id,
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)

    return {
        "id": document.id,
        "title": document.title,
        "category": document.category,
        "filename": document.filename,
        "file_type": document.file_type,
        "file_size": document.file_size,
        "uploaded_by_name": f"{current_user.first_name} {current_user.last_name}",
        "created_at": document.created_at,
    }


@router.get("/")
async def list_documents(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List documents the user can see. Owner-only docs are filtered out for non-owners."""
    query = (
        select(CompanyDocument)
        .options(selectinload(CompanyDocument.uploader))
        .order_by(CompanyDocument.created_at.desc())
    )
    if current_user.role != UserRole.owner:
        query = query.where(CompanyDocument.visibility == "all")

    result = await db.execute(query)
    documents = result.scalars().all()

    return [
        {
            "id": doc.id,
            "title": doc.title,
            "category": doc.category,
            "filename": doc.filename,
            "file_type": doc.file_type,
            "file_size": doc.file_size,
            "visibility": doc.visibility,
            "uploaded_by_name": (
                f"{doc.uploader.first_name} {doc.uploader.last_name}"
                if doc.uploader
                else "Unknown"
            ),
            "created_at": doc.created_at,
        }
        for doc in documents
    ]


@router.get("/{doc_id}/download")
async def download_document(
    doc_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download a document (any authenticated user)."""
    result = await db.execute(
        select(CompanyDocument).where(CompanyDocument.id == doc_id)
    )
    document = result.scalar_one_or_none()

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )

    if document.visibility == "owner" and current_user.role != UserRole.owner:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )

    file_bytes = base64.b64decode(document.file_data)
    return StreamingResponse(
        BytesIO(file_bytes),
        media_type=document.file_type,
        headers={
            "Content-Disposition": f'attachment; filename="{document.filename}"'
        },
    )


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: int,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    """Delete a document (manager/owner only)."""
    result = await db.execute(
        select(CompanyDocument).where(CompanyDocument.id == doc_id)
    )
    document = result.scalar_one_or_none()

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )

    await db.delete(document)
    await db.commit()
