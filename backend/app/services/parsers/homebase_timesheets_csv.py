"""Homebase timesheets CSV parser.

Homebase exports one CSV per location per date range. File shape:

    Row 0: <Store display name>
    Row 1: Payroll Period | MM/DD/YYYY To MM/DD/YYYY
    Row 3: Header row — Name, Clock in date, Clock in time, ...,
           Wage rate, Scheduled hours, Actual hours, ...,
           Total paid hours, Regular hours, Unpaid breaks, OT hours, ...

Within the file each employee gets a sub-block:
    <header row>
    <shift row 1>
    <shift row 2>
    ...
    Totals for <Name>
    - - - - separator - - - -
    <header row>        <-- repeats
    ...

We flatten those shift rows and aggregate by (store, clock-in-date).

Employee rules
--------------
* `EXCLUDED_EMPLOYEES` — owners whose payroll runs through a store but
  whose hours must NOT count toward that store's labor cost.
* `EMPLOYEE_STORE_OVERRIDES` — employees whose shifts should be routed
  to a different store than the file's header (the Bakery runs its
  payroll through Apple Valley but needs its own labor bucket).

`STORE_FILENAME_TO_SHORT_NAME` maps Homebase's store display name to
our canonical_short_name so we can look up the Location row.
"""

from __future__ import annotations

import csv
import io
import logging
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date as date_cls, datetime
from typing import Any

logger = logging.getLogger(__name__)

# Homebase display name (row 0 of the CSV, trimmed) -> canonical_short_name
STORE_FILENAME_TO_SHORT_NAME: dict[str, str] = {
    "SIX BEANS COFFEE CO": "APPLE_VALLEY_HS",
    "Six Beans Coffee Co 7th Street": "SEVENTH_STREET",
    "Six Beans Coffee Ranchero": "HESPERIA",
    "Six Beans Coffee Yucca Loma": "YUCCA_LOMA",
    "Six Beans Victorville": "VICTORVILLE",
    "Barstow Six Beans": "BARSTOW",
}

# Employees whose hours must be excluded entirely from store labor
# (owner payroll runs through Homebase but doesn't count toward store
# labor cost). Normalized to lowercase on comparison.
EXCLUDED_EMPLOYEES: set[str] = {
    "jessica nicklason",
    "jess nicklason",
    "j nicklason",
    "brian nicklason",
    "b nicklason",
}

# Employees whose shifts should be routed to a different canonical store
# than the file header says. Name normalized to lowercase, first-name
# substring match on the left side.
EMPLOYEE_STORE_OVERRIDES: dict[str, str] = {
    "adelia": "BAKERY",
}


