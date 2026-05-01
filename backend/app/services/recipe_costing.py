"""Recipe costing engine.

Resolves a recipe's per-size cost by walking its current version's
ingredients. Each ingredient is either a SupplyItem (uses cached
cost_per_base_unit) or a sub-recipe (cost-per-yield-unit, computed
recursively).

Circular sub-recipe references are blocked.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.recipe import (
    Recipe,
    RecipeIngredient,
    RecipeVersion,
)
from app.models.supply_catalog import SupplyItem
from app.services.units import (
    base_unit_for,
    convert,
    dimension_of,
    normalize_unit,
)


@dataclass
class IngredientCostLine:
    """One ingredient's contribution to a recipe's cost."""

    label: str  # display name
    source_kind: str  # 'supply' | 'sub_recipe'
    source_id: int
    amount: float
    unit: str
    cost: float
    size_variant: str | None
    error: str | None = None


@dataclass
class RecipeCostResult:
    """Total cost broken down by size variant + per-line."""

    by_size: dict[str, float]  # 'S' / 'M' / 'L' / 'XL' / 'all' → cost
    lines: list[IngredientCostLine]
    cost_per_yield_unit: float | None  # if recipe declares yields_*
    yield_amount: float | None
    yield_unit: str | None


class CostingError(Exception):
    pass


async def _current_version(db: AsyncSession, recipe_id: int) -> RecipeVersion | None:
    """Return the most recent active (ended_at IS NULL) version, or
    fallback to the highest version_number if none is open."""
    rows = (await db.execute(
        select(RecipeVersion)
        .where(RecipeVersion.recipe_id == recipe_id)
        .order_by(RecipeVersion.version_number.desc())
    )).scalars().all()
    if not rows:
        return None
    for v in rows:
        if v.ended_at is None:
            return v
    return rows[0]


async def cost_recipe(
    db: AsyncSession,
    recipe_id: int,
    *,
    _stack: tuple[int, ...] = (),
) -> RecipeCostResult:
    """Recursively compute the cost of a recipe.

    `_stack` is the chain of recipe ids being costed; we use it to
    detect circular sub-recipe references and bail with a CostingError.
    """
    if recipe_id in _stack:
        raise CostingError(
            f"Circular sub-recipe reference detected: "
            f"{' -> '.join(str(x) for x in _stack + (recipe_id,))}"
        )

    recipe = (await db.execute(
        select(Recipe).where(Recipe.id == recipe_id)
    )).scalar_one_or_none()
    if recipe is None:
        raise CostingError(f"Recipe {recipe_id} not found")

    version = await _current_version(db, recipe_id)
    if version is None:
        return RecipeCostResult(by_size={}, lines=[], cost_per_yield_unit=None,
                                yield_amount=recipe.yields_amount, yield_unit=recipe.yields_unit)

    ingredients = (await db.execute(
        select(RecipeIngredient)
        .where(RecipeIngredient.version_id == version.id)
        .options(selectinload(RecipeIngredient.supply_item))
        .order_by(RecipeIngredient.sort_order, RecipeIngredient.id)
    )).scalars().all()

    by_size: dict[str, float] = defaultdict(float)
    lines: list[IngredientCostLine] = []

    for ing in ingredients:
        line = await _cost_one_ingredient(db, ing, _stack + (recipe_id,))
        lines.append(line)
        size_key = line.size_variant or "all"
        by_size[size_key] += line.cost

    # If the recipe carries no per-size lines, the 'all' bucket IS the
    # whole recipe cost across every size; otherwise we leave per-size
    # totals as-is (caller renders them separately).
    cost_per_yield_unit: float | None = None
    if recipe.yields_amount and recipe.yields_amount > 0 and recipe.yields_unit:
        # Total cost from non-sized lines only — yields recipes shouldn't
        # have per-size variants.
        total = by_size.get("all", 0.0)
        cost_per_yield_unit = round(total / recipe.yields_amount, 6)

    return RecipeCostResult(
        by_size={k: round(v, 4) for k, v in by_size.items()},
        lines=lines,
        cost_per_yield_unit=cost_per_yield_unit,
        yield_amount=recipe.yields_amount,
        yield_unit=recipe.yields_unit,
    )


async def _cost_one_ingredient(
    db: AsyncSession,
    ing: RecipeIngredient,
    stack: tuple[int, ...],
) -> IngredientCostLine:
    if ing.supply_item_id is not None:
        return _cost_supply_line(ing)
    if ing.sub_recipe_id is not None:
        return await _cost_sub_recipe_line(db, ing, stack)
    return IngredientCostLine(
        label="(empty)", source_kind="supply", source_id=0,
        amount=ing.amount, unit=ing.unit, cost=0.0,
        size_variant=ing.size_variant,
        error="No source set",
    )


def _cost_supply_line(ing: RecipeIngredient) -> IngredientCostLine:
    item: SupplyItem | None = ing.supply_item
    if item is None:
        return IngredientCostLine(
            label="(missing)", source_kind="supply", source_id=ing.supply_item_id or 0,
            amount=ing.amount, unit=ing.unit, cost=0.0,
            size_variant=ing.size_variant,
            error="Supply item not found",
        )

    unit = normalize_unit(ing.unit)
    base = base_unit_for(item.pack_unit) if item.pack_unit else None
    cost_per_base = item.cost_per_base_unit

    if not base or cost_per_base is None:
        return IngredientCostLine(
            label=item.name, source_kind="supply", source_id=item.id,
            amount=ing.amount, unit=ing.unit, cost=0.0,
            size_variant=ing.size_variant,
            error="Catalog item missing pack size / unit / price",
        )

    converted = convert(
        ing.amount, unit, base,
        density_oz_per_cup=item.density_oz_per_cup,
    )
    if converted is None:
        return IngredientCostLine(
            label=item.name, source_kind="supply", source_id=item.id,
            amount=ing.amount, unit=ing.unit, cost=0.0,
            size_variant=ing.size_variant,
            error=f"Can't convert {ing.unit} to {base} (set a density?)",
        )

    return IngredientCostLine(
        label=item.name, source_kind="supply", source_id=item.id,
        amount=ing.amount, unit=ing.unit,
        cost=round(converted * cost_per_base, 6),
        size_variant=ing.size_variant,
    )


async def _cost_sub_recipe_line(
    db: AsyncSession,
    ing: RecipeIngredient,
    stack: tuple[int, ...],
) -> IngredientCostLine:
    sub = (await db.execute(
        select(Recipe).where(Recipe.id == ing.sub_recipe_id)
    )).scalar_one_or_none()
    if sub is None:
        return IngredientCostLine(
            label="(missing sub-recipe)", source_kind="sub_recipe",
            source_id=ing.sub_recipe_id or 0, amount=ing.amount,
            unit=ing.unit, cost=0.0, size_variant=ing.size_variant,
            error="Sub-recipe not found",
        )
    if not sub.yields_amount or not sub.yields_unit:
        return IngredientCostLine(
            label=sub.name, source_kind="sub_recipe", source_id=sub.id,
            amount=ing.amount, unit=ing.unit, cost=0.0,
            size_variant=ing.size_variant,
            error=f"Sub-recipe '{sub.name}' has no yield set",
        )

    try:
        sub_cost = await cost_recipe(db, sub.id, _stack=stack)
    except CostingError as exc:
        return IngredientCostLine(
            label=sub.name, source_kind="sub_recipe", source_id=sub.id,
            amount=ing.amount, unit=ing.unit, cost=0.0,
            size_variant=ing.size_variant,
            error=str(exc),
        )

    if sub_cost.cost_per_yield_unit is None:
        return IngredientCostLine(
            label=sub.name, source_kind="sub_recipe", source_id=sub.id,
            amount=ing.amount, unit=ing.unit, cost=0.0,
            size_variant=ing.size_variant,
            error="Sub-recipe yield cost couldn't be computed",
        )

    # Convert the requested amount to the sub-recipe's yield unit.
    converted = convert(ing.amount, normalize_unit(ing.unit), normalize_unit(sub.yields_unit))
    if converted is None:
        # Same dimension fallback — if dimensions don't match, just use raw amount
        # (e.g. recipe yield in 'each' for a baked count and ingredient asks for 'each').
        if dimension_of(ing.unit) == dimension_of(sub.yields_unit):
            converted = ing.amount
        else:
            return IngredientCostLine(
                label=sub.name, source_kind="sub_recipe", source_id=sub.id,
                amount=ing.amount, unit=ing.unit, cost=0.0,
                size_variant=ing.size_variant,
                error=f"Can't convert {ing.unit} to sub-recipe yield unit {sub.yields_unit}",
            )

    return IngredientCostLine(
        label=sub.name, source_kind="sub_recipe", source_id=sub.id,
        amount=ing.amount, unit=ing.unit,
        cost=round(converted * sub_cost.cost_per_yield_unit, 6),
        size_variant=ing.size_variant,
    )
