"""First-install seed for the banking center.

- 5 accounts with the Jan 1, 2026 starting balances the owner provided
- Canonical category list (matches the accountant's P&L structure)
- ~150 rules imported from the offline categorization tool, with the
  truncated category names normalized to their canonical form.
"""

from __future__ import annotations

import csv
import logging
import os
from datetime import date

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import BankAccount, FinanceCategory, FinanceRule

logger = logging.getLogger(__name__)


# Tracks the year-end opening balance the owner supplied. Edit via UI later.
STARTING_DATE = date(2026, 1, 1)
STARTING_ACCOUNTS = [
    {
        "name": "Wells Fargo - Main Checking",
        "short_code": "wf_main",
        "institution": "Wells Fargo",
        "account_type": "checking",
        "starting_balance": 923.81,
        "sort_order": 10,
    },
    {
        "name": "Wells Fargo - Merchant Checking",
        "short_code": "wf_merchant",
        "institution": "Wells Fargo",
        "account_type": "checking",
        "starting_balance": 27.07,
        "sort_order": 20,
    },
    {
        "name": "Wells Fargo - Payroll Checking",
        "short_code": "wf_payroll",
        "institution": "Wells Fargo",
        "account_type": "checking",
        "starting_balance": 1627.35,
        "sort_order": 30,
    },
    {
        "name": "Wells Fargo - Savings",
        "short_code": "wf_savings",
        "institution": "Wells Fargo",
        "account_type": "savings",
        "starting_balance": 18.00,
        "sort_order": 40,
    },
    {
        # Credit-card balances are stored as the amount owed (positive number).
        # On the balance sheet this appears as a current liability.
        "name": "Capital One Credit Card",
        "short_code": "cap_one",
        "institution": "Capital One",
        "account_type": "credit_card",
        "starting_balance": 75000.00,
        "sort_order": 50,
    },
]


# (name, type, sort_order). Hierarchy is flat for v1; we can nest later.
SEED_CATEGORIES: list[tuple[str, str, int]] = [
    # Income
    ("Food Sales", "income", 100),
    ("Online Food Sales", "income", 110),
    ("Bank Interest", "income", 120),
    ("Equipment Sales", "income", 130),
    ("ERC", "income", 140),
    ("EV Charging", "income", 150),
    ("Insurance Settlement", "income", 160),
    # COGS
    ("Cost of Goods Sold", "cogs", 200),
    ("Food Purchases", "cogs", 210),
    ("Restaurant Supplies", "cogs", 220),
    # Operating expense
    ("Advertising and Promotion", "expense", 300),
    ("Automobile Expense", "expense", 310),
    ("Bank Service Charges", "expense", 320),
    ("Building Construction", "expense", 330),
    ("Business Licenses and Permits", "expense", 340),
    ("CASH FOR POS DRAWERS", "expense", 350),
    ("Computer and Internet", "expense", 360),
    ("Donations", "expense", 370),
    ("Fuel", "expense", 380),
    ("GIFTS", "expense", 390),
    ("Insurance Expense", "expense", 400),
    ("Workers Comp Insurance", "expense", 410),
    ("Meals", "expense", 420),
    ("Notes Payable - Ram Cargo Van", "expense", 430),
    ("Office Supplies", "expense", 440),
    ("Payroll Expenses", "expense", 450),
    ("Payroll Tax Expenses", "expense", 460),
    ("Professional Fees", "expense", 470),
    ("Rent Expense", "expense", 480),
    ("Repairs and Maintenance", "expense", 490),
    ("Shipping Expense", "expense", 500),
    ("Software", "expense", 510),
    ("Subscriptions", "expense", 520),
    ("Travel Expense", "expense", 530),
    ("Utilities", "expense", 540),
    ("Interest Expense", "expense", 550),
    # Transfers (excluded from P&L)
    ("Internal Transfer", "transfer", 600),
    ("Uncategorized", "expense", 999),
]


