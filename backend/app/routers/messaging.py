from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.messaging import Message
from app.models.user import User, UserRole
from app.schemas.messaging import MessageCreate, MessageListResponse, MessageResponse
from app.services.audit_service import log_action

router = APIRouter()


@router.post("/", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Only managers/owners can send announcements
    if data.is_announcement and current_user.role == UserRole.employee:
        raise HTTPException(status_code=403, detail="Only managers/owners can send announcements")

    # Company-wide messages only from owners
    if data.location_id is None and current_user.role != UserRole.owner:
        raise HTTPException(status_code=403, detail="Only owners can send company-wide messages")

    msg = Message(
        sender_id=current_user.id,
        location_id=data.location_id,
        content=data.content,
        is_announcement=data.is_announcement,
    )
    db.add(msg)
    await db.flush()

    await log_action(db, current_user.id, "send_message", "message", msg.id)

    return MessageResponse(
        id=msg.id, sender_id=msg.sender_id, location_id=msg.location_id,
        content=msg.content, is_announcement=msg.is_announcement,
        sender_name=f"{current_user.first_name} {current_user.last_name}",
        created_at=msg.created_at,
    )


@router.get("/", response_model=MessageListResponse)
async def list_messages(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    location_id: int | None = None,
    announcements_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Message).options(selectinload(Message.sender))

    if current_user.role == UserRole.owner:
        if location_id:
            query = query.where(
                or_(Message.location_id == location_id, Message.location_id.is_(None))
            )
    elif current_user.role == UserRole.manager:
        loc_ids = [loc.id for loc in current_user.locations]
        query = query.where(
            or_(Message.location_id.in_(loc_ids), Message.location_id.is_(None))
        )
    else:
        loc_ids = [loc.id for loc in current_user.locations]
        query = query.where(
            or_(Message.location_id.in_(loc_ids), Message.location_id.is_(None))
        )

    if announcements_only:
        query = query.where(Message.is_announcement.is_(True))

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    query = query.order_by(Message.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    messages = result.scalars().all()

    return MessageListResponse(
        messages=[
            MessageResponse(
                id=m.id, sender_id=m.sender_id, location_id=m.location_id,
                content=m.content, is_announcement=m.is_announcement,
                sender_name=f"{m.sender.first_name} {m.sender.last_name}" if m.sender else None,
                created_at=m.created_at,
            )
            for m in messages
        ],
        total=total, page=page, per_page=per_page,
    )
