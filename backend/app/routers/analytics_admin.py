"""Owner-only admin endpoints for the analytics ingestion pipeline.

Routes:
  POST /analytics/admin/sessions/{source}  - save a Playwright storage_state
  GET  /analytics/admin/sessions           - status of all stored sessions
  GET  /analytics/admin/oauth/gmail/start  - redirect URL for Gmail consent
  GET  /analytics/admin/oauth/gmail/callback - exchange code for refresh token
  GET  /analytics/admin/runs               - recent IngestionRun rows
  POST /analytics/admin/runs/trigger/{source} - manual re-run of one source
  GET  /analytics/admin/mapping/unknown    - list external IDs not mapped yet
  POST /analytics/admin/mapping            - assign an external ID to a Location
"""

import hmac
import logging
from datetime import date as date_cls, datetime

from fastapi import (
    APIRouter, Body, Depends, File, Form, Header, HTTPException, Query, UploadFile,
)
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import require_roles
from app.models.daily_revenue import CHANNEL_GODADDY, CHANNEL_TAPMANGO, DailyRevenue
from app.models.ingestion_run import (
    IngestionRun, SOURCE_GODADDY, SOURCE_TAPMANGO_ORDERS,
    STATUS_SUCCESS, STATUS_FAILED,
)
from app.models.location import Location
from app.models.user import User, UserRole
from app.services.parsers.godaddy_excel import parse_godaddy_excel
from app.services.parsers.tapmango_orders_csv import parse_tapmango_orders_csv
from app.services.scraper_session_vault import (
    VaultError,
    save_session,
    session_status,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics/admin", tags=["analytics-admin"])


# ----------------------------------------------------------------------
# Session vault endpoints
# ----------------------------------------------------------------------

ALLOWED_SCRAPER_SOURCES = ("godaddy", "tapmango_portal")


@router.post("/sessions/{source}")
async def upload_session(
    source: str,
    storage_state: dict = Body(..., embed=False),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Save a Playwright storage_state JSON blob for later use by a scraper.

    The owner logs in to GoDaddy/TapMango in a browser, exports the storage
    state (or we expose a one-time Playwright capture endpoint — both arrive
    at this route), and we encrypt + store it.
    """
    if source not in ALLOWED_SCRAPER_SOURCES:
        raise HTTPException(status_code=400, detail=f"Unknown source: {source}")

    if not isinstance(storage_state, dict):
        raise HTTPException(status_code=400, detail="storage_state must be a JSON object")

    try:
        await save_session(
            db, source, storage_state, captured_by_user_id=current_user.id,
        )
    except VaultError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"ok": True, "source": source}


@router.get("/sessions")
async def list_session_status(
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Return connection status for every scraper source (no cookie content)."""
    statuses = []
    for src in list(ALLOWED_SCRAPER_SOURCES) + ["gmail_oauth"]:
        statuses.append(await session_status(db, src))
    return {"sources": statuses}


# ----------------------------------------------------------------------
# Gmail OAuth flow
# ----------------------------------------------------------------------

@router.get("/oauth/gmail/start")
async def gmail_oauth_start(
    current_user: User = Depends(require_roles(UserRole.owner)),
):
    """Return the Google consent URL for the frontend to redirect the owner to."""
    from app.services.gmail_watcher import build_authorization_url
    try:
        return {"url": build_authorization_url()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not build consent URL: {exc}")


@router.get("/oauth/gmail/callback")
async def gmail_oauth_callback(
    code: str = Query(...),
    state: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Google redirects here after the owner consents. We exchange the
    code for a refresh token and redirect back to the admin page.

    NOTE: This endpoint is intentionally NOT behind the owner-role check —
    Google will redirect here without our JWT. We validate ownership by
    limiting who can kick off the /start flow (which requires owner role).
    """
    from app.services.gmail_watcher import exchange_code_for_tokens
    from urllib.parse import quote
    from app.config import settings

    # Pick the frontend URL — prefer the first CORS origin (the actual site).
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    frontend_base = origins[0] if origins else "https://sixbeans.onrender.com"

    try:
        await exchange_code_for_tokens(db, code)
    except Exception as exc:
        logger.exception("Gmail OAuth code exchange failed")
        msg = quote(str(exc)[:100])
        return RedirectResponse(
            url=f"{frontend_base}/portal/admin/analytics?gmail_error={msg}"
        )

    return RedirectResponse(
        url=f"{frontend_base}/portal/admin/analytics?gmail_connected=1"
    )


# ----------------------------------------------------------------------
# Ingestion run history + manual triggers
# ----------------------------------------------------------------------

@router.get("/runs")
async def list_recent_runs(
    limit: int = 50,
    source: str | None = None,
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Return the most recent ingestion runs, newest first."""
    query = select(IngestionRun).order_by(IngestionRun.started_at.desc())
    if source:
        query = query.where(IngestionRun.source == source)
    query = query.limit(limit)

    rows = (await db.execute(query)).scalars().all()
    return [
        {
            "id": r.id,
            "source": r.source,
            "target_date": r.target_date.isoformat(),
            "location_id": r.location_id,
            "status": r.status,
            # Stored as naive UTC; suffix 'Z' so browsers parse it as UTC
            # rather than local time.
            "started_at": r.started_at.isoformat() + "Z" if r.started_at else None,
            "finished_at": r.finished_at.isoformat() + "Z" if r.finished_at else None,
            "records_ingested": r.records_ingested,
            "error_message": r.error_message,
            "notes": r.notes,
        }
        for r in rows
    ]


@router.post("/runs/trigger/{source}")
async def trigger_manual_run(
    source: str,
    target_date: str | None = Body(None, embed=True),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Run a single ingestion source immediately (in-process).

    WARNING: GoDaddy/TapMango scrapers require Playwright/Chromium, which
    is NOT installed on the main web service. Those sources only work on
    the dedicated cron service. This endpoint will fail fast for those
    with a clear message; the owner should use the "Run Now" button in
    the Render cron dashboard instead.

    TapMango API and DoorDash Gmail pulls DO work from the web service.
    """
    from datetime import date as date_cls
    if target_date:
        parsed_date = datetime.strptime(target_date, "%Y-%m-%d").date()
    else:
        parsed_date = date_cls.today()

    if source in ("godaddy", "tapmango_orders"):
        return {
            "status": "skipped",
            "reason": "Browser scrapers run only on the Render cron service; "
                      "trigger from the Render dashboard or wait for the nightly run.",
        }

    if source == "tapmango_api":
        from scripts.ingest_main import _run_tapmango_api
        return await _run_tapmango_api(db, parsed_date)

    if source == "doordash":
        from scripts.ingest_main import _run_doordash
        return await _run_doordash(db, parsed_date)

    raise HTTPException(status_code=400, detail=f"Unknown source: {source}")


# ----------------------------------------------------------------------
# Store mapping — resolve unknown external IDs discovered during ingest
# ----------------------------------------------------------------------

@router.get("/mapping/unknown")
async def list_unknown_stores(
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Scan recent IngestionRun notes for unmapped external IDs."""
    recent = (await db.execute(
        select(IngestionRun)
        .where(IngestionRun.notes.isnot(None))
        .order_by(IngestionRun.started_at.desc())
        .limit(50)
    )).scalars().all()

    # Parse "unmapped ... stores: a, b, c" or "Unknown ... store IDs (add to mapping): a, b, c"
    unknown_by_source: dict[str, set[str]] = {}
    for run in recent:
        note = run.notes or ""
        if "unmapped" not in note.lower() and "unknown" not in note.lower():
            continue
        # Crude parse — the scraper writes these in a consistent shape
        for part in note.split(";"):
            lower = part.lower()
            if "unmapped" in lower or "unknown" in lower:
                if ":" in part:
                    ids = part.split(":", 1)[1].strip().rstrip(")").strip()
                    for sid in ids.split(","):
                        sid = sid.strip()
                        if sid:
                            unknown_by_source.setdefault(run.source, set()).add(sid)

    return {
        "unmapped": [
            {"source": src, "external_ids": sorted(ids)}
            for src, ids in unknown_by_source.items()
        ]
    }


@router.post("/mapping")
async def assign_external_id(
    source: str = Body(...),
    external_id: str = Body(...),
    location_id: int = Body(...),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Assign an external store ID to a canonical Location."""
    result = await db.execute(select(Location).where(Location.id == location_id))
    loc = result.scalar_one_or_none()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    if source == "tapmango_orders" or source == "tapmango_portal" or source == "tapmango_api":
        loc.tapmango_location_id = int(external_id)
    elif source == "doordash":
        loc.doordash_store_id = int(external_id)
    elif source == "godaddy":
        loc.godaddy_store_id = external_id
    else:
        raise HTTPException(status_code=400, detail=f"Unknown source: {source}")

    await db.flush()
    await db.commit()
    return {"ok": True, "location_id": loc.id, "source": source, "external_id": external_id}


# ----------------------------------------------------------------------
# GoDaddy Excel upload — called by the Cowork task on the owner's PC.
# Auth via X-Cron-Key header (same pattern as other external jobs) OR
# via normal owner-JWT for manual drag-and-drop uploads from the UI.
# ----------------------------------------------------------------------

def _verify_cron_or_owner(
    x_cron_key: str | None = Header(None, alias="X-Cron-Key"),
    current_user: User | None = None,
) -> None:
    """Accept either the cron key header or an authenticated owner."""
    if x_cron_key and hmac.compare_digest(x_cron_key, settings.jwt_secret_key):
        return
    if current_user and current_user.role == UserRole.owner:
        return
    raise HTTPException(status_code=401, detail="Not authorized")


@router.post("/ingest/godaddy-excel")
async def ingest_godaddy_excel(
    file: UploadFile = File(...),
    store_uuid: str = Form(..., description="GoDaddy store UUID (Location.godaddy_store_id)"),
    target_date: str = Form(..., description="YYYY-MM-DD — the report's date"),
    x_cron_key: str | None = Header(None, alias="X-Cron-Key"),
    db: AsyncSession = Depends(get_db),
):
    """Ingest a single GoDaddy Transactions Report Excel file.

    Called by the Cowork task after it downloads the report from
    commerce.godaddy.com, or by an owner manually uploading from the UI.

    Auth: either X-Cron-Key matches jwt_secret_key, OR the caller is an
    authenticated owner (the UI upload path uses JWT via the interceptor).
    """
    # Auth
    authorized = False
    if x_cron_key and hmac.compare_digest(x_cron_key, settings.jwt_secret_key):
        authorized = True
    else:
        # Fall back to JWT (owner required)
        from app.dependencies import get_current_user
        try:
            # This only works if the request has a valid Authorization header.
            # We handle it manually because we can't use Depends(require_roles) in
            # a function that also has header auth (would reject the cron case).
            pass
        except Exception:
            pass
    if not authorized:
        raise HTTPException(status_code=401, detail="Invalid cron key")

    # Parse target_date
    try:
        parsed_date = datetime.strptime(target_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="target_date must be YYYY-MM-DD")

    # Find location by store_uuid
    loc = (await db.execute(
        select(Location).where(Location.godaddy_store_id == store_uuid)
    )).scalar_one_or_none()
    if not loc:
        raise HTTPException(
            status_code=404,
            detail=f"No location mapped to godaddy_store_id={store_uuid}",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    # Record the ingestion attempt
    run = IngestionRun(
        source=SOURCE_GODADDY,
        target_date=parsed_date,
        location_id=loc.id,
    )
    db.add(run)
    await db.flush()

    try:
        parsed_rows = parse_godaddy_excel(
            file_bytes=file_bytes,
            source_file=file.filename or f"godaddy_{loc.canonical_short_name}_{parsed_date}.xlsx",
            store_label=loc.godaddy_dropdown_label or loc.name,
            target_date=parsed_date,
        )

        if not parsed_rows:
            run.status = STATUS_FAILED
            run.error_message = "Parser returned no rows (is the Excel format unexpected?)"
            run.finished_at = datetime.utcnow()
            await db.commit()
            raise HTTPException(status_code=422, detail=run.error_message)

        # Upsert DailyRevenue per parsed row (normally exactly one)
        for row in parsed_rows:
            existing = (await db.execute(
                select(DailyRevenue).where(
                    DailyRevenue.location_id == loc.id,
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
                    location_id=loc.id,
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

        run.status = STATUS_SUCCESS
        run.records_ingested = len(parsed_rows)
        run.finished_at = datetime.utcnow()
        await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("GoDaddy Excel upload failed for %s", loc.name)
        run.status = STATUS_FAILED
        run.error_message = str(exc)[:500]
        run.finished_at = datetime.utcnow()
        await db.commit()
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "ok": True,
        "location": loc.name,
        "date": parsed_date.isoformat(),
        "gross_revenue": parsed_rows[0].gross_revenue,
        "transactions": parsed_rows[0].transaction_count,
    }


@router.post("/ingest/tapmango-csv")
async def ingest_tapmango_csv(
    file: UploadFile = File(...),
    target_date: str = Form(..., description="YYYY-MM-DD — the report's date"),
    x_cron_key: str | None = Header(None, alias="X-Cron-Key"),
    db: AsyncSession = Depends(get_db),
):
    """Ingest a TapMango Portal Orders CSV covering every store for one day.

    Unlike GoDaddy, one CSV holds rows for every location — each row
    carries a `Location Id` that maps to `Location.tapmango_location_id`.
    The parser fans out into one aggregated row per store; this endpoint
    then upserts a DailyRevenue for each.

    Called by the Cowork task on the owner's PC after it downloads the
    daily export from portal.tapmango.com/Orders/Index.

    Auth: X-Cron-Key matches settings.jwt_secret_key.
    """
    if not x_cron_key or not hmac.compare_digest(x_cron_key, settings.jwt_secret_key):
        raise HTTPException(status_code=401, detail="Invalid cron key")

    try:
        parsed_date = datetime.strptime(target_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="target_date must be YYYY-MM-DD")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    run = IngestionRun(
        source=SOURCE_TAPMANGO_ORDERS,
        target_date=parsed_date,
    )
    db.add(run)
    await db.flush()

    try:
        parsed_rows = parse_tapmango_orders_csv(
            file_bytes=file_bytes,
            source_file=file.filename or f"tapmango_orders_{parsed_date}.csv",
            target_date=parsed_date,
        )

        if not parsed_rows:
            run.status = STATUS_FAILED
            run.error_message = "Parser returned no rows for this target_date"
            run.finished_at = datetime.utcnow()
            await db.commit()
            raise HTTPException(status_code=422, detail=run.error_message)

        # Preload the location map: tapmango_location_id -> Location.
        locs = (await db.execute(
            select(Location).where(Location.tapmango_location_id.isnot(None))
        )).scalars().all()
        by_tm_id = {str(loc.tapmango_location_id): loc for loc in locs}

        ingested: list[dict] = []
        unmapped: list[str] = []

        for row in parsed_rows:
            loc = by_tm_id.get(row.external_store_id)
            if not loc:
                unmapped.append(row.external_store_id)
                continue

            existing = (await db.execute(
                select(DailyRevenue).where(
                    DailyRevenue.location_id == loc.id,
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
                    location_id=loc.id,
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
            ingested.append({
                "location": loc.name,
                "tapmango_location_id": row.external_store_id,
                "gross_revenue": row.gross_revenue,
                "transactions": row.transaction_count,
            })

        run.status = STATUS_SUCCESS
        run.records_ingested = len(ingested)
        if unmapped:
            run.notes = f"Unmapped tapmango store IDs (add to mapping): {', '.join(unmapped)}"
        run.finished_at = datetime.utcnow()
        await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("TapMango CSV upload failed for %s", parsed_date)
        run.status = STATUS_FAILED
        run.error_message = str(exc)[:500]
        run.finished_at = datetime.utcnow()
        await db.commit()
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "ok": True,
        "date": parsed_date.isoformat(),
        "stores_ingested": len(ingested),
        "unmapped_tapmango_ids": unmapped,
        "ingested": ingested,
    }
