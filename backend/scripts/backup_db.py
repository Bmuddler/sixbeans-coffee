"""Weekly Postgres backup — pg_dump, then email the file to the owner.

Runs as a Render cron (see render.yaml). Uses the already-wired Gmail
OAuth account to deliver the dump as an attachment so no new secrets
or storage buckets are required. The dump is in pg_dump custom format
(-Fc) which is compressed and restorable via pg_restore.

To restore on a fresh Postgres instance:
    pg_restore --clean --if-exists --no-owner -d "<new DATABASE_URL>" sixbeans-YYYY-MM-DD.dump

Invocation:
    python -m scripts.backup_db
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
import tempfile
from datetime import date, datetime

import pytz

from app.config import settings
from app.database import async_session
from app.services.gmail_watcher import send_email, send_email_with_attachment

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

RECIPIENT = os.environ.get("BACKUP_RECIPIENT", settings.analytics_alert_recipient)


def _pacific_today() -> date:
    return datetime.now(pytz.timezone("America/Los_Angeles")).date()


def _dump_database(database_url: str, out_path: str) -> None:
    """Run pg_dump in custom format. Raises CalledProcessError on failure."""
    # -Fc  = custom format (compressed, pg_restore-friendly)
    # -Z 9 = max compression
    # --no-owner / --no-acl so the dump restores cleanly onto a fresh DB
    cmd = [
        "pg_dump",
        "-Fc",
        "-Z", "9",
        "--no-owner",
        "--no-acl",
        "-f", out_path,
        database_url,
    ]
    logger.info("Running pg_dump → %s", out_path)
    subprocess.run(cmd, check=True, capture_output=True, text=True)


async def main() -> int:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL not set")
        return 1

    # pg_dump wants postgresql:// not postgres://
    if database_url.startswith("postgres://"):
        database_url = "postgresql://" + database_url[len("postgres://"):]

    today = _pacific_today()
    filename = f"sixbeans-{today.isoformat()}.dump"

    with tempfile.TemporaryDirectory() as tmp:
        dump_path = os.path.join(tmp, filename)
        try:
            _dump_database(database_url, dump_path)
        except subprocess.CalledProcessError as exc:
            logger.error("pg_dump failed (exit %s): %s", exc.returncode, exc.stderr)
            try:
                async with async_session() as db:
                    await send_email(
                        db,
                        to=RECIPIENT,
                        subject=f"[Six Beans] Weekly DB backup FAILED {today.isoformat()}",
                        body=(
                            f"pg_dump exited with code {exc.returncode}.\n\n"
                            f"stderr:\n{exc.stderr}\n\n"
                            "No dump file was produced. Check the Render cron logs "
                            "and run a manual pg_dump from your PC until this is fixed."
                        ),
                    )
            except Exception:
                logger.exception("Failed to send failure-alert email")
            return 1

        size_mb = os.path.getsize(dump_path) / 1024 / 1024
        logger.info("Dump complete — %.2f MB", size_mb)

        async with async_session() as db:
            await send_email_with_attachment(
                db,
                to=RECIPIENT,
                subject=f"[Six Beans] Weekly DB backup {today.isoformat()} ({size_mb:.1f} MB)",
                body=(
                    f"Attached is the weekly Six Beans database backup for {today.isoformat()}.\n\n"
                    f"File: {filename}\n"
                    f"Size: {size_mb:.2f} MB\n"
                    f"Format: pg_dump custom (-Fc), restore with pg_restore.\n\n"
                    "To restore onto a fresh Postgres:\n"
                    f'  pg_restore --clean --if-exists --no-owner -d "<new DATABASE_URL>" {filename}\n\n'
                    "Keep this email — Gmail retention is your backup history."
                ),
                attachment_path=dump_path,
                attachment_name=filename,
            )

    logger.info("Backup email sent to %s", RECIPIENT)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