@dataclass
class LaborDayBucket:
    location_short_name: str
    date: date_cls
    total_hours: float = 0.0
    regular_hours: float = 0.0
    ot_hours: float = 0.0
    labor_cost: float = 0.0
    employees: set[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.employees is None:
            self.employees = set()


def _as_float(val: Any) -> float:
    if val is None or val == "":
        return 0.0
    s = str(val).strip().replace("$", "").replace(",", "")
    if not s or s == "-":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_clock_date(val: str | None) -> date_cls | None:
    """Homebase writes 'April 21 2026' in the Clock-in-date column."""
    if not val:
        return None
    s = val.strip()
    for fmt in ("%B %d %Y", "%b %d %Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip()).lower()


def _resolve_store(
    header_short_name: str, employee_name: str
) -> str:
    """Route one employee's shift to the right location."""
    norm = _normalize_name(employee_name)
    for prefix, target in EMPLOYEE_STORE_OVERRIDES.items():
        if norm.startswith(prefix) or f" {prefix} " in f" {norm} ":
            return target
    return header_short_name


def _store_short_from_header(header_line: str) -> str | None:
    """Row 0 of each CSV is the Homebase store display name."""
    key = header_line.strip()
    if not key:
        return None
    if key in STORE_FILENAME_TO_SHORT_NAME:
        return STORE_FILENAME_TO_SHORT_NAME[key]
    # Fuzzy fallback — strip punctuation / case for tolerant match
    collapsed = re.sub(r"[^A-Za-z0-9]+", "", key).lower()
    for display, short in STORE_FILENAME_TO_SHORT_NAME.items():
        if re.sub(r"[^A-Za-z0-9]+", "", display).lower() == collapsed:
            return short
    return None


def parse_homebase_timesheets_csv(
    file_bytes: bytes,
    source_file: str,
) -> tuple[list[LaborDayBucket], dict[str, Any]]:
    """Parse one Homebase timesheets CSV into per-(store, date) labor buckets.

    Returns (buckets, diagnostics). Diagnostics records skipped rows and
    the header store so the endpoint can surface per-file results.
    """
    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)

    if not rows:
        return [], {"error": "Empty file"}

    header_store = rows[0][0] if rows[0] else ""
    header_short = _store_short_from_header(header_store)
    if not header_short:
        return [], {"error": f"Unknown Homebase store '{header_store}' — add to STORE_FILENAME_TO_SHORT_NAME"}

    # Find column indices from the first header row (row 3 in the sample,
    # but not guaranteed — scan for the row that has "Clock in date").
    col_idx: dict[str, int] = {}
    for r in rows[:30]:
        lowered = [c.strip().lower() for c in r]
        if "clock in date" in lowered and "wage rate" in lowered:
            for i, name in enumerate(lowered):
                if name:
                    col_idx[name] = i
            break
    if "clock in date" not in col_idx or "wage rate" not in col_idx:
        return [], {"error": "Could not locate the header row with 'Clock in date' and 'Wage rate'"}

    buckets: dict[tuple[str, date_cls], LaborDayBucket] = {}
    excluded_rows = 0
    skipped_no_date = 0
    skipped_zero_hours = 0
    current_employee = ""

    name_idx = col_idx["name"]
    clock_date_idx = col_idx["clock in date"]
    wage_idx = col_idx["wage rate"]
    actual_idx = col_idx.get("actual hours", -1)
    total_paid_idx = col_idx.get("total paid hours", -1)
    regular_idx = col_idx.get("regular hours", -1)
    ot_idx = col_idx.get("ot hours", -1)

    for row in rows[4:]:
        if not row or all(not c.strip() for c in row):
            continue
        first = row[0].strip() if row[0] else ""
        if first.startswith("-"):
            continue  # separator row
        lowered_first = first.lower()
        if lowered_first.startswith("totals for "):
            continue  # per-employee totals row; we aggregate ourselves
        # Re-entering a new employee block: the "Name" column holds the name on
        # the first shift row, and is blank on continuation rows.
        if first and not first.lower().startswith("name"):
            current_employee = first
        name = current_employee or first
        if not name:
            continue
        if _normalize_name(name) in EXCLUDED_EMPLOYEES:
            excluded_rows += 1
            continue

        clock_date_val = row[clock_date_idx] if clock_date_idx < len(row) else ""
        d = _parse_clock_date(clock_date_val)
        if not d:
            # Employee header row without shifts (e.g. "B Nicklason" with no
            # clock-ins) — or a blank line. Skip quietly.
            skipped_no_date += 1
            continue

        # Prefer Total paid hours (includes paid breaks) for labor cost;
        # use Actual hours as a fallback. For SPLH we still want total
        # paid because every paid hour costs us.
        total_paid = _as_float(row[total_paid_idx]) if total_paid_idx >= 0 else 0.0
        actual = _as_float(row[actual_idx]) if actual_idx >= 0 else 0.0
        hours = total_paid if total_paid > 0 else actual
        if hours <= 0:
            skipped_zero_hours += 1
            continue

        regular = _as_float(row[regular_idx]) if regular_idx >= 0 else hours
        ot = _as_float(row[ot_idx]) if ot_idx >= 0 else 0.0
        wage = _as_float(row[wage_idx])
        cost = round(hours * wage, 2)

        store_short = _resolve_store(header_short, name)
        key = (store_short, d)
        b = buckets.get(key)
        if b is None:
            b = LaborDayBucket(location_short_name=store_short, date=d)
            buckets[key] = b
        b.total_hours += hours
        b.regular_hours += regular
        b.ot_hours += ot
        b.labor_cost += cost
        b.employees.add(_normalize_name(name))

    diagnostics = {
        "header_store": header_store,
        "header_short": header_short,
        "excluded_rows": excluded_rows,
        "skipped_no_date": skipped_no_date,
        "skipped_zero_hours": skipped_zero_hours,
        "source_file": source_file,
    }
    return list(buckets.values()), diagnostics
