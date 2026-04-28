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
from app.models.daily_labor import DailyLabor
from app.models.daily_revenue import (
    CHANNEL_DOORDASH,
    CHANNEL_GODADDY,
    CHANNEL_TAPMANGO,
    DailyRevenue,
)
from app.models.expense import Expense
from app.models.hourly_revenue import HourlyRevenue
from app.models.ingestion_run import IngestionRun, STATUS_FAILED, STATUS_PARTIAL
from app.models.location import Location
from app.models.system_settings import SystemSettings
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


def _sum_rows(rows, card_processing_fee_pct: float = 0.023) -> dict:
    """Sum a list of DailyRevenue rows into totals.

    `card_processing_fee_pct` is applied to the GoDaddy card_total to
    estimate the silent processing fee. Other channels don't carry a card
    breakdown, so they don't contribute to the fee estimate.
    """
    total_gross = 0.0
    total_net = 0.0
    total_txns = 0
    total_commission = 0.0
    total_other_fees = 0.0
    total_card = 0.0
    total_cash = 0.0
    by_channel: dict[str, dict] = defaultdict(
        lambda: {"gross": 0.0, "net": 0.0, "txns": 0, "commission": 0.0, "fees": 0.0, "card": 0.0, "cash": 0.0}
    )
    for r in rows:
        total_gross += r.gross_revenue or 0.0
        total_net += r.net_revenue or 0.0
        total_txns += r.transaction_count or 0
        total_commission += r.commission_total or 0.0
        total_other_fees += r.fee_total or 0.0
        card = getattr(r, "card_total", None) or 0.0
        cash = getattr(r, "cash_total", None) or 0.0
        total_card += card
        total_cash += cash
        ch = by_channel[r.channel]
        ch["gross"] += r.gross_revenue or 0.0
        ch["net"] += r.net_revenue or 0.0
        ch["txns"] += r.transaction_count or 0
        ch["commission"] += r.commission_total or 0.0
        ch["fees"] += r.fee_total or 0.0
        ch["card"] += card
        ch["cash"] += cash

    estimated_card_fee = total_card * (card_processing_fee_pct or 0.0)
    total_silent_fees = estimated_card_fee + total_commission + total_other_fees
    return {
        "gross": round(total_gross, 2),
        "net": round(total_net, 2),
        "net_after_card_fee": round(total_net - estimated_card_fee, 2),
        "transactions": total_txns,
        "commission": round(total_commission, 2),
        "fees_other": round(total_other_fees, 2),
        "card_total": round(total_card, 2),
        "cash_total": round(total_cash, 2),
        "estimated_card_processing_fee": round(estimated_card_fee, 2),
        "card_processing_fee_pct": card_processing_fee_pct,
        "total_silent_fees": round(total_silent_fees, 2),
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

    settings_row = (await db.execute(select(SystemSettings).limit(1))).scalar_one_or_none()
    fee_pct = float(getattr(settings_row, "card_processing_fee_pct", None) or 0.023)
    curr = _sum_rows(curr_rows, card_processing_fee_pct=fee_pct)
    prev = _sum_rows(prev_rows, card_processing_fee_pct=fee_pct)

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

    # Only surface sales locations — the 6 shops with at least one POS
    # channel mapped. Bakery / Warehouse are labor-only and never rung up
    # revenue, so they shouldn't appear on the store-scorecard list.
    locations = (await db.execute(
        select(Location)
        .where(
            Location.canonical_short_name.isnot(None),
            (
                Location.godaddy_store_id.isnot(None)
                | Location.tapmango_location_id.isnot(None)
                | Location.doordash_store_id.isnot(None)
            ),
        )
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


# ----------------------------------------------------------------------
# Heatmap: day-of-week × (hour | quarter-hour)
# ----------------------------------------------------------------------

@router.get("/heatmap")
async def heatmap(
    location_id: int = Query(..., description="Which store"),
    start_date: str | None = Query(None, description="YYYY-MM-DD (defaults to 4 weeks ago)"),
    end_date: str | None = Query(None, description="YYYY-MM-DD (defaults to yesterday)"),
    granularity: str = Query("hour", pattern="^(hour|quarter)$"),
    metric: str = Query("txns", pattern="^(txns|gross)$"),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Average `metric` per (day-of-week, time-slot) cell across the window.

    - day-of-week: 0 = Monday through 6 = Sunday (ISO).
    - time-slot: 0..23 if granularity=hour, 0..95 (hour*4 + quarter) if quarter.
    - Cell value = sum / number of dates in the window that fell on that dow.
      So if the window covers 4 Tuesdays, a Tuesday cell is the average across
      those 4 Tuesdays' txn counts (or gross $).

    Aggregates across all channels (godaddy + tapmango). DoorDash has no
    hourly rows so it's implicitly excluded.
    """
    today = _pacific_today()
    try:
        start = date.fromisoformat(start_date) if start_date else today - timedelta(days=28)
        end = date.fromisoformat(end_date) if end_date else today - timedelta(days=1)
    except ValueError as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Bad date: {exc}")
    if end < start:
        start, end = end, start

    rows = (await db.execute(
        select(HourlyRevenue).where(
            HourlyRevenue.location_id == location_id,
            HourlyRevenue.date >= start,
            HourlyRevenue.date <= end,
        )
    )).scalars().all()

    # Count how many dates of each weekday appear in [start, end]
    dow_date_counts: dict[int, int] = defaultdict(int)
    d = start
    while d <= end:
        dow_date_counts[d.weekday()] += 1
        d += timedelta(days=1)

    # Aggregate by (dow, slot) -> metric total
    def slot_of(hour: int, quarter: int) -> int:
        return hour if granularity == "hour" else hour * 4 + quarter

    slots = 24 if granularity == "hour" else 96
    grid: list[list[float]] = [[0.0] * slots for _ in range(7)]  # grid[dow][slot]

    window_total_gross = 0.0
    window_total_txns = 0
    for r in rows:
        dow = r.date.weekday()
        s = slot_of(r.hour, r.quarter)
        if metric == "txns":
            grid[dow][s] += r.txns
        else:
            grid[dow][s] += r.gross
        window_total_gross += r.gross or 0.0
        window_total_txns += r.txns or 0

    # Average across the number of matching days per weekday
    max_val = 0.0
    for dow in range(7):
        denom = dow_date_counts.get(dow, 0) or 1
        for s in range(slots):
            grid[dow][s] = round(grid[dow][s] / denom, 2 if metric == "gross" else 3)
            if grid[dow][s] > max_val:
                max_val = grid[dow][s]

    return {
        "location_id": location_id,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "granularity": granularity,
        "metric": metric,
        "slots": slots,
        "dow_date_counts": dict(dow_date_counts),
        "max_value": max_val,
        "grid": grid,  # grid[dow][slot]
        "window_total_gross": round(window_total_gross, 2),
        "window_total_txns": window_total_txns,
        "sources_included": ["godaddy", "tapmango"],
    }



# ----------------------------------------------------------------------
# Data freshness — which sources have data for each day in the window
# ----------------------------------------------------------------------

@router.get("/data-freshness")
async def data_freshness(
    days: int = Query(7, ge=1, le=90),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Per-source coverage report for the selected window.

    For each data source, returns:
      - expected: total number of dates in the window
      - present: days with at least one row
      - missing_dates: ISO-formatted list of dates with nothing yet

    Lets the Insights page tell the owner 'DoorDash is missing for the
    last 3 days, Homebase for 2' without having to dig.
    """
    curr_start, curr_end = _resolve_window(days, start_date, end_date)
    all_days: list[date] = []
    d = curr_start
    while d <= curr_end:
        all_days.append(d)
        d += timedelta(days=1)
    expected = len(all_days)
    all_days_set = set(all_days)

    # Per-channel revenue coverage
    rev_rows = (await db.execute(
        select(DailyRevenue.date, DailyRevenue.channel)
        .where(and_(DailyRevenue.date >= curr_start, DailyRevenue.date <= curr_end))
    )).all()
    per_channel: dict[str, set[date]] = {
        CHANNEL_GODADDY: set(), CHANNEL_TAPMANGO: set(), CHANNEL_DOORDASH: set(),
    }
    for row in rev_rows:
        if row.channel in per_channel:
            per_channel[row.channel].add(row.date)

    # Labor coverage
    labor_rows = (await db.execute(
        select(DailyLabor.date)
        .where(and_(DailyLabor.date >= curr_start, DailyLabor.date <= curr_end))
    )).all()
    labor_days = {row.date for row in labor_rows}

    def _summary(present_days: set) -> dict:
        missing = sorted(all_days_set - present_days)
        return {
            "present": len(present_days & all_days_set),
            "missing": len(missing),
            "missing_dates": [d.isoformat() for d in missing],
            "latest_present": max(present_days).isoformat() if present_days else None,
        }

    return {
        "window": {
            "start": curr_start.isoformat(),
            "end": curr_end.isoformat(),
            "days": expected,
        },
        "sources": {
            "godaddy":  _summary(per_channel[CHANNEL_GODADDY]),
            "tapmango": _summary(per_channel[CHANNEL_TAPMANGO]),
            "doordash": _summary(per_channel[CHANNEL_DOORDASH]),
            "homebase": _summary(labor_days),
        },
    }



# ----------------------------------------------------------------------
# Elite Scorecards — per-store P&L + grade + action
# ----------------------------------------------------------------------

# Target labor % of revenue. Anything above this contributes to
# "labor_opportunity" (how much you could save by right-sizing staff).
TARGET_LABOR_PCT = 0.30


def _grade(score: int, has_labor: bool) -> str:
    if not has_labor:
        return "INFO ONLY"  # no labor data yet — can't grade
    if score >= 85:
        return "GREEN"
    if score >= 70:
        return "YELLOW"
    if score >= 55:
        return "ORANGE"
    return "RED"


def _manager_score(
    margin_pct: float | None,
    labor_pct: float | None,
    avg_splh: float | None,
    labor_opportunity: float,
    wow_profit_delta: float | None,
) -> int:
    """Adaptation of the v6 Python scorer. 100 = perfect; subtractive."""
    score = 100

    if labor_pct is not None:
        if labor_pct > 40:
            score -= 28
        elif labor_pct > 35:
            score -= 18
        elif labor_pct > 30:
            score -= 10

    if margin_pct is not None:
        if margin_pct < 10:
            score -= 30
        elif margin_pct < 20:
            score -= 15
        elif margin_pct < 30:
            score -= 6

    if avg_splh is not None:
        if avg_splh < 60:
            score -= 12
        elif avg_splh < 65:
            score -= 7
        elif avg_splh < 70:
            score -= 3

    if labor_opportunity > 550:
        score -= 12
    elif labor_opportunity > 400:
        score -= 8
    elif labor_opportunity > 250:
        score -= 4

    if wow_profit_delta is not None:
        if wow_profit_delta > 250:
            score += 4
        elif wow_profit_delta < -250:
            score -= 6

    return max(0, min(100, int(round(score))))


def _action_for(grade: str, margin_pct, labor_pct, labor_opportunity, wow_rev_delta, wow_profit_delta) -> str:
    if grade == "INFO ONLY":
        return "Upload Homebase timesheets to unlock grading"
    if margin_pct is not None and margin_pct < 10:
        return f"Margin only {margin_pct:.1f}% — cut labor or raise prices"
    if labor_pct is not None and labor_pct >= 40:
        return f"Labor at {labor_pct:.1f}% — cut weak shifts first"
    if labor_pct is not None and labor_pct >= 35:
        return f"Labor high at {labor_pct:.1f}% — tighten slow periods"
    if labor_opportunity > 250:
        return f"Up to ${labor_opportunity:.0f} in labor savings available"
    if wow_profit_delta is not None and wow_profit_delta < -250:
        return f"Profit down ${abs(wow_profit_delta):.0f} vs prior period — investigate"
    if wow_rev_delta is not None and wow_rev_delta < -500:
        return f"Revenue down ${abs(wow_rev_delta):.0f} vs prior — match staff to demand"
    if grade == "GREEN":
        return "Protect gains — hold labor line"
    return "Monitor"


@router.get("/elite-scorecards")
async def elite_scorecards(
    days: int = Query(7, ge=1, le=90),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    current_user: User = Depends(require_roles(UserRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    """Elite per-store P&L scorecards with grade + action item.

    Joins DailyRevenue + DailyLabor + Expense with SystemSettings
    (labor_burden_multiplier, cogs_percent) to compute each shop's
    margin, labor %, SPLH, and labor-opportunity figure. Grades via a
    100-point scorer. Returns per-store cards ordered by lowest margin
    first (so the shops that need attention sit at the top).
    """
    curr_start, curr_end = _resolve_window(days, start_date, end_date)
    span = (curr_end - curr_start).days + 1
    prev_end = curr_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=span - 1)

    # Resilient SystemSettings read — auto-create the row if missing so a
    # fresh / post-wipe DB doesn't crash this endpoint, and fall back to
    # conservative defaults if individual columns are NULL for any reason.
    settings_row = (await db.execute(select(SystemSettings).limit(1))).scalar_one_or_none()
    if settings_row is None:
        settings_row = SystemSettings(id=1)
        db.add(settings_row)
        await db.flush()
    burden = getattr(settings_row, "labor_burden_multiplier", None) or 1.25
    cogs_pct = getattr(settings_row, "cogs_percent", None) or 0.22

    locations = (await db.execute(
        select(Location).where(
            Location.canonical_short_name.isnot(None),
            (
                Location.godaddy_store_id.isnot(None)
                | Location.tapmango_location_id.isnot(None)
                | Location.doordash_store_id.isnot(None)
            ),
        ).order_by(Location.canonical_short_name)
    )).scalars().all()

    # Locate bakery + warehouse so we can fold their non-rent costs into
    # the revenue-share overhead pool. Bakery contributes LABOR only
    # (Adelia's shifts × burden) — its $1,000 rent is intentionally left
    # out. Warehouse contributes its full monthly expense line.
    all_support = (await db.execute(
        select(Location).where(
            Location.canonical_short_name.in_(("BAKERY", "WAREHOUSE"))
        )
    )).scalars().all()
    bakery_id = next((l.id for l in all_support if l.canonical_short_name == "BAKERY"), None)
    warehouse_id = next((l.id for l in all_support if l.canonical_short_name == "WAREHOUSE"), None)

    # One big revenue + labor fetch covering both windows
    rev_rows = (await db.execute(
        select(DailyRevenue).where(
            and_(DailyRevenue.date >= prev_start, DailyRevenue.date <= curr_end)
        )
    )).scalars().all()
    labor_rows = (await db.execute(
        select(DailyLabor).where(
            and_(DailyLabor.date >= prev_start, DailyLabor.date <= curr_end)
        )
    )).scalars().all()

    rev_by_loc: dict[int, list] = defaultdict(list)
    for r in rev_rows:
        rev_by_loc[r.location_id].append(r)
    labor_by_loc: dict[int, list] = defaultdict(list)
    for l in labor_rows:
        labor_by_loc[l.location_id].append(l)

    # Per-store expense totals (current snapshot — we prorate to the window)
    exp_rows = (await db.execute(select(Expense))).scalars().all()
    exp_monthly_by_loc: dict[int | None, float] = defaultdict(float)
    for e in exp_rows:
        exp_monthly_by_loc[e.location_id] += e.amount or 0.0

    def _window_split(rows, start_, end_):
        curr = [r for r in rows if curr_start <= r.date <= end_ and r.date >= start_]
        return curr

    def _rollup(rev_curr, labor_curr, monthly_expense: float, window_days: int):
        gross = sum((r.gross_revenue or 0.0) for r in rev_curr)
        txns = sum((r.transaction_count or 0) for r in rev_curr)
        hours = sum((l.total_hours or 0.0) for l in labor_curr)
        raw_labor = sum((l.labor_cost or 0.0) for l in labor_curr)
        fully_loaded = raw_labor * burden
        cogs = gross * cogs_pct
        prorated_exp = (monthly_expense / 30.44) * window_days
        return {
            "gross": round(gross, 2),
            "transactions": txns,
            "hours": round(hours, 2),
            "raw_labor": round(raw_labor, 2),
            "fully_loaded_labor": round(fully_loaded, 2),
            "cogs": round(cogs, 2),
            "prorated_expenses": round(prorated_exp, 2),
            "_gross": gross,
            "_fully_loaded": fully_loaded,
            "_cogs": cogs,
            "_prorated_exp": prorated_exp,
        }

    def _finalize(rollup: dict, shared_share: float):
        gross = rollup.pop("_gross")
        fully_loaded = rollup.pop("_fully_loaded")
        cogs = rollup.pop("_cogs")
        prorated_exp = rollup.pop("_prorated_exp")
        profit = gross - cogs - fully_loaded - prorated_exp - shared_share
        margin = (profit / gross * 100.0) if gross else None
        labor_pct = (fully_loaded / gross * 100.0) if gross else None
        splh = (gross / rollup["hours"]) if rollup["hours"] else None
        opp = max(0.0, fully_loaded - gross * TARGET_LABOR_PCT)
        rollup["shared_overhead_share"] = round(shared_share, 2)
        rollup["profit"] = round(profit, 2)
        rollup["margin_pct"] = round(margin, 1) if margin is not None else None
        rollup["labor_pct"] = round(labor_pct, 1) if labor_pct is not None else None
        rollup["avg_splh"] = round(splh, 2) if splh is not None else None
        rollup["labor_opportunity"] = round(opp, 2)
        return rollup

    # Revenue-share overhead pool: company-level expenses (no location) +
    # warehouse expenses + bakery labor (burden-loaded) for each window.
    # Bakery's own rent is intentionally excluded — it's a dedicated cost
    # center that already carries its own roof.
    company_monthly = exp_monthly_by_loc.get(None, 0.0)
    warehouse_monthly = exp_monthly_by_loc.get(warehouse_id, 0.0) if warehouse_id else 0.0
    shared_monthly = company_monthly + warehouse_monthly

    def _bakery_labor_for(start_, end_) -> float:
        if not bakery_id:
            return 0.0
        rows = [
            l for l in labor_by_loc.get(bakery_id, [])
            if start_ <= l.date <= end_
        ]
        return sum((l.labor_cost or 0.0) for l in rows) * burden

    bakery_labor_curr = _bakery_labor_for(curr_start, curr_end)
    bakery_labor_prev = _bakery_labor_for(prev_start, prev_end)

    total_shared_curr = (shared_monthly / 30.44) * span + bakery_labor_curr
    total_shared_prev = (shared_monthly / 30.44) * span + bakery_labor_prev

    # 28-day trailing sparkline window (always 28 days ending at curr_end,
    # independent of the selected period). Daily profit per location is
    # estimated as: gross − COGS − labor*burden − own monthly/30.44
    # − share of (shared overhead + bakery labor) by 28-day revenue share.
    # Window-share allocation keeps the daily series stable instead of
    # bouncing when a single shop has a slow Tuesday.
    SPARK_DAYS = 28
    spark_end = curr_end
    spark_start = spark_end - timedelta(days=SPARK_DAYS - 1)
    spark_rev_rows = (await db.execute(
        select(DailyRevenue).where(
            and_(DailyRevenue.date >= spark_start, DailyRevenue.date <= spark_end)
        )
    )).scalars().all()
    spark_labor_rows = (await db.execute(
        select(DailyLabor).where(
            and_(DailyLabor.date >= spark_start, DailyLabor.date <= spark_end)
        )
    )).scalars().all()
    spark_rev_by_loc_day: dict[tuple[int, object], float] = defaultdict(float)
    for r in spark_rev_rows:
        spark_rev_by_loc_day[(r.location_id, r.date)] += r.gross_revenue or 0.0
    spark_labor_by_loc_day: dict[tuple[int, object], float] = defaultdict(float)
    for l in spark_labor_rows:
        spark_labor_by_loc_day[(l.location_id, l.date)] += l.labor_cost or 0.0
    spark_loc_total_rev: dict[int, float] = defaultdict(float)
    for (loc_id, _date), gross in spark_rev_by_loc_day.items():
        spark_loc_total_rev[loc_id] += gross
    spark_total_rev = sum(spark_loc_total_rev.values())
    spark_bakery_labor_total = sum(
        (spark_labor_by_loc_day.get((bakery_id, spark_start + timedelta(days=i)), 0.0))
        for i in range(SPARK_DAYS)
    ) * burden if bakery_id else 0.0
    spark_daily_shared = shared_monthly / 30.44
    spark_daily_bakery = (spark_bakery_labor_total / SPARK_DAYS) if SPARK_DAYS else 0.0

    def _profit_sparkline(loc_id: int, monthly_exp: float) -> list[float]:
        loc_share = (spark_loc_total_rev.get(loc_id, 0.0) / spark_total_rev) if spark_total_rev else 0.0
        daily_share = (spark_daily_shared + spark_daily_bakery) * loc_share
        daily_own = monthly_exp / 30.44
        out: list[float] = []
        for i in range(SPARK_DAYS):
            d = spark_start + timedelta(days=i)
            gross = spark_rev_by_loc_day.get((loc_id, d), 0.0)
            labor = spark_labor_by_loc_day.get((loc_id, d), 0.0) * burden
            cogs = gross * cogs_pct
            profit = gross - cogs - labor - daily_own - daily_share
            out.append(round(profit, 2))
        return out

    # First pass: build raw rollups, capture per-shop window revenue.
    pending = []
    for loc in locations:
        monthly_exp = exp_monthly_by_loc.get(loc.id, 0.0)
        rev_curr = _window_split(rev_by_loc.get(loc.id, []), curr_start, curr_end)
        rev_prev = [r for r in rev_by_loc.get(loc.id, []) if prev_start <= r.date <= prev_end]
        labor_curr = [l for l in labor_by_loc.get(loc.id, []) if curr_start <= l.date <= curr_end]
        labor_prev = [l for l in labor_by_loc.get(loc.id, []) if prev_start <= l.date <= prev_end]
        pending.append({
            "loc": loc,
            "curr": _rollup(rev_curr, labor_curr, monthly_exp, span),
            "prev": _rollup(rev_prev, labor_prev, monthly_exp, span),
            "labor_prev": labor_prev,
        })

    total_rev_curr = sum(p["curr"]["_gross"] for p in pending)
    total_rev_prev = sum(p["prev"]["_gross"] for p in pending)

    scorecards = []
    for p in pending:
        loc = p["loc"]
        share_curr = (p["curr"]["_gross"] / total_rev_curr * total_shared_curr) if total_rev_curr else 0.0
        share_prev = (p["prev"]["_gross"] / total_rev_prev * total_shared_prev) if total_rev_prev else 0.0
        curr = _finalize(p["curr"], share_curr)
        prev = _finalize(p["prev"], share_prev)
        labor_prev = p["labor_prev"]

        wow_rev = curr["gross"] - prev["gross"]
        wow_profit = curr["profit"] - prev["profit"]

        has_labor = curr["hours"] > 0
        score = _manager_score(
            curr["margin_pct"], curr["labor_pct"], curr["avg_splh"],
            curr["labor_opportunity"], wow_profit if labor_prev else None,
        )
        grade = _grade(score, has_labor)
        action = _action_for(
            grade, curr["margin_pct"], curr["labor_pct"],
            curr["labor_opportunity"], wow_rev, wow_profit,
        )

        scorecards.append({
            "location_id": loc.id,
            "name": loc.name,
            "canonical_short_name": loc.canonical_short_name,
            "current": curr,
            "previous": prev,
            "wow_revenue_delta": round(wow_rev, 2),
            "wow_profit_delta": round(wow_profit, 2),
            "score": score,
            "grade": grade,
            "primary_action": action,
            "profit_sparkline_28d": _profit_sparkline(
                loc.id, exp_monthly_by_loc.get(loc.id, 0.0)
            ),
        })

    # Sort: ungraded first, then by margin ascending (neediest first)
    def _sort_key(s):
        g = s["grade"]
        rank = {"INFO ONLY": 0, "RED": 1, "ORANGE": 2, "YELLOW": 3, "GREEN": 4}.get(g, 5)
        margin = s["current"]["margin_pct"]
        return (rank, margin if margin is not None else 999)
    scorecards.sort(key=_sort_key)

    # Top-5 priority actions queue
    priority_queue = []
    for s in scorecards:
        if s["grade"] in ("RED", "ORANGE"):
            priority_queue.append({
                "store": s["name"],
                "short_name": s["canonical_short_name"],
                "grade": s["grade"],
                "score": s["score"],
                "action": s["primary_action"],
                "labor_opportunity": s["current"]["labor_opportunity"],
            })

    # Company roll-up
    company_gross = sum(s["current"]["gross"] for s in scorecards)
    company_profit = sum(s["current"]["profit"] for s in scorecards)
    company_labor_opp = sum(s["current"]["labor_opportunity"] for s in scorecards)
    company_margin = (company_profit / company_gross * 100.0) if company_gross else None
    projected = company_profit + company_labor_opp

    return {
        "window": {
            "start": curr_start.isoformat(),
            "end": curr_end.isoformat(),
            "days": span,
        },
        "settings": {
            "labor_burden_multiplier": burden,
            "cogs_percent": cogs_pct,
            "target_labor_pct": TARGET_LABOR_PCT,
            "shared_overhead_allocation": "revenue_share",
            "shared_overhead_includes": [
                "company_expenses",
                "warehouse_expenses",
                "bakery_labor_burdened",
            ],
            "shared_overhead_excludes": ["bakery_rent"],
        },
        "company": {
            "gross": round(company_gross, 2),
            "profit": round(company_profit, 2),
            "margin_pct": round(company_margin, 1) if company_margin is not None else None,
            "labor_opportunity": round(company_labor_opp, 2),
            "projected_profit_if_fixed": round(projected, 2),
            "shared_overhead_pool": round(total_shared_curr, 2),
            "shared_overhead_monthly": round(shared_monthly, 2),
            "bakery_labor_window": round(bakery_labor_curr, 2),
        },
        "scorecards": scorecards,
        "priority_queue": priority_queue[:5],
    }
