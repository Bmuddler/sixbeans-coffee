"""One-time helper to capture a Playwright storage_state from your PC.

Usage:
    pip install playwright
    playwright install chromium
    python capture_session.py godaddy
    python capture_session.py tapmango

Opens a Chromium window, you log in manually, then press Enter in the
terminal. The storage_state JSON is written to clipboard AND saved to
a file next to this script. Paste it into the Analytics Setup admin page.
"""

import asyncio
import json
import sys
from pathlib import Path


TARGETS = {
    "godaddy": {
        "label": "GoDaddy Commerce",
        "url": "https://spa.commerce.godaddy.com/home",
    },
    "tapmango": {
        "label": "TapMango Portal",
        "url": "https://portal.tapmango.com/Orders/Index",
    },
}


async def capture(source: str) -> None:
    target = TARGETS[source]
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("ERROR: Playwright not installed. Run:")
        print("  pip install playwright")
        print("  playwright install chromium")
        sys.exit(1)

    async with async_playwright() as pw:
        # Launch with anti-detection flags — GoDaddy's bot filter blocks
        # the default Playwright Chromium otherwise.
        browser = await pw.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ],
        )
        context = await browser.new_context(
            accept_downloads=True,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )
        # Remove the navigator.webdriver flag that gives away automation
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        page = await context.new_page()

        print(f"\nOpening {target['label']}…")
        await page.goto(target["url"], wait_until="domcontentloaded")

        print("\n" + "=" * 60)
        print(f"Log in to {target['label']} in the browser window.")
        print("Once you're fully logged in and can see your account,")
        print("come back here and press Enter.")
        print("=" * 60)
        input("\nPress Enter once logged in... ")

        storage_state = await context.storage_state()
        await browser.close()

    # Save to file
    out_path = Path(__file__).parent / f"{source}_storage_state.json"
    out_path.write_text(json.dumps(storage_state, indent=2))

    # Also print so user can copy
    json_str = json.dumps(storage_state)
    print(f"\nSaved to: {out_path}")
    print(f"File size: {out_path.stat().st_size} bytes")
    print(f"Cookies captured: {len(storage_state.get('cookies', []))}")

    # Try to copy to clipboard on Windows
    try:
        import subprocess
        proc = subprocess.Popen(["clip"], stdin=subprocess.PIPE)
        proc.communicate(input=json_str.encode("utf-8"))
        print("\n✓ storage_state JSON copied to clipboard.")
    except Exception:
        print("\n(Could not auto-copy to clipboard — open the file above and copy the contents.)")

    print("\nNext step:")
    print("  1. Go to sixbeans.onrender.com/portal/admin/analytics")
    print(f"  2. Click 'Upload cookies' on the {target['label']} card")
    print("  3. Paste the JSON and save")


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in TARGETS:
        print("Usage: python capture_session.py [godaddy|tapmango]")
        sys.exit(1)
    asyncio.run(capture(sys.argv[1]))


if __name__ == "__main__":
    main()
