"""Default recipe categories. Idempotent — only inserts missing names."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.recipe import RecipeCategory


DEFAULT_CATEGORIES = [
    ("Shop Drinks", 10),
    ("Shop Food", 20),
    ("Bakery Food", 30),
    ("Bakery Syrups", 40),
    ("Frap Powders", 50),
]


async def seed_recipe_categories(db: AsyncSession) -> int:
    existing_names = {
        n for (n,) in (
            await db.execute(select(RecipeCategory.name))
        ).all()
    }
    inserted = 0
    for name, sort_order in DEFAULT_CATEGORIES:
        if name in existing_names:
            continue
        db.add(RecipeCategory(name=name, sort_order=sort_order))
        inserted += 1
    if inserted:
        await db.commit()
    return inserted
