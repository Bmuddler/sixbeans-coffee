"""
US Foods Local Agent
Runs on your PC. Polls the Six Beans API for pending jobs,
downloads CSV, runs Playwright to upload/validate on US Foods,
posts results back.

Setup:
  pip install httpx playwright
  playwright install chromium

Usage:
  python usfoods_agent.py --api-url https://sixbeans-api.onrender.com/api --agent-key YOUR_JWT_SECRET_KEY

  For testing (fake upload only, never submits):
  python usfoods_agent.py --api-url ... --agent-key ... --dry-run
"""

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("usfoods_agent.log"),
    ],
)
logger = logging.getLogger(__name__)

POLL_INTERVAL = 30  # seconds
USFOODS_HOME = "https://order.usfoods.com/desktop/home"
PROFILE_DIR = os.path.join(os.path.dirname(__file__), ".chrome_profile")


async def poll_for_jobs(api_url: str, agent_key: str, dry_run: bool = False):
    """Main loop: poll API for pending jobs and process them."""
    headers = {"X-Agent-Key": agent_key}

    logger.info("US Foods Agent started. Polling %s every %ds...", api_url, POLL_INTERVAL)
    logger.info("Dry run: %s", dry_run)
    logger.info("Chrome profile: %s", PROFILE_DIR)

    while True:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(f"{api_url}/usfoods/agent/pending", headers=headers)

                if resp.status_code != 200:
                    logger.error("Failed to poll: %s %s", resp.status_code, resp.text)
                    await asyncio.sleep(POLL_INTERVAL)
                    continue

                job = resp.json()

                if job.get("job_type") is None:
                    await asyncio.sleep(POLL_INTERVAL)
                    continue

                job_type = job["job_type"]
                run_id = job["run_id"]
                csv_data = job.get("csv_data", "")

                logger.info("Got job: %s for run %d", job_type, run_id)

                # Write CSV to temp file
                csv_path = os.path.join(tempfile.gettempdir(), f"usfoods_import_{run_id}.csv")
                with open(csv_path, "w", newline="") as f:
                    f.write(csv_data)
                logger.info("CSV written to %s", csv_path)

                if job_type == "validate":
                    validation = await run_playwright_upload(csv_path, submit=False)
                    # Post results back
                    await client.post(
                        f"{api_url}/usfoods/agent/validation-result",
                        headers=headers,
                        json={
                            "run_id": run_id,
                            "results": validation.get("products", []),
                            "raw_json": json.dumps(validation),
                        },
                    )
                    logger.info("Validation results posted for run %d", run_id)

                elif job_type == "submit":
                    if dry_run:
                        logger.info("DRY RUN: would submit run %d, skipping", run_id)
                        await client.post(
                            f"{api_url}/usfoods/agent/submit-result",
                            headers=headers,
                            json={"run_id": run_id, "success": False, "message": "Dry run - submit skipped"},
                        )
                    else:
                        result = await run_playwright_upload(csv_path, submit=True)
                        success = result.get("submitted", False)
                        await client.post(
                            f"{api_url}/usfoods/agent/submit-result",
                            headers=headers,
                            json={"run_id": run_id, "success": success, "message": result.get("message", "")},
                        )
                        logger.info("Submit result posted for run %d: %s", run_id, "success" if success else "failed")

                # Clean up temp file
                try:
                    os.unlink(csv_path)
                except OSError:
                    pass

        except Exception:
            logger.exception("Error in poll loop")

        await asyncio.sleep(POLL_INTERVAL)


