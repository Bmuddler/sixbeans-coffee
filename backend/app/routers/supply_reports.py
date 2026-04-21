"""Supply report endpoints — manual trigger and scheduled cron."""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import require_roles
from app.models.user import User, UserRole
from app.services.supply_report_service import run_supply_report

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory cache for generated checklists (keyed by token)
_checklist_cache: dict[str, str] = {}


def store_checklist(html: str) -> str:
    """Store a checklist and return its access token."""
    import hashlib
    token = hashlib.sha256(f"{datetime.utcnow().isoformat()}{len(html)}".encode()).hexdigest()[:16]
    _checklist_cache[token] = html
    # Keep only last 20 checklists
    if len(_checklist_cache) > 20:
        oldest = list(_checklist_cache.keys())[0]
        del _checklist_cache[oldest]
    return token


@router.get("/checklist/{token}", response_class=HTMLResponse)
async def view_checklist(token: str):
    """Serve a generated checklist as a web page (no auth required)."""
    html = _checklist_cache.get(token)
    if not html:
        return HTMLResponse("<h1>Checklist not found or expired</h1><p>This link may have expired. Please request a new report.</p>", status_code=404)
    return HTMLResponse(html)


@router.post("/run")
async def run_supply_report_endpoint(
    manual: bool = Query(True),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger a supply report run (owner-only)."""
    try:
        result = await run_supply_report(manual=True)
        return result
    except Exception as exc:
        logger.exception("Supply report failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Supply report failed: {exc}",
        )


@router.post("/scheduled-run")
async def scheduled_supply_report(
    x_cron_key: str = Header(..., alias="X-Cron-Key"),
):
    """Called by external cron on Monday and Friday at 9am PT.

    Authenticated via X-Cron-Key header (must match jwt_secret_key).
    """
    if x_cron_key != settings.jwt_secret_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid cron key",
        )
    import traceback
    try:
        result = await run_supply_report(manual=False)
        return result
    except Exception as exc:
        tb = traceback.format_exc()
        logger.exception("Scheduled supply report failed")
        return {
            "status": "error",
            "error": str(exc),
            "traceback": tb,
        }
