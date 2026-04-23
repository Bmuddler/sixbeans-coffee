"""Nightly analytics ingestion orchestrator.

Entry point for the Render cron service. Runs every night at 9 PM PT:
  1. GoDaddy scrape    (nightly, yesterday's data for all 6 stores)
  2. TapMango scrape   (nightly, yesterday's data — one file covers all stores)
  3. TapMango API pull (nightly, customer + loyalty data)
  4. DoorDash gmail    (only acts on the weekly email; no-op on other days)

Each source is run in its own try/except so a failure in one doesn't
block the others. Each records its own IngestionRun row in the DB.

Run manually:
    python -m backend.scripts.ingest_main
    python -m backend.scripts.ingest_main --source godaddy
    python -m backend.scripts.ingest_main --target-date 2026-04-21
"""

import argparse
import asyncio
import logging
import sys
from datetime import date, datetime, timedelta
from typing import Iterable

import pytz
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.daily_revenue import CHANNEL_DOORDASH, DailyRevenue
from app.models.ingestion_run import (
    IngestionRun,
    SOURCE_DOORDASH,
    SOURCE_TAPMANGO_API,
    STATUS_FAILED,
    STATUS_PARTIAL,
    STATUS_RUNNING,
    STATUS_SUCCESS,
)
from app.models.location import Location
from app.services.parsers import ParsedRevenueRow
from app.services.parsers.doordash_aux_csvs import (
    parse_doordash_errors_csv,
    parse_doordash_payout_csv,
)
from app.services.parsers.doordash_detailed_csv import parse_doordash_detailed_csv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------
# Individual source runners — each wraps errors so one failure doesn't
# stop the rest of the pipeline.
# ----------------------------------------------------------------------


async def _run_godaddy(db: AsyncSession, target_date: date) -> dict:
    from scripts.scrape_godaddy import run_godaddy_scrape
    try:
        return await run_godaddy_scrape(db, target_date)
    except Exception as exc:
        logger.exception("GoDaddy scrape crashed")
        return {"status": STATUS_FAILED, "reason": str(exc)}


async def _run_tapmango_orders(db: AsyncSession, target_date: date) -> dict:
    from scripts.scrape_tapmango import run_tapmango_orders_scrape
    try:
        return await run_tapmango_orders_scrape(db, target_date)
    except Exception as exc:
        logger.exception("TapMango orders scrape crashed")
        return {"status": STATUS_FAILED, "reason": str(exc)}


async def _run_tapmango_api(db: AsyncSession, target_date: date) -> dict:
    """Pull customer + loyalty data from the TapMango REST API.

    Currently stores nothing (no customer table yet) — but still logs an
    IngestionRun so the admin page can show "last pulled" and the owner
    knows the key is working. Customer storage is Phase 2.
    """
    from app.services.tapmango_api_client import TapMangoApiError, check_credentials

    run = IngestionRun(
        source=SOURCE_TAPMANGO_API,
        target_date=target_date,
        status=STATUS_RUNNING,
    )
    db.add(run)
    await db.flush()
    await db.commit()

    status_report = await check_credentials()
    if not status_report["ok"]:
        run.status = STATUS_FAILED
        run.error_message = status_report["error"]
    else:
        run.status = STATUS_SUCCESS
        run.notes = f"Verified TapMango API access; {status_report['location_count']} locations"
    run.finished_at = datetime.utcnow()
    await db.commit()
    return {"status": run.status, "locations": status_report.get("location_count", 0)}


async def _upsert_doordash_daily_revenue(db: AsyncSession, row: ParsedRevenueRow, location_id: int) -> None:
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
        existing.commission_total = row.commission_total
        existing.fee_total = row.fee_total
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
            commission_total=row.commission_total,
            fee_total=row.fee_total,
            transaction_count=row.transaction_count,
            rejected_count=row.rejected_count,
            source_file=row.raw_notes.get("source_file"),
        ))
    await db.flush()


