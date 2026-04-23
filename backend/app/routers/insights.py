"""Owner Insights dashboard endpoints.

Aggregates the DailyRevenue table (fed by the nightly ingestion pipeline)
into views the owner actually looks at every morning:
  - company-pulse: total revenue/txns across all shops, today vs last week
  - store-scorecards: per-store trends, WoW delta, channel mix
  - action-inbox: flagged items the owner should act on
"""

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta

import pytz
from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_roles
from app.models.daily_revenue import (
    CHANNEL_DOORDASH,
    CHANNEL_GODADDY,
    CHANNEL_TAPMANGO,
    DailyRevenue,
)
from app.models.ingestion_run import IngestionRun, STATUS_FAILED, STATUS_PARTIAL
from app.models.location import Location
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/insights", tags=["insights"])


def _pacific_today() -> date:
    return datetime.now(pytz.timezone("America/Los_Angeles")).date()


def _resolve_window(
    days: int,
    start_date: str | None,
    end_date: str | None,
) -> tuple[date, date]:
    """Resolve the (curr_start, curr_end) window.

    If an explicit start_date / end_date pair is given it takes precedence
    over ``days`` and is clamped between 1 and 365 days. Otherwise the
    window is the last ``days`` days ending at Pacific today.
    """
    if start_date or end_date:
        try:
            start = date.fromisoformat(start_date) if start_date else _pacific_today()
            end = date.fromisoformat(end_date) if end_date else start
        except ValueError as exc:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=400,
                detail=f"start_date / end_date must be YYYY-MM-DD ({exc})",
            )
        if end < start:
            start, end = end, start
        span = (end - start).days + 1
        if span > 365:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=400,
                detail="Date range too large (max 365 days)",
            )
        return start, end

    today = _pacific_today()
    return today - timedelta(days=days - 1), today


def _sum_rows(rows) -> dict:
    """Sum a list of DailyRevenue rows into totals."""
    total_gross = 0.0
    total_net = 0.0
    total_txns = 0
    total_commission = 0.0
    by_channel: dict[str, dict] = defaultdict(
        lambda: {"gross": 0.0, "net": 0.0, "txns": 0, "commission": 0.0}
    )
    for r in rows:
        total_gross += r.gross_revenue or 0.0
        total_net += r.net_revenue or 0.0
        total_txns += r.transaction_count or 0
        total_commission += r.commission_total or 0.0
        ch = by_channel[r.channel]
        ch["gross"] += r.gross_revenue or 0.0
        ch["net"] += r.net_revenue or 0.0
        ch["txns"] += r.transaction_count or 0
        ch["commission"] += r.commission_total or 0.0
    return {
        "gross": round(total_gross, 2),
        "net": round(total_net, 2),
        "transactions": total_txns,
        "commission": round(total_commission, 2),
        "by_channel": {
            ch: {k: round(v, 2) if isinstance(v, float) else v for k, v in data.items()}
            for ch, data in by_channel.items()
        },
    }


# ----------------------------------------------------------------------
# Company Pulse: overall roll-up
# ----------------------------------------------------------------------

@router.get("/company-pulse")
async def company_pulse(
    days: int = Query(7, ge=1, le=90),
    start_date: str | None = Query(None, description="YYYY-MM-DD — overrides `days` when set"),
    end_date: str | None = Query(None, description="YYYY-MM-DD — defaults to start_date when only start is set"),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """High-level numbers for the top of the dashboard.

    Returns totals for the current window plus the prior window of the
    same length for a period-over-period comparison. Use
    ``start_date`` / ``end_date`` to pick an arbitrary range (e.g. a
    specific day), otherwise defaults to the last ``days`` days.
    """
    curr_start, curr_end = _resolve_window(days, start_date, end_date)
    span = (curr_end - curr_start).days + 1
    prev_end = curr_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=span - 1)

    curr_rows = (await db.execute(
        select(DailyRevenue).where(
            and_(DailyRevenue.date >= curr_start, DailyRevenue.date <= curr_end)
        )
    )).scalars().all()
    prev_rows = (await db.execute(
        select(DailyRevenue).where(
            and_(DailyRevenue.date >= prev_start, DailyRevenue.date <= prev_end)
        )
    )).scalars().all()

    curr = _sum_rows(curr_rows)
    prev = _sum_rows(prev_rows)

    def pct_change(a: float, b: float) -> float | None:
        if not b:
            return None
        return round(((a - b) / b) * 100, 1)

    # DoorDash data freshness banner (only weekly)
    latest_dd = (await db.execute(
        select(func.max(DailyRevenue.date)).where(
            DailyRevenue.channel == CHANNEL_DOORDASH
        )
    )).scalar_one_or_none()

    return {
        "window": {
            "start": curr_start.isoformat(),
            "end": curr_end.isoformat(),
            "days": span,
        },
        "current": curr,
        "previous": prev,
        "deltas": {
            "gross_pct": pct_change(curr["gross"], prev["gross"]),
            "net_pct": pct_change(curr["net"], prev["net"]),
            "transactions_pct": pct_change(curr["transactions"], prev["transactions"]),
        },
        "doordash_data_through": latest_dd.isoformat() if latest_dd else None,
    }


