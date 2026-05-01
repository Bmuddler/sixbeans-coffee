"""Recipe & costing system.

Architecture notes:

- A Recipe belongs to a RecipeCategory (Shop Drinks, Bakery Food, etc.).
- A Recipe has one or more Versions; only the most recent unended version
  is "current". Edits create a new version so historical sales can be
  costed against the recipe that was active at the time of sale.
- A RecipeIngredient line points to either a SupplyItem (purchased) OR
  another Recipe (a sub-recipe like a house syrup). The cost cascades
  through sub-recipes recursively.
- Recipes that "produce" an ingredient set yields_amount + yields_unit
  so the costing engine can compute their per-unit cost as a usable
  ingredient in other recipes.
- A Recipe can be flagged is_template=True to show up in the "Start from
  template" picker when creating a new recipe.
- Recipe maps to GoDaddy POS sales by sku (e.g. "FLVRD-LTT-0").
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.models import Base


class RecipeCategory(Base):
    __tablename__ = "recipe_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    sort_order = Column(Integer, nullable=False, default=0)
    is_archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    # GoDaddy POS SKU this recipe maps to (e.g. "FLVRD-LTT-0"). Nullable
    # because internal recipes (house syrups, frap powders) don't sell
    # directly through the POS — they're costed and used as sub-recipes.
    sku = Column(String(100), nullable=True, index=True)
    category_id = Column(Integer, ForeignKey("recipe_categories.id"), nullable=False)
    # Marks this recipe as a starting point for new recipes. Doesn't
    # affect costing — purely a UX hint for the "+ New from template"
    # picker.
    is_template = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    archived_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    # Production yield. If set, this recipe produces an ingredient that
    # other recipes can consume — e.g. yields_amount=64, yields_unit='floz'
    # for a Vanilla House Syrup batch. The costing engine divides total
    # ingredient cost by yields_amount to get per-unit cost.
    yields_amount = Column(Float, nullable=True)
    yields_unit = Column(String(20), nullable=True)
    # Base size identifier ('M' / 'medium' / 'standard'). Drives the
    # auto-generated S / L / XL size variants when relevant.
    base_size = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    category = relationship("RecipeCategory")
    versions = relationship("RecipeVersion", back_populates="recipe", cascade="all, delete-orphan")


class RecipeVersion(Base):
    __tablename__ = "recipe_versions"
    __table_args__ = (
        UniqueConstraint("recipe_id", "version_number", name="uq_recipe_version"),
    )

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False)
    version_number = Column(Integer, nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # ended_at NULL = currently active. Set when a new version supersedes.
    ended_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)

    recipe = relationship("Recipe", back_populates="versions")
    ingredients = relationship("RecipeIngredient", back_populates="version", cascade="all, delete-orphan")


class RecipeIngredient(Base):
    """One ingredient line on a recipe version.

    Exactly one of supply_item_id / sub_recipe_id is set. size_variant
    lets a single recipe carry per-size amounts ('S', 'M', 'L', 'XL').
    If size_variant is NULL, the line applies to all sizes (the default
    when the recipe has no size dimension, like bakery items).
    """

    __tablename__ = "recipe_ingredients"
    __table_args__ = (
        CheckConstraint(
            "(supply_item_id IS NOT NULL) <> (sub_recipe_id IS NOT NULL)",
            name="ck_recipe_ing_one_source",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    version_id = Column(Integer, ForeignKey("recipe_versions.id", ondelete="CASCADE"), nullable=False)
    supply_item_id = Column(Integer, ForeignKey("supply_items.id"), nullable=True)
    sub_recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=True)
    amount = Column(Float, nullable=False)
    # Unit the amount is expressed in (oz, floz, each, cup, etc.). The
    # service layer converts to the source ingredient's base unit before
    # multiplying by cost_per_base_unit.
    unit = Column(String(20), nullable=False, default="oz")
    size_variant = Column(String(20), nullable=True)  # 'S' | 'M' | 'L' | 'XL' | NULL
    sort_order = Column(Integer, nullable=False, default=0)
    notes = Column(Text, nullable=True)

    version = relationship("RecipeVersion", back_populates="ingredients")
    supply_item = relationship("SupplyItem")
    sub_recipe = relationship("Recipe", foreign_keys=[sub_recipe_id])


class RecipeModifier(Base):
    """Global modifier library — additive or substitutive ingredient deltas.

    Examples:
      'Extra shot'           = additive,    +1 floz of espresso
      'Oat milk'             = substitutive, swap milk → oat milk
      'Sugar free vanilla'   = substitutive, swap vanilla syrup → SF
      'Add cookie crumbs'    = additive,    +0.25 oz cookie crumb
      'Decaf'                = substitutive, swap coffee bean → decaf bean

    Each modifier is keyed by (godaddy_group, godaddy_value) so the
    sales-import pipeline can tag transactions with the matching cost
    delta. The recipe author maps a recipe's GoDaddy modifier groups
    once and the system handles the rest.
    """

    __tablename__ = "recipe_modifiers"
    __table_args__ = (
        UniqueConstraint("godaddy_group", "godaddy_value", name="uq_modifier_godaddy_pair"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    # 'add' | 'replace' | 'size'
    modifier_type = Column(String(20), nullable=False, default="add")
    # GoDaddy modifier group + value pair, e.g. ("MILK OPTIONS", "OAT").
    godaddy_group = Column(String(100), nullable=True)
    godaddy_value = Column(String(200), nullable=True)
    # For 'add': the supply item / amount being added.
    target_supply_item_id = Column(Integer, ForeignKey("supply_items.id"), nullable=True)
    delta_amount = Column(Float, nullable=True)
    delta_unit = Column(String(20), nullable=True)
    # For 'replace': swap target_supply_item_id → replacement_supply_item_id.
    replacement_supply_item_id = Column(Integer, ForeignKey("supply_items.id"), nullable=True)
    # For 'size' modifiers: a multiplier to apply to the base recipe
    # (e.g. Small=0.75, Large=1.5, XL=2.0).
    size_multiplier = Column(Float, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class RecipeSizeMap(Base):
    """Per-recipe mapping of GoDaddy size modifier values → size_variant.

    Different products use different size group names: 'LATTE SIZE',
    'FRAPPE SIZES', 'AMERICANO SIZE', 'DRIVE SIZE', etc. Even within a
    group, the value strings vary ('LG' vs 'L', 'MED' vs 'M', etc.).
    Recipe author marks the size group + maps each value the first time
    they build the recipe; later sales auto-resolve the size_variant.
    """

    __tablename__ = "recipe_size_maps"
    __table_args__ = (
        UniqueConstraint("recipe_id", "godaddy_value", name="uq_recipe_size_map"),
    )

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False)
    # Which GoDaddy modifier group on this SKU is the size axis. Stored
    # at the recipe level so multi-size recipes don't have to repeat it.
    godaddy_group = Column(String(100), nullable=False)
    godaddy_value = Column(String(200), nullable=False)
    size_variant = Column(String(20), nullable=False)  # 'S' | 'M' | 'L' | 'XL' | 'KIDS'
