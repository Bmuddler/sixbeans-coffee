"""Recipe & costing API.

Owner-only across the board. Endpoints:

  Categories:
    GET    /recipe-categories
    POST   /recipe-categories
    PATCH  /recipe-categories/{id}
    DELETE /recipe-categories/{id}

  Recipes:
    GET    /recipes
    POST   /recipes                  (optional template_id to clone from)
    GET    /recipes/{id}             (full recipe + current version + cost)
    PATCH  /recipes/{id}             (metadata only — name/category/yield/etc.)
    DELETE /recipes/{id}             (archive — soft delete)
    POST   /recipes/{id}/duplicate
    PUT    /recipes/{id}/ingredients (replace current version's ingredients
                                     atomically; creates a new version if
                                     the active one is referenced by sales)

  Pickable ingredients (drives the picker in the recipe builder UI):
    GET    /recipe-ingredients/options
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_roles
from app.models.recipe import (
    Recipe,
    RecipeCategory,
    RecipeIngredient,
    RecipeVersion,
)
from app.models.supply_catalog import SupplyItem
from app.models.user import User, UserRole
from app.services.recipe_costing import CostingError, cost_recipe
from app.services.units import base_unit_for, normalize_unit

router = APIRouter()


def _owner_only():
    return require_roles(UserRole.owner)


# ----- Schemas -----------------------------------------------------------


class CategoryIn(BaseModel):
    name: str
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None
    is_archived: bool | None = None


class RecipeIngredientIn(BaseModel):
    supply_item_id: int | None = None
    sub_recipe_id: int | None = None
    amount: float = Field(gt=0)
    unit: str
    size_variant: str | None = None
    sort_order: int = 0
    notes: str | None = None


class RecipeCreate(BaseModel):
    name: str
    category_id: int
    sku: str | None = None
    is_template: bool = False
    yields_amount: float | None = None
    yields_unit: str | None = None
    base_size: str | None = None
    notes: str | None = None
    template_id: int | None = None  # if set, clone ingredients from this recipe


class RecipeMetaUpdate(BaseModel):
    name: str | None = None
    category_id: int | None = None
    sku: str | None = None
    is_template: bool | None = None
    is_active: bool | None = None
    yields_amount: float | None = None
    yields_unit: str | None = None
    base_size: str | None = None
    notes: str | None = None


# ----- Helpers -----------------------------------------------------------


async def _get_or_404(db: AsyncSession, recipe_id: int) -> Recipe:
    rec = (await db.execute(select(Recipe).where(Recipe.id == recipe_id))).scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return rec


def _serialize_category(c: RecipeCategory) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "sort_order": c.sort_order,
        "is_archived": c.is_archived,
    }


def _serialize_recipe_summary(r: Recipe, cat_name: str | None) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "sku": r.sku,
        "category_id": r.category_id,
        "category_name": cat_name,
        "is_template": r.is_template,
        "is_active": r.is_active,
        "yields_amount": r.yields_amount,
        "yields_unit": r.yields_unit,
        "base_size": r.base_size,
        "notes": r.notes,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


async def _copy_ingredients(
    db: AsyncSession,
    src_version: RecipeVersion,
    dest_version: RecipeVersion,
) -> None:
    src_ings = (await db.execute(
        select(RecipeIngredient).where(RecipeIngredient.version_id == src_version.id)
        .order_by(RecipeIngredient.sort_order)
    )).scalars().all()
    for ing in src_ings:
        db.add(RecipeIngredient(
            version_id=dest_version.id,
            supply_item_id=ing.supply_item_id,
            sub_recipe_id=ing.sub_recipe_id,
            amount=ing.amount,
            unit=ing.unit,
            size_variant=ing.size_variant,
            sort_order=ing.sort_order,
            notes=ing.notes,
        ))


# ----- Categories --------------------------------------------------------


@router.get("/recipe-categories")
async def list_categories(
    include_archived: bool = False,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    q = select(RecipeCategory)
    if not include_archived:
        q = q.where(RecipeCategory.is_archived.is_(False))
    q = q.order_by(RecipeCategory.sort_order, RecipeCategory.name)
    rows = (await db.execute(q)).scalars().all()
    return {"items": [_serialize_category(c) for c in rows]}


@router.post("/recipe-categories", status_code=status.HTTP_201_CREATED)
async def create_category(
    body: CategoryIn,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    existing = (await db.execute(
        select(RecipeCategory).where(func.lower(RecipeCategory.name) == name.lower())
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Category '{name}' already exists")
    cat = RecipeCategory(name=name, sort_order=body.sort_order)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return _serialize_category(cat)


@router.patch("/recipe-categories/{cat_id}")
async def update_category(
    cat_id: int,
    body: CategoryUpdate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    cat = (await db.execute(select(RecipeCategory).where(RecipeCategory.id == cat_id))).scalar_one_or_none()
    if cat is None:
        raise HTTPException(status_code=404, detail="Category not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(cat, k, v)
    await db.commit()
    await db.refresh(cat)
    return _serialize_category(cat)


@router.delete("/recipe-categories/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    cat_id: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    cat = (await db.execute(select(RecipeCategory).where(RecipeCategory.id == cat_id))).scalar_one_or_none()
    if cat is None:
        raise HTTPException(status_code=404, detail="Category not found")
    # Block delete if recipes still use it.
    in_use = (await db.execute(
        select(func.count()).select_from(Recipe).where(Recipe.category_id == cat_id, Recipe.is_active.is_(True))
    )).scalar() or 0
    if in_use > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Category has {in_use} active recipe(s); reassign or archive them first.",
        )
    await db.delete(cat)
    await db.commit()


# ----- Recipes -----------------------------------------------------------


@router.get("/recipes")
async def list_recipes(
    category_id: int | None = None,
    is_template: bool | None = None,
    include_archived: bool = False,
    search: str | None = None,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(Recipe, RecipeCategory.name)
        .outerjoin(RecipeCategory, Recipe.category_id == RecipeCategory.id)
    )
    if not include_archived:
        q = q.where(Recipe.is_active.is_(True))
    if category_id is not None:
        q = q.where(Recipe.category_id == category_id)
    if is_template is not None:
        q = q.where(Recipe.is_template.is_(is_template))
    if search:
        like = f"%{search.lower()}%"
        q = q.where(func.lower(Recipe.name).like(like))
    q = q.order_by(Recipe.name)
    rows = (await db.execute(q)).all()
    return {"items": [_serialize_recipe_summary(r, cn) for r, cn in rows]}


@router.post("/recipes", status_code=status.HTTP_201_CREATED)
async def create_recipe(
    body: RecipeCreate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    cat = (await db.execute(
        select(RecipeCategory).where(RecipeCategory.id == body.category_id)
    )).scalar_one_or_none()
    if cat is None:
        raise HTTPException(status_code=400, detail="category_id not found")

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    rec = Recipe(
        name=name,
        sku=body.sku.strip() if body.sku else None,
        category_id=body.category_id,
        is_template=body.is_template,
        yields_amount=body.yields_amount,
        yields_unit=normalize_unit(body.yields_unit) or None if body.yields_unit else None,
        base_size=body.base_size,
        notes=body.notes,
    )
    db.add(rec)
    await db.flush()

    # First version, always.
    version = RecipeVersion(recipe_id=rec.id, version_number=1, started_at=datetime.utcnow())
    db.add(version)
    await db.flush()

    # Optionally clone from a template.
    if body.template_id is not None:
        tpl = (await db.execute(select(Recipe).where(Recipe.id == body.template_id))).scalar_one_or_none()
        if tpl is None:
            raise HTTPException(status_code=400, detail="template_id not found")
        tpl_version = (await db.execute(
            select(RecipeVersion).where(RecipeVersion.recipe_id == tpl.id)
            .order_by(RecipeVersion.version_number.desc())
        )).scalars().first()
        if tpl_version is not None:
            await _copy_ingredients(db, tpl_version, version)

    await db.commit()
    await db.refresh(rec)
    return _serialize_recipe_summary(rec, cat.name)


@router.get("/recipes/{recipe_id}")
async def get_recipe(
    recipe_id: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    rec = await _get_or_404(db, recipe_id)
    cat = (await db.execute(
        select(RecipeCategory.name).where(RecipeCategory.id == rec.category_id)
    )).scalar_one_or_none()

    versions = (await db.execute(
        select(RecipeVersion).where(RecipeVersion.recipe_id == rec.id)
        .order_by(RecipeVersion.version_number.desc())
    )).scalars().all()

    current = next((v for v in versions if v.ended_at is None), versions[0] if versions else None)
    ingredient_rows: list[dict] = []
    if current is not None:
        ings = (await db.execute(
            select(RecipeIngredient).where(RecipeIngredient.version_id == current.id)
            .options(selectinload(RecipeIngredient.supply_item),
                     selectinload(RecipeIngredient.sub_recipe))
            .order_by(RecipeIngredient.sort_order, RecipeIngredient.id)
        )).scalars().all()
        for ing in ings:
            ingredient_rows.append({
                "id": ing.id,
                "supply_item_id": ing.supply_item_id,
                "sub_recipe_id": ing.sub_recipe_id,
                "amount": ing.amount,
                "unit": ing.unit,
                "size_variant": ing.size_variant,
                "sort_order": ing.sort_order,
                "notes": ing.notes,
                "label": (ing.supply_item.name if ing.supply_item
                          else (ing.sub_recipe.name if ing.sub_recipe else "(missing)")),
                "kind": "supply" if ing.supply_item_id else "sub_recipe",
            })

    # Compute cost (best-effort — errors come back per-line).
    try:
        cost = await cost_recipe(db, rec.id)
        cost_payload = {
            "by_size": cost.by_size,
            "lines": [
                {
                    "label": line.label,
                    "kind": line.source_kind,
                    "source_id": line.source_id,
                    "amount": line.amount,
                    "unit": line.unit,
                    "size_variant": line.size_variant,
                    "cost": line.cost,
                    "error": line.error,
                }
                for line in cost.lines
            ],
            "cost_per_yield_unit": cost.cost_per_yield_unit,
        }
    except CostingError as exc:
        cost_payload = {"by_size": {}, "lines": [], "cost_per_yield_unit": None,
                        "error": str(exc)}

    return {
        **_serialize_recipe_summary(rec, cat),
        "current_version_id": current.id if current is not None else None,
        "version_count": len(versions),
        "ingredients": ingredient_rows,
        "cost": cost_payload,
    }


@router.patch("/recipes/{recipe_id}")
async def update_recipe_meta(
    recipe_id: int,
    body: RecipeMetaUpdate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    rec = await _get_or_404(db, recipe_id)
    data = body.model_dump(exclude_unset=True)
    if "yields_unit" in data and data["yields_unit"]:
        data["yields_unit"] = normalize_unit(data["yields_unit"]) or None
    for k, v in data.items():
        setattr(rec, k, v)
    if "is_active" in data and data["is_active"] is False:
        rec.archived_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.delete("/recipes/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_recipe(
    recipe_id: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    rec = await _get_or_404(db, recipe_id)
    rec.is_active = False
    rec.archived_at = datetime.utcnow()
    await db.commit()


@router.post("/recipes/{recipe_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_recipe(
    recipe_id: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    src = await _get_or_404(db, recipe_id)
    copy = Recipe(
        name=f"{src.name} (Copy)",
        sku=None,
        category_id=src.category_id,
        is_template=False,
        yields_amount=src.yields_amount,
        yields_unit=src.yields_unit,
        base_size=src.base_size,
        notes=src.notes,
    )
    db.add(copy)
    await db.flush()
    version = RecipeVersion(recipe_id=copy.id, version_number=1, started_at=datetime.utcnow())
    db.add(version)
    await db.flush()

    src_version = (await db.execute(
        select(RecipeVersion).where(RecipeVersion.recipe_id == src.id)
        .order_by(RecipeVersion.version_number.desc())
    )).scalars().first()
    if src_version is not None:
        await _copy_ingredients(db, src_version, version)

    await db.commit()
    return {"id": copy.id}


@router.put("/recipes/{recipe_id}/ingredients")
async def replace_ingredients(
    recipe_id: int,
    body: list[RecipeIngredientIn],
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    """Replace the current version's ingredient list atomically.

    Phase 2: simple replacement on the active (open) version. The
    versioning machinery is in the schema but not exposed yet — Phase 4
    flips this to "create a new version" once recipes are mapped to
    historical sales rows.
    """
    rec = await _get_or_404(db, recipe_id)

    # Validate every line first
    for line in body:
        has_supply = line.supply_item_id is not None
        has_sub = line.sub_recipe_id is not None
        if has_supply == has_sub:
            raise HTTPException(
                status_code=400,
                detail="Each ingredient must point to exactly one of supply_item_id / sub_recipe_id",
            )
        if has_sub and line.sub_recipe_id == recipe_id:
            raise HTTPException(status_code=400, detail="A recipe can't reference itself")
        if line.amount <= 0:
            raise HTTPException(status_code=400, detail="amount must be > 0")

    version = (await db.execute(
        select(RecipeVersion).where(RecipeVersion.recipe_id == rec.id, RecipeVersion.ended_at.is_(None))
        .order_by(RecipeVersion.version_number.desc())
    )).scalars().first()
    if version is None:
        # Make one if somehow missing.
        version = RecipeVersion(recipe_id=rec.id, version_number=1, started_at=datetime.utcnow())
        db.add(version)
        await db.flush()

    # Wipe existing lines and re-insert.
    existing = (await db.execute(
        select(RecipeIngredient).where(RecipeIngredient.version_id == version.id)
    )).scalars().all()
    for e in existing:
        await db.delete(e)
    await db.flush()

    for idx, line in enumerate(body):
        db.add(RecipeIngredient(
            version_id=version.id,
            supply_item_id=line.supply_item_id,
            sub_recipe_id=line.sub_recipe_id,
            amount=line.amount,
            unit=normalize_unit(line.unit) or line.unit,
            size_variant=line.size_variant,
            sort_order=line.sort_order if line.sort_order is not None else idx,
            notes=line.notes,
        ))
    await db.commit()
    return {"ok": True, "count": len(body)}


# ----- Pickable ingredient options (for the recipe builder UI) -----------


@router.get("/recipe-ingredients/options")
async def ingredient_options(
    search: str | None = None,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    """Two ingredient sources for the picker:
    1. Active SupplyItems with a pack price + unit set
    2. Active recipes that DO produce a yield (sub-recipes)
    """
    items_q = select(SupplyItem).where(SupplyItem.is_active.is_(True))
    if search:
        items_q = items_q.where(func.lower(SupplyItem.name).like(f"%{search.lower()}%"))
    items_q = items_q.order_by(SupplyItem.category, SupplyItem.name)
    items = (await db.execute(items_q)).scalars().all()

    sub_q = select(Recipe).where(
        Recipe.is_active.is_(True),
        Recipe.yields_amount.is_not(None),
        Recipe.yields_unit.is_not(None),
    )
    if search:
        sub_q = sub_q.where(func.lower(Recipe.name).like(f"%{search.lower()}%"))
    sub_q = sub_q.order_by(Recipe.name)
    subs = (await db.execute(sub_q)).scalars().all()

    return {
        "supply_items": [
            {
                "id": i.id,
                "name": i.name,
                "category": i.category,
                "pack_size": i.pack_size,
                "pack_unit": i.pack_unit,
                "is_count_item": i.is_count_item,
                "cost_per_base_unit": i.cost_per_base_unit,
                "base_unit": base_unit_for(i.pack_unit) if i.pack_unit else None,
                "needs_costing": (i.cost_per_base_unit is None or i.pack_unit is None),
            }
            for i in items
        ],
        "sub_recipes": [
            {
                "id": r.id,
                "name": r.name,
                "yields_amount": r.yields_amount,
                "yields_unit": r.yields_unit,
            }
            for r in subs
        ],
    }