# ----------------------------------------------------------------------
# Per-store scorecards
# ----------------------------------------------------------------------

@router.get("/store-scorecards")
async def store_scorecards(
    days: int = Query(7, ge=1, le=90),
    start_date: str | None = Query(None, description="YYYY-MM-DD — overrides `days` when set"),
    end_date: str | None = Query(None, description="YYYY-MM-DD — defaults to start_date when only start is set"),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """One scorecard per canonical location with totals, channel mix, and period-over-period delta."""
    curr_start, curr_end = _resolve_window(days, start_date, end_date)
    span = (curr_end - curr_start).days + 1
    prev_end = curr_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=span - 1)

    # Only surface locations that have canonical_short_name set (the 6 real shops)
    locations = (await db.execute(
        select(Location)
        .where(Location.canonical_short_name.isnot(None))
        .order_by(Location.canonical_short_name)
    )).scalars().all()

    rev_rows = (await db.execute(
        select(DailyRevenue).where(
            and_(DailyRevenue.date >= prev_start, DailyRevenue.date <= curr_end)
        )
    )).scalars().all()

    # Group rows by location
    by_loc: dict[int, list] = defaultdict(list)
    for r in rev_rows:
        by_loc[r.location_id].append(r)

    scorecards = []
    for loc in locations:
        loc_rows = by_loc.get(loc.id, [])
        curr_rows_loc = [r for r in loc_rows if curr_start <= r.date <= curr_end]
        prev_rows_loc = [r for r in loc_rows if prev_start <= r.date <= prev_end]
        curr = _sum_rows(curr_rows_loc)
        prev = _sum_rows(prev_rows_loc)

        wow_pct = None
        if prev["gross"]:
            wow_pct = round(((curr["gross"] - prev["gross"]) / prev["gross"]) * 100, 1)

        scorecards.append({
            "location_id": loc.id,
            "name": loc.name,
            "canonical_short_name": loc.canonical_short_name,
            "current_gross": curr["gross"],
            "current_net": curr["net"],
            "current_transactions": curr["transactions"],
            "wow_pct": wow_pct,
            "by_channel": curr["by_channel"],
            "has_godaddy": bool(loc.godaddy_store_id),
            "has_tapmango": bool(loc.tapmango_location_id),
            "has_doordash": bool(loc.doordash_store_id),
        })

    return {
        "window": {
            "start": curr_start.isoformat(),
            "end": curr_end.isoformat(),
            "days": span,
        },
        "scorecards": scorecards,
    }


# ----------------------------------------------------------------------
# Daily trend for a single store (drill-down)
# ----------------------------------------------------------------------

