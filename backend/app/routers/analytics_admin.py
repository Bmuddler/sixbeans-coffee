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

import logging
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles
from app.models.ingestion_run import IngestionRun
from app.models.location import Location
from app.models.user import User, UserRole
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
    try:
        await exchange_code_for_tokens(db, code)
    except Exception as exc:
        logger.exception("Gmail OAuth code exchange failed")
        return RedirectResponse(
            url=f"/portal/admin/analytics?gmail_error={str(exc)[:100]}"
        )

    return RedirectResponse(url="/portal/admin/analytics?gmail_connected=1")


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
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
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
        from backend.scripts.ingest_main import _run_tapmango_api
        return await _run_tapmango_api(db, parsed_date)

    if source == "doordash":
        from backend.scripts.ingest_main import _run_doordash
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
