"""Square API integration stub for sales data."""

import logging
from datetime import date

from app.config import settings

logger = logging.getLogger(__name__)


async def get_daily_sales(location_id: int, sales_date: date) -> dict:
    """Fetch daily sales data from Square for a location.

    Stub implementation - would integrate with Square SDK.
    """
    if not settings.square_access_token:
        logger.warning("Square not configured")
        return {
            "status": "not_configured",
            "location_id": location_id,
            "date": sales_date.isoformat(),
        }

    # Stub response
    return {
        "status": "ok",
        "location_id": location_id,
        "date": sales_date.isoformat(),
        "total_sales": 0.0,
        "total_transactions": 0,
        "cash_sales": 0.0,
        "card_sales": 0.0,
        "tip_total": 0.0,
    }


async def get_sales_summary(
    location_id: int,
    start_date: date,
    end_date: date,
) -> dict:
    """Fetch sales summary for a date range from Square.

    Stub implementation.
    """
    return {
        "status": "stub",
        "location_id": location_id,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "total_sales": 0.0,
        "total_transactions": 0,
        "daily_breakdown": [],
    }
