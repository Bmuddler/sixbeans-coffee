"""Banking center: bank accounts, transactions, categories, rules, ledger, closes.

Architecture notes:

- We model 5 accounts: 4 Wells Fargo (Main Checking, Merchant Checking, Payroll
  Checking, Savings) + 1 Capital One credit card. Each has a starting balance
  on a known date and we roll forward from there using transaction amounts.

- Each transaction carries a `flow_type`:
    'normal'      → regular income/expense, counts in both Tax and Operational
    'cc_payment'  → WF→Cap One lump payment. Counts in Tax P&L (so the
                    accountant's books match), excluded from Operational
                    spend analysis (so it doesn't double-count with the
                    underlying purchases).
    'cc_purchase' → an actual purchase made on the Cap One card. Excluded
                    from Tax P&L (covered by the lump payment) but COUNTS
                    in Operational spend so vendor breakdowns are accurate.

- Dedup key: (account_id, date, amount, normalized_description). Re-uploading
  the same statement is a no-op; partial overlaps are handled gracefully.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
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


class BankAccount(Base):
    __tablename__ = "bank_accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    short_code = Column(String(40), nullable=False, unique=True)  # 'wf_main', 'cap_one', etc.
    institution = Column(String(50), nullable=False)  # 'Wells Fargo', 'Capital One'
    account_type = Column(String(20), nullable=False)  # 'checking', 'savings', 'credit_card'
    last_four = Column(String(4), nullable=True)
    starting_balance = Column(Float, nullable=False, default=0.0)
    starting_balance_date = Column(Date, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class FinanceCategory(Base):
    __tablename__ = "finance_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False, unique=True)
    # 'income' | 'cogs' | 'expense' | 'transfer' | 'asset' | 'liability' | 'equity'
    category_type = Column(String(20), nullable=False, default="expense")
    parent_id = Column(Integer, ForeignKey("finance_categories.id"), nullable=True)
    is_archived = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    parent = relationship("FinanceCategory", remote_side=[id])


class FinanceRule(Base):
    __tablename__ = "finance_rules"

    id = Column(Integer, primary_key=True, index=True)
    rule_name = Column(String(200), nullable=False)
    # 'contains' | 'equals' | 'starts_with' | 'regex'
    match_type = Column(String(20), nullable=False, default="contains")
    match_text = Column(String(255), nullable=False)
    vendor = Column(String(200), nullable=True)
    category_id = Column(Integer, ForeignKey("finance_categories.id"), nullable=False)
    # Optional account scope: if set, the rule only matches transactions on
    # that account. Used for things like "every CHECK on Payroll Checking
    # is a payroll expense" where the description alone is ambiguous.
    account_id = Column(Integer, ForeignKey("bank_accounts.id"), nullable=True)
    priority = Column(Integer, nullable=False, default=100)  # lower = checked first
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    category = relationship("FinanceCategory")
    account = relationship("BankAccount")


class BankTransaction(Base):
    __tablename__ = "bank_transactions"
    __table_args__ = (
        UniqueConstraint(
            "account_id", "txn_date", "amount", "description_normalized",
            name="uq_bank_txn_dedup",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("bank_accounts.id"), nullable=False, index=True)
    txn_date = Column(Date, nullable=False, index=True)
    posted_date = Column(Date, nullable=True)
    description = Column(Text, nullable=False)
    description_normalized = Column(String(255), nullable=False)
    amount = Column(Float, nullable=False)  # signed: + inflow, − outflow
    vendor = Column(String(200), nullable=True)
    category_id = Column(Integer, ForeignKey("finance_categories.id"), nullable=True, index=True)
    matched_rule_id = Column(Integer, ForeignKey("finance_rules.id"), nullable=True)

    # 'normal' | 'cc_payment' | 'cc_purchase'
    flow_type = Column(String(20), nullable=False, default="normal")
    # 'pending' | 'posted'
    status = Column(String(20), nullable=False, default="posted")

    is_locked = Column(Boolean, nullable=False, default=False)  # set by month-end close
    notes = Column(Text, nullable=True)

    receipt_blob = Column(Text, nullable=True)  # base64
    receipt_filename = Column(String(255), nullable=True)
    receipt_content_type = Column(String(100), nullable=True)

    source_filename = Column(String(255), nullable=True)
    imported_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    account = relationship("BankAccount")
    category = relationship("FinanceCategory")


class ManualLedgerEntry(Base):
    """Things that don't come from bank feeds: Food Inventory, Furniture &
    Equipment, Notes Receivable, member equity / draws."""

    __tablename__ = "manual_ledger_entries"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    # 'asset' | 'liability' | 'equity'
    entry_type = Column(String(20), nullable=False)
    sub_type = Column(String(60), nullable=True)  # 'inventory' | 'fixed' | 'notes_receivable' | 'member_equity' | 'member_draws' | 'retained_earnings'
    amount = Column(Float, nullable=False)
    as_of_date = Column(Date, nullable=False)
    notes = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class MonthlyClose(Base):
    __tablename__ = "finance_monthly_closes"
    __table_args__ = (
        UniqueConstraint("year", "month", name="uq_finance_monthly_close_period"),
    )

    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)  # 1..12
    closed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    closed_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    notes = Column(Text, nullable=True)
