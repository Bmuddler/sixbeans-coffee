"""Banking center: accounts, transactions, rules, ledger, P&L, balance sheet.

Owner-only across the board. Both owners (Brian + Jess) can read/write.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles
from app.models.finance import (
    BankAccount,
    BankTransaction,
    FinanceCategory,
    FinanceRule,
    ManualLedgerEntry,
    MonthlyClose,
)
from app.models.user import User, UserRole
from app.services.finance_ingestion import ingest_csv, normalize_description

router = APIRouter()


def _owner_only():
    return require_roles(UserRole.owner)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class AccountResponse(BaseModel):
    id: int
    name: str
    short_code: str
    institution: str
    account_type: str
    last_four: str | None = None
    starting_balance: float
    starting_balance_date: date
    current_balance: float
    is_active: bool

    class Config:
        from_attributes = True


class CategoryResponse(BaseModel):
    id: int
    name: str
    category_type: str
    parent_id: int | None = None
    is_archived: bool

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):
    name: str
    category_type: Literal["income", "cogs", "expense", "transfer"] = "expense"
    parent_id: int | None = None


class CategoryUpdate(BaseModel):
    name: str | None = None
    category_type: Literal["income", "cogs", "expense", "transfer"] | None = None
    is_archived: bool | None = None


class RuleResponse(BaseModel):
    id: int
    rule_name: str
    match_type: str
    match_text: str
    vendor: str | None = None
    category_id: int
    priority: int
    is_active: bool

    class Config:
        from_attributes = True


class RuleCreate(BaseModel):
    rule_name: str
    match_type: Literal["contains", "equals", "starts_with", "regex"] = "contains"
    match_text: str
    vendor: str | None = None
    category_id: int
    priority: int = 100
    is_active: bool = True


class RuleUpdate(BaseModel):
    rule_name: str | None = None
    match_type: Literal["contains", "equals", "starts_with", "regex"] | None = None
    match_text: str | None = None
    vendor: str | None = None
    category_id: int | None = None
    priority: int | None = None
    is_active: bool | None = None


class TransactionResponse(BaseModel):
    id: int
    account_id: int
    account_name: str
    txn_date: date
    description: str
    amount: float
    vendor: str | None = None
    category_id: int | None = None
    category_name: str | None = None
    flow_type: str
    status: str
    is_locked: bool
    notes: str | None = None
    has_receipt: bool

    class Config:
        from_attributes = True


class TransactionUpdate(BaseModel):
    category_id: int | None = None
    vendor: str | None = None
    notes: str | None = None
    flow_type: Literal["normal", "cc_payment", "cc_purchase"] | None = None


class LedgerEntryResponse(BaseModel):
    id: int
    name: str
    entry_type: str
    sub_type: str | None = None
    amount: float
    as_of_date: date
    notes: str | None = None

    class Config:
        from_attributes = True


class LedgerEntryCreate(BaseModel):
    name: str
    entry_type: Literal["asset", "liability", "equity"]
    sub_type: str | None = None
    amount: float
    as_of_date: date
    notes: str | None = None


class LedgerEntryUpdate(BaseModel):
    name: str | None = None
    sub_type: str | None = None
    amount: float | None = None
    as_of_date: date | None = None
    notes: str | None = None


class CloseRequest(BaseModel):
    year: int = Field(..., ge=2024, le=2100)
    month: int = Field(..., ge=1, le=12)
    notes: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _account_balance(db: AsyncSession, account: BankAccount) -> float:
    total = (await db.execute(
        select(func.coalesce(func.sum(BankTransaction.amount), 0.0))
        .where(BankTransaction.account_id == account.id)
    )).scalar() or 0.0
    if account.account_type == "credit_card":
        # On a CC, the "balance" is the amount owed. Starting balance is
        # tracked as a positive owed-amount; purchases (negative amounts on
        # transactions) increase what's owed; payments (positive amounts)
        # decrease it.
        return float(account.starting_balance) - float(total)
    return float(account.starting_balance) + float(total)


async def _is_locked_period(db: AsyncSession, txn_date: date) -> bool:
    closed = (await db.execute(
        select(MonthlyClose).where(
            MonthlyClose.year == txn_date.year,
            MonthlyClose.month == txn_date.month,
        )
    )).scalar_one_or_none()
    return closed is not None


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


@router.get("/accounts", response_model=list[AccountResponse])
async def list_accounts(
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    accounts = (await db.execute(
        select(BankAccount).order_by(BankAccount.sort_order.asc())
    )).scalars().all()
    out: list[AccountResponse] = []
    for a in accounts:
        out.append(AccountResponse(
            id=a.id,
            name=a.name,
            short_code=a.short_code,
            institution=a.institution,
            account_type=a.account_type,
            last_four=a.last_four,
            starting_balance=a.starting_balance,
            starting_balance_date=a.starting_balance_date,
            current_balance=round(await _account_balance(db, a), 2),
            is_active=a.is_active,
        ))
    return out


class AccountUpdate(BaseModel):
    starting_balance: float | None = None
    starting_balance_date: date | None = None
    last_four: str | None = None
    is_active: bool | None = None


@router.patch("/accounts/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: int,
    payload: AccountUpdate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    a = (await db.execute(select(BankAccount).where(BankAccount.id == account_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")
    if payload.starting_balance is not None:
        a.starting_balance = payload.starting_balance
    if payload.starting_balance_date is not None:
        a.starting_balance_date = payload.starting_balance_date
    if payload.last_four is not None:
        a.last_four = payload.last_four
    if payload.is_active is not None:
        a.is_active = payload.is_active
    await db.commit()
    await db.refresh(a)
    return AccountResponse(
        id=a.id, name=a.name, short_code=a.short_code, institution=a.institution,
        account_type=a.account_type, last_four=a.last_four,
        starting_balance=a.starting_balance, starting_balance_date=a.starting_balance_date,
        current_balance=round(await _account_balance(db, a), 2), is_active=a.is_active,
    )


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@router.get("/categories", response_model=list[CategoryResponse])
async def list_categories(
    include_archived: bool = False,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    q = select(FinanceCategory).order_by(FinanceCategory.sort_order.asc(), FinanceCategory.name.asc())
    if not include_archived:
        q = q.where(FinanceCategory.is_archived.is_(False))
    cats = (await db.execute(q)).scalars().all()
    return cats


@router.post("/categories", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(
        select(FinanceCategory).where(func.lower(FinanceCategory.name) == payload.name.strip().lower())
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Category {payload.name!r} already exists")
    cat = FinanceCategory(
        name=payload.name.strip(),
        category_type=payload.category_type,
        parent_id=payload.parent_id,
        sort_order=900,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.patch("/categories/{cat_id}", response_model=CategoryResponse)
async def update_category(
    cat_id: int,
    payload: CategoryUpdate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    cat = (await db.execute(select(FinanceCategory).where(FinanceCategory.id == cat_id))).scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if payload.name is not None:
        cat.name = payload.name.strip()
    if payload.category_type is not None:
        cat.category_type = payload.category_type
    if payload.is_archived is not None:
        cat.is_archived = payload.is_archived
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    cat_id: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    cat = (await db.execute(select(FinanceCategory).where(FinanceCategory.id == cat_id))).scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    in_use = (await db.execute(
        select(func.count())
        .select_from(BankTransaction)
        .where(BankTransaction.category_id == cat_id)
    )).scalar() or 0
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: {in_use} transactions still use this category. Archive instead.",
        )
    rules_in_use = (await db.execute(
        select(func.count()).select_from(FinanceRule).where(FinanceRule.category_id == cat_id)
    )).scalar() or 0
    if rules_in_use:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: {rules_in_use} rules still target this category.",
        )
    await db.delete(cat)
    await db.commit()


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------


@router.get("/rules", response_model=list[RuleResponse])
async def list_rules(
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    rules = (await db.execute(
        select(FinanceRule).order_by(FinanceRule.priority.asc(), FinanceRule.id.asc())
    )).scalars().all()
    return rules


@router.post("/rules", response_model=RuleResponse, status_code=status.HTTP_201_CREATED)
async def create_rule(
    payload: RuleCreate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    cat = (await db.execute(select(FinanceCategory).where(FinanceCategory.id == payload.category_id))).scalar_one_or_none()
    if cat is None:
        raise HTTPException(status_code=400, detail="category_id not found")
    rule = FinanceRule(
        rule_name=payload.rule_name.strip()[:200],
        match_type=payload.match_type,
        match_text=payload.match_text.strip(),
        vendor=(payload.vendor or "").strip()[:200] or None,
        category_id=payload.category_id,
        priority=payload.priority,
        is_active=payload.is_active,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.patch("/rules/{rule_id}", response_model=RuleResponse)
async def update_rule(
    rule_id: int,
    payload: RuleUpdate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    rule = (await db.execute(select(FinanceRule).where(FinanceRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rule, field, value)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    rule = (await db.execute(select(FinanceRule).where(FinanceRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    await db.commit()


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------


@router.post("/ingest")
async def ingest_endpoint(
    account_id: int = Form(...),
    file: UploadFile = File(...),
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    a = (await db.execute(select(BankAccount).where(BankAccount.id == account_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")
    contents = await file.read()
    try:
        text = contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = contents.decode("latin-1")
    summary = await ingest_csv(db, a, text, source_filename=file.filename)
    return {
        "account": summary.account,
        "parsed": summary.parsed,
        "inserted": summary.inserted,
        "skipped_duplicate": summary.skipped_duplicate,
        "auto_categorized": summary.auto_categorized,
        "uncategorized": summary.uncategorized,
    }


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------


@router.get("/transactions")
async def list_transactions(
    account_id: int | None = None,
    category_id: int | None = None,
    flow_type: str | None = None,
    only_uncategorized: bool = False,
    start_date: date | None = None,
    end_date: date | None = None,
    search: str | None = None,
    page: int = 1,
    per_page: int = 100,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    q = select(BankTransaction, BankAccount, FinanceCategory).join(
        BankAccount, BankTransaction.account_id == BankAccount.id
    ).outerjoin(
        FinanceCategory, BankTransaction.category_id == FinanceCategory.id
    )
    if account_id:
        q = q.where(BankTransaction.account_id == account_id)
    if category_id:
        q = q.where(BankTransaction.category_id == category_id)
    if flow_type:
        q = q.where(BankTransaction.flow_type == flow_type)
    if only_uncategorized:
        uncat = (await db.execute(
            select(FinanceCategory).where(FinanceCategory.name == "Uncategorized")
        )).scalar_one_or_none()
        if uncat is not None:
            q = q.where(or_(
                BankTransaction.category_id.is_(None),
                BankTransaction.category_id == uncat.id,
            ))
    if start_date:
        q = q.where(BankTransaction.txn_date >= start_date)
    if end_date:
        q = q.where(BankTransaction.txn_date <= end_date)
    if search:
        like = f"%{search.upper()}%"
        q = q.where(BankTransaction.description_normalized.like(like))

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    q = q.order_by(BankTransaction.txn_date.desc(), BankTransaction.id.desc())
    q = q.offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(q)).all()

    items: list[dict] = []
    for txn, acct, cat in rows:
        items.append({
            "id": txn.id,
            "account_id": txn.account_id,
            "account_name": acct.name,
            "account_short_code": acct.short_code,
            "txn_date": txn.txn_date.isoformat(),
            "description": txn.description,
            "amount": txn.amount,
            "vendor": txn.vendor,
            "category_id": txn.category_id,
            "category_name": cat.name if cat else None,
            "flow_type": txn.flow_type,
            "status": txn.status,
            "is_locked": txn.is_locked,
            "notes": txn.notes,
            "has_receipt": txn.receipt_blob is not None,
        })
    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.patch("/transactions/{txn_id}")
async def update_transaction(
    txn_id: int,
    payload: TransactionUpdate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    txn = (await db.execute(select(BankTransaction).where(BankTransaction.id == txn_id))).scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if txn.is_locked:
        raise HTTPException(status_code=409, detail="Transaction is in a closed month and cannot be edited.")
    if await _is_locked_period(db, txn.txn_date):
        raise HTTPException(status_code=409, detail="That month is closed.")
    if payload.category_id is not None:
        cat = (await db.execute(select(FinanceCategory).where(FinanceCategory.id == payload.category_id))).scalar_one_or_none()
        if not cat:
            raise HTTPException(status_code=400, detail="category_id not found")
        txn.category_id = payload.category_id
    if payload.vendor is not None:
        txn.vendor = payload.vendor.strip() or None
    if payload.notes is not None:
        txn.notes = payload.notes.strip() or None
    if payload.flow_type is not None:
        txn.flow_type = payload.flow_type
    await db.commit()
    return {"ok": True}


@router.delete("/transactions/{txn_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    txn_id: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    txn = (await db.execute(select(BankTransaction).where(BankTransaction.id == txn_id))).scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if txn.is_locked or await _is_locked_period(db, txn.txn_date):
        raise HTTPException(status_code=409, detail="That month is closed.")
    await db.delete(txn)
    await db.commit()


@router.post("/transactions/{txn_id}/receipt")
async def attach_receipt(
    txn_id: int,
    file: UploadFile = File(...),
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    import base64
    txn = (await db.execute(select(BankTransaction).where(BankTransaction.id == txn_id))).scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Receipt larger than 10MB")
    txn.receipt_blob = base64.b64encode(contents).decode("utf-8")
    txn.receipt_filename = file.filename
    txn.receipt_content_type = file.content_type
    await db.commit()
    return {"ok": True}


@router.delete("/transactions/{txn_id}/receipt", status_code=status.HTTP_204_NO_CONTENT)
async def remove_receipt(
    txn_id: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    txn = (await db.execute(select(BankTransaction).where(BankTransaction.id == txn_id))).scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    txn.receipt_blob = None
    txn.receipt_filename = None
    txn.receipt_content_type = None
    await db.commit()


# ---------------------------------------------------------------------------
# Manual ledger
# ---------------------------------------------------------------------------


@router.get("/ledger", response_model=list[LedgerEntryResponse])
async def list_ledger(
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ManualLedgerEntry).order_by(
            ManualLedgerEntry.entry_type.asc(),
            ManualLedgerEntry.sort_order.asc(),
            ManualLedgerEntry.id.asc(),
        )
    )).scalars().all()
    return rows


@router.post("/ledger", response_model=LedgerEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_ledger_entry(
    payload: LedgerEntryCreate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    entry = ManualLedgerEntry(**payload.model_dump())
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.patch("/ledger/{entry_id}", response_model=LedgerEntryResponse)
async def update_ledger_entry(
    entry_id: int,
    payload: LedgerEntryUpdate,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    entry = (await db.execute(select(ManualLedgerEntry).where(ManualLedgerEntry.id == entry_id))).scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/ledger/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ledger_entry(
    entry_id: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    entry = (await db.execute(select(ManualLedgerEntry).where(ManualLedgerEntry.id == entry_id))).scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    await db.delete(entry)
    await db.commit()


# ---------------------------------------------------------------------------
# Reports — P&L, Balance Sheet, Vendor breakdown
# ---------------------------------------------------------------------------


def _is_tax_view_excluded(flow_type: str) -> bool:
    """Tax/year-end P&L excludes only cc_purchase rows (counted via the lump
    payment on the WF side)."""
    return flow_type == "cc_purchase"


def _is_operational_view_excluded(flow_type: str) -> bool:
    """Operational view excludes the lump CC payment (so it doesn't double
    count with the underlying purchases)."""
    return flow_type == "cc_payment"


async def _compute_pl(
    db: AsyncSession,
    start_date: date,
    end_date: date,
    mode: str,
) -> dict:
    rows = (await db.execute(
        select(
            BankTransaction.id,
            BankTransaction.amount,
            BankTransaction.flow_type,
            BankTransaction.category_id,
            FinanceCategory.name,
            FinanceCategory.category_type,
        )
        .join(FinanceCategory, BankTransaction.category_id == FinanceCategory.id, isouter=True)
        .where(BankTransaction.txn_date >= start_date)
        .where(BankTransaction.txn_date <= end_date)
    )).all()

    income: dict[str, float] = defaultdict(float)
    cogs: dict[str, float] = defaultdict(float)
    expense: dict[str, float] = defaultdict(float)
    transfer_skipped = 0
    excluded_by_mode = 0

    for _id, amount, flow_type, _cid, name, ctype in rows:
        if mode == "tax" and _is_tax_view_excluded(flow_type):
            excluded_by_mode += 1
            continue
        if mode == "operational" and _is_operational_view_excluded(flow_type):
            excluded_by_mode += 1
            continue
        if ctype == "transfer":
            transfer_skipped += 1
            continue
        cat_name = name or "Uncategorized"
        if ctype == "income":
            # Income on a checking account = inflow = positive amount
            income[cat_name] += float(amount or 0.0)
        elif ctype == "cogs":
            # COGS recorded as negative cash flow (outflow). Display as positive.
            cogs[cat_name] += -float(amount or 0.0)
        else:
            # Default 'expense' or unknown
            expense[cat_name] += -float(amount or 0.0)

    total_income = round(sum(income.values()), 2)
    total_cogs = round(sum(cogs.values()), 2)
    total_expense = round(sum(expense.values()), 2)
    gross_profit = round(total_income - total_cogs, 2)
    net_income = round(gross_profit - total_expense, 2)

    return {
        "mode": mode,
        "window": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "days": (end_date - start_date).days + 1,
        },
        "income": [{"category": k, "amount": round(v, 2)} for k, v in sorted(income.items(), key=lambda x: -x[1])],
        "cogs": [{"category": k, "amount": round(v, 2)} for k, v in sorted(cogs.items(), key=lambda x: -x[1])],
        "expense": [{"category": k, "amount": round(v, 2)} for k, v in sorted(expense.items(), key=lambda x: -x[1])],
        "totals": {
            "income": total_income,
            "cogs": total_cogs,
            "gross_profit": gross_profit,
            "expense": total_expense,
            "net_income": net_income,
        },
        "diagnostics": {
            "transfer_rows_skipped": transfer_skipped,
            "rows_excluded_by_mode": excluded_by_mode,
        },
    }


@router.get("/reports/pl")
async def profit_and_loss(
    start_date: date,
    end_date: date,
    mode: Literal["tax", "operational"] = "tax",
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    return await _compute_pl(db, start_date, end_date, mode)


@router.get("/reports/balance-sheet")
async def balance_sheet(
    as_of: date | None = None,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    """As-of balance sheet. Bank balances roll forward from each account's
    starting balance + any transactions through `as_of`. Manual ledger
    entries (Food Inventory, Notes Receivable, Member equity, etc.) are
    layered on top."""
    if as_of is None:
        as_of = date.today()

    accounts = (await db.execute(
        select(BankAccount).order_by(BankAccount.sort_order.asc())
    )).scalars().all()

    bank_assets = []
    cc_liabilities = []
    for a in accounts:
        total_through = (await db.execute(
            select(func.coalesce(func.sum(BankTransaction.amount), 0.0))
            .where(BankTransaction.account_id == a.id)
            .where(BankTransaction.txn_date <= as_of)
        )).scalar() or 0.0
        if a.account_type == "credit_card":
            owed = float(a.starting_balance) - float(total_through)
            cc_liabilities.append({
                "id": a.id, "name": a.name, "amount": round(owed, 2),
            })
        else:
            bal = float(a.starting_balance) + float(total_through)
            bank_assets.append({
                "id": a.id, "name": a.name, "amount": round(bal, 2),
            })

    ledger = (await db.execute(
        select(ManualLedgerEntry).where(ManualLedgerEntry.as_of_date <= as_of)
    )).scalars().all()

    other_assets: list[dict] = []
    other_liabilities: list[dict] = []
    equity_items: list[dict] = []
    for e in ledger:
        item = {"id": e.id, "name": e.name, "sub_type": e.sub_type, "amount": round(e.amount, 2)}
        if e.entry_type == "asset":
            other_assets.append(item)
        elif e.entry_type == "liability":
            other_liabilities.append(item)
        else:
            equity_items.append(item)

    total_bank = round(sum(x["amount"] for x in bank_assets), 2)
    total_other_assets = round(sum(x["amount"] for x in other_assets), 2)
    total_assets = round(total_bank + total_other_assets, 2)

    total_cc = round(sum(x["amount"] for x in cc_liabilities), 2)
    total_other_liab = round(sum(x["amount"] for x in other_liabilities), 2)
    total_liabilities = round(total_cc + total_other_liab, 2)

    total_equity_manual = round(sum(x["amount"] for x in equity_items), 2)

    # YTD net income up to the as-of date — derived from transactions so the
    # balance sheet ties to the P&L automatically. Uses tax-mode rules so it
    # matches what the accountant sees.
    pl = await _compute_pl(db, date(as_of.year, 1, 1), as_of, "tax")
    ytd_net_income = pl["totals"]["net_income"]

    return {
        "as_of": as_of.isoformat(),
        "assets": {
            "bank": bank_assets,
            "other": other_assets,
            "total_bank": total_bank,
            "total_other": total_other_assets,
            "total": total_assets,
        },
        "liabilities": {
            "credit_cards": cc_liabilities,
            "other": other_liabilities,
            "total_credit_cards": total_cc,
            "total_other": total_other_liab,
            "total": total_liabilities,
        },
        "equity": {
            "manual_items": equity_items,
            "ytd_net_income": ytd_net_income,
            "total": round(total_equity_manual + ytd_net_income, 2),
        },
        "totals": {
            "assets": total_assets,
            "liabilities_plus_equity": round(total_liabilities + total_equity_manual + ytd_net_income, 2),
        },
    }


@router.get("/reports/top-vendors")
async def top_vendors(
    start_date: date,
    end_date: date,
    limit: int = 25,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    """Operational view: ranked vendor spend with month-over-month delta.
    Excludes cc_payment rows so vendor totals reflect actual purchases."""
    rows = (await db.execute(
        select(
            BankTransaction.vendor,
            BankTransaction.txn_date,
            BankTransaction.amount,
            BankTransaction.flow_type,
        )
        .where(BankTransaction.txn_date >= start_date)
        .where(BankTransaction.txn_date <= end_date)
    )).all()

    span_days = (end_date - start_date).days + 1
    prior_end = start_date - timedelta(days=1)
    prior_start = prior_end - timedelta(days=span_days - 1)
    prior_rows = (await db.execute(
        select(
            BankTransaction.vendor,
            BankTransaction.amount,
            BankTransaction.flow_type,
        )
        .where(BankTransaction.txn_date >= prior_start)
        .where(BankTransaction.txn_date <= prior_end)
    )).all()

    def _sum_outflow(rs):
        out: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "count": 0})
        for r in rs:
            vendor = r[0] or "Unknown"
            amount = r[2] if len(r) >= 3 else r[1]
            flow = r[-1]
            if flow == "cc_payment":
                continue
            if amount is None or amount >= 0:
                continue
            out[vendor]["total"] += -float(amount)
            out[vendor]["count"] += 1
        return out

    curr = _sum_outflow(rows)
    prev = _sum_outflow(prior_rows)
    items = []
    for vendor, agg in curr.items():
        prev_total = prev.get(vendor, {}).get("total", 0.0)
        delta_pct = None
        if prev_total > 0:
            delta_pct = round((agg["total"] - prev_total) / prev_total * 100.0, 1)
        items.append({
            "vendor": vendor,
            "total": round(agg["total"], 2),
            "count": agg["count"],
            "prior_total": round(prev_total, 2),
            "delta_pct": delta_pct,
        })
    items.sort(key=lambda x: -x["total"])
    return {
        "window": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "days": span_days,
        },
        "items": items[:limit],
    }


# ---------------------------------------------------------------------------
# Month-end close
# ---------------------------------------------------------------------------


@router.get("/closes")
async def list_closes(
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(MonthlyClose).order_by(MonthlyClose.year.desc(), MonthlyClose.month.desc())
    )).scalars().all()
    return [
        {"year": r.year, "month": r.month, "closed_at": r.closed_at.isoformat(), "notes": r.notes}
        for r in rows
    ]


@router.post("/closes")
async def close_month(
    payload: CloseRequest,
    current_user: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    """Close a month: marks all transactions in that month as locked. Refuses
    if there are any uncategorized rows still in the period."""
    existing = (await db.execute(
        select(MonthlyClose).where(
            MonthlyClose.year == payload.year,
            MonthlyClose.month == payload.month,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="That month is already closed.")

    period_start = date(payload.year, payload.month, 1)
    if payload.month == 12:
        period_end = date(payload.year, 12, 31)
    else:
        period_end = date(payload.year, payload.month + 1, 1) - timedelta(days=1)

    uncat = (await db.execute(
        select(FinanceCategory).where(FinanceCategory.name == "Uncategorized")
    )).scalar_one_or_none()
    if uncat is not None:
        n_uncat = (await db.execute(
            select(func.count())
            .select_from(BankTransaction)
            .where(BankTransaction.txn_date >= period_start)
            .where(BankTransaction.txn_date <= period_end)
            .where(or_(
                BankTransaction.category_id.is_(None),
                BankTransaction.category_id == uncat.id,
            ))
        )).scalar() or 0
        if n_uncat:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot close: {n_uncat} uncategorized transactions remain in {payload.year}-{payload.month:02d}.",
            )

    txns = (await db.execute(
        select(BankTransaction)
        .where(BankTransaction.txn_date >= period_start)
        .where(BankTransaction.txn_date <= period_end)
    )).scalars().all()
    for t in txns:
        t.is_locked = True

    db.add(MonthlyClose(
        year=payload.year,
        month=payload.month,
        closed_by=current_user.id,
        notes=payload.notes,
    ))
    await db.commit()
    return {"ok": True, "transactions_locked": len(txns)}


@router.delete("/closes/{year}/{month}", status_code=status.HTTP_204_NO_CONTENT)
async def reopen_month(
    year: int,
    month: int,
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    cls = (await db.execute(
        select(MonthlyClose).where(MonthlyClose.year == year, MonthlyClose.month == month)
    )).scalar_one_or_none()
    if cls is None:
        raise HTTPException(status_code=404, detail="That month is not closed.")
    period_start = date(year, month, 1)
    if month == 12:
        period_end = date(year, 12, 31)
    else:
        period_end = date(year, month + 1, 1) - timedelta(days=1)
    txns = (await db.execute(
        select(BankTransaction)
        .where(BankTransaction.txn_date >= period_start)
        .where(BankTransaction.txn_date <= period_end)
    )).scalars().all()
    for t in txns:
        t.is_locked = False
    await db.delete(cls)
    await db.commit()


# ---------------------------------------------------------------------------
# Re-categorize: apply current rules to any uncategorized rows. Useful after
# adding a new rule.
# ---------------------------------------------------------------------------


@router.post("/recategorize-uncategorized")
async def recategorize_uncategorized(
    _u: User = Depends(_owner_only()),
    db: AsyncSession = Depends(get_db),
):
    from app.services.finance_ingestion import categorize as run_categorizer

    uncat = (await db.execute(
        select(FinanceCategory).where(FinanceCategory.name == "Uncategorized")
    )).scalar_one_or_none()
    if uncat is None:
        raise HTTPException(status_code=400, detail="Uncategorized category not found.")

    txns = (await db.execute(
        select(BankTransaction).where(or_(
            BankTransaction.category_id.is_(None),
            BankTransaction.category_id == uncat.id,
        )).where(BankTransaction.is_locked.is_(False))
    )).scalars().all()

    rules = (await db.execute(
        select(FinanceRule).where(FinanceRule.is_active.is_(True))
        .order_by(FinanceRule.priority.asc(), FinanceRule.id.asc())
    )).scalars().all()

    updated = 0
    for t in txns:
        cat_id, vendor, rule_id = run_categorizer(rules, t.description_normalized)
        if cat_id is not None:
            t.category_id = cat_id
            t.vendor = vendor
            t.matched_rule_id = rule_id
            updated += 1
    await db.commit()
    return {"updated": updated, "examined": len(txns)}
