"""Shared helpers for the Playwright scrapers.

Responsibilities:
  - Load the encrypted storage_state from the DB vault and inject it
    into a Playwright context so the scraper is already logged in.
  - Detect "redirected back to login" as the canonical "session expired"
    signal and mark the vault row failed so the admin page can prompt
    for a re-auth.
  - Return the Playwright browser / context / page triple so the concrete
    scrapers can focus on the site-specific click sequence.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from playwright.async_api import Browser, BrowserContext, Page, async_playwright
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.scraper_session_vault import (
    VaultError,
    load_session,
    mark_session_failed,
    mark_session_used,
)

logger = logging.getLogger(__name__)


class SessionExpiredError(Exception):
    """Raised when the scraper detects it has been redirected to a login page."""


@asynccontextmanager
async def playwright_context_for_source(
    db: AsyncSession,
    source: str,
    headless: bool = True,
    downloads_dir: str | None = None,
) -> AsyncIterator[tuple[Browser, BrowserContext, Page]]:
    """Yield a (browser, context, page) preloaded with cookies for `source`.

    Usage:
        async with playwright_context_for_source(db, "godaddy") as (b, ctx, page):
            await page.goto(...)

    If no session is stored or it can't be decrypted, raises VaultError.
    The caller is expected to catch that and surface a "Reconnect needed"
    state via the IngestionRun error_message.
    """
    try:
        storage_state = await load_session(db, source)
    except VaultError:
        raise

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=headless,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        context = await browser.new_context(
            storage_state=storage_state,
            accept_downloads=True,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        page = await context.new_page()
        try:
            yield browser, context, page
        finally:
            await context.close()
            await browser.close()


async def capture_and_save_session(
    db: AsyncSession,
    source: str,
    captured_by_user_id: int | None,
    headless: bool = False,
    login_url: str = "",
    ready_selector: str = "",
    login_timeout_s: int = 300,
) -> None:
    """Open a visible Playwright browser, wait for the owner to log in,
    then save the resulting cookies to the vault.

    Intended to be called from an admin page endpoint that streams progress.
    Only used in local / developer workflows — production uses a browser
    snapshot uploaded from the owner's machine (see admin page).
    """
    from app.services.scraper_session_vault import save_session

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto(login_url, wait_until="domcontentloaded")
        logger.info("Waiting up to %ds for login to complete...", login_timeout_s)

        if ready_selector:
            await page.wait_for_selector(ready_selector, timeout=login_timeout_s * 1000)

        storage_state = await context.storage_state()
        await save_session(db, source, storage_state, captured_by_user_id)

        await context.close()
        await browser.close()


async def report_success(db: AsyncSession, source: str) -> None:
    await mark_session_used(db, source)


async def report_expired(db: AsyncSession, source: str, reason: str) -> None:
    await mark_session_failed(db, source, reason)
    raise SessionExpiredError(reason)
