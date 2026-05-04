"""Heuristic backfill for SupplyItem.pack_size / pack_unit / is_count_item.

Reads the existing `name` + `description` columns and tries to extract a
canonical pack size + unit so the recipe-costing engine can compute a
per-base-unit cost. Idempotent: skips items that already have a
pack_size set, so the owner's manual edits are never clobbered.

Patterns covered (most common first):

  '30 LBS.'                 -> 30 lb
  '5LBS' / '5LBS BAG'       -> 5 lb
  '20 lb. bag' / '12lb Bag' -> 12 lb (or 20 lb)
  '1 GAL' / '1 Gallon'      -> 1 gal
  'CASE OF 6 - 1 GAL'       -> 6 gal  (multipack)
  'Case 6 half gallons'     -> 3 gal  (special case)
  '12 - 2 LBS'              -> 24 lb  (12 packs * 2lb)
  '24 - 16.9oz.'            -> 24 floz * (16.9 / 1) NO — should be
                               24 * 16.9 = 405.6 floz total
  '16 oz. Bottle'           -> 16 floz
  '1 - 35.3 oz Container'   -> 35.3 floz (single pack)
  'Dozen'                   -> 12 each (count item)
  'Pack of 6' / 'Case of 6' -> 6 each  (count, when no inner unit)
  '200 pack' / '500 per Case' -> 200 / 500 each
  'SIX PACK'                -> 6 each
  '1 apron' / '1 BAG'       -> 1 each  (when name suggests count)

Items the parser can't classify get left untouched — the owner fills
them in manually in the Manage Catalog UI.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.supply_catalog import SupplyItem
from app.models.usfoods import USFoodsProduct
from app.services.units import compute_cost_per_base_unit


# -- Supplier inference ----------------------------------------------------


# Canonical supplier keys, matching TAG_MAPPING in supply_report_service.
SUPPLIER_KEYS = [
    "WAREHOUSE", "BAKERY", "DAIRY", "US FOODS", "COSTCO", "WINCO",
    "WEBSTAURANT", "KLATCH", "OLD TOWN BAKING", "BANK", "OTHER",
]


def infer_supplier(name: str, category: str | None) -> str | None:
    """Best-effort: match a SupplyItem to one of the canonical suppliers.

    Returns None when the inference is too weak — owner reviews in the
    Manage Catalog UI.
    """
    upper = (name or "").upper()
    cat = (category or "").strip()

    # Strongest signals: vendor name appearing in the item name.
    if "OLD TOWN" in upper:
        return "OLD TOWN BAKING"
    if "KLATCH" in upper:
        return "KLATCH"
    if "WEBSTAURANT" in upper:
        return "WEBSTAURANT"
    if "WINCO" in upper:
        return "WINCO"
    if "COSTCO" in upper:
        return "COSTCO"
    if "BUNN" in upper:  # Bunn coffee filters historically come from US Foods
        return "US FOODS"

    if cat == "Coins And Cash":
        return "BANK"
    if cat == "Bakery Only":
        return "BAKERY"
    if cat == "Coffee And Teas":
        return "WAREHOUSE"  # roaster + tea inventory live in the warehouse
    if cat == "Cups And Lids" or cat == "Disposables":
        return "WEBSTAURANT"
    if cat == "Cleaning Supplies":
        return "WAREHOUSE"
    if cat == "Frappe Powders":
        return "WAREHOUSE"
    if cat == "Syrups And Sauces":
        # Most syrups are house-made or warehouse-stocked
        return "WAREHOUSE"

    # Food And Milks is ambiguous — milk = DAIRY, eggs/bacon/produce =
    # mostly US FOODS or COSTCO. Leave None and let the owner pick.
    return None

logger = logging.getLogger(__name__)


# -- Detection --------------------------------------------------------------


# Names whose products are inherently countable. These short-circuit the
# unit detection in favour of 'each' even when the description doesn't say.
COUNT_NAME_PATTERNS = [
    r"\bAPRON\b",
    r"T-?SHIRT",
    r"\bMARKER\b",
    r"\bNOTEBOOK\b",
    r"\bBAGEL\b",
    r"\bMUFFIN\b",
    r"\bSCONE\b",
    r"\bCROISSANT\b",
    r"\bCINNAMON\s+ROLL\b",
    r"\bDONUT\b",
    r"\bLOAF\b",
    r"BREAD\b",  # whole bread loaves
    r"\bPACKET",
    r"\bCUP\b",
    r"\bLID\b",
    r"\bSTRAW",
    r"\bFILTER",
    r"\bCONTAINER",
    r"\bSEAT\s+COVER",
    r"\bTOILET\s+PAPER",
    r"\bROLL\s+OF",
    r"COFFEE\s+SLEEVE",
    r"\bSPOON\b",
    r"\bFORK\b",
    r"\bKNIFE\b",
    r"\bNAPKIN",
    r"\bBAG\b",  # paper bags (when a packaging item, see _is_packaging)
    r"\bGLOVE",
    r"\bWIPE",
    r"\bTAPE\b",
    r"\bBATTERY",
    r"\bSHARPIE",
    r"\bPENS?\b",
    r"\bTONGS?\b",
]

# Subset of pure-packaging item-name patterns; these always get is_count_item=True
# even when description like "1 Case" is too vague to parse.
PACKAGING_NAME_PATTERNS = [
    r"\bCUP\b", r"\bLID\b", r"\bSTRAW", r"\bCONTAINER", r"\bFILTER",
    r"\bSEAT\s+COVER", r"\bSLEEVE", r"\bBAG\b", r"PRINTER\s+ROLL", r"REGISTER\s+TAPE",
]


@dataclass
class PackInfo:
    pack_size: float | None
    pack_unit: str | None
    is_count_item: bool


def _name_matches_any(name: str, patterns: list[str]) -> bool:
    upper = name.upper()
    return any(re.search(p, upper) for p in patterns)


# -- Unit normalization --------------------------------------------------------


_WEIGHT_TOKENS = {
    "lb": ["lbs", "lb", "lb.", "pound", "pounds"],
    "oz": ["oz", "oz.", "ounce", "ounces"],
    "g": ["g", "gram", "grams"],
    "kg": ["kg", "kgs", "kilogram", "kilograms"],
}

_VOLUME_TOKENS = {
    "gal": ["gal", "gal.", "gallon", "gallons"],
    "qt": ["qt", "qts", "quart", "quarts"],
    "pt": ["pt", "pts", "pint", "pints"],
    "floz": ["fl oz", "floz", "fl. oz.", "fluid ounce", "fluid ounces"],
    "cup": ["cup", "cups"],
    "tbsp": ["tbsp", "tablespoon", "tablespoons"],
    "tsp": ["tsp", "teaspoon", "teaspoons"],
    "ml": ["ml", "milliliter", "milliliters"],
    "l": ["l", "liter", "liters", "litre", "litres"],
}


def _canonical_unit(token: str) -> str | None:
    t = token.lower().strip().rstrip(".")
    for canon, aliases in _WEIGHT_TOKENS.items():
        if t in [a.rstrip(".") for a in aliases]:
            return canon
    for canon, aliases in _VOLUME_TOKENS.items():
        if t in [a.rstrip(".") for a in aliases]:
            return canon
    return None


# Match the most common weight + volume patterns. Order matters — try
# the more specific patterns first.
#
# Each regex captures group(1) = number, group(2) = unit token.
_PRIMARY_PATTERNS = [
    # "5LBS", "12lb", "20lb", "1.5LB"
    r"(\d+\.?\d*)\s*(LBS?|lbs?|LB\.|lb\.|POUND[S]?|pound[s]?)\b",
    # "1 GAL", "5 gal.", "4 Gallons"
    r"(\d+\.?\d*)\s*(GAL\.?|gal\.?|GALLON[S]?|Gallon[s]?|gallon[s]?)\b",
    # "16 oz. Bottle", "32oz."  (treat as fluid ounces — bottle/jug context)
    r"(\d+\.?\d*)\s*(OZ\.?|oz\.?|FL\s*OZ|fl\s*oz)\b",
    # "1 QT", "12-1 QT"
    r"(\d+\.?\d*)\s*(QT\.?|qt\.?|quart[s]?)\b",
]


def _find_first_qty_unit(text: str) -> tuple[float, str] | None:
    """Return (number, canonical_unit) for the first quantity+unit match."""
    for pat in _PRIMARY_PATTERNS:
        m = re.search(pat, text)
        if not m:
            continue
        try:
            qty = float(m.group(1))
        except ValueError:
            continue
        unit = _canonical_unit(m.group(2))
        if not unit:
            continue
        # An "oz" measurement on a Bottle context = fluid ounces; on a Bag
        # context = weight. Bias by surrounding word.
        if unit == "oz":
            # Look at the rest of the description for context
            after = text[m.end():].lower()
            before = text[:m.start()].lower()
            if any(k in after for k in ["bottle", "can ", "cans", "bib", "container"]):
                unit = "floz"
            elif any(k in before for k in ["bottle", "container"]):
                unit = "floz"
            # default oz = weight
        return qty, unit
    return None


# -- Multipack patterns -----------------------------------------------------


def _multipack_total(text: str) -> tuple[float, str] | None:
    """Try to recognise multipack patterns and return the TOTAL pack
    contents in canonical units. Patterns:

      "12 - 2 LBS"              -> 24 lb
      "30 - 1 lb."              -> 30 lb
      "24 - 16.9oz."            -> 405.6 floz (24 * 16.9, fl oz from bottle context)
      "10- 3LB BLOCKS"          -> 30 lb
      "24 - 1.9 oz"             -> 24 * 1.9 = 45.6 oz (weight)
      "60 - 1.38 oz"            -> 60 * 1.38 = 82.8 oz
      "30-2oz"                  -> 30 * 2 = 60 oz
      "200 - 9g PACKETS"        -> 200 * 9 = 1800 g
      "Box of 200 - 7gr Packet" -> 200 * 7 = 1400 g
      "200 pack"                -> 200 each (count item)
      "Case of 6"               -> 6 each (count, no inner)
      "(48) 1oz. Bags"          -> 48 oz
      "1 - 35.3 oz Container"   -> 35.3 floz (1 of 35.3 oz)
    """
    # "(48) 1oz. Bags"
    m = re.search(r"\((\d+)\)\s*(\d+\.?\d*)\s*([A-Za-z]+)\.?", text)
    if m:
        cnt, sz, unit_tok = float(m.group(1)), float(m.group(2)), m.group(3)
        u = _canonical_unit(unit_tok)
        if u:
            return cnt * sz, u

    # "X - Y unit" or "X- Y unit" or "X-Y unit"
    m = re.search(r"(\d+)\s*-\s*(\d+\.?\d*)\s*([A-Za-z\.]+)", text)
    if m:
        cnt, sz, unit_tok = float(m.group(1)), float(m.group(2)), m.group(3)
        u = _canonical_unit(unit_tok)
        if u:
            # Determine if oz means weight or fluid based on surrounding text.
            if u == "oz":
                lower = text.lower()
                if any(k in lower for k in ["bottle", "can ", "cans", "container", "bib"]):
                    u = "floz"
            return cnt * sz, u

    # "200 pack" / "100 pack" / "12 pack" / "12 pops" / "24 SINGLES"
    m = re.match(
        r"^\s*(\d+)\s*(pack|pops|chargers|sheets|tea\s*bags|singles|chargers|cans?|boxes|bottles?|bags?)?\s*$",
        text, re.IGNORECASE,
    )
    if m:
        return float(m.group(1)), "each"

    # "Pack 24" / "Pack 50"
    m = re.match(r"^\s*Pack\s+(\d+)\s*$", text, re.IGNORECASE)
    if m:
        return float(m.group(1)), "each"

    # "15 Dozen" / "Dozen" already handled below
    m = re.match(r"^\s*(\d+)\s*Dozen\s*$", text, re.IGNORECASE)
    if m:
        return float(m.group(1)) * 12, "each"

    # "8 Scones" / "6 heads" / "12 pops"
    m = re.match(
        r"^\s*(\d+)\s*(scones?|heads?|loaves|loafs|donuts?|cookies?|muffins?)\s*$",
        text, re.IGNORECASE,
    )
    if m:
        return float(m.group(1)), "each"

    # "10 pack - 63cc" — count + extra spec we can't use; treat as count.
    m = re.match(r"^\s*(\d+)\s*pack\b", text, re.IGNORECASE)
    if m:
        return float(m.group(1)), "each"

    # "1 ROLL OF 50" / "1 ROLL OF 40" already match Roll-of pattern above.
    # "1 ROLL" alone -> 1 each (count of an unknown-size roll).
    m = re.match(r"^\s*1\s*ROLL\s*$", text, re.IGNORECASE)
    if m:
        return 1.0, "each"

    # "6 CT." / "120 CT" / "Case 120 CT"
    m = re.search(r"(\d+)\s*CT\.?\b", text, re.IGNORECASE)
    if m:
        return float(m.group(1)), "each"

    # "Case 6 half gallons" — Case followed by count + inner unit,
    # without 'of'.
    m = re.match(r"^\s*Case\s+(\d+)\s+(.+)$", text, re.IGNORECASE)
    if m:
        cnt = float(m.group(1))
        rest = m.group(2).lower()
        if "half gallon" in rest:
            return cnt * 0.5, "gal"
        inner = _find_first_qty_unit(rest)
        if inner:
            return cnt * inner[0], inner[1]
        # Else assume each.
        return cnt, "each"

    # "2 Boxes - 100 Tea Bags" / "1 Box - 50 Tea Bags" -> N*M each
    m = re.search(r"(\d+)\s*Boxe?s?\s*-\s*(\d+)\s*(?:Tea\s+)?Bags?", text, re.IGNORECASE)
    if m:
        return float(m.group(1)) * float(m.group(2)), "each"

    # "6 #10 CANS" / "6 Cans"
    m = re.match(r"^\s*(\d+)\s*(?:#\d+\s+)?cans?\b", text, re.IGNORECASE)
    if m:
        return float(m.group(1)), "each"

    # Patterns starting with "Case of N", "Pack of N", "Box of N", "Bag of N"
    # — N must immediately follow "of"; "Box of  PACKETS" (no number) skips here.
    m = re.search(r"(?:Case|Pack|Box|Bag|Roll)\s+of\s+(\d+)\b", text, re.IGNORECASE)
    if m:
        # Was there an inner unit? "Case of 6 half gallons", "Box of 12"
        rest = text[m.end():].lower()
        # special: "half gallons"
        if "half gallon" in rest:
            return float(m.group(1)) * 0.5, "gal"
        # Try to find an inner unit qty + unit on the rest
        inner = _find_first_qty_unit(rest)
        if inner:
            return float(m.group(1)) * inner[0], inner[1]
        # Else count.
        return float(m.group(1)), "each"

    # "Case of 1000" / "1000 per Case" / "500 PER CASE"
    m = re.search(r"(\d+)\s*(?:per|/)\s*Case", text, re.IGNORECASE)
    if m:
        return float(m.group(1)), "each"

    # "168/case"
    m = re.match(r"^\s*(\d+)\s*/\s*case", text, re.IGNORECASE)
    if m:
        return float(m.group(1)), "each"

    # "12-1 QT" -> 12 quarts (one-qt each)
    m = re.match(r"^\s*(\d+)\s*-\s*1\s*(QT|qt|quart)", text)
    if m:
        return float(m.group(1)), "qt"

    # Bare-word counts
    text_lower = text.strip().lower()
    if text_lower in ("dozen",):
        return 12.0, "each"
    if text_lower in ("six pack",):
        return 6.0, "each"
    if text_lower in ("1each", "1 ea.", "1ea"):
        return 1.0, "each"
    if text_lower in ("loaf",):
        return 1.0, "each"

    return None


# -- Main parser ------------------------------------------------------------


def _parse_name_parens(name: str) -> tuple[float, str] | None:
    """Look for size hints inside parens in the name.
       e.g. "(6 Boxes)", "(8)", "(30 egg cups)", "(24 SINGLES)"
    """
    for inner in re.findall(r"\(([^)]+)\)", name):
        inner_clean = inner.strip()
        # Try multipack first, then primary, then bare-count.
        for fn in (_multipack_total, _find_first_qty_unit):
            r = fn(inner_clean)
            if r:
                return r
        m = re.match(r"^\s*(\d+)\s*$", inner_clean)
        if m:
            return float(m.group(1)), "each"
        # "30 egg cups" / "8 sandwiches" — a number plus any words = count.
        m = re.match(r"^\s*(\d+)\s+\w+", inner_clean)
        if m:
            return float(m.group(1)), "each"
    return None


def parse_pack_info(name: str, description: str | None) -> PackInfo | None:
    """Best-effort heuristic. Returns PackInfo or None if not classifiable."""
    name = (name or "").strip()
    desc = (description or "").strip()

    # Try to pull a hint from parens in the name first — useful when the
    # description is empty/vague but the name spells it out, e.g.
    # "ORGANIC PEPPERMINT TEA (6 boxes)".
    name_hint = _parse_name_parens(name)

    if not desc:
        if name_hint:
            size, unit = name_hint
            return PackInfo(pack_size=round(size, 4), pack_unit=unit,
                            is_count_item=(unit == "each"))
        # No description — try to detect packaging-by-name
        if _name_matches_any(name, PACKAGING_NAME_PATTERNS):
            return PackInfo(pack_size=1, pack_unit="each", is_count_item=True)
        return None

    is_count_name = _name_matches_any(name, COUNT_NAME_PATTERNS)
    is_packaging = _name_matches_any(name, PACKAGING_NAME_PATTERNS)

    # 1) Multipack first (it's more specific than single qty).
    multi = _multipack_total(desc)
    if multi:
        size, unit = multi
        is_count = unit == "each"
        return PackInfo(pack_size=round(size, 4), pack_unit=unit, is_count_item=is_count)

    # 2) Single quantity + unit.
    primary = _find_first_qty_unit(desc)
    if primary:
        size, unit = primary
        return PackInfo(pack_size=round(size, 4), pack_unit=unit, is_count_item=False)

    # 3) Vague single-pack descriptions: "Bag", "Bottle", "Case", "Box", "Roll".
    #    If the name is clearly a count item, treat as 1 each. Otherwise leave None.
    if is_count_name or is_packaging:
        return PackInfo(pack_size=1, pack_unit="each", is_count_item=True)

    return None


# -- Backfill driver --------------------------------------------------------


async def _build_usfoods_pn_lookup(db: AsyncSession) -> dict[str, str]:
    """Map normalised USFoodsProduct names → product_number for fuzzy
    matching against SupplyItem names."""
    rows = (await db.execute(select(USFoodsProduct))).scalars().all()
    lookup: dict[str, str] = {}
    for p in rows:
        if not p.product_number:
            continue
        norm = re.sub(r"[^A-Z0-9]+", "", (p.name or "").upper())
        if norm:
            lookup[norm] = p.product_number
    return lookup


def _try_match_usfoods_pn(name: str, lookup: dict[str, str]) -> str | None:
    """Loose match: SupplyItem name (normalised) shares a long prefix
    with a USFoodsProduct name. Returns the PN or None."""
    if not lookup:
        return None
    norm = re.sub(r"[^A-Z0-9]+", "", (name or "").upper())
    if not norm:
        return None
    if norm in lookup:
        return lookup[norm]
    # Substring containment in either direction; pick the longest match.
    best: tuple[int, str] | None = None
    for key, pn in lookup.items():
        if len(key) < 8:
            continue
        if key in norm or norm in key:
            score = min(len(key), len(norm))
            if best is None or score > best[0]:
                best = (score, pn)
    return best[1] if best else None


async def backfill_from_square_map(
    db: AsyncSession,
    *,
    overwrite: bool = False,
) -> tuple[int, int]:
    """Apply the Square-catalog supplier/PN map to every SupplyItem
    linked by square_token. Returns (supplier_filled, pn_filled).

    overwrite=False (default): only fills blanks.
    overwrite=True: replaces whatever is there with the Square value.
    """
    from app.data.square_catalog_supplier_map import SQUARE_CATALOG_SUPPLIER_MAP

    items = (await db.execute(
        select(SupplyItem).where(SupplyItem.square_token.is_not(None))
    )).scalars().all()
    sup_filled = 0
    pn_filled = 0
    for item in items:
        entry = SQUARE_CATALOG_SUPPLIER_MAP.get(item.square_token or "")
        if not entry:
            continue
        sup, pn = entry
        if sup and (overwrite or not item.supplier):
            if item.supplier != sup:
                item.supplier = sup
                sup_filled += 1
        if pn and (overwrite or not item.usfoods_pn):
            if item.usfoods_pn != pn:
                item.usfoods_pn = pn
                pn_filled += 1
    return sup_filled, pn_filled


async def backfill_catalog_units(
    db: AsyncSession,
    *,
    overwrite: bool = False,
) -> dict:
    """Walk every active SupplyItem and fill missing pack info.

    Also infers supplier from name + category and, for items routed to
    US FOODS, looks up the product number against USFoodsProduct.

    `overwrite=False` (default) only fills rows where pack_size is NULL,
    so the owner's manual edits are never clobbered. Pass True to
    re-run from scratch.
    """
    # FIRST: apply the Square-catalog supplier+PN map for everything that
    # has a square_token. This is the most accurate source — the supplier
    # tag is authoritative on the Square side. Per-item overwrite flag
    # mirrors the heuristic-block behaviour below.
    sup_from_square, pn_from_square = await backfill_from_square_map(db, overwrite=overwrite)

    rows = (await db.execute(select(SupplyItem))).scalars().all()
    pn_lookup = await _build_usfoods_pn_lookup(db)

    examined = 0
    filled = 0
    skipped_existing = 0
    supplier_filled = sup_from_square
    pn_filled = pn_from_square
    unrecognised: list[tuple[int, str, str]] = []

    for item in rows:
        examined += 1

        # Pack info — gated by overwrite.
        if overwrite or item.pack_size is None:
            info = parse_pack_info(item.name, item.description)
            if info is None or info.pack_size is None:
                unrecognised.append((item.id, item.name, item.description or ""))
            else:
                item.pack_size = info.pack_size
                item.pack_unit = info.pack_unit
                item.is_count_item = info.is_count_item
                item.cost_per_base_unit = compute_cost_per_base_unit(
                    item.price, info.pack_size, info.pack_unit,
                )
                filled += 1
        else:
            skipped_existing += 1

        # Supplier — only fill when blank, never overwrite.
        if not item.supplier:
            inferred = infer_supplier(item.name, item.category)
            if inferred:
                item.supplier = inferred
                supplier_filled += 1

        # US Foods PN — only when supplier is US FOODS and PN is blank.
        if item.supplier == "US FOODS" and not item.usfoods_pn:
            pn = _try_match_usfoods_pn(item.name, pn_lookup)
            if pn:
                item.usfoods_pn = pn
                pn_filled += 1

    await db.commit()
    logger.info(
        "Catalog backfill: examined=%d filled=%d skipped=%d unrecognised=%d "
        "supplier_filled=%d pn_filled=%d",
        examined, filled, skipped_existing, len(unrecognised),
        supplier_filled, pn_filled,
    )
    return {
        "examined": examined,
        "filled": filled,
        "skipped_existing": skipped_existing,
        "unrecognised_count": len(unrecognised),
        "supplier_filled": supplier_filled,
        "pn_filled": pn_filled,
        "unrecognised_sample": [
            {"id": i, "name": n, "description": d}
            for i, n, d in unrecognised[:25]
        ],
    }
