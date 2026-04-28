"""Parsers for the 4 analytics ingestion sources.

Each parser is a pure function: (bytes | path, source_file_name) -> list of
ParsedRevenueRow dicts. The orchestrator takes those rows, resolves their
external store ID to a canonical Location via location_resolver, and upserts
DailyRevenue records.

Keeping the parsers pure (no DB access, no network) makes them fast to
unit-test against saved sample files.
"""

from dataclasses import dataclass, field
from datetime import date


@dataclass
class ParsedRevenueRow:
    """Normalized output from any of the 4 parsers.

    The orchestrator matches `external_store_id` (+ channel) against the
    Location table's `godaddy_dropdown_label` / `tapmango_location_id` /
    `doordash_store_id` columns to route to the right location.
    """
    external_store_id: str  # stringified; parser decides how to encode
    channel: str            # one of CHANNEL_GODADDY / CHANNEL_TAPMANGO / CHANNEL_DOORDASH
    date: date
    gross_revenue: float
    net_revenue: float | None = None
    discount_total: float | None = None
    tip_total: float | None = None
    tax_total: float | None = None
    commission_total: float | None = None
    fee_total: float | None = None
    transaction_count: int | None = None
    rejected_count: int | None = None
    card_total: float | None = None  # GoDaddy: subtotal+tip on Card Payments sheets
    cash_total: float | None = None  # GoDaddy: subtotal+tip on Cash Payments sheets
    raw_notes: dict = field(default_factory=dict)  # parser-specific diagnostic info
