"""TapMango portal Orders CSV exporter.

Flow per nightly run:
  1. Load encrypted cookies from vault
  2. Go to https://portal.tapmango.com/Orders/Index
  3. Verify we're still authenticated (not bounced to /login)
  4. Set date filter to yesterday (full 24h, Pacific)
  5. Click "Export" / "Download CSV" — one file covers all stores
  6. Parse via parse_tapmango_orders_csv() — that parser splits the
     rows into (store, date) buckets
  7. For each ParsedRevenueRow, find Location where
     Location.tapmango_location_id == int(row.external_store_id); upsert
     DailyRevenue
  8. Any unmatched store IDs get flagged in IngestionRun.notes for the
     auto-discovery / mapping UI
"""

import logging
from datetime import date, datetime, timedelta

import pytz
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.daily_revenue import CHANNEL_TAPMANGO, DailyRevenue
from app.models.ingestion_run import (
    IngestionRun,
    SOURCE_TAPMANGO_ORDERS,
    STATUS_FAILED,
    STATUS_PARTIAL,
    STATUS_RUNNING,
    STATUS_SUCCESS,
)
from app.models.location import Location
from app.models.scraper_session import SOURCE_TAPMANGO_PORTAL
from app.services.parsers.tapmango_orders_csv import parse_tapmango_orders_csv
from app.services.parsers import ParsedRevenueRow
from app.services.scraper_session_vault import VaultError
from backend.scripts.scraper_base import (
    playwright_context_for_source,
    report_expired,
    report_success,
)

logger = logging.getLogger(__name__)

ORDERS_URL = "https://portal.tapmango.com/Orders/Index"
LOGIN_REDIRECT_SIGNAL = "/login"  # If URL path contains this, cookies expired


async def _set_date_range(page, target_date: date) -> None:
    """Configure the Orders page to show only target_date."""
    iso = target_date.isoformat()
    # Common patterns for date filter inputs
    candidates = [
        'input[name="startDate"]',
        'input[name="fromDate"]',
        'input[aria-label*="start" i]',
        'input[aria-label*="from" i]',
        'input[type="date"]',
    ]
    for sel in candidates:
        try:
            inputs = page.locator(sel)
            count = await inputs.count()
            if count >= 1:
                await inputs.nth(0).fill(iso)
            if count >= 2:
                await inputs.nth(1).fill(iso)
            # Trigger the filter
            try:
                await page.get_by_role("button", name="Apply", exact=False).first.click(timeout=2000)
            except Exception:
                try:
                    await page.get_by_role("button", name="Filter", exact=False).first.click(timeout=2000)
                except Exception:
                    pass
            return
        except Exception:
            continue


async def _download_orders_csv(page) -> bytes | None:
    """Click the Export/Download button and return the CSV bytes."""
    try:
        async with page.expect_download(timeout=60_000) as dl_info:
            for text in ("Export CSV", "Export", "Download CSV", "Download"):
                try:
                    await page.get_by_role("button", name=text, exact=False).first.click(timeout=3000)
                    break
                except Exception:
                    continue
        download = await dl_info.value
        path = await download.path()
        if not path:
            return None
        with open(path, "rb") as f:
            return f.read()
    except Exception as exc:
        logger.warning("TapMango CSV download failed: %s", exc)
        return None


async def _upsert_daily_revenue(db: AsyncSession, row: ParsedRevenueRow, location_id: int) -> None:
    existing = (await db.execute(
        select(DailyRevenue).where(
            DailyRevenue.location_id == location_id,
            DailyRevenue.date == row.date,
            DailyRevenue.channel == row.channel,
        )
    )).scalar_one_or_none()

    if existing:
        existing.gross_revenue = row.gross_revenue
        existing.net_revenue = row.net_revenue
        existing.discount_total = row.discount_total
        existing.tip_total = row.tip_total
        existing.tax_total = row.tax_total
        existing.transaction_count = row.transaction_count
        existing.rejected_count = row.rejected_count
        existing.source_file = row.raw_notes.get("source_file")
        existing.updated_at = datetime.utcnow()
    else:
        db.add(DailyRevenue(
            location_id=location_id,
            date=row.date,
            channel=row.channel,
            gross_revenue=row.gross_revenue,
            net_revenue=row.net_revenue,
            discount_total=row.discount_total,
            tip_total=row.tip_total,
            tax_total=row.tax_total,
            transaction_count=row.transaction_count,
            rejected_count=row.rejected_count,
            source_file=row.raw_notes.get("source_file"),
        ))
    await db.flush()


async def run_tapmango_orders_scrape(db: AsyncSession, target_date: date | None = None) -> dict:
    """Main entry point — call from orchestrator or manual trigger."""
    pacific = pytz.timezone("America/Los_Angeles")
    if target_date is None:
        target_date = (datetime.now(pacific) - timedelta(days=1)).date()

    run = IngestionRun(
        source=SOURCE_TAPMANGO_ORDERS,
        target_date=target_date,
        status=STATUS_RUNNING,
    )
    db.add(run)
    await db.flush()
    await db.commit()

    # Build TapMango-id -> Location map for the routing step
    locations = (await db.execute(
        select(Location).where(Location.tapmango_location_id.isnot(None))
    )).scalars().all()
    tm_to_loc = {str(loc.tapmango_location_id): loc for loc in locations}

    try:
        async with playwright_context_for_source(db, SOURCE_TAPMANGO_PORTAL) as (_, _, page):
            await page.goto(ORDERS_URL, wait_until="domcontentloaded")
            if LOGIN_REDIRECT_SIGNAL in page.url:
                await report_expired(
                    db, SOURCE_TAPMANGO_PORTAL,
                    f"Redirected to {page.url} — cookies expired",
                )

            await _set_date_range(page, target_date)
            file_bytes = await _download_orders_csv(page)

        if not file_bytes:
            run.status = STATUS_FAILED
            run.error_message = "Could not download TapMango orders CSV"
            run.finished_at = datetime.utcnow()
            await db.commit()
            return {"status": STATUS_FAILED, "reason": run.error_message}

        await report_success(db, SOURCE_TAPMANGO_PORTAL)
    except VaultError as exc:
        run.status = STATUS_FAILED
        run.error_message = f"Vault error: {exc}"
        run.finished_at = datetime.utcnow()
        await db.commit()
        return {"status": STATUS_FAILED, "reason": run.error_message}

    # Parse and route
    parsed_rows = parse_tapmango_orders_csv(
        file_bytes=file_bytes,
        source_file=f"tapmango_orders_{target_date}.csv",
    )

    routed = 0
    unknown_stores: list[str] = []
    for row in parsed_rows:
        loc = tm_to_loc.get(row.external_store_id)
        if not loc:
            if row.external_store_id not in unknown_stores:
                unknown_stores.append(row.external_store_id)
            continue
        await _upsert_daily_revenue(db, row, loc.id)
        routed += 1

    run.records_ingested = routed
    if unknown_stores:
        run.notes = f"Unknown TapMango store IDs (add to mapping): {', '.join(unknown_stores)}"
        run.status = STATUS_PARTIAL if routed else STATUS_FAILED
    elif routed:
        run.status = STATUS_SUCCESS
    else:
        run.status = STATUS_FAILED
        run.error_message = "CSV contained no recognized rows"

    run.finished_at = datetime.utcnow()
    await db.commit()
    return {
        "status": run.status,
        "routed": routed,
        "unknown_stores": unknown_stores,
    }