# Rules CSV ships with truncated category names ("Advertising and Prom...").
# Normalize them to the canonical names above.
CATEGORY_NORMALIZATION: dict[str, str] = {
    "Advertising and Prom...": "Advertising and Promotion",
    "Automobile Expense...": "Automobile Expense",
    "Business Licenses an...": "Business Licenses and Permits",
    "Computer and Internet": "Computer and Internet",
    "Food Sales Online Fo...": "Online Food Sales",
    "Notes Payable/Ram C...": "Notes Payable - Ram Cargo Van",
    "Payroll Expenses Pay...": "Payroll Tax Expenses",
    "Payroll Expenses W...": "Workers Comp Insurance",
}


async def seed_finance(session: AsyncSession) -> None:
    """Idempotent: skips work if accounts already exist."""
    existing = (await session.execute(select(BankAccount).limit(1))).scalar_one_or_none()
    if existing is not None:
        logger.info("Banking center already seeded, skipping.")
        return

    logger.info("Seeding banking center: 5 accounts, %d categories, rules…", len(SEED_CATEGORIES))

    # Accounts
    for acct in STARTING_ACCOUNTS:
        session.add(BankAccount(
            name=acct["name"],
            short_code=acct["short_code"],
            institution=acct["institution"],
            account_type=acct["account_type"],
            starting_balance=acct["starting_balance"],
            starting_balance_date=STARTING_DATE,
            sort_order=acct["sort_order"],
            is_active=True,
        ))

    # Categories
    for name, ctype, sort_order in SEED_CATEGORIES:
        session.add(FinanceCategory(
            name=name,
            category_type=ctype,
            sort_order=sort_order,
        ))
    await session.commit()

    # Rules — fetch the categories we just inserted so we can resolve FKs
    cats = (await session.execute(select(FinanceCategory))).scalars().all()
    cat_by_name = {c.name: c for c in cats}

    rules_path = os.path.join(
        os.path.dirname(__file__), "finance", "initial_rules.csv"
    )
    if not os.path.exists(rules_path):
        logger.warning("Rules CSV not found at %s, skipping rule seed.", rules_path)
        return

    inserted = 0
    skipped: list[str] = []
    with open(rules_path, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            raw_cat = (row.get("category") or "").strip()
            cat_name = CATEGORY_NORMALIZATION.get(raw_cat, raw_cat)
            cat = cat_by_name.get(cat_name)
            if cat is None:
                skipped.append(f"{row.get('rule_name')} → unknown category {raw_cat!r}")
                continue
            session.add(FinanceRule(
                rule_name=row.get("rule_name", "").strip()[:200],
                match_type=(row.get("match_type") or "contains").strip().lower(),
                match_text=(row.get("match_text") or "").strip(),
                vendor=(row.get("vendor") or None) and row["vendor"].strip()[:200],
                category_id=cat.id,
                priority=100,
                is_active=True,
            ))
            inserted += 1
    await session.commit()
    logger.info("Banking center seed: %d rules inserted, %d skipped.", inserted, len(skipped))
    for s in skipped[:10]:
        logger.warning("Rule skipped: %s", s)


async def ensure_account_scoped_rules(session: AsyncSession) -> None:
    """Idempotent: re-applies on every boot. Specific rules that depend on
    transaction account context, not just description. Today there's just
    one (CHECK on Payroll Checking → Payroll Expenses); add more here as
    they come up."""
    payroll_acct = (await session.execute(
        select(BankAccount).where(BankAccount.short_code == "wf_payroll")
    )).scalar_one_or_none()
    payroll_cat = (await session.execute(
        select(FinanceCategory).where(FinanceCategory.name == "Payroll Expenses")
    )).scalar_one_or_none()
    if not payroll_acct or not payroll_cat:
        return

    existing = (await session.execute(
        select(FinanceRule).where(
            FinanceRule.account_id == payroll_acct.id,
            FinanceRule.match_text == "CHECK",
            FinanceRule.match_type == "equals",
        )
    )).scalar_one_or_none()
    if existing is not None:
        return

    session.add(FinanceRule(
        rule_name="CHECK on Payroll Checking",
        match_type="equals",
        match_text="CHECK",
        vendor="Employee Paycheck",
        category_id=payroll_cat.id,
        account_id=payroll_acct.id,
        priority=50,  # higher priority than the generic Uncategorized fallback
        is_active=True,
    ))
    await session.commit()
    logger.info("Banking: seeded account-scoped rule CHECK@Payroll → Payroll Expenses.")
