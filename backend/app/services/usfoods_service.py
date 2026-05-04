"""US Foods weekly run generation and CSV building service."""

import logging
import re
from collections import defaultdict
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.location import Location
from app.models.supply_catalog import SupplyItem, SupplyOrder, SupplyOrderItem
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
    Pull Square orders for the full week: Monday 11 AM → Monday 11 AM.
    Auto-runs at 11:05 AM Monday via cron.
    """
    import pytz
    pacific = pytz.timezone("America/Los_Angeles")
    now = datetime.now(pacific)
    today = now.date()

    # Find this Monday (or most recent Monday)
    days_since_monday = today.weekday()  # Monday = 0
    this_monday = today - timedelta(days=days_since_monday)
    last_monday = this_monday - timedelta(days=7)

    # Window: last Monday 11 AM → this Monday 11 AM
    order_window_start = pacific.localize(datetime(last_monday.year, last_monday.month, last_monday.day, 11, 0, 0))
    order_window_end = pacific.localize(datetime(this_monday.year, this_monday.month, this_monday.day, 11, 0, 0))

    # Delete any previous runs from today so we get a clean start
    old_runs = await db.execute(
        select(USFoodsWeeklyRun).where(USFoodsWeeklyRun.run_date == today)
    )
    for old_run in old_runs.scalars().all():
        await db.delete(old_run)
    await db.flush()
    logger.info("Purged old runs for %s", today)

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
        logger.info("Aggregated into %d line items from Square", len(aggregated))

        # Merge in portal-placed orders for the same window. Each portal
        # SupplyOrderItem pointing to a SupplyItem with a US Foods PN
        # gets folded into the same (shop_mapping, product) buckets.
        portal_aggregated = await _aggregate_portal_orders(
            db,
            order_window_start.replace(tzinfo=None),
            order_window_end.replace(tzinfo=None),
            shop_mappings,
            products_by_number,
        )
        for key, line_data in portal_aggregated.items():
            if key in aggregated:
                aggregated[key]["quantity"] += line_data["quantity"]
            else:
                aggregated[key] = line_data
        logger.info(
            "Aggregated %d portal lines, %d combined line items total",
            len(portal_aggregated), len(aggregated),
        )

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
                        "state_filter": {
                            "states": ["OPEN", "COMPLETED"],
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
            # Square quantity is a string that can be decimal (e.g. "1.5")
            try:
                quantity = max(1, int(float(line_item.get("quantity", "1"))))
            except (ValueError, TypeError):
                quantity = 1

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


async def _aggregate_portal_orders(
    db: AsyncSession,
    start_naive: datetime,
    end_naive: datetime,
    shop_mappings: list,
    products_by_number: dict,
) -> dict[tuple[int, int], dict]:
    """Walk SupplyOrder rows in the window and aggregate any items whose
    SupplyItem carries a usfoods_pn into the same (shop_mapping, product)
    buckets the Square-side aggregator produces.

    Portal orders have a real Location FK so we map directly by
    location_id when the shop mapping has one set; otherwise we fall
    back to keyword matching on the location name (same as Square).
    """
    aggregated: dict[tuple[int, int], dict] = {}

    rows = (await db.execute(
        select(SupplyOrder)
        .where(SupplyOrder.created_at >= start_naive)
        .where(SupplyOrder.created_at < end_naive)
        .options(
            selectinload(SupplyOrder.items).selectinload(SupplyOrderItem.supply_item),
            selectinload(SupplyOrder.location),
        )
    )).scalars().all()

    for order in rows:
        location_id = order.location_id
        location_name = order.location.name if order.location else ""

        # Direct location_id match first; fall back to keyword match.
        mapping = next(
            (m for m in shop_mappings if m.location_id == location_id),
            None,
        )
        if mapping is None:
            mapping = _match_shop(location_name, shop_mappings)
        if mapping is None:
            logger.warning(
                "Portal order %d: no US Foods shop mapping for location '%s' (id=%s)",
                order.id, location_name, location_id,
            )
            continue

        for line in order.items:
            si: SupplyItem | None = line.supply_item
            if si is None or not si.usfoods_pn:
                continue
            product = products_by_number.get(si.usfoods_pn)
            if product is None:
                logger.warning(
                    "Portal order %d: SupplyItem %s has PN %s with no matching active USFoodsProduct",
                    order.id, si.name, si.usfoods_pn,
                )
                continue

            qty = int(line.quantity or 1)
            key = (mapping.id, product.id)
            if key in aggregated:
                aggregated[key]["quantity"] += qty
            else:
                aggregated[key] = {
                    "quantity": qty,
                    "unit": product.default_unit,
                    "square_item_name": si.name,
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
    combinations: dict[str, str] | None = None,
) -> str:
    """
    Generate the 19-column US Foods CSV format.
    combinations: maps source customer_number -> target customer_number
    """
    mappings_by_id = {m.id: m for m in shop_mappings}
    products_by_id = {}
    for p in products_by_number.values():
        products_by_id[p.id] = p

    combinations = combinations or {}

    # Use Pacific date to match run_date
    import pytz
    pacific = pytz.timezone("America/Los_Angeles")
    today_str = datetime.now(pacific).strftime("%m/%d/%Y")
    lines = [",".join(CSV_COLUMNS)]

    for item in run_items:
        mapping = mappings_by_id.get(item.shop_mapping_id)
        product = products_by_id.get(item.product_id)

        if not mapping or not product:
            continue

        # Apply combination override
        customer_number = mapping.customer_number
        if customer_number in combinations:
            customer_number = combinations[customer_number]

        cs_qty = str(item.quantity) if item.unit == "CS" else ""
        ea_qty = str(item.quantity) if item.unit == "EA" else ""
        cs_price = f"{product.current_price:.2f}" if product.current_price and item.unit == "CS" else ""
        ea_price = f"{product.current_price:.2f}" if product.current_price and item.unit == "EA" else ""

        # Calculate extended price
        extended = ""
        if product.current_price:
            extended = f"{product.current_price * item.quantity:.2f}"

        row = [
            customer_number,               # CUSTOMER NUMBER
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

        # Escape per RFC 4180: wrap in quotes and double any internal quotes
        escaped_row = []
        for field in row:
            s = str(field)
            if "," in s or '"' in s or "\n" in s:
                s = s.replace('"', '""')
                escaped_row.append(f'"{s}"')
            else:
                escaped_row.append(s)

        lines.append(",".join(escaped_row))

    return "\n".join(lines)




def build_breakdown_pdf(
    run_items: list,
    shop_mappings: list,
    products_by_number: dict,
    combinations: dict[str, str],
) -> bytes:
    """Build a PDF showing which items belong to which shop within combined orders."""
    from io import BytesIO
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    mappings_by_id = {m.id: m for m in shop_mappings}
    mappings_by_cust = {}
    for m in shop_mappings:
        if not m.is_routing_alias:
            mappings_by_cust[m.customer_number] = m

    products_by_id = {}
    for p in products_by_number.values():
        products_by_id[p.id] = p

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.5 * inch, bottomMargin=0.5 * inch)
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle("T", parent=styles["Title"], fontSize=16,
                                  textColor=colors.HexColor("#2c3e50"), spaceAfter=4)
    subtitle_style = ParagraphStyle("S", parent=styles["Normal"], fontSize=10,
                                     textColor=colors.gray, spaceAfter=16)
    header_style = ParagraphStyle("H", parent=styles["Heading2"], fontSize=13,
                                   textColor=colors.white, backColor=colors.HexColor("#2c3e50"),
                                   spaceBefore=14, spaceAfter=6, borderPadding=(6, 8, 6, 8))
    shop_style = ParagraphStyle("Sh", parent=styles["Heading3"], fontSize=11,
                                 textColor=colors.HexColor("#5CB832"), spaceBefore=10, spaceAfter=4)

    story = []
    story.append(Paragraph("Combined Order Breakdown", title_style))
    story.append(Paragraph("Which items go to which shop", subtitle_style))

    # Group: for each target customer number, show which source shops contributed
    target_groups: dict[str, dict[str, list]] = {}
    for item in run_items:
        mapping = mappings_by_id.get(item.shop_mapping_id)
        product = products_by_id.get(item.product_id)
        if not mapping or not product:
            continue

        source_cust = mapping.customer_number
        target_cust = combinations.get(source_cust, source_cust)

        if target_cust not in target_groups:
            target_groups[target_cust] = {}

        source_name = mapping.us_foods_account_name
        if source_name not in target_groups[target_cust]:
            target_groups[target_cust][source_name] = []

        target_groups[target_cust][source_name].append({
            "description": product.description,
            "product_number": product.product_number,
            "quantity": item.quantity,
            "unit": item.unit,
        })

    for target_cust, sources in target_groups.items():
        target_mapping = mappings_by_cust.get(target_cust)
        target_name = target_mapping.us_foods_account_name if target_mapping else f"#{target_cust}"

        source_names = list(sources.keys())
        if len(source_names) <= 1 and target_cust not in combinations.values():
            continue

        total_items = sum(len(items) for items in sources.values())
        story.append(Paragraph(f"Delivering to: {target_name} (#{target_cust}) — {total_items} items", header_style))

        for source_name, items in sorted(sources.items()):
            story.append(Paragraph(f"{source_name} ({len(items)} items)", shop_style))

            table_data = [["Product", "PN#", "Qty", "Unit"]]
            for it in items:
                table_data.append([it["description"][:50], it["product_number"], str(it["quantity"]), it["unit"]])

            t = Table(table_data, colWidths=[3.5 * inch, 1 * inch, 0.5 * inch, 0.5 * inch])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f0")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#ddd")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(t)

    if len(story) <= 2:
        story.append(Paragraph("No combined orders — all shops are separate.", styles["Normal"]))

    doc.build(story)
    return buf.getvalue()
