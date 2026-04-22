"""US Foods weekly run generation and CSV building service."""

import logging
import re
from collections import defaultdict
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.usfoods import (
    RunStatus,
    USFoodsProduct,
    USFoodsRunItem,
    USFoodsShopMapping,
    USFoodsWeeklyRun,
)

logger = logging.getLogger(__name__)

# US Foods CSV columns
CSV_COLUMNS = [
    "CUSTOMER NUMBER",
    "DISTRIBUTOR",
    "DEPARTMENT",
    "DATE",
    "PO NUMBER",
    "PRODUCT NUMBER",
    "CUST PROD #",
    "DESCRIPTION",
    "BRAND",
    "PACK SIZE",
    "CS PRICE",
    "EA PRICE",
    "CS",
    "EA",
    "EXTENDED PRICE",
    "ORDER #",
    "STOCK STATUS",
    "EXCEPTIONS / AUTO-SUB",
    "SHORTED",
]

# Regex patterns for Square item tags
USFOODS_TAG_RE = re.compile(r"\[U\]", re.IGNORECASE)
PRODUCT_NUMBER_RE = re.compile(r"\[PN:(\d{7})\]", re.IGNORECASE)

# Square API base URL
SQUARE_BASE_URL = "https://connect.squareup.com/v2"


async def generate_weekly_run(db: AsyncSession) -> USFoodsWeeklyRun:
    """
    Pull Square orders for the current delivery window:
    - Monday run (cron 9 AM): Friday 11 AM → Monday 11 AM
    - Friday run (cron 9 AM): Monday 11 AM → Friday 11 AM
    - Other days (manual): uses the most recent window
    """
    import pytz
    pacific = pytz.timezone("America/Los_Angeles")
    now = datetime.now(pacific)
    today = now.date()
    dow = today.weekday()  # 0=Mon, 4=Fri

    if dow == 4:  # Friday
        # Window: Monday 11 AM → Friday 11 AM
        monday = today - timedelta(days=4)
        order_window_start = pacific.localize(datetime(monday.year, monday.month, monday.day, 11, 0, 0))
        order_window_end = pacific.localize(datetime(today.year, today.month, today.day, 11, 0, 0))
    else:
        # Monday (or manual on other days): Friday 11 AM → Monday 11 AM
        days_since_monday = dow  # Monday = 0
        monday = today - timedelta(days=days_since_monday)
        friday = monday - timedelta(days=3)
        order_window_start = pacific.localize(datetime(friday.year, friday.month, friday.day, 11, 0, 0))
        order_window_end = pacific.localize(datetime(monday.year, monday.month, monday.day, 11, 0, 0))

    # Create the run record (store naive datetimes for DB)
    run = USFoodsWeeklyRun(
        run_date=today,
        order_window_start=order_window_start.replace(tzinfo=None),
        order_window_end=order_window_end.replace(tzinfo=None),
        status=RunStatus.generating,
    )
    db.add(run)
    await db.flush()

    try:
        # Fetch Square orders
        orders = await _fetch_square_orders(order_window_start, order_window_end)
        run.square_orders_count = len(orders)

        # Extract US Foods items from orders
        usfoods_items = _extract_usfoods_items(orders)
        logger.info("Extracted %d US Foods items from %d orders", len(usfoods_items), len(orders))

        # Resolve catalog names for items that have catalog_object_ids
        catalog_ids = [
            item["catalog_object_id"]
            for item in usfoods_items
            if item.get("catalog_object_id")
        ]
        catalog_names = await _batch_resolve_catalog_names(catalog_ids) if catalog_ids else {}
        logger.info("Resolved %d catalog names from %d IDs", len(catalog_names), len(catalog_ids))

        # Load shop mappings
        mappings_result = await db.execute(select(USFoodsShopMapping))
        shop_mappings = mappings_result.scalars().all()
        logger.info("Loaded %d shop mappings", len(shop_mappings))

        # Load product catalog
        products_result = await db.execute(select(USFoodsProduct).where(USFoodsProduct.is_active == True))  # noqa: E712
        products_by_number = {p.product_number: p for p in products_result.scalars().all()}
        logger.info("Loaded %d active products", len(products_by_number))

        # Map items to shops and aggregate
        aggregated = _aggregate_items(usfoods_items, catalog_names, shop_mappings, products_by_number)
        logger.info("Aggregated into %d line items", len(aggregated))

        # Create run items
        items_created = 0
        for (mapping_id, product_id), item_data in aggregated.items():
            run_item = USFoodsRunItem(
                run_id=run.id,
                shop_mapping_id=mapping_id,
                product_id=product_id,
                quantity=item_data["quantity"],
                unit=item_data["unit"],
                square_item_name=item_data.get("square_item_name"),
            )
            db.add(run_item)
            items_created += 1

        run.total_line_items = items_created

        # Generate CSV
        await db.flush()
        # Reload items with relationships for CSV generation
        items_result = await db.execute(
            select(USFoodsRunItem)
            .where(USFoodsRunItem.run_id == run.id)
        )
        all_items = items_result.scalars().all()
        run.csv_data = build_csv(all_items, shop_mappings, products_by_number)

        run.status = RunStatus.reviewing
        await db.flush()

        return run

    except Exception as e:
        run.status = RunStatus.failed
        await db.flush()
        raise