@router.get("/store/{location_id}/daily")
async def store_daily_trend(
    location_id: int,
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Daily gross/net/transactions for one store across all channels."""
    today = _pacific_today()
    start = today - timedelta(days=days - 1)

    rows = (await db.execute(
        select(DailyRevenue)
        .where(and_(
            DailyRevenue.location_id == location_id,
            DailyRevenue.date >= start,
            DailyRevenue.date <= today,
        ))
        .order_by(DailyRevenue.date.asc())
    )).scalars().all()

    # Combine channels per date
    by_date: dict[date, dict] = defaultdict(
        lambda: {"gross": 0.0, "net": 0.0, "txns": 0,
                 "godaddy": 0.0, "tapmango": 0.0, "doordash": 0.0}
    )
    for r in rows:
        d = by_date[r.date]
        d["gross"] += r.gross_revenue or 0.0
        d["net"] += r.net_revenue or 0.0
        d["txns"] += r.transaction_count or 0
        d[r.channel] += r.gross_revenue or 0.0

    series = [
        {
            "date": dt.isoformat(),
            "gross": round(v["gross"], 2),
            "net": round(v["net"], 2),
            "transactions": v["txns"],
            "godaddy": round(v["godaddy"], 2),
            "tapmango": round(v["tapmango"], 2),
            "doordash": round(v["doordash"], 2),
        }
        for dt, v in sorted(by_date.items())
    ]
    return {"location_id": location_id, "days": days, "series": series}


# ----------------------------------------------------------------------
# Action Inbox: flagged items the owner should act on
# ----------------------------------------------------------------------

@router.get("/action-inbox")
async def action_inbox(
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Surface things the owner should look at today:
      - Ingestion runs that failed or are partial
      - Stores with unusually low revenue vs their 4-week average
      - DoorDash error charges (from run notes)
      - Stores that haven't reported today
    """
    today = _pacific_today()
    actions: list[dict] = []

    # 1. Failed or partial ingestion runs in the last 7 days
    recent_runs = (await db.execute(
        select(IngestionRun)
        .where(IngestionRun.started_at >= datetime.utcnow() - timedelta(days=7))
        .where(IngestionRun.status.in_([STATUS_FAILED, STATUS_PARTIAL]))
        .order_by(IngestionRun.started_at.desc())
        .limit(20)
    )).scalars().all()

    for r in recent_runs:
        actions.append({
            "type": "ingest_failure",
            "severity": "error" if r.status == STATUS_FAILED else "warning",
            "title": f"{r.source} ingest {r.status}",
            "detail": r.error_message or r.notes or "See ingestion log",
            "occurred_at": r.started_at.isoformat() if r.started_at else None,
        })

    # 2. Stores with no revenue reported for yesterday (possible scraper issue)
    yesterday = today - timedelta(days=1)
    locations = (await db.execute(
        select(Location).where(Location.canonical_short_name.isnot(None))
    )).scalars().all()

    reporting_rows = (await db.execute(
        select(DailyRevenue.location_id)
        .where(DailyRevenue.date == yesterday)
        .distinct()
    )).scalars().all()
    reporting_set = set(reporting_rows)

    for loc in locations:
        if loc.id not in reporting_set and loc.godaddy_store_id:
            actions.append({
                "type": "missing_data",
                "severity": "warning",
                "title": f"No revenue reported for {loc.name} yesterday",
                "detail": "Check the GoDaddy/TapMango scrapers on the Analytics Setup page",
                "occurred_at": yesterday.isoformat(),
            })

    # 3. Low-revenue flag: store < 60% of its 28-day avg over the last 3 days
    four_wk_start = today - timedelta(days=28)
    three_day_start = today - timedelta(days=3)

    four_wk_rows = (await db.execute(
        select(DailyRevenue).where(DailyRevenue.date >= four_wk_start)
    )).scalars().all()

    by_loc_day: dict[tuple[int, date], float] = defaultdict(float)
    for r in four_wk_rows:
        by_loc_day[(r.location_id, r.date)] += r.gross_revenue or 0.0

    for loc in locations:
        daily_vals = [
            v for (lid, _), v in by_loc_day.items() if lid == loc.id
        ]
        if len(daily_vals) < 10:
            continue
        avg = sum(daily_vals) / len(daily_vals)
        recent_vals = [
            v for (lid, d), v in by_loc_day.items()
            if lid == loc.id and d >= three_day_start
        ]
        if not recent_vals:
            continue
        recent_avg = sum(recent_vals) / len(recent_vals)
        if avg > 0 and recent_avg < avg * 0.6:
            actions.append({
                "type": "low_revenue",
                "severity": "warning",
                "title": f"{loc.name}: 3-day revenue is {round(recent_avg/avg*100)}% of 28-day average",
                "detail": f"${round(recent_avg, 2)} vs ${round(avg, 2)} avg",
                "occurred_at": today.isoformat(),
            })

    return {"actions": actions}
