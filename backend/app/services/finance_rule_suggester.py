"""Suggest categorization rules for uncategorized transactions.

Two-tier:
  1. Hardcoded vendor map — covers ~80 common merchants for free, instantly.
  2. Claude API — fills in the long tail. Only fires for merchants the
     hardcoded map doesn't recognize, and we batch them into one call to
     keep latency + cost low.

Output is a list of proposals the owner reviews + accepts in the UI; nothing
mutates until they click Apply.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Iterable

from app.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pattern extraction
# ---------------------------------------------------------------------------

# Bank-statement noise we strip before extracting the merchant.
_PREFIX_PATTERNS = [
    r"^PURCHASE\s+AUTHORIZED\s+ON\s+\d{1,2}/\d{1,2}\s+",
    r"^RECURRING\s+PAYMENT\s+AUTHORIZED\s+ON\s+\d{1,2}/\d{1,2}\s+",
    r"^NON-WF\s+ATM\s+WITHDRAWAL\s+AUTHORIZED\s+ON\s+\d{1,2}/\d{1,2}\s+",
    r"^BUSINESS\s+TO\s+BUSINESS\s+ACH\s+",
    r"^ONLINE\s+TRANSFER\s+(TO|FROM)\s+",
    r"^CASH\s+E?WITHDRAWAL\s+IN\s+BRANCH\s+",
    r"^MOBILE\s+DEPOSIT\s*:\s*",
    r"^CASH\s+DEPOSIT\s+",
    r"^TST\*\s*",  # Cap One restaurant tag
    r"^SP\s+",  # Cap One single-purchase tag (often "SP ESPRESSO PARTS")
    r"^GDP\*",  # GoDaddy Payments tag
    r"^SQ\s*\*",  # Square
    r"^FWD\*",  # Forward / merchant of record
]
_PREFIX_RE = re.compile("|".join(_PREFIX_PATTERNS), re.IGNORECASE)

# Tokens that come AFTER the merchant on WF descriptions and should be cut.
_TRAILING_PATTERNS = [
    r"\s+CARD\s+\d{4}\s*$",
    r"\s+\d{3}-\d{3}-\d{4}\s+.*$",  # phone trailing
    r"\s+S\d{15}\s+CARD.*$",  # WF auth-id token
    r"\s+P\d{15,}\s+CARD.*$",
    r"\s+REF\s+#?\w+.*$",
    r"\s+APPLE\s+VALLEY\s+CA\b.*$",
    r"\s+VICTORVILLE\s+CA\b.*$",
    r"\s+HESPERIA\s+CA\b.*$",
    r"\s+BARSTOW\s+CA\b.*$",
    r"\s+\b[A-Z]{2}\b\s*$",  # state code at end
]


def extract_merchant(description: str) -> str:
    """Best-effort: pull the merchant signature out of a noisy bank line."""
    s = (description or "").upper().strip()
    s = re.sub(r"\s+", " ", s)
    s = _PREFIX_RE.sub("", s, count=1)
    for pat in _TRAILING_PATTERNS:
        s = re.sub(pat, "", s, count=1)
    # Drop obvious noise tokens
    s = re.sub(r"\s+\d{6,}\s+.*$", "", s)  # long numeric ids onwards
    s = s.strip(" -*#")
    # Keep first 60 chars max — enough to disambiguate but short enough
    # to be a usable rule pattern.
    return s[:60].strip() or s


# ---------------------------------------------------------------------------
# Hardcoded vendor → category map
# ---------------------------------------------------------------------------

# (regex_pattern, suggested_category, vendor_name)
# Patterns are matched against the EXTRACTED merchant string (uppercase).
HEURISTIC_RULES: list[tuple[str, str, str]] = [
    # Subscriptions
    (r"\bCLAUDE", "Subscriptions", "Claude"),
    (r"\bOPENAI", "Subscriptions", "OpenAI"),
    (r"\bXAI\b", "Subscriptions", "xAI"),
    (r"PRIME VIDEO", "Subscriptions", "Prime Video"),
    (r"AMAZON DIGIT", "Subscriptions", "Amazon Digital"),
    (r"FRESH TECHNOLOGY", "Subscriptions", "Fresh Technology"),
    (r"JOIN ?HOMEBASE", "Subscriptions", "Homebase"),
    (r"APPLE\.COM", "Subscriptions", "Apple"),
    (r"PEOPLE\.COM", "Subscriptions", "People.com"),
    (r"HOST GATOR", "Subscriptions", "Host Gator"),
    (r"\bRAILWAY\b", "Subscriptions", "Railway"),
    (r"PRIVATE INTERNET", "Subscriptions", "Private Internet"),
    # Bank service charges
    (r"MONTHLY SERVICE FEE", "Bank Service Charges", "Wells Fargo"),
    (r"CURRENCY ORDERED FEE", "Bank Service Charges", "Wells Fargo"),
    (r"CASH DEPOSIT PROCESSING", "Bank Service Charges", "Wells Fargo"),
    (r"WIRE TRANSFER FEE", "Bank Service Charges", "Wire Transfer Fee"),
    (r"CAPITAL ONE MEMBER FEE", "Bank Service Charges", "Capital One"),
    # Sales tax / gov fees
    (r"CDTFA", "Business Licenses and Permits", "CDTFA"),
    (r"FRANCHISE TAX", "Business Licenses and Permits", "Franchise Tax Board"),
    (r"CA SECRETARY OF ST", "Business Licenses and Permits", "CA Secretary of State"),
    (r"SAN BERNARDINO", "Business Licenses and Permits", "San Bernardino County"),
    (r"CITY OF VICTORVILLE", "Business Licenses and Permits", "City of Victorville"),
    (r"TOWN OF APPLE VAL", "Business Licenses and Permits", "Town of Apple Valley"),
    (r"CITY OF BARSTOW", "Business Licenses and Permits", "City of Barstow"),
    # DMV / vehicle / auto
    (r"\bDMV\b", "Automobile Expense", "DMV"),
    (r"STATE OF CALIF DMV", "Automobile Expense", "DMV"),
    (r"AAA INSURANCE", "Insurance Expense", "AAA Insurance"),
    (r"BIBERK", "Insurance Expense", "BiBerk"),
    (r"THE HARTFORD", "Insurance Expense", "The Hartford"),
    (r"CAR WASH", "Automobile Expense", "Car Wash"),
    (r"MISTER WASH", "Automobile Expense", "Mister Wash"),
    (r"TOWN & COUNTRY TI", "Automobile Expense", "Town & Country Tire"),
    (r"AUTOZONE", "Automobile Expense", "Autozone"),
    # Fuel
    (r"\bSHELL\b", "Fuel", "Shell"),
    (r"\bCHEVRON\b", "Fuel", "Chevron"),
    (r"\bARCO\b", "Fuel", "Arco"),
    (r"\bEXXON\b", "Fuel", "Exxon"),
    (r"\b76\b", "Fuel", "76"),
    (r"FOOD ?4 ?LESS[\s-]+FUEL", "Fuel", "Food 4 Less Fuel"),
    (r"7[\s-]?ELEVEN", "Fuel", "7 Eleven"),
    (r"G&M OIL", "Fuel", "G&M Oil"),
    (r"\bTME\b", "Fuel", "TME"),
    (r"RINCON TRAVEL PLAZA", "Fuel", "Rincon Travel Plaza"),
    (r"ONE STOP MART", "Fuel", "One Stop Mart"),
    (r"VICTORVILLE SU", "Fuel", "Victorville Sunoco"),
    # Meals (restaurants / fast food the owner eats at, not coffee shops)
    (r"RED ROBIN", "Meals", "Red Robin"),
    (r"WENDY'?S", "Meals", "Wendy's"),
    (r"MCDONALD'?S", "Meals", "McDonald's"),
    (r"CHICK[- ]FIL[- ]A", "Meals", "Chick-fil-A"),
    (r"CHIPOTLE", "Meals", "Chipotle"),
    (r"CHILI'?S", "Meals", "Chili's"),
    (r"TACO BELL", "Meals", "Taco Bell"),
    (r"BURGER KING", "Meals", "Burger King"),
    (r"\bKFC\b", "Meals", "KFC"),
    (r"DEL TACO", "Meals", "Del Taco"),
    (r"WING STOP", "Meals", "Wing Stop"),
    (r"RAISING CANES", "Meals", "Raising Cane's"),
    (r"BAKERS\b", "Meals", "Bakers"),
    (r"CINEMARK", "GIFTS", "Cinemark"),
    (r"PIEOLOGY", "Meals", "Pieology"),
    (r"SIZZLER", "Meals", "Sizzler"),
    (r"TEXAS ROADHOUSE", "Meals", "Texas Roadhouse"),
    (r"APPLEBEES", "Meals", "Applebee's"),
    (r"OGGI'?S", "Meals", "Oggi's"),
    (r"LA CASITA", "Meals", "La Casita"),
    (r"NOTHING BUNDT", "Meals", "Nothing Bundt Cakes"),
    (r"SMOK'?D HOG", "Meals", "The Smok'd Hog"),
    # Food / supplies stores (these go into Food Purchases for Six Beans)
    (r"WINCO", "Food Purchases", "Winco Foods"),
    (r"COSTCO", "Food Purchases", "Costco"),
    (r"STATER ?BRO", "Food Purchases", "Stater Bros"),
    (r"SMART N FINAL", "Food Purchases", "Smart N Final"),
    (r"WAL-?MART", "Food Purchases", "Walmart"),
    (r"\bALDI\b", "Food Purchases", "Aldi"),
    (r"\bWINSUPPLY\b", "Repairs and Maintenance", "Winsupply"),
    # Repairs and supplies
    (r"\bLOWE'?S\b", "Repairs and Maintenance", "Lowe's"),
    (r"HOME DEPOT", "Repairs and Maintenance", "Home Depot"),
    (r"HARBOR FREIGHT", "Repairs and Maintenance", "Harbor Freight"),
    (r"HIGH DESERT LOCK", "Repairs and Maintenance", "High Desert Lock & Safe"),
    (r"BEAR'?S? VALLEY GLASS", "Repairs and Maintenance", "Bear Valley Glass"),
    (r"ESPRESSO PARTS", "Repairs and Maintenance", "Espresso Parts"),
    (r"ESPRESSOCOFFEESHOP", "Repairs and Maintenance", "EspressoCoffeeShop.com"),
    (r"PARTS TOWN", "Repairs and Maintenance", "Parts Town"),
    (r"WEBSTAUR(A|U)NT|WEBSTRAUNT", "Cost of Goods Sold", "Webstaurant"),
    (r"AIRGAS", "Restaurant Supplies", "Airgas"),
    (r"KARAT", "Cost of Goods Sold", "Karat Packaging"),
    # Shipping / e-commerce
    (r"\bUPS\*?\b", "Shipping Expense", "UPS"),
    (r"\bUSPS\b", "Shipping Expense", "USPS"),
    (r"AMAZON", "Restaurant Supplies", "Amazon"),
    (r"AMZN", "Restaurant Supplies", "Amazon"),
    (r"WALMART\.COM", "Restaurant Supplies", "Walmart.com"),
    (r"\bEBAY\b", "Restaurant Supplies", "eBay"),
    (r"\bTEMU\b", "Restaurant Supplies", "Temu"),
    # Utilities / internet / phone
    (r"FRONTIER", "Utilities", "Frontier"),
    (r"VERIZON", "Utilities", "Verizon"),
    (r"\bSPECTRUM\b", "Utilities", "Spectrum"),
    (r"EDISON", "Utilities", "Edison"),
    (r"SOUTHWEST GAS", "Utilities", "Southwest Gas"),
    (r"GOLDEN STATE WATER", "Utilities", "Golden State Water"),
    (r"GO ?DADDY", "Computer and Internet", "Go Daddy"),
    # Advertising
    (r"\bMETA\b|FACEBOOK", "Advertising and Promotion", "Meta / Facebook"),
    (r"\bGOOGLE\b", "Advertising and Promotion", "Google"),
    (r"TAPMANGO", "Advertising and Promotion", "Tapmango"),
    (r"CRISP IMAGING", "Advertising and Promotion", "Crisp Imaging"),
    # Income side
    (r"INTEREST PAYMENT", "Bank Interest", None),
    (r"STRIPE\s+TRANSFER", "Online Food Sales", "Stripe"),
    (r"DOORDASH", "Online Food Sales", "DoorDash"),
    (r"GRUBHUB", "Online Food Sales", "Grubhub"),
    (r"CHARGEPOINT", "EV Charging", "Chargepoint"),
    # Internal moves
    (r"^CHECK$", "Uncategorized", None),  # paper checks need human eyes
    (r"CITI CARD ONLINE", "Internal Transfer", "Citi"),
    (r"BARCLAY", "Cost of Goods Sold", "Barclay Credit Card"),
    # Fees / interest
    (r"INTEREST CHARGE", "Interest Expense", None),
    (r"WK PEST", "Repairs and Maintenance", "WK Pest"),
    (r"HART CLEANING", "Repairs and Maintenance", "Hart Cleaning"),
    # Donations
    (r"VOLLEYBALL|FOOTBALL|BASEBALL", "Donations", None),
]
HEURISTIC_RULES_COMPILED: list[tuple[re.Pattern, str, str | None]] = [
    (re.compile(p, re.IGNORECASE), c, v) for p, c, v in HEURISTIC_RULES
]


def heuristic_match(merchant: str) -> tuple[str, str | None] | None:
    """Returns (category_name, vendor_name) if a heuristic rule fires."""
    for pattern, category, vendor in HEURISTIC_RULES_COMPILED:
        if pattern.search(merchant):
            return (category, vendor)
    return None


# ---------------------------------------------------------------------------
# LLM fallback
# ---------------------------------------------------------------------------


@dataclass
class Proposal:
    """One proposed rule, possibly covering many transactions."""
    merchant: str
    category_name: str
    vendor: str | None
    sample_descriptions: list[str]
    transaction_ids: list[int]
    source: str  # 'heuristic' | 'llm' | 'fallback'
    confidence: float  # 0-1


_LLM_SYSTEM_PROMPT = """You are an accounting assistant for a coffee-shop chain. \
The owner has a list of vendor names from bank statements that need to be \
categorized into the company's chart of accounts. \
Reply with a JSON array; one object per vendor, in the same order as the input. \
Each object: {"merchant": "<input>", "category": "<one of the allowed categories>", \
"vendor": "<clean vendor name>", "confidence": 0.0-1.0}. \
Do not invent categories — only use names from the allowed list. If unsure, \
use "Uncategorized" with low confidence."""