async def _fetch_square_orders(start: datetime, end: datetime) -> list[dict]:
    """Fetch orders from Square API within the given time window."""
    if not settings.square_access_token:
        logger.warning("No Square access token configured, returning empty orders")
        return []

    headers = {
        "Authorization": f"Bearer {settings.square_access_token}",
        "Content-Type": "application/json",
        "Square-Version": "2024-01-18",
    }

    # First get all locations
    async with httpx.AsyncClient() as client:
        locations_resp = await client.get(
            f"{SQUARE_BASE_URL}/locations",
            headers=headers,
        )
        if locations_resp.status_code != 200:
            logger.error(f"Failed to fetch locations: {locations_resp.status_code}")
            return []

        locations = locations_resp.json().get("locations", [])
        location_ids = [loc["id"] for loc in locations]

        # Search orders
        all_orders = []
        cursor = None

        while True:
            body = {
                "location_ids": location_ids,
                "query": {
                    "filter": {
                        "date_time_filter": {
                            "created_at": {
                                "start_at": start.isoformat(),
                                "end_at": end.isoformat(),
                            }
                        },
                    }
                },
                "limit": 500,
            }
            if cursor:
                body["cursor"] = cursor

            resp = await client.post(
                f"{SQUARE_BASE_URL}/orders/search",
                headers=headers,
                json=body,
            )

            if resp.status_code != 200:
                logger.error(f"Failed to search orders: {resp.status_code} - {resp.text}")
                break

            data = resp.json()
            orders = data.get("orders", [])
            all_orders.extend(orders)

            cursor = data.get("cursor")
            if not cursor:
                break

    logger.info(f"Fetched {len(all_orders)} Square orders in window")
    return all_orders


def _get_shop_name(order: dict) -> str:
    """Extract the shop/recipient name from a Square order."""
    for ff in order.get("fulfillments", []):
        recipient = ff.get("delivery_details", {}).get("recipient", {})
        name = recipient.get("display_name", "").strip()
        if name:
            return name
        # Also check pickup
        recipient = ff.get("pickup_details", {}).get("recipient", {})
        name = recipient.get("display_name", "").strip()
        if name:
            return name
    for key in ("ticket_name", "note"):
        val = order.get(key, "").strip()
        if val:
            return val[:60]
    return "Unknown Shop"


def _extract_usfoods_items(orders: list[dict]) -> list[dict]:
    """Extract line items tagged with [U] or [PN:xxx] from Square orders."""
    items = []

    for order in orders:
        shop_name = _get_shop_name(order)
        for line_item in order.get("line_items", []):
            name = line_item.get("name", "")

            # Check for US Foods tags
            has_u_tag = bool(USFOODS_TAG_RE.search(name))
            pn_match = PRODUCT_NUMBER_RE.search(name)

            if not has_u_tag and not pn_match:
                continue

            product_number = pn_match.group(1) if pn_match else None
            quantity = int(line_item.get("quantity", "1"))

            items.append({
                "name": name,
                "product_number": product_number,
                "quantity": quantity,
                "catalog_object_id": line_item.get("catalog_object_id"),
                "shop_name": shop_name,
            })

    logger.info("Extracted %d US Foods tagged items from %d orders", len(items), len(orders))
    return items


async def _batch_resolve_catalog_names(catalog_ids: list[str]) -> dict[str, str]:
    """Resolve catalog object IDs to current item names via Square API."""
    if not settings.square_access_token or not catalog_ids:
        return {}

    headers = {
        "Authorization": f"Bearer {settings.square_access_token}",
        "Content-Type": "application/json",
        "Square-Version": "2024-01-18",
    }

    names = {}
    # Batch in groups of 1000 (Square limit)
    batch_size = 1000
    async with httpx.AsyncClient() as client:
        for i in range(0, len(catalog_ids), batch_size):
            batch = catalog_ids[i : i + batch_size]
            # Deduplicate
            batch = list(set(batch))

            resp = await client.post(
                f"{SQUARE_BASE_URL}/catalog/batch-retrieve",
                headers=headers,
                json={"object_ids": batch},
            )

            if resp.status_code != 200:
                logger.error(f"Failed to batch retrieve catalog: {resp.status_code}")
                continue

            objects = resp.json().get("objects", [])
            for obj in objects:
                obj_id = obj.get("id", "")
                item_data = obj.get("item_data", {})
                name = item_data.get("name", "")
                if name:
                    names[obj_id] = name

    return names


