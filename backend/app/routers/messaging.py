from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.messaging import Message, MessageRecipient
from app.models.user import User, UserRole, user_locations
from app.schemas.messaging import (
    MarkReadRequest,
    MessageCreate,
    MessageListResponse,
    MessageResponse,
    RecipientInfo,
)
from app.services.audit_service import log_action

router = APIRouter()


def _build_message_response(msg: Message, current_user_id: int | None = None) -> MessageResponse:
    recipients = []
    read_count = 0
    for r in (msg.recipients or []):
        name = f"{r.user.first_name} {r.user.last_name}" if r.user else None
        recipients.append(RecipientInfo(user_id=r.user_id, user_name=name, read_at=r.read_at))
        if r.read_at:
            read_count += 1

    return MessageResponse(
        id=msg.id,
        sender_id=msg.sender_id,
        location_id=msg.location_id,
        content=msg.content,
        is_announcement=msg.is_announcement,
        is_direct=getattr(msg, 'is_direct', False) or False,
        sender_name=f"{msg.sender.first_name} {msg.sender.last_name}" if msg.sender else None,
        created_at=msg.created_at,
        recipients=recipients,
        read_count=read_count,
        total_recipients=len(msg.recipients or []),
    )


@router.post("/", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if data.is_announcement and current_user.role == UserRole.employee:
        raise HTTPException(status_code=403, detail="Only managers/owners can send announcements")

    if data.location_id is None and not data.is_direct and not data.recipient_ids and current_user.role != UserRole.owner:
        raise HTTPException(status_code=403, detail="Only owners can send company-wide messages")

    msg = Message(
        sender_id=current_user.id,
        location_id=data.location_id,
        content=data.content,
        is_announcement=data.is_announcement,
        is_direct=bool(data.recipient_ids),
    )
    db.add(msg)
    await db.flush()

    # Add explicit recipients if provided
    if data.recipient_ids:
        for uid in data.recipient_ids:
            db.add(MessageRecipient(message_id=msg.id, user_id=uid))
        await db.flush()
    elif data.location_id and not data.is_announcement:
        # Auto-add all employees at the location as recipients
        result = await db.execute(
            select(user_locations.c.user_id).where(user_locations.c.location_id == data.location_id)
        )
        for row in result.all():
            if row[0] != current_user.id:
                db.add(MessageRecipient(message_id=msg.id, user_id=row[0]))
        await db.flush()

    await log_action(db, current_user.id, "send_message", "message", msg.id)

    # Reload with relationships
    result = await db.execute(
        select(Message)
        .options(selectinload(Message.sender), selectinload(Message.recipients).selectinload(MessageRecipient.user))
        .where(Message.id == msg.id)
    )
    msg = result.scalar_one()
    return _build_message_response(msg)


@router.get("/", response_model=MessageListResponse)
async def list_messages(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    location_id: int | None = None,
    announcements_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Message).options(
        selectinload(Message.sender),
        selectinload(Message.recipients).selectinload(MessageRecipient.user),
    )

    # Build visibility filter
    visibility_filters = []

    # Location-based messages the user can see
    if current_user.role == UserRole.owner:
        if location_id:
            visibility_filters.append(Message.location_id == location_id)
        else:
            visibility_filters.append(Message.location_id.isnot(None))
        visibility_filters.append(Message.location_id.is_(None))
    else:
        loc_ids = [loc.id for loc in current_user.locations]
        if location_id and location_id in loc_ids:
            visibility_filters.append(Message.location_id == location_id)
        else:
            visibility_filters.append(Message.location_id.in_(loc_ids))
        visibility_filters.append(Message.location_id.is_(None))

    # Direct messages where user is sender or recipient
    visibility_filters.append(
        and_(Message.is_direct.is_(True), Message.sender_id == current_user.id)
    )
    visibility_filters.append(
        and_(
            Message.is_direct.is_(True),
            Message.id.in_(
                select(MessageRecipient.message_id).where(MessageRecipient.user_id == current_user.id)
            ),
        )
    )

    query = query.where(or_(*visibility_filters))

    if announcements_only:
        query = query.where(Message.is_announcement.is_(True))

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    query = query.order_by(Message.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    messages = result.unique().scalars().all()

    return MessageListResponse(
        items=[_build_message_response(m, current_user.id) for m in messages],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.post("/mark-read")
async def mark_messages_read(
    data: MarkReadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    result = await db.execute(
        select(MessageRecipient).where(
            and_(
                MessageRecipient.message_id.in_(data.message_ids),
                MessageRecipient.user_id == current_user.id,
                MessageRecipient.read_at.is_(None),
            )
        )
    )
    recipients = result.scalars().all()
    count = 0
    for r in recipients:
        r.read_at = now
        count += 1

    return {"marked_read": count}


@router.get("/unread-count")
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(func.count(MessageRecipient.id)).where(
            and_(
                MessageRecipient.user_id == current_user.id,
                MessageRecipient.read_at.is_(None),
            )
        )
    )
    count = result.scalar() or 0
    return {"unread_count": count}
