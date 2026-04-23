"""TapMango REST API client.

Covers the loyalty/customer endpoints that don't require a portal scrape:
  - GET /locations               -> list of all TapMango locations (used for auto-mapping)
  - GET /customers               -> paginated customer list
  - GET /customers/{id}/pointstransactions  -> loyalty points history per customer
  - GET /activecustomers         -> customers active in a given date range

The online Orders data is NOT exposed here — TapMango's portal is the only
source and is handled by the Playwright scraper.

Auth header format per https://developer.tapmango.com/api-reference:
    Authentication: ApiKey: <TAPMANGO_API_KEY>
"""

import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class TapMangoApiError(Exception):
    """Raised when the TapMango API returns a non-2xx response."""


def _headers() -> dict[str, str]:
    # TapMango uses a custom ApiKey scheme on the Authorization header.
    return {
        "Authorization": f"ApiKey {settings.tapmango_api_key}",
        "Content-Type": "application/json",
    }


async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    """Internal: GET with standard auth + error handling."""
    if not settings.tapmango_api_key:
        raise TapMangoApiError("TAPMANGO_API_KEY is not configured")

    url = f"{settings.tapmango_api_base_url.rstrip('/')}{path}"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(url, headers=_headers(), params=params or {})

    if resp.status_code >= 400:
        logger.error(
            "TapMango API %s failed: %s %s",
            path, resp.status_code, resp.text[:500],
        )
        raise TapMangoApiError(
            f"TapMango {path} returned {resp.status_code}: {resp.text[:200]}"
        )

    try:
        return resp.json()
    except Exception as exc:
        raise TapMangoApiError(f"TapMango {path} returned invalid JSON: {exc}") from exc


# ----------------------------------------------------------------------
# Public endpoints
# ----------------------------------------------------------------------

async def list_locations() -> list[dict[str, Any]]:
    """Return all TapMango locations on this account.

    Used for auto-mapping new stores back to the canonical locations table.
    """
    data = await _get("/locations")
    # Response may be a plain list or wrapped in {"data": [...]}
    if isinstance(data, dict) and "data" in data:
        return data["data"]
    return data or []


async def list_customers(
    page: int = 1,
    page_size: int = 100,
    modified_since: str | None = None,
) -> list[dict[str, Any]]:
    """List customers with optional pagination and delta filtering.

    Args:
        page: 1-indexed page number
        page_size: customers per page (TapMango caps this at ~500)
        modified_since: ISO8601 timestamp — only customers updated after this
    """
    params: dict[str, Any] = {"page": page, "pageSize": page_size}
    if modified_since:
        params["modifiedSince"] = modified_since

    data = await _get("/customers", params=params)
    if isinstance(data, dict) and "data" in data:
        return data["data"]
    return data or []


async def iter_all_customers(
    modified_since: str | None = None,
    page_size: int = 500,
) -> list[dict[str, Any]]:
    """Paginate through all customers into a single list.

    Safe for nightly ingest — stops when a page returns fewer records
    than page_size, which indicates the end of the list.
    """
    all_customers: list[dict[str, Any]] = []
    page = 1
    while True:
        chunk = await list_customers(
            page=page, page_size=page_size, modified_since=modified_since,
        )
        if not chunk:
            break
        all_customers.extend(chunk)
        if len(chunk) < page_size:
            break
        page += 1
    return all_customers


async def get_customer_points_transactions(
    customer_id: str | int,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict[str, Any]]:
    """Return the loyalty points history for a single customer."""
    params: dict[str, Any] = {}
    if start_date:
        params["startDate"] = start_date
    if end_date:
        params["endDate"] = end_date

    data = await _get(
        f"/customers/{customer_id}/pointstransactions",
        params=params or None,
    )
    if isinstance(data, dict) and "data" in data:
        return data["data"]
    return data or []


async def list_active_customers(
    start_date: str,
    end_date: str,
    location_id: int | None = None,
) -> list[dict[str, Any]]:
    """List customers who had activity in the given window.

    Args:
        start_date: ISO date, e.g. "2026-04-01"
        end_date: ISO date, e.g. "2026-04-22"
        location_id: optional TapMango location filter
    """
    params: dict[str, Any] = {"startDate": start_date, "endDate": end_date}
    if location_id is not None:
        params["locationId"] = location_id

    data = await _get("/activecustomers", params=params)
    if isinstance(data, dict) and "data" in data:
        return data["data"]
    return data or []


# ----------------------------------------------------------------------
# Health check — used by the admin page to verify credentials are good
# ----------------------------------------------------------------------

async def check_credentials() -> dict[str, Any]:
    """Ping /locations as a cheap auth test. Returns {ok, count, error}."""
    try:
        locations = await list_locations()
        return {"ok": True, "location_count": len(locations), "error": None}
    except TapMangoApiError as exc:
        return {"ok": False, "location_count": 0, "error": str(exc)}
