"""GoDaddy Commerce Transactions Report scraper.

Flow per run (runs nightly at 9 PM PT on the Render cron service):

  1. Load encrypted cookies from the vault
  2. Navigate to the Reports section of commerce.godaddy.com
  3. For each of the 6 canonical locations:
       a. Open the store switcher dropdown
       b. Select the store by its godaddy_dropdown_label
       c. Configure the Transactions Report for yesterday's date range
          (full 24h: 00:00:00 -> 23:59:59 Pacific)
       d. Click "Generate" / "Export" / whatever the button is called
       e. Wait for the download
       f. Hand the file bytes to parse_godaddy_excel()
       g. Resolve to Location via godaddy_dropdown_label, upsert DailyRevenue
  4. Mark session used (or mark failed + raise if the scraper hits a login page)

Selectors below are best-effort. Exact selectors need to be confirmed once
the owner captures their first session and we inspect the actual DOM.
"""

import logging
from datetime import date, datetime, timedelta

import pytz
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.daily_revenue import CHANNEL_GODADDY, DailyRevenue
from app.models.ingestion_run import (
    IngestionRun,
    SOURCE_GODADDY,
    STATUS_FAILED,
    STATUS_PARTIAL,
    STATUS_RUNNING,
    STATUS_SUCCESS,
)
from app.models.location import Location
from app.services.parsers.godaddy_excel import parse_godaddy_excel
from app.services.scraper_session_vault import VaultError
from app.services.parsers import ParsedRevenueRow
from backend.scripts.scraper_base import (
    playwright_context_for_source,
    report_expired,
    report_success,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://spa.commerce.godaddy.com"
STORE_URL_TEMPLATE = f"{BASE_URL}/home/store?storeId={{store_id}}"
LOGIN_REDIRECT_SIGNAL = "sso.godaddy.com"  # If URL contains this, cookies expired


async def _navigate_to_store(page, store_uuid: str) -> bool:
    """Navigate directly to a store's page using its UUID in the URL.

    GoDaddy Commerce selects a store via the URL's storeId parameter rather
    than a clickable dropdown, so we just go straight to the right URL.
    """
    url = STORE_URL_TEMPLATE.format(store_id=store_uuid)
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        if LOGIN_REDIRECT_SIGNAL in page.url:
            return False
        return True
    except Exception as exc:
        logger.warning("Could not load store %s: %s", store_uuid, exc)
        return False


async def _download_transactions_report(page, target_date: date) -> bytes | None:
    """Open the Transactions Report, set the date, click Generate, return bytes.

    Selectors here are speculative — the owner's first real session will
    tell us the correct ones.
    """
    # Navigate to the specific report
    try:
        await page.get_by_role("link", name="Transactions").click(timeout=5000)
    except Exception:
        try:
            await page.goto(f"{REPORTS_URL}/transactions", wait_until="domcontentloaded")
        except Exception as exc:
            logger.warning("Could not open transactions report: %s", exc)
            return None

    # Set date range to target_date
    iso = target_date.isoformat()
    date_inputs = [
        'input[name="startDate"]',
        'input[aria-label*="start" i]',
        'input[type="date"]',
    ]
    for sel in date_inputs:
        try:
            inputs = page.locator(sel)
            count = await inputs.count()
            if count >= 1:
                await inputs.nth(0).fill(iso)
            if count >= 2:
                await inputs.nth(1).fill(iso)
            break
        except Exception:
            continue

    # Download via the Generate/Export button
    try:
        async with page.expect_download(timeout=60_000) as dl_info:
            # Try a few button texts
            for text in ("Generate Report", "Generate", "Export", "Download"):
                try:
                    await page.get_by_role("button", name=text, exact=False).click(timeout=3000)
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
        logger.warning("Download timed out / failed: %s", exc)
        return None


async def _upsert_daily_revenue(db: AsyncSession, row: ParsedRevenueRow, location_id: int) -> None:
    """Upsert DailyRevenue by (location_id, date, channel)."""
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
            source_file=row.raw_notes.get("source_file"),
        ))
    await db.flush()


async def run_godaddy_scrape(db: AsyncSession, target_date: date | None = None) -> dict:
    """Main entry point — call from the orchestrator or manual admin trigger."""
    pacific = pytz.timezone("America/Los_Angeles")
    if target_date is None:
        target_date = (datetime.now(pacific) - timedelta(days=1)).date()

    run = IngestionRun(
        source=SOURCE_GODADDY,
        target_date=target_date,
        status=STATUS_RUNNING,
    )
    db.add(run)
    await db.flush()
    await db.commit()

    # Load all locations with a GoDaddy store UUID configured
    locations = (await db.execute(
        select(Location).where(Location.godaddy_store_id.isnot(None))
    )).scalars().all()

    if not locations:
        run.status = STATUS_FAILED
        run.error_message = "No locations have godaddy_store_id set"
        run.finished_at = datetime.utcnow()
        await db.commit()
        return {"status": STATUS_FAILED, "reason": run.error_message}

    success_count = 0
    failure_notes: list[str] = []

    try:
        async with playwright_context_for_source(db, SOURCE_GODADDY) as (_, _, page):
            # First navigation doubles as the "cookies still valid?" check
            first_url = STORE_URL_TEMPLATE.format(store_id=locations[0].godaddy_store_id)
            await page.goto(first_url, wait_until="domcontentloaded")
            if LOGIN_REDIRECT_SIGNAL in page.url:
                await report_expired(
                    db, SOURCE_GODADDY,
                    f"Redirected to {page.url} — cookies expired",
                )

            for loc in locations:
                label = loc.godaddy_dropdown_label or loc.canonical_short_name or loc.name
                try:
                    if not await _navigate_to_store(page, loc.godaddy_store_id):
                        failure_notes.append(f"could not load store page for {label}")
                        continue

                    file_bytes = await _download_transactions_report(page, target_date)
                    if not file_bytes:
                        failure_notes.append(f"no download for {label}")
                        continue

                    parsed = parse_godaddy_excel(
                        file_bytes=file_bytes,
                        source_file=f"godaddy_{loc.canonical_short_name or loc.id}_{target_date}.xlsx",
                        store_label=label,
                        target_date=target_date,
                    )
                    for row in parsed:
                        await _upsert_daily_revenue(db, row, loc.id)
                    success_count += 1
                except Exception as exc:
                    logger.exception("GoDaddy scrape failed for %s", label)
                    failure_notes.append(f"{label}: {exc}")

        await report_success(db, SOURCE_GODADDY)
    except VaultError as exc:
        run.status = STATUS_FAILED
        run.error_message = f"Vault error: {exc}"
        run.finished_at = datetime.utcnow()
        await db.commit()
        return {"status": STATUS_FAILED, "reason": run.error_message}

    if success_count == len(locations):
        run.status = STATUS_SUCCESS
    elif success_count == 0:
        run.status = STATUS_FAILED
    else:
        run.status = STATUS_PARTIAL

    run.records_ingested = success_count
    run.notes = "; ".join(failure_notes) if failure_notes else None
    run.finished_at = datetime.utcnow()
    await db.commit()
    return {
        "status": run.status,
        "success_count": success_count,
        "total": len(locations),
        "failures": failure_notes,
    }
