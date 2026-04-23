"""Auxiliary DoorDash CSV parsers: simplified, error charges, payout summary.

These are supplementary views delivered in the weekly DoorDash zip. We
primarily rely on FINANCIAL_DETAILED_TRANSACTIONS, but these three give
us useful extras:

  - Simplified: human-readable per-order view. Skipped for revenue ingest
    (detailed covers it), but useful as a cross-check when debugging.
  - Error charges: per-store list of disputes / chargebacks with dates
    and reasons. Surfaced on the dashboard as action items.
  - Payout summary: totals per payout period — used to reconcile
    detailed-transactions commission math against actual deposits.

The simplified parser is a stub — not used in the pipeline, kept here
so debugging tooling has a single place to sit.
"""

import csv
import io
import logging
from datetime import date as date_cls, datetime

logger = logging.getLogger(__name__)


def _as_float(val: str | None) -> float:
    if not val:
        return 0.0
    s = str(val).strip().replace("$", "").replace(",", "")
    if not s:
        return 0.0
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_date(val: str | None) -> date_cls | None:
    if not val:
        return None
    s = str(val).strip()
    for sep in ("T", " "):
        if sep in s:
            s = s.split(sep, 1)[0]
            break
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _col(row: dict[str, str], *candidates: str) -> str | None:
    for c in candidates:
        for k, v in row.items():
            if k and k.strip().lower() == c.strip().lower():
                return v
    return None


# ----------------------------------------------------------------------
# Error charges — one row per dispute/chargeback
# ----------------------------------------------------------------------

def parse_doordash_errors_csv(
    file_bytes: bytes,
    source_file: str,
) -> list[dict]:
    """Return a list of error charge dicts. Each dict has:
        {store_id, date, amount, reason, order_id}

    These are surfaced on the dashboard as individual action items
    rather than rolled into DailyRevenue totals.
    """
    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    errors: list[dict] = []
    for row in reader:
        store_id = _col(row, "STORE_ID", "Store ID")
        amount = _as_float(_col(row, "ERROR_AMOUNT", "Error Amount", "AMOUNT", "Amount"))
        date = _parse_date(_col(row, "ERROR_DATE", "Error Date", "Date", "TRANSACTION_DATE"))
        reason = _col(row, "ERROR_REASON", "Error Reason", "REASON", "Reason") or ""
        order_id = _col(row, "ORDER_ID", "Order ID") or ""

        if not store_id or not date:
            continue

        errors.append({
            "store_id": str(store_id).strip(),
            "date": date,
            "amount": round(amount, 2),
            "reason": reason.strip(),
            "order_id": str(order_id).strip(),
            "source_file": source_file,
        })
    return errors


# ----------------------------------------------------------------------
# Payout summary — one row per payout period
# ----------------------------------------------------------------------

def parse_doordash_payout_csv(
    file_bytes: bytes,
    source_file: str,
) -> list[dict]:
    """Return a list of payout dicts:
        {store_id, payout_date, period_start, period_end, amount}

    Kept as raw dicts rather than ParsedRevenueRow — payouts are an
    accounting view, not a revenue view, so they go in their own table
    (TBD) rather than daily_revenues.
    """
    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    payouts: list[dict] = []
    for row in reader:
        store_id = _col(row, "STORE_ID", "Store ID")
        if not store_id:
            continue

        payout_date = _parse_date(_col(row, "PAYOUT_DATE", "Payout Date", "Settlement Date"))
        period_start = _parse_date(_col(row, "PERIOD_START", "Start Date", "Period Start"))
        period_end = _parse_date(_col(row, "PERIOD_END", "End Date", "Period End"))
        amount = _as_float(_col(row, "PAYOUT_AMOUNT", "Payout Amount", "Total Payout", "Amount"))

        if not payout_date:
            continue

        payouts.append({
            "store_id": str(store_id).strip(),
            "payout_date": payout_date,
            "period_start": period_start,
            "period_end": period_end,
            "amount": round(amount, 2),
            "source_file": source_file,
        })
    return payouts


# ----------------------------------------------------------------------
# Simplified — unused in pipeline, exposed for debug
# ----------------------------------------------------------------------

def parse_doordash_simplified_csv(
    file_bytes: bytes,
    source_file: str,
) -> list[dict]:
    """Return the rows from the simplified report as-is for debugging.

    Not used in the ingestion pipeline — the detailed report is the
    authoritative source. This exists so operations can diff the two
    if DoorDash ever changes the detailed format.
    """
    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)
