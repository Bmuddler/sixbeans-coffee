"""POS sales — upload + list + stats."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_roles
from app.models.location import Location
from app.models.pos_sale import PosSale, PosSaleModifier
from app.models.recipe import Recipe
from app.models.user import User, UserRole
from app.services.parsers.godaddy_items_xlsx import parse_godaddy_items_xlsx

router = APIRouter()


def _owner_only():
    return require_roles(UserRole.owner)


# ---------- Upload -------------------------------------------------------


@router.post("/pos-sales/upload-items-xlsx")
async def upload_items_xlsx(
    file: UploadFile = File(...),
    location_id: int = Form(...),
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    """Ingest a GoDaddy Items XLSX export for ONE store.

    The XLSX has no embedded location info, so the caller picks the
    location from a dropdown before upload.
    """
    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if loc is None:
        raise HTTPException(status_code=400, detail="location_id not found")

    raw = await file.read()
    try:
        lines = parse_godaddy_items_xlsx(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not lines:
        return {"ok": True, "inserted": 0, "skipped_duplicate": 0, "total_parsed": 0}

    # Build a single batch dedup-key set so we can reject duplicates within
    # the same upload AND against the existing table.
    hashes = [l.dedup_hash for l in lines]
    existing_rows = (await db.execute(
        select(PosSale.dedup_hash).where(PosSale.dedup_hash.in_(hashes))
    )).scalars().all()
    existing_set = set(existing_rows)

    inserted = 0
    skipped = 0
    seen_in_batch: set[str] = set()
    for line in lines:
        if line.dedup_hash in existing_set or line.dedup_hash in seen_in_batch:
            skipped += 1
            continue
        seen_in_batch.add(line.dedup_hash)
        sale = PosSale(
            location_id=location_id,
            sale_datetime=line.sale_datetime,
            transaction_id=line.transaction_id,
            order_id=line.order_id,
            sku=line.sku,
            item_name=line.item_name,
            raw_modifier_text=line.raw_modifier_text,
            unit_price=line.unit_price,
            quantity=line.quantity,
            subtotal=line.subtotal,
            item_discount=line.item_discount,
            item_fee=line.item_fee,
            total_taxes=line.total_taxes,
            grand_total=line.grand_total,
            status=line.status,
            source="godaddy_items",
            source_filename=file.filename,
            dedup_hash=line.dedup_hash,
        )
        db.add(sale)
        await db.flush()  # need sale.id for the modifier rows
        for idx, mod in enumerate(line.modifiers):
            db.add(PosSaleModifier(
                pos_sale_id=sale.id,
                group_name=mod.group_name,
                value=mod.value,
                sort_order=idx,
            ))
        inserted += 1

    await db.commit()
    return {
        "ok": True,
        "inserted": inserted,
        "skipped_duplicate": skipped,
        "total_parsed": len(lines),
        "filename": file.filename,
    }


# ---------- List + stats -------------------------------------------------


@router.get("/pos-sales")
async def list_pos_sales(
    start_date: date | None = None,
    end_date: date | None = None,
    location_id: int | None = None,
    sku: str | None = None,
    page: int = 1,
    per_page: int = 100,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(PosSale, Location.name, Recipe.id, Recipe.name)
        .outerjoin(Location, PosSale.location_id == Location.id)
        .outerjoin(Recipe, and_(Recipe.sku == PosSale.sku, Recipe.is_active.is_(True)))
        .options(selectinload(PosSale.modifiers))
    )
    if location_id:
        q = q.where(PosSale.location_id == location_id)
    if sku:
        q = q.where(PosSale.sku == sku)
    if start_date:
        q = q.where(func.date(PosSale.sale_datetime) >= start_date)
    if end_date:
        q = q.where(func.date(PosSale.sale_datetime) <= end_date)

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    q = q.order_by(PosSale.sale_datetime.desc(), PosSale.id.desc())
    q = q.offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(q)).all()

    items: list[dict] = []
    for sale, loc_name, recipe_id, recipe_name in rows:
        items.append({
            "id": sale.id,
            "sale_datetime": sale.sale_datetime.isoformat(),
            "transaction_id": sale.transaction_id,
            "order_id": sale.order_id,
            "sku": sale.sku,
            "item_name": sale.item_name,
            "modifiers": [
                {"group": m.group_name, "value": m.value}
                for m in sorted(sale.modifiers, key=lambda x: x.sort_order)
            ],
            "unit_price": sale.unit_price,
            "quantity": sale.quantity,
            "subtotal": sale.subtotal,
            "item_discount": sale.item_discount,
            "grand_total": sale.grand_total,
            "status": sale.status,
            "location_id": sale.location_id,
            "location_name": loc_name,
            "linked_recipe_id": recipe_id,
            "linked_recipe_name": recipe_name,
        })
    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.get("/pos-sales/stats")
async def pos_sales_stats(
    start_date: date | None = None,
    end_date: date | None = None,
    location_id: int | None = None,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    """Quick stats for the POS sales dashboard:
       - row count, distinct SKUs, gross total
       - SKU coverage: how many distinct SKUs have a recipe linked
       - top 10 SKUs by quantity
    """
    # Build the WHERE clauses once and reuse — avoids the cartesian-product
    # bug we'd hit with .select_from(base_q.subquery()) while still
    # referencing PosSale columns in the outer aggregate.
    conds = []
    if location_id:
        conds.append(PosSale.location_id == location_id)
    if start_date:
        conds.append(func.date(PosSale.sale_datetime) >= start_date)
    if end_date:
        conds.append(func.date(PosSale.sale_datetime) <= end_date)

    count_q = select(func.count(PosSale.id))
    if conds:
        count_q = count_q.where(*conds)
    count = (await db.execute(count_q)).scalar() or 0

    gross_q = select(func.coalesce(func.sum(PosSale.subtotal), 0.0))
    if conds:
        gross_q = gross_q.where(*conds)
    gross = (await db.execute(gross_q)).scalar() or 0.0

    distinct_q = select(
        PosSale.sku,
        func.count(PosSale.id),
        func.sum(PosSale.quantity),
        func.sum(PosSale.subtotal),
    ).group_by(PosSale.sku)
    if conds:
        distinct_q = distinct_q.where(*conds)
    distinct_skus = (await db.execute(distinct_q)).all()

    # Recipe coverage
    skus = {row[0] for row in distinct_skus if row[0]}
    linked_skus = set()
    if skus:
        linked_rows = (await db.execute(
            select(Recipe.sku).where(Recipe.sku.in_(skus), Recipe.is_active.is_(True))
        )).scalars().all()
        linked_skus = set(linked_rows)

    top_skus = sorted(
        ({"sku": r[0], "lines": int(r[1] or 0), "qty": float(r[2] or 0.0), "gross": float(r[3] or 0.0)}
         for r in distinct_skus if r[0]),
        key=lambda x: -x["qty"],
    )[:10]

    return {
        "rows": int(count),
        "gross_subtotal": round(float(gross), 2),
        "distinct_skus": len(skus),
        "linked_skus": len(linked_skus),
        "unlinked_skus": len(skus - linked_skus),
        "top_skus": top_skus,
        "window": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
        },
    }


@router.delete("/pos-sales/{sale_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pos_sale(
    sale_id: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    sale = (await db.execute(select(PosSale).where(PosSale.id == sale_id))).scalar_one_or_none()
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found")
    await db.delete(sale)
    await db.commit()