def _aggregate_items(
    usfoods_items: list[dict],
    catalog_names: dict[str, str],
    shop_mappings: list,
    products_by_number: dict,
) -> dict[tuple[int, int], dict]:
    """
    Aggregate extracted items by shop and product.
    Returns dict keyed by (shop_mapping_id, product_id) with aggregated data.
    """
    aggregated: dict[tuple[int, int], dict] = {}

    for item in usfoods_items:
        # Resolve the display name
        catalog_id = item.get("catalog_object_id")
        display_name = catalog_names.get(catalog_id, item["name"]) if catalog_id else item["name"]

        # Match to a shop using the order's recipient name (first match wins)
        shop_name = item.get("shop_name", "")
        shop_mapping = _match_shop(shop_name, shop_mappings)
        if not shop_mapping:
            logger.warning("No shop mapping for '%s' (item: %s)", shop_name, display_name)
            continue

        # Match to a product
        product_number = item.get("product_number")
        if not product_number:
            logger.warning(f"No product number for item: {display_name}")
            continue

        product = products_by_number.get(product_number)
        if not product:
            logger.warning(f"Product {product_number} not found in catalog")
            continue

        key = (shop_mapping.id, product.id)
        if key in aggregated:
            aggregated[key]["quantity"] += item["quantity"]
        else:
            aggregated[key] = {
                "quantity": item["quantity"],
                "unit": product.default_unit,
                "square_item_name": display_name,
            }

    return aggregated


def _match_shop(
    shop_name: str,
    shop_mappings: list,
) -> "USFoodsShopMapping | None":
    """Match a shop name to a mapping using keyword matching (first match wins)."""
    search_text = shop_name.lower()

    for mapping in shop_mappings:
        keywords = [kw.strip().lower() for kw in mapping.match_keywords.split(",")]
        for keyword in keywords:
            if keyword and keyword in search_text:
                return mapping

    return None


def build_csv(
    run_items: list,
    shop_mappings: list,
    products_by_number: dict,
) -> str:
    """
    Generate the 19-column US Foods CSV format.
    """
    # Build lookup maps
    mappings_by_id = {m.id: m for m in shop_mappings}
    products_by_id = {}
    for p in products_by_number.values():
        products_by_id[p.id] = p

    today_str = date.today().strftime("%m/%d/%Y")
    lines = [",".join(CSV_COLUMNS)]

    for item in run_items:
        mapping = mappings_by_id.get(item.shop_mapping_id)
        product = products_by_id.get(item.product_id)

        if not mapping or not product:
            continue

        cs_qty = str(item.quantity) if item.unit == "CS" else ""
        ea_qty = str(item.quantity) if item.unit == "EA" else ""
        cs_price = f"{product.current_price:.2f}" if product.current_price and item.unit == "CS" else ""
        ea_price = f"{product.current_price:.2f}" if product.current_price and item.unit == "EA" else ""

        # Calculate extended price
        extended = ""
        if product.current_price:
            extended = f"{product.current_price * item.quantity:.2f}"

        row = [
            mapping.customer_number,       # CUSTOMER NUMBER
            mapping.distributor,           # DISTRIBUTOR
            mapping.department,            # DEPARTMENT
            today_str,                     # DATE
            "",                            # PO NUMBER
            product.product_number,        # PRODUCT NUMBER
            "",                            # CUST PROD #
            product.description,           # DESCRIPTION
            product.brand or "",           # BRAND
            product.pack_size or "",       # PACK SIZE
            cs_price,                      # CS PRICE
            ea_price,                      # EA PRICE
            cs_qty,                        # CS
            ea_qty,                        # EA
            extended,                      # EXTENDED PRICE
            "",                            # ORDER #
            "",                            # STOCK STATUS
            "",                            # EXCEPTIONS / AUTO-SUB
            "",                            # SHORTED
        ]

        # Escape commas in fields
        escaped_row = []
        for field in row:
            if "," in field or '"' in field:
                escaped_row.append(f'"{field}"')
            else:
                escaped_row.append(field)

        lines.append(",".join(escaped_row))

    return "\n".join(lines)


async def apply_validation_results(
    db: AsyncSession,
    run_id: int,
    results: list,
) -> None:
    """
    Apply validation results from the Playwright scrape to run items.
    Updates flags on items based on stock status from the US Foods website.
    """
    # Load run items with products
    items_result = await db.execute(
        select(USFoodsRunItem)
        .where(USFoodsRunItem.run_id == run_id)
    )
    run_items = items_result.scalars().all()

    # Load products for number lookup
    product_ids = [item.product_id for item in run_items]
    products_result = await db.execute(
        select(USFoodsProduct).where(USFoodsProduct.id.in_(product_ids))
    )
    products_by_id = {p.id: p for p in products_result.scalars().all()}

    # Map validation results by product number
    validation_map = {r.product_number: r for r in results}

    for item in run_items:
        product = products_by_id.get(item.product_id)
        if not product:
            continue

        result = validation_map.get(product.product_number)
        if not result:
            continue

        if result.status == "ok":
            item.is_flagged = False
            item.flag_reason = None
        else:
            item.is_flagged = True
            item.flag_reason = result.status  # out_of_stock, discontinued, substituted, etc.

    await db.flush()
