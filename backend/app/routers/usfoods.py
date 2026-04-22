"""US Foods order management router."""

import logging
from collections import defaultdict

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models.usfoods import (
    RunStatus,
    USFoodsProduct,
    USFoodsRunItem,
    USFoodsShopMapping,
    USFoodsWeeklyRun,
)
from app.models.user import User, UserRole
from app.schemas.usfoods import (
    RunItemCreate,
    RunItemUpdate,
    SubmitResultPayload,
    USFoodsProductResponse,
    USFoodsRunItemResponse,
    USFoodsRunListItem,
    USFoodsRunResponse,
    USFoodsShopMappingResponse,
    USFoodsShopSummary,
    ValidationResultPayload,
)
from app.services.usfoods_service import generate_weekly_run

logger = logging.getLogger(__name__)

router = APIRouter()


# --- Agent auth helper ---

async def verify_agent_key(x_agent_key: str = Header(...)) -> bool:
    """Verify the agent key matches the JWT secret (shared secret for agent auth)."""
    if x_agent_key != settings.jwt_secret_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid agent key",
        )
    return True


# --- Helper to serialize run items ---

def _serialize_run_item(item: USFoodsRunItem) -> dict:
    return {
        "id": item.id,
        "run_id": item.run_id,
        "shop_mapping_id": item.shop_mapping_id,
        "product_id": item.product_id,
        "product_number": item.product.product_number if item.product else None,
        "product_description": item.product.description if item.product else None,
        "quantity": item.quantity,
        "unit": item.unit,
        "square_item_name": item.square_item_name,
        "is_flagged": item.is_flagged,
        "flag_reason": item.flag_reason,
        "is_filler": item.is_filler,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


# --- Owner endpoints ---

@router.get("/runs")
async def list_runs(
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """List all weekly runs, newest first."""
    result = await db.execute(
        select(USFoodsWeeklyRun).order_by(USFoodsWeeklyRun.run_date.desc())
    )
    runs = result.scalars().all()
    return [
        {
            "id": r.id,
            "run_date": r.run_date.isoformat(),
            "status": r.status.value if isinstance(r.status, RunStatus) else r.status,
            "square_orders_count": r.square_orders_count,
            "total_line_items": r.total_line_items,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in runs
    ]


@router.get("/runs/{run_id}")
async def get_run(
    run_id: int,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Get run detail with items grouped by shop."""
    result = await db.execute(
        select(USFoodsWeeklyRun)
        .options(
            selectinload(USFoodsWeeklyRun.items)
            .selectinload(USFoodsRunItem.product),
            selectinload(USFoodsWeeklyRun.items)
            .selectinload(USFoodsRunItem.shop_mapping),
        )
        .where(USFoodsWeeklyRun.id == run_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # Group items by customer number (merges aliases like Adelia -> Hesperia)
    shops_map: dict[str, dict] = defaultdict(lambda: {
        "shop_name": "",
        "customer_number": "",
        "sub_shops": [],
        "items": [],
        "flagged_count": 0,
    })

    for item in run.items:
        mapping = item.shop_mapping
        if not mapping:
            continue
        cust_num = mapping.customer_number
        shop_data = shops_map[cust_num]
        shop_data["customer_number"] = cust_num

        # Use the non-alias name as primary, track sub-shops
        if mapping.is_routing_alias:
            if mapping.us_foods_account_name not in shop_data["sub_shops"]:
                shop_data["sub_shops"].append(mapping.us_foods_account_name)
        else:
            shop_data["shop_name"] = mapping.us_foods_account_name

        shop_data["items"].append(_serialize_run_item(item))
        if item.is_flagged:
            shop_data["flagged_count"] += 1

    shops = []
    for data in shops_map.values():
        name = data["shop_name"] or data["sub_shops"][0] if data["sub_shops"] else "Unknown"
        if data["sub_shops"]:
            name += f" (includes: {', '.join(data['sub_shops'])})"
        shops.append({
            "shop_name": name,
            "customer_number": data["customer_number"],
            "item_count": len(data["items"]),
            "flagged_count": data["flagged_count"],
            "meets_minimum": len(data["items"]) >= 15,
            "items": data["items"],
        })

    return {
        "id": run.id,
        "run_date": run.run_date.isoformat(),
        "order_window_start": run.order_window_start.isoformat() if run.order_window_start else None,
        "order_window_end": run.order_window_end.isoformat() if run.order_window_end else None,
        "status": run.status.value if isinstance(run.status, RunStatus) else run.status,
        "square_orders_count": run.square_orders_count,
        "total_line_items": run.total_line_items,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
        "csv_data": run.csv_data,
        "shops": shops,
    }


@router.post("/runs/generate", status_code=status.HTTP_201_CREATED)
async def trigger_generate_run(
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Trigger generation of a new weekly run from Square orders."""
    import traceback
    try:
        run = await generate_weekly_run(db)
        await db.commit()
        return {
            "id": run.id,
            "run_date": run.run_date.isoformat(),
            "status": run.status.value if isinstance(run.status, RunStatus) else run.status,
            "square_orders_count": run.square_orders_count,
            "total_line_items": run.total_line_items,
            "order_window_start": run.order_window_start.isoformat() if run.order_window_start else None,
            "order_window_end": run.order_window_end.isoformat() if run.order_window_end else None,
        }
    except Exception as e:
        logger.exception("Failed to generate weekly run")
        return {"error": str(e), "traceback": traceback.format_exc()}


@router.patch("/runs/{run_id}/items/{item_id}")
async def update_run_item(
    run_id: int,
    item_id: int,
    body: RunItemUpdate,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Edit a run item (quantity, unit, flags)."""
    result = await db.execute(
        select(USFoodsRunItem)
        .options(selectinload(USFoodsRunItem.product))
        .where(USFoodsRunItem.id == item_id, USFoodsRunItem.run_id == run_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(item, field, value)
    await db.flush()

    return _serialize_run_item(item)


@router.post("/runs/{run_id}/items", status_code=status.HTTP_201_CREATED)
async def add_run_item(
    run_id: int,
    body: RunItemCreate,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Add a new item to a run from the product catalog."""
    # Verify run exists
    run_result = await db.execute(
        select(USFoodsWeeklyRun).where(USFoodsWeeklyRun.id == run_id)
    )
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # Verify product exists
    prod_result = await db.execute(
        select(USFoodsProduct).where(USFoodsProduct.id == body.product_id)
    )
    product = prod_result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Verify shop mapping exists
    mapping_result = await db.execute(
        select(USFoodsShopMapping).where(USFoodsShopMapping.id == body.shop_mapping_id)
    )
    mapping = mapping_result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(status_code=404, detail="Shop mapping not found")

    item = USFoodsRunItem(
        run_id=run_id,
        shop_mapping_id=body.shop_mapping_id,
        product_id=body.product_id,
        quantity=body.quantity,
        unit=body.unit,
        is_filler=True,  # Manually added items are fillers
    )
    db.add(item)
    await db.flush()

    run.total_line_items += 1
    await db.flush()

    return {
        "id": item.id,
        "run_id": item.run_id,
        "product_id": item.product_id,
        "shop_mapping_id": item.shop_mapping_id,
        "quantity": item.quantity,
        "unit": item.unit,
        "is_filler": item.is_filler,
    }


@router.delete("/runs/{run_id}/items/{item_id}")
async def remove_run_item(
    run_id: int,
    item_id: int,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Remove an item from a run."""
    result = await db.execute(
        select(USFoodsRunItem).where(
            USFoodsRunItem.id == item_id, USFoodsRunItem.run_id == run_id
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    await db.delete(item)

    # Update run total
    run_result = await db.execute(
        select(USFoodsWeeklyRun).where(USFoodsWeeklyRun.id == run_id)
    )
    run = run_result.scalar_one_or_none()
    if run and run.total_line_items > 0:
        run.total_line_items -= 1

    await db.flush()
    return {"ok": True}


@router.post("/runs/{run_id}/validate")
async def mark_for_validation(
    run_id: int,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Mark a run as ready for validation (agent will pick it up)."""
    result = await db.execute(
        select(USFoodsWeeklyRun).where(USFoodsWeeklyRun.id == run_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    run.status = RunStatus.pending_validation
    await db.flush()
    return {"id": run.id, "status": run.status.value}


@router.post("/runs/{run_id}/rebuild-csv")
async def rebuild_csv(
    run_id: int,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Rebuild CSV from current run items (after edits/additions)."""
    from app.services.usfoods_service import build_csv

    result = await db.execute(
        select(USFoodsWeeklyRun).where(USFoodsWeeklyRun.id == run_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # Load items with relationships
    items_result = await db.execute(
        select(USFoodsRunItem).where(USFoodsRunItem.run_id == run_id)
    )
    items = items_result.scalars().all()

    # Load shop mappings and products
    mappings_result = await db.execute(select(USFoodsShopMapping))
    shop_mappings = mappings_result.scalars().all()

    products_result = await db.execute(select(USFoodsProduct))
    products_by_number = {p.product_number: p for p in products_result.scalars().all()}

    run.csv_data = build_csv(items, shop_mappings, products_by_number)
    await db.flush()
    await db.commit()

    return {"csv_data": run.csv_data}


@router.post("/runs/{run_id}/submit")
async def mark_for_submit(
    run_id: int,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Mark a run as ready for real submission (agent will pick it up)."""
    result = await db.execute(
        select(USFoodsWeeklyRun).where(USFoodsWeeklyRun.id == run_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.status != RunStatus.reviewing:
        raise HTTPException(
            status_code=400,
            detail="Run must be in 'reviewing' status to submit",
        )

    run.status = RunStatus.pending_submit
    await db.flush()
    await db.commit()
    return {"id": run.id, "status": run.status.value}


@router.post("/cron/generate")
async def cron_generate_run(
    x_cron_key: str = Header(..., alias="X-Cron-Key"),
    db: AsyncSession = Depends(get_db),
):
    """Monday 11 AM cron: generate weekly run from Square orders."""
    if x_cron_key != settings.jwt_secret_key:
        raise HTTPException(status_code=403, detail="Invalid cron key")

    from app.services.usfoods_service import generate_weekly_run

    try:
        run = await generate_weekly_run(db)
        await db.commit()
        return {"id": run.id, "status": run.status.value, "total_items": run.total_line_items}
    except Exception as e:
        logger.exception("Cron generate run failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/products")
async def list_products(
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """List the US Foods product catalog."""
    result = await db.execute(
        select(USFoodsProduct)
        .where(USFoodsProduct.is_active == True)  # noqa: E712
        .order_by(USFoodsProduct.description)
    )
    products = result.scalars().all()
    return [
        {
            "id": p.id,
            "product_number": p.product_number,
            "description": p.description,
            "brand": p.brand,
            "pack_size": p.pack_size,
            "storage_class": p.storage_class,
            "default_unit": p.default_unit,
            "current_price": p.current_price,
        }
        for p in products
    ]


@router.get("/shops")
async def list_shops(
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """List US Foods shop mappings."""
    result = await db.execute(
        select(USFoodsShopMapping).order_by(USFoodsShopMapping.us_foods_account_name)
    )
    mappings = result.scalars().all()
    return [
        {
            "id": m.id,
            "location_id": m.location_id,
            "customer_number": m.customer_number,
            "us_foods_account_name": m.us_foods_account_name,
            "distributor": m.distributor,
            "department": m.department,
            "match_keywords": m.match_keywords,
            "is_routing_alias": m.is_routing_alias,
            "notes": m.notes,
        }
        for m in mappings
    ]


@router.get("/analytics")
async def get_analytics(
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Get consumption trends and price history for the dashboard."""
    # Recent runs summary
    runs_result = await db.execute(
        select(USFoodsWeeklyRun)
        .order_by(USFoodsWeeklyRun.run_date.desc())
        .limit(12)
    )
    runs = runs_result.scalars().all()

    # Products with price changes
    from app.models.usfoods import USFoodsPriceHistory

    price_changes_result = await db.execute(
        select(USFoodsProduct)
        .where(
            USFoodsProduct.previous_price.isnot(None),
            USFoodsProduct.current_price != USFoodsProduct.previous_price,
        )
        .order_by(USFoodsProduct.price_updated_at.desc())
        .limit(20)
    )
    price_changes = price_changes_result.scalars().all()

    return {
        "recent_runs": [
            {
                "id": r.id,
                "run_date": r.run_date.isoformat(),
                "status": r.status.value if isinstance(r.status, RunStatus) else r.status,
                "total_line_items": r.total_line_items,
            }
            for r in runs
        ],
        "price_changes": [
            {
                "product_number": p.product_number,
                "description": p.description,
                "current_price": p.current_price,
                "previous_price": p.previous_price,
                "price_updated_at": p.price_updated_at.isoformat() if p.price_updated_at else None,
            }
            for p in price_changes
        ],
    }


# --- Agent endpoints ---

@router.get("/agent/pending")
async def agent_get_pending(
    _: bool = Depends(verify_agent_key),
    db: AsyncSession = Depends(get_db),
):
    """Get the next job for the agent (validation or submit)."""
    # Check for pending validation first
    result = await db.execute(
        select(USFoodsWeeklyRun)
        .where(USFoodsWeeklyRun.status == RunStatus.pending_validation)
        .order_by(USFoodsWeeklyRun.created_at.asc())
        .limit(1)
    )
    run = result.scalar_one_or_none()
    if run:
        return {
            "job_type": "validate",
            "run_id": run.id,
            "csv_data": run.csv_data,
        }

    # Check for pending submit
    result = await db.execute(
        select(USFoodsWeeklyRun)
        .where(USFoodsWeeklyRun.status == RunStatus.pending_submit)
        .order_by(USFoodsWeeklyRun.created_at.asc())
        .limit(1)
    )
    run = result.scalar_one_or_none()
    if run:
        return {
            "job_type": "submit",
            "run_id": run.id,
            "csv_data": run.csv_data,
        }

    return {"job_type": None}


@router.post("/agent/validation-result")
async def agent_post_validation_result(
    body: ValidationResultPayload,
    _: bool = Depends(verify_agent_key),
    db: AsyncSession = Depends(get_db),
):
    """Agent posts validation results from the Playwright scrape."""
    from app.services.usfoods_service import apply_validation_results

    run_result = await db.execute(
        select(USFoodsWeeklyRun).where(USFoodsWeeklyRun.id == body.run_id)
    )
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    await apply_validation_results(db, body.run_id, body.results)

    # Transition to reviewing status
    run.status = RunStatus.reviewing
    await db.flush()
    await db.commit()

    # Count flagged items for the SMS
    items_result = await db.execute(
        select(USFoodsRunItem).where(USFoodsRunItem.run_id == body.run_id)
    )
    all_items = items_result.scalars().all()
    flagged_count = sum(1 for i in all_items if i.is_flagged)
    total_items = len(all_items)

    # Count unique shops
    shop_ids = set(i.shop_mapping_id for i in all_items)

    # Send SMS notification to owner
    try:
        from app.services.notification_service import send_sms

        owner_result = await db.execute(
            select(User).where(User.role == UserRole.owner, User.is_active.is_(True))
        )
        owners = owner_result.scalars().all()
        msg = (
            f"Six Beans: US Foods order ready for review. "
            f"{total_items} items across {len(shop_ids)} shops."
        )
        if flagged_count > 0:
            msg += f" {flagged_count} flagged items need attention."
        msg += " Review at sixbeanscoffee.com/portal/usfoods"

        for owner in owners:
            if owner.phone:
                await send_sms(owner.phone, msg)
    except Exception:
        logger.exception("Failed to send US Foods validation SMS")

    return {"ok": True, "status": run.status.value}


@router.post("/agent/submit-result")
async def agent_post_submit_result(
    body: SubmitResultPayload,
    _: bool = Depends(verify_agent_key),
    db: AsyncSession = Depends(get_db),
):
    """Agent posts submission confirmation."""
    run_result = await db.execute(
        select(USFoodsWeeklyRun).where(USFoodsWeeklyRun.id == body.run_id)
    )
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if body.success:
        run.status = RunStatus.submitted
    else:
        run.status = RunStatus.failed

    await db.flush()

    return {"ok": True, "status": run.status.value}
