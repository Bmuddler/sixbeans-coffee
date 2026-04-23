"""Encrypted vault for Playwright scraper session cookies.

Flow:
  1. Owner logs into GoDaddy/TapMango once via an admin page.
  2. We call save_session(source, storage_state_json) — the cookies are
     encrypted with SCRAPER_SESSION_ENCRYPTION_KEY and stored in the DB.
  3. Nightly cron service calls load_session(source) to get the cookies
     back, injects them into a Playwright context, and scrapes without
     needing to log in again.
  4. If the cookies have expired, the scraper catches the "redirected to
     login page" signal, marks the session failed, and the admin page
     shows a "Reconnect" button for the owner.

Encryption uses Fernet (symmetric AES-128-CBC + HMAC from the `cryptography`
package). The key is a URL-safe 32-byte base64 secret in env var
SCRAPER_SESSION_ENCRYPTION_KEY — generate with:
    python -c "import secrets; print(secrets.token_urlsafe(32))"
"""

import base64
import hashlib
import json
import logging
from datetime import datetime

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.scraper_session import ScraperSession

logger = logging.getLogger(__name__)


class VaultError(Exception):
    """Raised when the vault can't encrypt, decrypt, or find a session."""


def _get_fernet() -> Fernet:
    """Derive a Fernet key from the configured secret.

    `Fernet` requires a 32-byte urlsafe base64 key. We accept any strong
    secret and hash it to that format so the operator doesn't have to
    generate the key in a specific way.
    """
    secret = settings.scraper_session_encryption_key
    if not secret:
        raise VaultError(
            "SCRAPER_SESSION_ENCRYPTION_KEY is not set — cannot encrypt sessions"
        )
    digest = hashlib.sha256(secret.encode()).digest()  # 32 bytes
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


async def save_session(
    db: AsyncSession,
    source: str,
    storage_state: dict,
    captured_by_user_id: int | None = None,
) -> ScraperSession:
    """Encrypt and store a Playwright storage_state dict for later reuse.

    `storage_state` is the JSON-serializable dict returned by
    `context.storage_state()` in Playwright — it contains cookies,
    localStorage, and session metadata.
    """
    fernet = _get_fernet()
    raw = json.dumps(storage_state).encode()
    encrypted = fernet.encrypt(raw)

    # Upsert by source — one active session per source
    result = await db.execute(
        select(ScraperSession).where(ScraperSession.source == source)
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.encrypted_cookies = encrypted
        existing.captured_by_user_id = captured_by_user_id
        existing.captured_at = datetime.utcnow()
        existing.last_failure_at = None
        existing.last_failure_reason = None
        session = existing
    else:
        session = ScraperSession(
            source=source,
            encrypted_cookies=encrypted,
            captured_by_user_id=captured_by_user_id,
        )
        db.add(session)

    await db.flush()
    await db.commit()
    logger.info("Saved scraper session for source=%s", source)
    return session


async def load_session(db: AsyncSession, source: str) -> dict:
    """Decrypt and return the Playwright storage_state for `source`.

    Raises VaultError if no session exists or decryption fails.
    """
    result = await db.execute(
        select(ScraperSession).where(ScraperSession.source == source)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise VaultError(f"No session stored for source={source}")

    fernet = _get_fernet()
    try:
        raw = fernet.decrypt(row.encrypted_cookies)
    except InvalidToken as exc:
        raise VaultError(
            f"Session for source={source} could not be decrypted — "
            f"SCRAPER_SESSION_ENCRYPTION_KEY may have changed."
        ) from exc

    try:
        return json.loads(raw.decode())
    except Exception as exc:
        raise VaultError(f"Session for source={source} is not valid JSON: {exc}") from exc


async def mark_session_used(db: AsyncSession, source: str) -> None:
    """Record that a scraper successfully used this session."""
    result = await db.execute(
        select(ScraperSession).where(ScraperSession.source == source)
    )
    row = result.scalar_one_or_none()
    if row:
        row.last_used_at = datetime.utcnow()
        row.last_failure_at = None
        row.last_failure_reason = None
        await db.commit()


async def mark_session_failed(db: AsyncSession, source: str, reason: str) -> None:
    """Record that a scraper failed (e.g. cookies expired, redirected to login)."""
    result = await db.execute(
        select(ScraperSession).where(ScraperSession.source == source)
    )
    row = result.scalar_one_or_none()
    if row:
        row.last_failure_at = datetime.utcnow()
        row.last_failure_reason = reason[:500]
        await db.commit()
    logger.warning("Scraper session failed for source=%s: %s", source, reason)


async def session_status(db: AsyncSession, source: str) -> dict:
    """Return metadata about the stored session for the admin page.

    Does NOT decrypt — safe to return to the frontend.
    """
    result = await db.execute(
        select(ScraperSession).where(ScraperSession.source == source)
    )
    row = result.scalar_one_or_none()
    if not row:
        return {
            "source": source,
            "connected": False,
            "captured_at": None,
            "last_used_at": None,
            "last_failure_at": None,
            "last_failure_reason": None,
        }
    return {
        "source": source,
        "connected": row.last_failure_at is None or (
            row.last_used_at is not None and
            (row.last_failure_at is None or row.last_used_at > row.last_failure_at)
        ),
        # Stored as naive UTC; suffix 'Z' so browsers parse as UTC, not local.
        "captured_at": row.captured_at.isoformat() + "Z" if row.captured_at else None,
        "last_used_at": row.last_used_at.isoformat() + "Z" if row.last_used_at else None,
        "last_failure_at": row.last_failure_at.isoformat() + "Z" if row.last_failure_at else None,
        "last_failure_reason": row.last_failure_reason,
    }