async def _run_doordash(db: AsyncSession, target_date: date) -> dict:
    """Check Gmail for a recent DoorDash zip, parse the detailed CSV,
    upsert DailyRevenue, and save errors/payouts for dashboard surfaces.

    If no email has arrived yet this week, returns a no-op result.
    """
    from app.services.gmail_watcher import fetch_latest_doordash_zip

    run = IngestionRun(
        source=SOURCE_DOORDASH,
        target_date=target_date,
        status=STATUS_RUNNING,
    )
    db.add(run)
    await db.flush()
    await db.commit()

    try:
        csvs = await fetch_latest_doordash_zip(db, since_days=14)
    except Exception as exc:
        logger.exception("Gmail fetch failed")
        run.status = STATUS_FAILED
        run.error_message = f"Gmail error: {exc}"
        run.finished_at = datetime.utcnow()
        await db.commit()
        return {"status": STATUS_FAILED, "reason": run.error_message}

    if not csvs:
        # Not an error — DoorDash only emails weekly
        run.status = STATUS_SUCCESS
        run.notes = "No new DoorDash email this run"
        run.records_ingested = 0
        run.finished_at = datetime.utcnow()
        await db.commit()
        return {"status": STATUS_SUCCESS, "message": "no new email"}

    # Find the detailed transactions CSV
    detailed_csv: bytes | None = None
    errors_csv: bytes | None = None
    payout_csv: bytes | None = None
    for name, data in csvs.items():
        lower = name.lower()
        if "detailed" in lower and "transaction" in lower:
            detailed_csv = data
        elif "error" in lower:
            errors_csv = data
        elif "payout" in lower:
            payout_csv = data

    unknown_stores: list[str] = []
    routed = 0

    if detailed_csv:
        # Build DoorDash-id -> Location map
        locations = (await db.execute(
            select(Location).where(Location.doordash_store_id.isnot(None))
        )).scalars().all()
        dd_to_loc = {str(loc.doordash_store_id): loc for loc in locations}

        parsed_rows = parse_doordash_detailed_csv(
            file_bytes=detailed_csv,
            source_file="doordash_detailed.csv",
        )
        for row in parsed_rows:
            loc = dd_to_loc.get(row.external_store_id)
            if not loc:
                if row.external_store_id not in unknown_stores:
                    unknown_stores.append(row.external_store_id)
                continue
            await _upsert_doordash_daily_revenue(db, row, loc.id)
            routed += 1

    # Parse errors + payouts for notes; full storage is future work
    error_count = 0
    payout_count = 0
    if errors_csv:
        errors = parse_doordash_errors_csv(errors_csv, "doordash_errors.csv")
        error_count = len(errors)
    if payout_csv:
        payouts = parse_doordash_payout_csv(payout_csv, "doordash_payouts.csv")
        payout_count = len(payouts)

    note_parts = [f"routed {routed} revenue rows"]
    if error_count:
        note_parts.append(f"{error_count} error charges")
    if payout_count:
        note_parts.append(f"{payout_count} payouts")
    if unknown_stores:
        note_parts.append(f"unmapped DoorDash stores: {', '.join(unknown_stores)}")

    run.records_ingested = routed
    run.notes = "; ".join(note_parts)
    if unknown_stores and not routed:
        run.status = STATUS_FAILED
    elif unknown_stores:
        run.status = STATUS_PARTIAL
    else:
        run.status = STATUS_SUCCESS
    run.finished_at = datetime.utcnow()
    await db.commit()
    return {
        "status": run.status,
        "routed": routed,
        "errors": error_count,
        "payouts": payout_count,
        "unknown_stores": unknown_stores,
    }


# ----------------------------------------------------------------------
# Orchestrator entry point
# ----------------------------------------------------------------------


ALL_SOURCES = ("godaddy", "tapmango_orders", "tapmango_api", "doordash")


async def run_all(sources: Iterable[str], target_date: date) -> dict[str, dict]:
    results: dict[str, dict] = {}
    async with async_session() as db:
        runners = {
            "godaddy": _run_godaddy,
            "tapmango_orders": _run_tapmango_orders,
            "tapmango_api": _run_tapmango_api,
            "doordash": _run_doordash,
        }
        for src in sources:
            fn = runners.get(src)
            if not fn:
                results[src] = {"status": STATUS_FAILED, "reason": f"unknown source {src}"}
                continue
            logger.info("=== Running source: %s ===", src)
            try:
                results[src] = await fn(db, target_date)
            except Exception as exc:
                logger.exception("%s failed at orchestrator level", src)
                results[src] = {"status": STATUS_FAILED, "reason": str(exc)}
    return results


def _pacific_yesterday() -> date:
    pacific = pytz.timezone("America/Los_Angeles")
    return (datetime.now(pacific) - timedelta(days=1)).date()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the analytics ingestion pipeline.")
    parser.add_argument("--source", choices=list(ALL_SOURCES), help="Only run a single source")
    parser.add_argument("--target-date", type=str, help="YYYY-MM-DD; default = yesterday (Pacific)")
    args = parser.parse_args()

    target_date = (
        datetime.strptime(args.target_date, "%Y-%m-%d").date()
        if args.target_date
        else _pacific_yesterday()
    )

    sources = (args.source,) if args.source else ALL_SOURCES
    results = asyncio.run(run_all(sources, target_date))

    logger.info("Ingestion complete: %s", results)
    overall_ok = all(r.get("status") in (STATUS_SUCCESS, STATUS_PARTIAL) for r in results.values())
    return 0 if overall_ok else 1


if __name__ == "__main__":
    sys.exit(main())
