"""Unit conversions for recipe costing.

Two independent dimensions: weight (oz/lb/g/kg) and volume (floz/cup/
tbsp/tsp/gal/qt/pt/ml/l). Cross-dimension conversion (e.g. oz weight ↔
cups volume) requires a density value supplied per ingredient.

Count items ('each') are handled separately — they have no compatible
unit other than themselves.

The "base unit" for a SupplyItem depends on what it is:
  - weight   → oz
  - volume   → floz (US fluid ounces)
  - count    → each

`cost_per_base_unit` on SupplyItem is what 1 of that base unit costs.
"""

# Canonical units, lowercase
WEIGHT_UNITS = {"oz", "lb", "g", "kg"}
VOLUME_UNITS = {"floz", "cup", "tbsp", "tsp", "gal", "qt", "pt", "ml", "l"}
COUNT_UNITS = {"each", "count", "ct"}

# Conversions to the base unit of each dimension.
# Weight base = oz, Volume base = floz.
WEIGHT_TO_OZ = {
    "oz": 1.0,
    "lb": 16.0,
    "g": 0.035274,
    "kg": 35.274,
}

VOLUME_TO_FLOZ = {
    "floz": 1.0,
    "cup": 8.0,
    "tbsp": 0.5,
    "tsp": 0.16667,
    "gal": 128.0,
    "qt": 32.0,
    "pt": 16.0,
    "ml": 0.033814,
    "l": 33.814,
}


def normalize_unit(unit: str | None) -> str:
    """Canonicalize a unit string. Accepts common aliases."""
    if not unit:
        return ""
    u = unit.strip().lower()
    aliases = {
        "ounce": "oz", "ounces": "oz",
        "pound": "lb", "pounds": "lb", "lbs": "lb",
        "gram": "g", "grams": "g",
        "kilogram": "kg", "kilograms": "kg", "kilo": "kg",
        "fluid ounce": "floz", "fluid ounces": "floz", "fl oz": "floz", "fl. oz.": "floz",
        "cups": "cup", "c": "cup",
        "tablespoon": "tbsp", "tablespoons": "tbsp", "tbs": "tbsp", "tbl": "tbsp", "t": "tbsp",
        "teaspoon": "tsp", "teaspoons": "tsp",
        "gallon": "gal", "gallons": "gal",
        "quart": "qt", "quarts": "qt",
        "pint": "pt", "pints": "pt",
        "milliliter": "ml", "milliliters": "ml",
        "liter": "l", "liters": "l",
        "litre": "l", "litres": "l",
        "ea": "each", "unit": "each", "units": "each", "ct": "count",
    }
    return aliases.get(u, u)


def dimension_of(unit: str) -> str:
    """Return 'weight' | 'volume' | 'count' | ''."""
    u = normalize_unit(unit)
    if u in WEIGHT_UNITS:
        return "weight"
    if u in VOLUME_UNITS:
        return "volume"
    if u in COUNT_UNITS:
        return "count"
    return ""


def base_unit_for(unit: str) -> str:
    """The base unit for the dimension this unit belongs to."""
    dim = dimension_of(unit)
    if dim == "weight":
        return "oz"
    if dim == "volume":
        return "floz"
    if dim == "count":
        return "each"
    return ""


def convert(
    amount: float,
    from_unit: str,
    to_unit: str,
    *,
    density_oz_per_cup: float | None = None,
) -> float | None:
    """Convert `amount` from one unit to another. Returns None when
    incompatible (or density required and missing).

    Cross-dimension (weight ↔ volume) conversion requires
    `density_oz_per_cup`. Count units only convert to themselves.
    """
    f = normalize_unit(from_unit)
    t = normalize_unit(to_unit)
    if not f or not t:
        return None
    if f == t:
        return amount

    f_dim = dimension_of(f)
    t_dim = dimension_of(t)
    if not f_dim or not t_dim:
        return None
    if "count" in (f_dim, t_dim) and f_dim != t_dim:
        # Count items can't cross to weight/volume.
        return None

    # Same dimension: lookup table conversion.
    if f_dim == t_dim:
        if f_dim == "weight":
            return amount * WEIGHT_TO_OZ[f] / WEIGHT_TO_OZ[t]
        if f_dim == "volume":
            return amount * VOLUME_TO_FLOZ[f] / VOLUME_TO_FLOZ[t]
        if f_dim == "count":
            return amount  # each → each

    # Cross-dimension via density. We know density as oz per cup.
    if density_oz_per_cup is None or density_oz_per_cup <= 0:
        return None

    if f_dim == "volume" and t_dim == "weight":
        # volume → cup → oz (weight) → target weight
        cups = amount * VOLUME_TO_FLOZ[f] / VOLUME_TO_FLOZ["cup"]
        oz_weight = cups * density_oz_per_cup
        return oz_weight / WEIGHT_TO_OZ[t]
    if f_dim == "weight" and t_dim == "volume":
        oz_weight = amount * WEIGHT_TO_OZ[f]
        cups = oz_weight / density_oz_per_cup
        return cups * VOLUME_TO_FLOZ["cup"] / VOLUME_TO_FLOZ[t]

    return None


def compute_cost_per_base_unit(
    price: float | None,
    pack_size: float | None,
    pack_unit: str | None,
) -> float | None:
    """Cache helper for SupplyItem.cost_per_base_unit.

    Converts pack_size from pack_unit to the dimension's base unit, then
    divides price by that. Returns None when inputs are missing or
    invalid.
    """
    if price is None or pack_size is None or pack_size <= 0 or not pack_unit:
        return None
    base = base_unit_for(pack_unit)
    if not base:
        return None
    converted = convert(pack_size, pack_unit, base)
    if converted is None or converted <= 0:
        return None
    return round(price / converted, 6)