async def llm_classify(merchants: list[str], allowed_categories: list[str]) -> list[dict]:
    """One Claude call for a batch of merchants. Returns parsed JSON list."""
    if not merchants:
        return []
    api_key = (settings.anthropic_api_key or "").strip()
    if not api_key:
        logger.warning("anthropic_api_key not set; skipping LLM classifier.")
        return []

    try:
        from anthropic import AsyncAnthropic
    except Exception:
        logger.exception("anthropic SDK not importable; skipping LLM.")
        return []

    client = AsyncAnthropic(api_key=api_key)
    user_msg = (
        f"Allowed categories: {json.dumps(allowed_categories)}\n\n"
        f"Vendors to classify (preserve order):\n{json.dumps(merchants)}\n\n"
        "Return only the JSON array — no prose, no markdown fences."
    )
    try:
        msg = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4000,
            system=_LLM_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        )
        text = "".join(block.text for block in msg.content if hasattr(block, "text")).strip()
        # Strip markdown fences if model added them anyway.
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].strip()
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "results" in parsed:
            parsed = parsed["results"]
        return parsed if isinstance(parsed, list) else []
    except Exception:
        logger.exception("LLM classification failed; returning empty.")
        return []


# ---------------------------------------------------------------------------
# Build proposals from a list of (txn_id, description)
# ---------------------------------------------------------------------------


