"""GoDaddy Commerce / Poynt Transactions Report parser.

The Playwright scraper downloads the daily Transactions Report Excel file
from https://commerce.godaddy.com/reports. One file covers one store for
one day, a 24-hour register window.

We produce a single ParsedRevenueRow per file — one row per (store, date).

Expected columns in the report (as of 2026):
  - Order / Transaction ID
  - Date / Time
  - Gross Sales, Discounts, Tax, Tips, Net Sales
  - Payment Type

Different GoDaddy exports label columns slightly differently ("Total",
"Sale Total", "Grand Total", etc.), so we scan for a set of candidates
rather than pin exact names.
"""

import io
import logging
from datetime import date as date_cls, datetime
from typing import Any

from app.models.daily_revenue import CHANNEL_GODADDY
from app.services.parsers import ParsedRevenueRow

logger = logging.getLogger(__name__)


def _first_col(row: dict[str, Any], *candidates: str) -> Any:
    """Return the first non-null value among candidate column names."""
    for c in candidates:
        for key in row.keys():
            if key and key.strip().lower() == c.strip().lower():
                val = row[key]
                if val is not None and val != "":
                    return val
    return None


def _as_float(val: Any) -> float:
    if val is None or val == "":
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace("$", "").replace(",", "").replace("(", "-").replace(")", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_godaddy_excel(
    file_bytes: bytes,
    source_file: str,
    store_label: str,
    target_date: date_cls,
) -> list[ParsedRevenueRow]:
    """Parse one GoDaddy Transactions Report Excel file.

    Args:
        file_bytes: raw .xlsx content
        source_file: filename for diagnostics
        store_label: the dropdown-label used to download this report
                     (matches Location.godaddy_dropdown_label)
        target_date: the date the report was pulled for

    Returns a single ParsedRevenueRow summing that day's transactions.
    """
    try:
        import openpyxl  # type: ignore
    except ImportError:
        raise RuntimeError(
            "openpyxl is required to parse GoDaddy Excel exports. "
            "Add openpyxl>=3.1 to requirements.txt."
        )

    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active
    if ws is None:
        return []

    # Find the header row — GoDaddy sometimes prefixes the sheet with a title
    rows = list(ws.iter_rows(values_only=True))
    header_idx = None
    for i, row in enumerate(rows[:25]):
        cells = [str(c).strip().lower() if c is not None else "" for c in row]
        if any("gross" in c for c in cells) and any("net" in c or "total" in c for c in cells):
            header_idx = i
            break
    if header_idx is None:
        logger.warning("GoDaddy parser could not find header row in %s", source_file)
        return []

    headers = [str(c).strip() if c is not None else "" for c in rows[header_idx]]
    data_rows = [dict(zip(headers, r)) for r in rows[header_idx + 1:] if any(v is not None for v in r)]

    gross = 0.0
    discounts = 0.0
    tax = 0.0
    tips = 0.0
    net = 0.0
    count = 0

    for r in data_rows:
        # Skip summary rows that lack an order id
        order_id = _first_col(r, "Order ID", "Transaction ID", "Ticket", "Receipt")
        if not order_id:
            continue
        count += 1
        gross += _as_float(_first_col(r, "Gross Sales", "Gross Total", "Subtotal"))
        discounts += _as_float(_first_col(r, "Discounts", "Discount Total", "Discount"))
        tax += _as_float(_first_col(r, "Tax", "Sales Tax", "Tax Total"))
        tips += _as_float(_first_col(r, "Tip", "Tips", "Tip Total", "Gratuity"))
        net += _as_float(_first_col(r, "Net Sales", "Net Total", "Total", "Grand Total"))

    row = ParsedRevenueRow(
        external_store_id=store_label,
        channel=CHANNEL_GODADDY,
        date=target_date,
        gross_revenue=round(gross, 2),
        net_revenue=round(net, 2) if net else None,
        discount_total=round(discounts, 2) if discounts else None,
        tip_total=round(tips, 2) if tips else None,
        tax_total=round(tax, 2) if tax else None,
        transaction_count=count,
        raw_notes={
            "source_file": source_file,
            "header_row_index": header_idx,
            "parsed_at": datetime.utcnow().isoformat(),
        },
    )
    return [row]
