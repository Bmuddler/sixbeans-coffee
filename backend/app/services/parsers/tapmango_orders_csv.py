"""TapMango online orders CSV parser.

The Playwright scraper exports the Orders CSV from
https://portal.tapmango.com/Orders/Index. It lists every online/loyalty
order with timestamps, totals, and a store identifier column.

We bucket orders by (store, date) and emit one ParsedRevenueRow per bucket.
"""

import csv
import io
import logging
from collections import defaultdict
from datetime import date as date_cls, datetime
from typing import Iterable

from app.models.daily_revenue import CHANNEL_TAPMANGO
from app.services.parsers import ParsedRevenueRow

logger = logging.getLogger(__name__)


def _as_float(val: str | None) -> float:
    if not val:
        return 0.0
    s = val.strip().replace("$", "").replace(",", "")
    if not s:
        return 0.0
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_order_date(val: str | None) -> date_cls | None:
    """TapMango dates arrive in a handful of formats. Try a few."""
    if not val:
        return None
    s = val.strip()
    # Strip time portion if present
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
    """Find the first matching column by case-insensitive name."""
    for c in candidates:
        for k, v in row.items():
            if k and k.strip().lower() == c.strip().lower():
                return v
    return None


def parse_tapmango_orders_csv(
    file_bytes: bytes,
    source_file: str,
) -> list[ParsedRevenueRow]:
    """Parse a TapMango Orders export into one ParsedRevenueRow per (store, date).

    Each output row's external_store_id is the TapMango location ID as a
    string (matches Location.tapmango_location_id cast to str).
    """
    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    # (store_id, date) -> accumulator
    buckets: dict[tuple[str, date_cls], dict] = defaultdict(
        lambda: {"gross": 0.0, "net": 0.0, "tax": 0.0, "tip": 0.0,
                 "discount": 0.0, "count": 0, "rejected": 0}
    )

    for row in reader:
        store_id = (
            _col(row, "Location ID", "LocationId", "Store ID", "StoreId")
            or _col(row, "Location", "Store")
        )
        if not store_id:
            continue
        store_id = str(store_id).strip()

        order_date = _parse_order_date(
            _col(row, "Order Date", "Date", "Created At", "CreatedAt", "Placed At")
        )
        if not order_date:
            continue

        status = (_col(row, "Status", "Order Status") or "").strip().lower()
        is_rejected = status in ("rejected", "cancelled", "canceled", "void", "voided", "refunded")

        gross = _as_float(_col(row, "Subtotal", "Gross", "Gross Total", "Order Total"))
        net = _as_float(_col(row, "Net Total", "Total Paid", "Payment Total", "Net"))
        tax = _as_float(_col(row, "Tax", "Tax Total"))
        tip = _as_float(_col(row, "Tip", "Tips", "Gratuity"))
        discount = _as_float(_col(row, "Discount", "Discount Total", "Loyalty Discount"))

        key = (store_id, order_date)
        b = buckets[key]
        if is_rejected:
            b["rejected"] += 1
            continue
        b["count"] += 1
        b["gross"] += gross
        b["net"] += net
        b["tax"] += tax
        b["tip"] += tip
        b["discount"] += discount

    out: list[ParsedRevenueRow] = []
    for (store_id, order_date), b in buckets.items():
        out.append(ParsedRevenueRow(
            external_store_id=store_id,
            channel=CHANNEL_TAPMANGO,
            date=order_date,
            gross_revenue=round(b["gross"], 2),
            net_revenue=round(b["net"], 2) if b["net"] else None,
            tax_total=round(b["tax"], 2) if b["tax"] else None,
            tip_total=round(b["tip"], 2) if b["tip"] else None,
            discount_total=round(b["discount"], 2) if b["discount"] else None,
            transaction_count=b["count"],
            rejected_count=b["rejected"] or None,
            raw_notes={"source_file": source_file},
        ))
    return out
