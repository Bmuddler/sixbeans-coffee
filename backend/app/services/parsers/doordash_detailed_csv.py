"""DoorDash FINANCIAL_DETAILED_TRANSACTIONS parser (primary DoorDash source).

DoorDash emails a zip weekly containing 4 CSVs. This one is the detailed
financial view — per-order: commission, net total, payout date, refunds.
We use this instead of the simplified "Sales" view because it has real
commission numbers (not the 28% flat guess in the legacy Python script).

Expected columns (DoorDash column names shift over time; we scan):
  - STORE_ID / Store ID
  - TRANSACTION_DATE / Order Date
  - SUBTOTAL / Gross
  - COMMISSION / Marketplace Commission
  - TOTAL_PAYOUT / Net Payout
  - REFUND
  - TRANSACTION_TYPE / Error / Adjustment markers
"""

import csv
import io
import logging
from collections import defaultdict
from datetime import date as date_cls, datetime

from app.models.daily_revenue import CHANNEL_DOORDASH
from app.services.parsers import ParsedRevenueRow

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
    d = _parse_datetime(val)
    return d.date() if d else None


def _parse_datetime(val: str | None) -> datetime | None:
    """DoorDash writes timestamps like '2026-04-21 12:35:39.374607'."""
    if not val:
        return None
    s = str(val).strip()
    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %I:%M:%S %p",
    ):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    # Date-only fallback
    date_part = s
    for sep in ("T", " "):
        if sep in date_part:
            date_part = date_part.split(sep, 1)[0]
            break
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(date_part, fmt)
        except ValueError:
            continue
    return None


def _col(row: dict[str, str], *candidates: str) -> str | None:
    for c in candidates:
        for k, v in row.items():
            if k and k.strip().lower() == c.strip().lower():
                return v
    return None


def parse_doordash_detailed_csv(
    file_bytes: bytes,
    source_file: str,
) -> list[ParsedRevenueRow]:
    """Parse FINANCIAL_DETAILED_TRANSACTIONS.csv into (store, date) buckets."""
    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    buckets: dict[tuple[str, date_cls], dict] = defaultdict(
        lambda: {"gross": 0.0, "net": 0.0, "commission": 0.0,
                 "fee": 0.0, "count": 0, "errors": 0}
    )
    hourly: dict[tuple[str, date_cls, int, int], list] = defaultdict(lambda: [0, 0.0])

    for row in reader:
        store_id = _col(row, "STORE_ID", "Store ID", "StoreID", "store_id")
        if not store_id:
            continue
        store_id = str(store_id).strip()

        ts = _parse_datetime(
            _col(row, "Timestamp local time", "TRANSACTION_DATE",
                 "Order Date", "transaction_date", "Date")
        )
        if ts is None:
            continue
        txn_date = ts.date()

        txn_type = (_col(row, "Transaction type", "TRANSACTION_TYPE") or "").strip().lower()

        gross = _as_float(_col(row, "SUBTOTAL", "Subtotal", "Gross", "Gross Sales"))
        # Commission is reported as a negative number in Brian's export; take abs.
        commission = abs(_as_float(_col(row, "COMMISSION", "Marketplace Commission", "Commission")))
        # 'Net total' (lower t) in the current export format; fall back to older names.
        payout = _as_float(_col(row, "Net total", "TOTAL_PAYOUT", "Net Payout", "Net Total", "Payout"))
        fees = _as_float(_col(row, "Merchant fees", "FEE", "Other Fees", "Tablet Fee"))

        key = (store_id, txn_date)
        b = buckets[key]

        # Error charges / adjustments tracked separately
        if "error" in txn_type or "adjustment" in txn_type:
            b["errors"] += 1

        b["gross"] += gross
        b["commission"] += commission
        b["net"] += payout
        b["fee"] += fees
        if gross > 0 and "error" not in txn_type:
            b["count"] += 1
            # Hourly bucket — customer-paid = subtotal (what DoorDash rings up).
            hkey = (store_id, txn_date, ts.hour, ts.minute // 15)
            hb = hourly[hkey]
            hb[0] += 1
            hb[1] += gross

    out: list[ParsedRevenueRow] = []
    for (store_id, txn_date), b in buckets.items():
        hourly_rows = [
            {
                "date": d, "hour": h, "quarter": q,
                "channel": CHANNEL_DOORDASH,
                "txns": bt, "gross": round(bg, 2),
            }
            for (sid, d, h, q), (bt, bg) in hourly.items()
            if sid == store_id and d == txn_date
        ]
        out.append(ParsedRevenueRow(
            external_store_id=store_id,
            channel=CHANNEL_DOORDASH,
            date=txn_date,
            gross_revenue=round(b["gross"], 2),
            net_revenue=round(b["net"], 2),
            commission_total=round(b["commission"], 2) if b["commission"] else None,
            fee_total=round(b["fee"], 2) if b["fee"] else None,
            transaction_count=b["count"],
            rejected_count=b["errors"] or None,
            raw_notes={
                "source_file": source_file,
                "parser": "doordash_detailed",
                "hourly_rows": hourly_rows,
            },
        ))
    return out
