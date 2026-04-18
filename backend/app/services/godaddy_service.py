"""GoDaddy transaction integration stub for expected cash amounts."""

import logging
from datetime import date

from app.config import settings

logger = logging.getLogger(__name__)


async def get_expected_cash_for_date(location_id: int, target_date: date) -> float:
    """Fetch expected cash amount from GoDaddy for a location and date.

    Stub implementation - returns 0.0 until GoDaddy integration is configured.
    In production, this would query GoDaddy's transaction API to determine
    the expected cash amount based on POS transactions.
    """
    if not settings.godaddy_api_key:
        logger.warning("GoDaddy not configured, returning 0.0 for expected cash")
        return 0.0

    # Stub: would call GoDaddy API here
    # Example: GET /v1/transactions?location={location_id}&date={target_date}
    return 0.0


async def get_transaction_summary(
    location_id: int,
    start_date: date,
    end_date: date,
) -> dict:
    """Fetch transaction summary from GoDaddy for a date range.

    Stub implementation.
    """
    return {
        "status": "stub",
        "location_id": location_id,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "total_cash": 0.0,
        "total_card": 0.0,
        "transaction_count": 0,
    }
