"""Daily analytics health check — emails the owner if yesterday's data didn't sync.

Runs on a separate Render cron at 8 AM Pacific (= 15:00 UTC PDT /
16:00 UTC PST). Checks whether the Cowork tasks on the owner's PC
successfully uploaded yesterday's GoDaddy Transactions Report and
TapMango Orders CSV. If either source is missing or failed, emails
logcastles@gmail.com via the already-connected Gmail OAuth account.

The DoorDash channel is deliberately ignored here — it's a weekly
watcher, not daily, so its absence is normal.

Invocation:
    python -m scripts.alert_if_missing
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta

import pytz
from sqlalchemy import and_, select

from app.database import async_session
from app.config import settings
from app.models.daily_revenue import CHANNEL_GODADDY, CHANNEL_TAPMANGO, DailyRevenue
from app.models.ingestion_run import (
    IngestionRun, SOURCE_GODADDY, SOURCE_TAPMANGO_ORDERS, STATUS_SUCCESS,
)
from app.services.gmail_watcher import send_email

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

SOURCES_TO_CHECK = [
    ("GoDaddy", SOURCE_GODADDY, CHANNEL_GODADDY),
    ("TapMango Orders", SOURCE_TAPMANGO_ORDERS, CHANNEL_TAPMANGO),
]


def _pacific_yesterday() -> date:
    return (datetime.now(pytz.timezone("America/Los_Angeles")) - timedelta(days=1)).date()


async def _source_is_healthy(db, source: str, channel: str, target_date: date) -> tuple[bool, str]:
    """Return (healthy, reason). Healthy means a success run + any DailyRevenue rows."""
    run = (await db.execute(
        select(IngestionRun)
        .where(and_(
            IngestionRun.source == source,
            IngestionRun.target_date == target_date,
            IngestionRun.status == STATUS_SUCCESS,
        ))
        .order_by(IngestionRun.started_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    if not run:
        return False, "no successful ingestion run recorded"

    rev_count = (await db.execute(
        select(DailyRevenue.id)
        .where(and_(DailyRevenue.date == target_date, DailyRevenue.channel == channel))
    )).all()
    if not rev_count:
        return False, f"ingestion ran at {run.started_at.isoformat()}Z but no DailyRevenue rows landed"

    return True, f"{len(rev_count)} stores ingested at {run.started_at.isoformat()}Z"


async def main() -> int:
    target = _pacific_yesterday()
    problems: list[tuple[str, str]] = []
    summary_lines: list[str] = []

    async with async_session() as db:
        for label, source, channel in SOURCES_TO_CHECK:
            healthy, reason = await _source_is_healthy(db, source, channel, target)
            summary_lines.append(f"  {label}: {'OK' if healthy else 'MISSING'} — {reason}")
            if not healthy:
                problems.append((label, reason))

        summary = "\n".join(summary_lines)
        logger.info("Health check for %s:\n%s", target, summary)

        if not problems:
            logger.info("All sources healthy — no alert sent.")
            return 0

        subject = f"[Six Beans] Analytics sync missing for {target.isoformat()}"
        body = (
            f"One or more analytics sources did not sync for {target.isoformat()} (Pacific).\n\n"
            f"Status per source:\n{summary}\n\n"
            "Next steps:\n"
            "  * GoDaddy / TapMango rely on the Cowork tasks on Brian's PC.\n"
            "  * Check Windows Task Scheduler: are six-beans-godaddy-nightly and\n"
            "    six-beans-tapmango-nightly enabled and did they run last night?\n"
            "  * If a task ran but failed, check its upload_log.txt under\n"
            "    C:\\Users\\logca\\Documents\\Claude\\Projects\\<task>\\outputs\\<date>\\\n"
            "  * Most common cause: the portal session expired — open the portal\n"
            "    in the task's persistent Chrome profile and log in, then re-run\n"
            "    the scheduled task manually.\n\n"
            "Dashboard: https://sixbeanscoffee.com/portal/admin/analytics\n"
        )

        try:
            await send_email(
                db,
                to=settings.analytics_alert_recipient,
                subject=subject,
                body=body,
            )
        except Exception:
            logger.exception("Failed to send alert email")
            return 2

    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
