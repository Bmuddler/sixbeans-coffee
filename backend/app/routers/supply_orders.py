"""Supply ordering system — catalog browsing and order management."""

import logging
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.location import Location
from app.models.supply_catalog import SupplyItem, SupplyOrder, SupplyOrderItem
from app.models.user import User, UserRole
from app.services.notification_service import send_sms, user_wants_sms
from app.services.units import compute_cost_per_base_unit, base_unit_for, normalize_unit

logger = logging.getLogger(__name__)

router = APIRouter()


# --- Schemas ---

class OrderItemIn(BaseModel):
    supply_item_id: int
    quantity: int


class CreateOrderIn(BaseModel):
    location_id: int
    notes: str | None = None
    items: list[OrderItemIn]


class UpdateStatusIn(BaseModel):
    status: str


class CatalogItemIn(BaseModel):
    name: str
    category: str
    description: str | None = None
    price: float | None = None
    square_token: str | None = None
    pack_size: float | None = None
    pack_unit: str | None = None
    is_count_item: bool = False
    density_oz_per_cup: float | None = None


class CatalogItemUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    description: str | None = None
    price: float | None = None
    is_active: bool | None = None
    square_token: str | None = None
    pack_size: float | None = None
    pack_unit: str | None = None
    is_count_item: bool | None = None
    density_oz_per_cup: float | None = None


# --- Endpoints ---

