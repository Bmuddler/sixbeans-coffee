"""Gmail watcher for the weekly DoorDash merchant report.

DoorDash emails a .zip containing 4 CSVs to blend556@gmail.com every
Monday. This service polls the inbox, downloads the latest matching
attachment, and returns the extracted CSV contents for the parsers.

Auth is a standard Google OAuth 2.0 refresh-token flow:
  1. Admin page redirects the owner to Google's consent screen
  2. Google returns an auth code to our callback endpoint
  3. We exchange it for access + refresh tokens; store the refresh token
     encrypted in the DB (reusing scraper_session_vault)
  4. Nightly, we use the refresh token to get a fresh access token and
     call the Gmail API

Scopes requested: gmail.readonly (enough to read + download attachments)
"""

import base64
import io
import logging
import zipfile
from datetime import datetime, timedelta
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.scraper_session_vault import load_session, save_session

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
VAULT_SOURCE = "gmail_oauth"  # key under which we store the refresh token


def get_oauth_redirect_uri() -> str:
    return settings.gmail_oauth_redirect_uri


def build_authorization_url() -> str:
    """Return the Google consent URL for the one-time owner consent flow."""
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.gmail_oauth_client_id,
                "client_secret": settings.gmail_oauth_client_secret,
                "redirect_uris": [settings.gmail_oauth_redirect_uri],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=SCOPES,
        redirect_uri=settings.gmail_oauth_redirect_uri,
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",  # force refresh_token issuance even if re-consenting
    )
    return auth_url


async def exchange_code_for_tokens(db: AsyncSession, code: str, user_id: int | None = None) -> dict:
    """Exchange an OAuth code for tokens and stash the refresh token in the vault."""
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.gmail_oauth_client_id,
                "client_secret": settings.gmail_oauth_client_secret,
                "redirect_uris": [settings.gmail_oauth_redirect_uri],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=SCOPES,
        redirect_uri=settings.gmail_oauth_redirect_uri,
    )
    flow.fetch_token(code=code)
    creds = flow.credentials

    payload = {
        "refresh_token": creds.refresh_token,
        "access_token": creds.token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }
    await save_session(db, VAULT_SOURCE, payload, captured_by_user_id=user_id)
    return {"ok": True}


async def _get_gmail_service(db: AsyncSession):
    """Build an authorized Gmail API client using the vault-stored refresh token."""
    creds_data = await load_session(db, VAULT_SOURCE)
    creds = Credentials(
        token=creds_data.get("access_token"),
        refresh_token=creds_data["refresh_token"],
        token_uri=creds_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=creds_data.get("client_id") or settings.gmail_oauth_client_id,
        client_secret=creds_data.get("client_secret") or settings.gmail_oauth_client_secret,
        scopes=creds_data.get("scopes", SCOPES),
    )
    if not creds.valid or creds.expired:
        creds.refresh(Request())
        # Save the refreshed access token
        creds_data["access_token"] = creds.token
        creds_data["expiry"] = creds.expiry.isoformat() if creds.expiry else None
        await save_session(db, VAULT_SOURCE, creds_data)

    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _find_newest_matching_message(service, query: str) -> dict | None:
    """Return the newest Gmail message matching `query`, or None."""
    try:
        resp = service.users().messages().list(userId="me", q=query, maxResults=10).execute()
    except HttpError as exc:
        logger.error("Gmail list failed: %s", exc)
        return None

    messages = resp.get("messages", [])
    if not messages:
        return None

    # The list endpoint returns IDs only; fetch the full message
    msg_id = messages[0]["id"]
    return service.users().messages().get(userId="me", id=msg_id, format="full").execute()


def _extract_attachment_bytes(service, message_id: str, attachment_id: str) -> bytes | None:
    try:
        att = service.users().messages().attachments().get(
            userId="me", messageId=message_id, id=attachment_id,
        ).execute()
    except HttpError as exc:
        logger.error("Gmail attachment fetch failed: %s", exc)
        return None

    data = att.get("data")
    if not data:
        return None
    # Gmail uses URL-safe base64
    return base64.urlsafe_b64decode(data)


def _walk_parts(part: dict):
    """Yield every part in a Gmail message tree."""
    yield part
    for child in part.get("parts", []) or []:
        yield from _walk_parts(child)


async def fetch_latest_doordash_zip(db: AsyncSession, since_days: int = 14) -> dict[str, bytes] | None:
    """Find the most recent DoorDash merchant report email in the last N days
    and return its 4 CSV files as {filename: bytes}.

    Returns None if no matching email is found.
    """
    service = await _get_gmail_service(db)

    # Search: from the DoorDash sender, has an attachment, recent
    after = (datetime.utcnow() - timedelta(days=since_days)).strftime("%Y/%m/%d")
    query = (
        f"from:{settings.doordash_report_from_email} "
        f"has:attachment "
        f"after:{after}"
    )
    message = _find_newest_matching_message(service, query)
    if not message:
        logger.info("No DoorDash email found since %s", after)
        return None

    # Walk every part, pull the first attachment that looks like a zip
    zip_bytes: bytes | None = None
    zip_filename: str | None = None
    for part in _walk_parts(message.get("payload", {})):
        filename = part.get("filename", "")
        if not filename:
            continue
        body = part.get("body", {})
        attachment_id = body.get("attachmentId")
        if not attachment_id:
            continue

        lower = filename.lower()
        if lower.endswith(".zip"):
            zip_bytes = _extract_attachment_bytes(service, message["id"], attachment_id)
            zip_filename = filename
            break

    if not zip_bytes:
        # Some DoorDash reports attach individual CSVs instead of a zip;
        # collect those directly.
        csvs: dict[str, bytes] = {}
        for part in _walk_parts(message.get("payload", {})):
            filename = part.get("filename", "")
            if not filename.lower().endswith(".csv"):
                continue
            body = part.get("body", {})
            attachment_id = body.get("attachmentId")
            if not attachment_id:
                continue
            data = _extract_attachment_bytes(service, message["id"], attachment_id)
            if data:
                csvs[filename] = data
        return csvs or None

    # Extract CSVs from the zip in memory
    csvs: dict[str, bytes] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for info in zf.infolist():
            if info.filename.lower().endswith(".csv"):
                csvs[info.filename] = zf.read(info.filename)

    logger.info(
        "Fetched DoorDash zip '%s' with %d CSVs", zip_filename, len(csvs),
    )
    return csvs
