"""TapMango online orders CSV parser.

CSV exported from https://portal.tapmango.com/Orders/Index. One file
covers every store for the selected date range. Real column layout
(as of 2026-04):

    Order Id, Order Number, Order Placed On Date/Time, Scheduled
    Pickup Date/Time, Status, Location Id, Location Name, Menu,
    MenuType, Customer Id, ..., BasePrice, Discount, Discount Name,
    Tax, Tax Rate, Tip, Third Party Tip, Service Fee,
    Total Delivery Fee, Total Payment, Credit Card Payment,
    Wallet Payment, Gift Card Payment, ...

We bucket orders by (store, date) and emit one ParsedRevenueRow per
bucket. Only orders with Status in INCLUDED_STATUSES count toward
revenue; anything else is tracked as `rejected_count`. Location
names matching EXCLUDED_LOCATION_PATTERNS (mobile / dummy) are
dropped entirely — they're internal/test locations without real
revenue.
"""

import csv
import io
import logging
import re
from collections import defaultdict
from datetime import date as date_cls, datetime

from app.models.daily_revenue import CHANNEL_TAPMANGO
from app.services.parsers import ParsedRevenueRow

logger = logging.getLogger(__name__)

# Order statuses that represent revenue-bearing completed orders.
INCLUDED_STATUSES = {"COMPLETED", "FULLFILLED", "FULFILLED"}

# Location-name substrings marking non-sales / internal / test rows.
EXCLUDED_LOCATION_PATTERNS = re.compile(r"mobile|dummy", re.IGNORECASE)


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
    """TapMango dates arrive as e.g. '4/21/2026 9:32:26 AM' or ISO variants."""
    if not val:
        return None
    s = val.strip()
    # Try full datetime formats first (preserves AM/PM handling)
    for fmt in (
        "%m/%d/%Y %I:%M:%S %p",
        "%m/%d/%Y %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    # Fall back to date-only (strip any time portion first)
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
    target_date: date_cls | None = None,
) -> list[ParsedRevenueRow]:
    """Parse a TapMango Orders export into one ParsedRevenueRow per (store, date).

    Each output row's external_store_id is the TapMango location ID as a
    string (matches Location.tapmango_location_id cast to str).

    If ``target_date`` is provided, only orders whose Order Placed On
    Date/Time falls on that date are included. When None, every date
    present in the CSV is emitted (useful for multi-day exports).
    """
    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    # (store_id, date) -> accumulator
    buckets: dict[tuple[str, date_cls], dict] = defaultdict(
        lambda: {"gross": 0.0, "net": 0.0, "tax": 0.0, "tip": 0.0,
                 "discount": 0.0, "count": 0, "rejected": 0,
                 "location_name": ""}
    )
    # (store_id, date, hour, quarter) -> [txns, gross] for the heatmap.
    hourly_buckets: dict[tuple[str, date_cls, int, int], list] = defaultdict(lambda: [0, 0.0])

    def _parse_order_datetime(val: str | None):
        if not val:
            return None
        s = val.strip()
        for fmt in (
            "%m/%d/%Y %I:%M:%S %p",
            "%m/%d/%Y %H:%M:%S",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M:%S",
        ):
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
        return None

    skipped_location = 0
    skipped_date = 0
    skipped_no_store_id = 0

    for row in reader:
        store_id = (
            _col(row, "Location Id", "Location ID", "LocationId", "Store ID", "StoreId")
            or _col(row, "Location", "Store")
        )
        if not store_id:
            skipped_no_store_id += 1
            continue
        store_id = str(store_id).strip()

        loc_name = (_col(row, "Location Name") or "").strip()
        if loc_name and EXCLUDED_LOCATION_PATTERNS.search(loc_name):
            skipped_location += 1
            continue

        order_date = _parse_order_date(
            _col(row, "Order Placed On Date/Time", "Order Date", "Date",
                 "Created At", "CreatedAt", "Placed At")
        )
        if not order_date:
            continue
        if target_date is not None and order_date != target_date:
            skipped_date += 1
            continue

        status = (_col(row, "Status", "Order Status") or "").strip().upper()
        is_included = status in INCLUDED_STATUSES

        base_price = _as_float(_col(row, "BasePrice", "Base Price",
                                    "Subtotal", "Gross", "Gross Total",
                                    "Order Total"))
        total_payment = _as_float(_col(row, "Total Payment",
                                       "Net Total", "Total Paid",
                                       "Payment Total", "Net"))
        tax = _as_float(_col(row, "Tax", "Tax Total"))
        tip = _as_float(_col(row, "Tip", "Tips", "Gratuity"))
        discount = _as_float(_col(row, "Discount", "Discount Total",
                                  "Loyalty Discount"))

        key = (store_id, order_date)
        b = buckets[key]
        if loc_name and not b["location_name"]:
            b["location_name"] = loc_name
        if not is_included:
            b["rejected"] += 1
            continue
        b["count"] += 1
        b["gross"] += base_price
        b["net"] += total_payment
        b["tax"] += tax
        b["tip"] += tip
        b["discount"] += discount

        # Per-row hourly bucket (only for counted orders)
        ts = _parse_order_datetime(
            _col(row, "Order Placed On Date/Time", "Order Date", "Date")
        )
        if ts is not None:
            h_key = (store_id, order_date, ts.hour, ts.minute // 15)
            hb = hourly_buckets[h_key]
            hb[0] += 1
            hb[1] += total_payment

    out: list[ParsedRevenueRow] = []
    for (store_id, order_date), b in buckets.items():
        if b["count"] == 0 and b["rejected"] == 0:
            continue
        # Per-store hourly rows scoped to this (store, date).
        hourly_rows = [
            {
                "date": d, "hour": h, "quarter": q,
                "channel": CHANNEL_TAPMANGO,
                "txns": bt, "gross": round(bg, 2),
            }
            for (sid, d, h, q), (bt, bg) in hourly_buckets.items()
            if sid == store_id and d == order_date
        ]
        out.append(ParsedRevenueRow(
            external_store_id=store_id,
            channel=CHANNEL_TAPMANGO,
            date=order_date,
            # `Total Payment` is what the customer actually paid; mirror
            # the GoDaddy convention of putting that on gross_revenue so
            # the dashboard can sum channels consistently.
            gross_revenue=round(b["net"] or b["gross"], 2),
            net_revenue=round(b["net"], 2) if b["net"] else None,
            tax_total=round(b["tax"], 2) if b["tax"] else None,
            tip_total=round(b["tip"], 2) if b["tip"] else None,
            discount_total=round(b["discount"], 2) if b["discount"] else None,
            transaction_count=b["count"],
            rejected_count=b["rejected"] or None,
            raw_notes={
                "source_file": source_file,
                "location_name": b["location_name"],
                "base_price_sum": round(b["gross"], 2),
                "skipped_location": skipped_location,
                "skipped_date": skipped_date,
                "skipped_no_store_id": skipped_no_store_id,
                "hourly_rows": hourly_rows,
            },
        ))
    if not out:
        logger.warning(
            "TapMango CSV parser: no rows produced from %s "
            "(target_date=%s, skipped_location=%d, skipped_date=%d, skipped_no_store_id=%d)",
            source_file, target_date, skipped_location, skipped_date, skipped_no_store_id,
        )
    return out