@router.get("/catalog")
async def get_catalog(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all active supply items grouped by category."""
    result = await db.execute(
        select(SupplyItem)
        .where(SupplyItem.is_active == True)  # noqa: E712
        .order_by(SupplyItem.category, SupplyItem.name)
    )
    items = result.scalars().all()

    grouped: dict[str, list] = defaultdict(list)
    for item in items:
        grouped[item.category].append({
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "price": item.price,
            "pack_size": item.pack_size,
            "pack_unit": item.pack_unit,
            "is_count_item": item.is_count_item,
            "density_oz_per_cup": item.density_oz_per_cup,
            "cost_per_base_unit": item.cost_per_base_unit,
            "base_unit": base_unit_for(item.pack_unit) if item.pack_unit else None,
        })

    categories = [
        {"name": cat, "items": cat_items}
        for cat, cat_items in sorted(grouped.items())
    ]
    return {"categories": categories}


@router.post("/catalog", status_code=status.HTTP_201_CREATED)
async def create_catalog_item(
    body: CatalogItemIn,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Add a new item to the supply catalog (owner only)."""
    pack_unit = normalize_unit(body.pack_unit) or None
    item = SupplyItem(
        name=body.name,
        category=body.category,
        description=body.description,
        price=body.price,
        square_token=body.square_token,
        pack_size=body.pack_size,
        pack_unit=pack_unit,
        is_count_item=bool(body.is_count_item),
        density_oz_per_cup=body.density_oz_per_cup,
        cost_per_base_unit=compute_cost_per_base_unit(body.price, body.pack_size, pack_unit),
    )
    db.add(item)
    await db.flush()
    return _serialize_item(item)


@router.patch("/catalog/{item_id}")
async def update_catalog_item(
    item_id: int,
    body: CatalogItemUpdate,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Edit a supply catalog item (owner only)."""
    result = await db.execute(select(SupplyItem).where(SupplyItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    update_data = body.model_dump(exclude_unset=True)
    if "pack_unit" in update_data:
        update_data["pack_unit"] = normalize_unit(update_data["pack_unit"]) or None
    for field, value in update_data.items():
        setattr(item, field, value)
    # Recompute the cached cost-per-base-unit whenever any cost-driving
    # input changed.
    if any(k in update_data for k in ("price", "pack_size", "pack_unit")):
        item.cost_per_base_unit = compute_cost_per_base_unit(
            item.price, item.pack_size, item.pack_unit,
        )
    await db.flush()

    return _serialize_item(item)


@router.delete("/catalog/{item_id}")
async def delete_catalog_item(
    item_id: int,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Deactivate a supply catalog item (owner only)."""
    result = await db.execute(select(SupplyItem).where(SupplyItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    item.is_active = False
    await db.flush()
    return {"ok": True}


@router.post("/catalog/{item_id}/copy", status_code=status.HTTP_201_CREATED)
async def copy_catalog_item(
    item_id: int,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Duplicate a supply catalog item (owner only)."""
    result = await db.execute(select(SupplyItem).where(SupplyItem.id == item_id))
    original = result.scalar_one_or_none()
    if not original:
        raise HTTPException(status_code=404, detail="Item not found")

    copy = SupplyItem(
        name=f"{original.name} (Copy)",
        category=original.category,
        description=original.description,
        price=original.price,
        square_token=None,
        pack_size=original.pack_size,
        pack_unit=original.pack_unit,
        is_count_item=original.is_count_item,
        density_oz_per_cup=original.density_oz_per_cup,
        cost_per_base_unit=original.cost_per_base_unit,
    )
    db.add(copy)
    await db.flush()

    return _serialize_item(copy)


def _serialize_item(item: SupplyItem) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "description": item.description,
        "price": item.price,
        "is_active": item.is_active,
        "pack_size": item.pack_size,
        "pack_unit": item.pack_unit,
        "is_count_item": item.is_count_item,
        "density_oz_per_cup": item.density_oz_per_cup,
        "cost_per_base_unit": item.cost_per_base_unit,
        "base_unit": base_unit_for(item.pack_unit) if item.pack_unit else None,
    }


@router.post("/orders", status_code=status.HTTP_201_CREATED)
async def create_order(
    body: CreateOrderIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit a supply order request."""
    if not body.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item")

    # Verify location exists
    loc_result = await db.execute(select(Location).where(Location.id == body.location_id))
    location = loc_result.scalar_one_or_none()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    # Look up supply items
    item_ids = [i.supply_item_id for i in body.items]
    supply_result = await db.execute(
        select(SupplyItem).where(SupplyItem.id.in_(item_ids), SupplyItem.is_active == True)  # noqa: E712
    )
    supply_items_map = {si.id: si for si in supply_result.scalars().all()}

    # Create order
    order = SupplyOrder(
        location_id=body.location_id,
        ordered_by=current_user.id,
        status="pending",
        notes=body.notes,
    )
    db.add(order)
    await db.flush()

    for line in body.items:
        si = supply_items_map.get(line.supply_item_id)
        if not si:
            raise HTTPException(
                status_code=404,
                detail=f"Supply item {line.supply_item_id} not found or inactive",
            )
        order_item = SupplyOrderItem(
            order_id=order.id,
            supply_item_id=si.id,
            quantity=line.quantity,
            item_name=si.name,
            item_price=si.price,
        )
        db.add(order_item)

    await db.commit()
    await db.refresh(order)

    # Notify owners via SMS
    orderer_name = f"{current_user.first_name} {current_user.last_name}"
    owners_result = await db.execute(
        select(User).where(User.role == UserRole.owner, User.is_active == True)  # noqa: E712
    )
    owners = owners_result.scalars().all()
    for owner in owners:
        if owner.id != current_user.id and user_wants_sms(owner, "supply_order"):
            await send_sms(
                owner.phone,
                f"Six Beans: New supply order #{order.id} from {orderer_name} "
                f"for {location.name}. {len(body.items)} item(s). Log in to review.",
            )

    return {"id": order.id, "status": order.status, "created_at": order.created_at.isoformat()}


@router.get("/orders")
async def list_orders(
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    """List supply orders. Owners see all; managers see their locations only."""
    query = (
        select(SupplyOrder)
        .options(
            selectinload(SupplyOrder.location),
            selectinload(SupplyOrder.orderer),
            selectinload(SupplyOrder.items),
        )
        .order_by(SupplyOrder.created_at.desc())
    )

    if current_user.role == UserRole.manager:
        user_location_ids = [loc.id for loc in current_user.locations]
        query = query.where(SupplyOrder.location_id.in_(user_location_ids))

    result = await db.execute(query)
    orders = result.scalars().all()

    return [_serialize_order(o) for o in orders]


@router.get("/orders/{order_id}")
async def get_order(
    order_id: int,
    current_user: User = Depends(require_roles(UserRole.owner, UserRole.manager)),
    db: AsyncSession = Depends(get_db),
):
    """Get a single order with full details."""
    result = await db.execute(
        select(SupplyOrder)
        .options(
            selectinload(SupplyOrder.location),
            selectinload(SupplyOrder.orderer),
            selectinload(SupplyOrder.items),
        )
        .where(SupplyOrder.id == order_id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Managers can only see orders for their locations
    if current_user.role == UserRole.manager:
        user_location_ids = [loc.id for loc in current_user.locations]
        if order.location_id not in user_location_ids:
            raise HTTPException(status_code=403, detail="Access denied")

    return _serialize_order(order)


@router.patch("/orders/{order_id}/status")
async def update_order_status(
    order_id: int,
    body: UpdateStatusIn,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Update order status (owner only)."""
    if body.status not in ("confirmed", "delivered"):
        raise HTTPException(status_code=400, detail="Status must be 'confirmed' or 'delivered'")

    result = await db.execute(
        select(SupplyOrder)
        .options(selectinload(SupplyOrder.orderer), selectinload(SupplyOrder.location))
        .where(SupplyOrder.id == order_id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = body.status
    order.updated_at = datetime.utcnow()
    await db.commit()

    # Notify the orderer
    if order.orderer and order.orderer.id != current_user.id:
        if user_wants_sms(order.orderer, "supply_order"):
            loc_name = order.location.name if order.location else "unknown"
            await send_sms(
                order.orderer.phone,
                f"Six Beans: Your supply order #{order.id} for {loc_name} "
                f"has been {body.status}.",
            )

    return {"id": order.id, "status": order.status}


@router.delete("/orders/{order_id}")
async def delete_order(
    order_id: int,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Delete a supply order (owner only)."""
    result = await db.execute(select(SupplyOrder).where(SupplyOrder.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    await db.delete(order)
    await db.flush()
    return {"ok": True}


def _serialize_order(order: SupplyOrder) -> dict:
    return {
        "id": order.id,
        "location_id": order.location_id,
        "location_name": order.location.name if order.location else None,
        "ordered_by": order.ordered_by,
        "orderer_name": (
            f"{order.orderer.first_name} {order.orderer.last_name}"
            if order.orderer else None
        ),
        "status": order.status,
        "notes": order.notes,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "updated_at": order.updated_at.isoformat() if order.updated_at else None,
        "items": [
            {
                "id": item.id,
                "supply_item_id": item.supply_item_id,
                "item_name": item.item_name,
                "item_price": item.item_price,
                "quantity": item.quantity,
            }
            for item in order.items
        ],
    }