async def run_playwright_upload(csv_path: str, submit: bool = False) -> dict:
    """
    Use Playwright to upload CSV to US Foods and scrape validation results.
    Returns validation data dict.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.error("Playwright not installed. Run: pip install playwright && playwright install chromium")
        return {"error": "playwright not installed"}

    result = {
        "scraped_at": datetime.now().isoformat(),
        "status": {},
        "orders": [],
        "products": [],
        "submitted": False,
        "message": "",
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            args=["--start-maximized"],
        )

        page = browser.pages[0] if browser.pages else await browser.new_page()

        try:
            # Navigate to US Foods
            logger.info("Navigating to US Foods...")
            await page.goto(USFOODS_HOME, wait_until="networkidle", timeout=60000)
            await asyncio.sleep(3)

            # Check if logged in
            try:
                content = await page.content()
            except Exception:
                content = ""
            if "Six Bean Coffee" not in content:
                logger.warning("Not logged in to US Foods. Please log in manually in the browser window...")
                logger.warning("You have 5 minutes to log in...")
                logged_in = False
                for i in range(60):
                    await asyncio.sleep(5)
                    try:
                        content = await page.content()
                        if "Six Bean Coffee" in content:
                            logger.info("Login detected!")
                            logged_in = True
                            break
                    except Exception:
                        # Page might be navigating during login
                        continue
                if not logged_in:
                    result["message"] = "Login timeout - please log in to US Foods first"
                    await browser.close()
                    return result

            # Navigate to Import Order
            logger.info("Navigating to Import Order...")
            try:
                # Try clicking My Orders menu first
                my_orders = page.get_by_text("My Orders", exact=True)
                if await my_orders.count() > 0:
                    await my_orders.first.click()
                    await asyncio.sleep(1)

                import_link = page.get_by_text("Import Order", exact=True)
                if await import_link.count() > 0:
                    await import_link.first.click()
                else:
                    await page.goto("https://order.usfoods.com/desktop/import-order", timeout=30000)
                await asyncio.sleep(2)
            except Exception as e:
                logger.warning("Nav click failed, trying direct URL: %s", e)
                await page.goto("https://order.usfoods.com/desktop/import-order", timeout=30000)
                await asyncio.sleep(2)

            # Select CSV format
            logger.info("Selecting CSV format...")
            csv_radio = page.locator('[data-cy="import-order-radio-csv2015"]')
            if await csv_radio.count() > 0:
                await csv_radio.click()
                await asyncio.sleep(1)

            # Upload file
            logger.info("Uploading CSV: %s", csv_path)
            file_input = page.locator('input[type="file"]')
            await file_input.set_input_files(csv_path)
            await asyncio.sleep(2)

            # Click Continue
            continue_btn = page.get_by_role("button", name="Continue")
            if await continue_btn.count() > 0:
                await continue_btn.click()

            # Wait for validation page
            logger.info("Waiting for validation results...")
            try:
                await page.wait_for_url("**/import-order-validation**", timeout=180000)
            except Exception:
                logger.warning("Timeout waiting for validation URL")

            await asyncio.sleep(3)

            # Scrape validation status
            logger.info("Scraping validation results...")
            validation_data = await page.evaluate("""
            () => {
                const result = {
                    status: { valid_orders: 0, invalid_orders: 0, valid_products: 0, invalid_products: 0 },
                    orders: []
                };

                // Parse status numbers from the page
                const statusText = document.body.innerText;
                const validOrdersMatch = statusText.match(/(\\d+)\\s*Valid\\s*Order/i);
                const invalidOrdersMatch = statusText.match(/(\\d+)\\s*Invalid\\s*Order/i);
                const validProductsMatch = statusText.match(/(\\d+)\\s*Valid\\s*Product/i);
                const invalidProductsMatch = statusText.match(/(\\d+)\\s*Invalid\\s*Product/i);

                if (validOrdersMatch) result.status.valid_orders = parseInt(validOrdersMatch[1]);
                if (invalidOrdersMatch) result.status.invalid_orders = parseInt(invalidOrdersMatch[1]);
                if (validProductsMatch) result.status.valid_products = parseInt(validProductsMatch[1]);
                if (invalidProductsMatch) result.status.invalid_products = parseInt(invalidProductsMatch[1]);

                // Find product cards and extract data
                const allText = document.body.innerText;
                const productPattern = /#(\\d{4,8})/g;
                let match;
                const seenProducts = new Set();

                // Get all elements that might be product cards
                const allElements = document.querySelectorAll('[class*="product"], [class*="card"], [class*="item"]');
                allElements.forEach(el => {
                    const text = el.innerText || '';
                    const pnMatch = text.match(/#(\\d{5,8})/);
                    if (!pnMatch) return;

                    const productNumber = pnMatch[1];
                    if (seenProducts.has(productNumber)) return;
                    seenProducts.add(productNumber);

                    const product = {
                        product_number: productNumber,
                        status: 'ok',
                        flags: {}
                    };

                    const lowerText = text.toLowerCase();
                    const siblingText = (el.previousElementSibling?.innerText || '').toLowerCase();

                    if (lowerText.includes('out of stock') || siblingText.includes('out of stock')) {
                        product.status = 'out_of_stock';
                        product.flags.out_of_stock = true;
                    }
                    if (lowerText.includes('discontinued') || siblingText.includes('discontinued')) {
                        product.status = 'discontinued';
                        product.flags.discontinued = true;
                    }
                    if (lowerText.includes('no substitute') || siblingText.includes('no substitute')) {
                        product.flags.no_substitute = true;
                    }
                    if (lowerText.includes('substituted') || siblingText.includes('substituted')) {
                        product.status = 'substituted';
                        product.flags.substituted = true;
                    }

                    result.orders.push(product);
                });

                return result;
            }
            """)

            result["status"] = validation_data.get("status", {})
            result["products"] = validation_data.get("orders", [])
            result["message"] = f"Valid: {result['status'].get('valid_orders', 0)} orders, {result['status'].get('valid_products', 0)} products. Invalid: {result['status'].get('invalid_orders', 0)} orders, {result['status'].get('invalid_products', 0)} products."

            logger.info("Validation: %s", result["message"])

            # Handle submit or cancel
            if submit and result["status"].get("invalid_orders", 0) == 0 and result["status"].get("invalid_products", 0) == 0:
                logger.info("Submitting order...")
                submit_btn = page.get_by_role("button", name="Submit")
                if await submit_btn.count() > 0:
                    await submit_btn.click()
                    await asyncio.sleep(5)
                    result["submitted"] = True
                    result["message"] = "Order submitted successfully"
                    logger.info("Order submitted!")
                else:
                    result["message"] = "Submit button not found"
                    logger.warning("Submit button not found")
            elif submit:
                logger.info("Cannot submit - has invalid items. Cancelling...")
                cancel_btn = page.get_by_role("button", name="Cancel Import")
                if await cancel_btn.count() > 0:
                    await cancel_btn.click()
                    await asyncio.sleep(2)
                result["message"] = "Cancelled - has invalid orders/products"
            else:
                # Validation only - cancel the import
                logger.info("Validation complete. Cancelling import...")
                cancel_btn = page.get_by_role("button", name="Cancel Import")
                if await cancel_btn.count() > 0:
                    await cancel_btn.click()
                    await asyncio.sleep(2)

        except Exception as e:
            logger.exception("Playwright error")
            result["message"] = f"Error: {str(e)}"
        finally:
            await browser.close()

    return result


def main():
    parser = argparse.ArgumentParser(description="US Foods Local Agent")
    parser.add_argument("--api-url", required=True, help="Six Beans API URL (e.g., https://sixbeans-api.onrender.com/api)")
    parser.add_argument("--agent-key", required=True, help="Agent key (JWT_SECRET_KEY from Render)")
    parser.add_argument("--dry-run", action="store_true", help="Never actually submit orders")
    parser.add_argument("--once", action="store_true", help="Run once then exit (don't loop)")
    args = parser.parse_args()

    if args.once:
        asyncio.run(poll_once(args.api_url, args.agent_key, args.dry_run))
    else:
        asyncio.run(poll_for_jobs(args.api_url, args.agent_key, args.dry_run))


async def poll_once(api_url: str, agent_key: str, dry_run: bool = False):
    """Poll once, process any job, then exit."""
    headers = {"X-Agent-Key": agent_key}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{api_url}/usfoods/agent/pending", headers=headers)
        if resp.status_code != 200:
            logger.error("Failed to poll: %s", resp.text)
            return

        job = resp.json()
        if job.get("job_type") is None:
            logger.info("No pending jobs.")
            return

        logger.info("Got job: %s for run %d", job["job_type"], job["run_id"])
        # Same logic as poll_for_jobs but single execution
        csv_path = os.path.join(tempfile.gettempdir(), f"usfoods_import_{job['run_id']}.csv")
        with open(csv_path, "w", newline="") as f:
            f.write(job.get("csv_data", ""))

        if job["job_type"] == "validate":
            validation = await run_playwright_upload(csv_path, submit=False)
            await client.post(
                f"{api_url}/usfoods/agent/validation-result",
                headers=headers,
                json={"run_id": job["run_id"], "results": validation.get("products", []), "raw_json": json.dumps(validation)},
            )
            logger.info("Validation posted.")
        elif job["job_type"] == "submit":
            if dry_run:
                await client.post(
                    f"{api_url}/usfoods/agent/submit-result",
                    headers=headers,
                    json={"run_id": job["run_id"], "success": False, "message": "Dry run"},
                )
            else:
                result = await run_playwright_upload(csv_path, submit=True)
                await client.post(
                    f"{api_url}/usfoods/agent/submit-result",
                    headers=headers,
                    json={"run_id": job["run_id"], "success": result.get("submitted", False), "message": result.get("message", "")},
                )

        try:
            os.unlink(csv_path)
        except OSError:
            pass


if __name__ == "__main__":
    main()
