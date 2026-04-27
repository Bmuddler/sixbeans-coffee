"""Banking center ingestion: parse uploaded CSVs, categorize, dedup, persist.

Two source formats supported in v1:

1. Wells Fargo (Checking + Savings export):
       "DATE","DESCRIPTION","AMOUNT","CHECK #","STATUS"
       "04/24/2026","STRIPE...","526.33","","Posted"
   Amount is signed: negative for debits, positive for credits.

2. Capital One (transaction download):
       Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
       2026-04-24, 2026-04-25, 1305, TEXAS ROADHOUSE, Dining, 178.96,
   Debit + Credit are unsigned amounts in separate columns. Credit rows are
   payments TO the card from the linked checking account; everything else is
   a purchase.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    BankAccount,
    BankTransaction,
    FinanceCategory,
    FinanceRule,
)


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


@dataclass
class ParsedRow:
    txn_date: date
    posted_date: date | None
    description: str
    amount: float  # signed: + inflow, − outflow


def _parse_date(s: str) -> date | None:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognized date {s!r}")


def _parse_amount(s: str) -> float:
    s = (s or "").strip().replace(",", "").replace("$", "")
    if not s:
        return 0.0
    return float(s)


def parse_wells_fargo(csv_text: str) -> list[ParsedRow]:
    """WF Checking / Savings CSV → ParsedRow list. Skips rows with empty data."""
    rows: list[ParsedRow] = []
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        date_str = (row.get("DATE") or "").strip().strip('"')
        desc = (row.get("DESCRIPTION") or "").strip().strip('"')
        amt_str = (row.get("AMOUNT") or "").strip().strip('"')
        if not date_str or not desc:
            continue
        try:
            d = _parse_date(date_str)
            amt = _parse_amount(amt_str)
        except ValueError:
            continue
        if d is None:
            continue
        rows.append(ParsedRow(
            txn_date=d,
            posted_date=d,
            description=desc,
            amount=amt,
        ))
    return rows


def parse_capital_one(csv_text: str) -> list[ParsedRow]:
    """Cap One transaction CSV → ParsedRow list.

    Cap One reports Debit (purchase, money OUT of checking ⇒ money you owe)
    and Credit (payment from checking ⇒ liability decreases) as separate
    columns. We sign so that:
        amount > 0 → balance owed went DOWN (payment received on the card)
        amount < 0 → balance owed went UP (purchase made on the card)
    Same convention as a checking account's "is money flowing in" sign so the
    arithmetic in the balance sheet works the same way for every account.
    """
    rows: list[ParsedRow] = []
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        d_str = (row.get("Transaction Date") or "").strip()
        p_str = (row.get("Posted Date") or "").strip()
        desc = (row.get("Description") or "").strip()
        debit_str = (row.get("Debit") or "").strip()
        credit_str = (row.get("Credit") or "").strip()
        if not d_str or not desc:
            continue
        try:
            txn_d = _parse_date(d_str)
            posted_d = _parse_date(p_str) if p_str else None
            debit = _parse_amount(debit_str) if debit_str else 0.0
            credit = _parse_amount(credit_str) if credit_str else 0.0
        except ValueError:
            continue
        if txn_d is None:
            continue
        # Purchase → negative; Payment to card → positive.
        amount = credit - debit
        rows.append(ParsedRow(
            txn_date=txn_d,
            posted_date=posted_d,
            description=desc,
            amount=amount,
        ))
    return rows


def parser_for(short_code: str):
    if short_code == "cap_one":
        return parse_capital_one
    return parse_wells_fargo


def detect_account_short_code(filename: str | None, csv_text: str) -> tuple[str, str, list[ParsedRow]]:
    """Best-guess which account the file belongs to.

    Returns (short_code, reason, parsed_rows). Filename wins for the
    obvious cases; content heuristics break the tie between the three WF
    Checking accounts (which all download with identical headers and
    filenames like Checking.csv / Checking (1).csv).
    """
    fn = (filename or "").lower()

    # Cap One detection: header is the giveaway, filename usually too.
    first_line = (csv_text.splitlines() or [""])[0].lower()
    if "transaction date" in first_line and "posted date" in first_line:
        rows = parse_capital_one(csv_text)
        return ("cap_one", "Capital One header detected", rows)
    if "transaction_download" in fn or "capital" in fn:
        rows = parse_capital_one(csv_text)
        return ("cap_one", "Filename matches Cap One pattern", rows)

    # Everything below is a WF export. Parse with WF parser.
    rows = parse_wells_fargo(csv_text)

    # Filename overrides
    if "savings" in fn:
        return ("wf_savings", "Filename contains 'savings'", rows)
    if "payroll" in fn:
        return ("wf_payroll", "Filename contains 'payroll'", rows)
    if "merchant" in fn:
        return ("wf_merchant", "Filename contains 'merchant'", rows)
    if "main" in fn:
        return ("wf_main", "Filename contains 'main'", rows)

    # All 3 WF checking exports come down with the same filename — fall back
    # to content fingerprinting.
    n = len(rows)
    if n == 0:
        return ("wf_main", "No rows; defaulting to Main Checking", rows)

    adp_count = sum(1 for r in rows if "ADP" in r.description.upper())
    paycheck_zelle_count = sum(
        1 for r in rows
        if "EMPLOYEE PAYCHECK" in r.description.upper()
        or ("ZELLE" in r.description.upper() and "PAYCHECK" in r.description.upper())
    )
    stripe_count = sum(1 for r in rows if "STRIPE" in r.description.upper())
    interest_count = sum(1 for r in rows if "INTEREST PAYMENT" in r.description.upper())

    # Savings (rare to see one with a "Checking" filename, but just in case):
    # nearly empty + interest only.
    if interest_count >= max(1, n * 0.5) and n < 20:
        return ("wf_savings", "Mostly interest rows", rows)

    # Merchant Checking: this is where Stripe deposits land before being
    # swept to Main Checking. A dominant Stripe signature is the strongest
    # tell — Main Checking has Stripe transfers IN from Merchant rather
    # than direct merchant deposits.
    if stripe_count >= max(5, n * 0.5):
        return ("wf_merchant", f"{stripe_count}/{n} rows are Stripe (Merchant Checking)", rows)

    # Payroll: dominated by ADP debits + employee Zelle paychecks.
    if (adp_count + paycheck_zelle_count) >= max(5, n * 0.25):
        return ("wf_payroll", f"{adp_count} ADP + {paycheck_zelle_count} paycheck rows", rows)

    # Otherwise: Main Checking (the high-volume operating account with
    # vendor pays, US Foods, utilities, transfers, etc.).
    return ("wf_main", f"{n} rows, vendor-pay activity", rows)


# ---------------------------------------------------------------------------
# Description normalization (used as part of the dedup key)
# ---------------------------------------------------------------------------


_NORM_RE = re.compile(r"\s+")


def normalize_description(desc: str) -> str:
    return _NORM_RE.sub(" ", (desc or "").upper().strip())[:255]


# ---------------------------------------------------------------------------
# Categorization
# ---------------------------------------------------------------------------


# Patterns that mark a WF row as a Capital One payment. Categorized under
# Food Purchases (per the owner's preference) so the year-end P&L matches
# the accountant's existing books.
CC_PAYMENT_PATTERNS = (
    "CAPITAL ONE ONLINE PYMT",
    "CAPITAL ONE PAYMENT",
    "BUSINESS TO BUSINESS ACH CAPITAL ONE",
    "CAPITAL ONE ACH",
)


def detect_cc_payment(account_short_code: str, normalized_desc: str) -> bool:
    if account_short_code == "cap_one":
        return False
    return any(p in normalized_desc for p in CC_PAYMENT_PATTERNS)


def _rule_matches(rule: FinanceRule, normalized_desc: str) -> bool:
    needle = (rule.match_text or "").upper().strip()
    if not needle:
        return False
    mt = (rule.match_type or "contains").lower()
    if mt == "equals":
        return normalized_desc == needle
    if mt == "starts_with":
        return normalized_desc.startswith(needle)
    if mt == "regex":
        try:
            return re.search(rule.match_text, normalized_desc) is not None
        except re.error:
            return False
    return needle in normalized_desc


def categorize(
    rules: list[FinanceRule],
    normalized_desc: str,
) -> tuple[int | None, str | None, int | None]:
    """Returns (category_id, vendor, matched_rule_id) or (None, None, None)."""
    for rule in rules:
        if not rule.is_active:
            continue
        if _rule_matches(rule, normalized_desc):
            return (rule.category_id, rule.vendor, rule.id)
    return (None, None, None)


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------


@dataclass
class IngestionSummary:
    account: str
    parsed: int
    inserted: int
    skipped_duplicate: int
    auto_categorized: int
    uncategorized: int


async def ingest_csv(
    db: AsyncSession,
    account: BankAccount,
    csv_text: str,
    source_filename: str | None = None,
) -> IngestionSummary:
    """Parse + categorize + dedup + insert. Returns a summary."""
    parser = parser_for(account.short_code)
    parsed = parser(csv_text)

    # Pull rules + categories once; categories aren't strictly needed but help
    # us verify the Food Purchases category exists for cc_payment routing.
    rules = (await db.execute(
        select(FinanceRule)
        .where(FinanceRule.is_active.is_(True))
        .order_by(FinanceRule.priority.asc(), FinanceRule.id.asc())
    )).scalars().all()
    cats = (await db.execute(select(FinanceCategory))).scalars().all()
    cat_by_name = {c.name: c for c in cats}
    food_purchases = cat_by_name.get("Food Purchases")
    internal_transfer = cat_by_name.get("Internal Transfer")
    uncategorized = cat_by_name.get("Uncategorized")

    # Pull existing dedup keys for this account so we can reject duplicates
    # without one round-trip per row.
    existing = (await db.execute(
        select(
            BankTransaction.txn_date,
            BankTransaction.amount,
            BankTransaction.description_normalized,
        ).where(BankTransaction.account_id == account.id)
    )).all()
    existing_keys = {(r[0], round(r[1], 2), r[2]) for r in existing}

    inserted = 0
    skipped = 0
    auto_cat = 0
    uncat = 0

    for row in parsed:
        ndesc = normalize_description(row.description)
        key = (row.txn_date, round(row.amount, 2), ndesc)
        if key in existing_keys:
            skipped += 1
            continue
        existing_keys.add(key)

        cat_id, vendor, rule_id = categorize(rules, ndesc)
        flow_type = "normal"

        if account.short_code == "cap_one":
            # Every Cap One row is a card-side event. Payments to card are
            # 'cc_payment' on the WF side; Cap One side is just informational
            # — we tag the purchase rows so reports filter correctly.
            if row.amount > 0:
                # Inbound money on the card = a payment from checking. Tag as
                # internal transfer; ignored by both Tax and Operational P&L.
                flow_type = "normal"
                if internal_transfer is not None:
                    cat_id = internal_transfer.id
                    vendor = "Capital One"
                    rule_id = None
            else:
                flow_type = "cc_purchase"
        elif detect_cc_payment(account.short_code, ndesc):
            # WF→Cap One payment: count this in the year-end P&L (per owner
            # preference, under Food Purchases) and exclude from the
            # operational dashboard.
            flow_type = "cc_payment"
            if food_purchases is not None:
                cat_id = food_purchases.id
                vendor = "Capital One"
                rule_id = None

        if cat_id is None and uncategorized is not None:
            cat_id = uncategorized.id

        is_categorized = cat_id is not None and cat_id != (uncategorized.id if uncategorized else -1)
        if is_categorized:
            auto_cat += 1
        else:
            uncat += 1

        db.add(BankTransaction(
            account_id=account.id,
            txn_date=row.txn_date,
            posted_date=row.posted_date,
            description=row.description[:8000],
            description_normalized=ndesc,
            amount=row.amount,
            vendor=vendor,
            category_id=cat_id,
            matched_rule_id=rule_id,
            flow_type=flow_type,
            status="posted",
            source_filename=source_filename,
        ))
        inserted += 1

    await db.commit()
    return IngestionSummary(
        account=account.name,
        parsed=len(parsed),
        inserted=inserted,
        skipped_duplicate=skipped,
        auto_categorized=auto_cat,
        uncategorized=uncat,
    )