async def build_proposals(
    txns: list[tuple[int, str, str | None]],  # (txn_id, description, account_short_code)
    allowed_categories: list[str],
    use_llm: bool = True,
) -> list[Proposal]:
    """Group txns by extracted merchant, propose a category for each group."""
    # Group by extracted merchant
    by_merchant: dict[str, dict] = {}
    for txn_id, desc, _acct in txns:
        m = extract_merchant(desc)
        if not m:
            continue
        bucket = by_merchant.setdefault(m, {"ids": [], "samples": []})
        bucket["ids"].append(txn_id)
        if len(bucket["samples"]) < 3:
            bucket["samples"].append(desc)

    proposals: list[Proposal] = []
    unknown_merchants: list[str] = []

    for merchant, bucket in by_merchant.items():
        hit = heuristic_match(merchant)
        if hit is not None:
            cat, vendor = hit
            if cat in allowed_categories:
                proposals.append(Proposal(
                    merchant=merchant,
                    category_name=cat,
                    vendor=vendor,
                    sample_descriptions=bucket["samples"],
                    transaction_ids=bucket["ids"],
                    source="heuristic",
                    confidence=0.95,
                ))
                continue
        unknown_merchants.append(merchant)

    if use_llm and unknown_merchants:
        llm_results = await llm_classify(unknown_merchants, allowed_categories)
        llm_by_merchant = {
            (r.get("merchant") or "").upper(): r
            for r in llm_results
            if isinstance(r, dict)
        }
        for merchant in unknown_merchants:
            bucket = by_merchant[merchant]
            r = llm_by_merchant.get(merchant.upper())
            if r and r.get("category") in allowed_categories:
                proposals.append(Proposal(
                    merchant=merchant,
                    category_name=r["category"],
                    vendor=r.get("vendor"),
                    sample_descriptions=bucket["samples"],
                    transaction_ids=bucket["ids"],
                    source="llm",
                    confidence=float(r.get("confidence", 0.6)),
                ))
            else:
                proposals.append(Proposal(
                    merchant=merchant,
                    category_name="Uncategorized",
                    vendor=None,
                    sample_descriptions=bucket["samples"],
                    transaction_ids=bucket["ids"],
                    source="fallback",
                    confidence=0.0,
                ))
    else:
        for merchant in unknown_merchants:
            bucket = by_merchant[merchant]
            proposals.append(Proposal(
                merchant=merchant,
                category_name="Uncategorized",
                vendor=None,
                sample_descriptions=bucket["samples"],
                transaction_ids=bucket["ids"],
                source="fallback",
                confidence=0.0,
            ))

    # Sort: most-frequent first, but uncategorized fallbacks at the bottom
    proposals.sort(key=lambda p: (p.source == "fallback", -len(p.transaction_ids)))
    return proposals
