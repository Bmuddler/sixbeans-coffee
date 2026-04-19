"""Supply order report — pulls from Square API, generates reports, emails them.

Replaces the local sixbeans_report.py script. Runs on Mon/Fri via external
cron (Render cron job or similar) or manually from the dashboard.
"""

import re
import smtplib
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import pytz
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

LA_TZ = pytz.timezone("America/Los_Angeles")

TAG_MAPPING = {
    "C": "COSTCO", "D": "DAIRY", "U": "US FOODS", "WIN": "WINCO",
    "BANK": "BANK", "B": "BAKERY", "W": "WAREHOUSE", "WEB": "WEBSTAURANT",
    "K": "KLATCH", "OLD": "OLD TOWN BAKING", "O": "OTHER",
}

TAG_PATTERN = re.compile(
    r"\[(" + "|".join(sorted(TAG_MAPPING.keys(), key=len, reverse=True)) + r")\]",
    re.IGNORECASE,
)

SUPPLIER_ORDER = [
    "WAREHOUSE", "BAKERY", "DAIRY", "US FOODS", "COSTCO", "WINCO",
    "WEBSTAURANT", "KLATCH", "OLD TOWN BAKING", "BANK", "OTHER",
]

FULL_RECIPIENTS = ["logcastles@gmail.com", "blend556@gmail.com"]
BAKERY_RECIPIENTS = ["blend556@gmail.com", "adeliasarah@gmail.com"]

SQUARE_BASE = "https://connect.squareup.com/v2"
SQUARE_VERSION = "2025-01-23"


# ── helpers ───────────────────────────────────────────────────


def _sorted_suppliers(data: dict) -> list[str]:
    """Return suppliers in the canonical display order."""
    present = set(data.keys())
    ordered = [s for s in SUPPLIER_ORDER if s in present]
    ordered += sorted(present - set(SUPPLIER_ORDER))
    return ordered


def _square_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.square_access_token}",
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
    }


# ── time window ──────────────────────────────────────────────


def get_time_window() -> tuple[str, str, str, str]:
    """Return (start_iso, end_iso, batch_name, window_label).

    Monday:  Friday 10 AM → Monday 10 AM   "MONDAY Deliveries"
    Friday:  Monday 10 AM → Friday 10 AM   "FRIDAY Deliveries"
    Other:   last 72 hours                  "MANUAL RUN"
    """
    now = datetime.now(LA_TZ)
    dow = now.weekday()  # 0=Mon … 6=Sun

    if dow == 0:  # Monday
        start = now.replace(hour=10, minute=0, second=0, microsecond=0) - timedelta(days=3)
        end = now.replace(hour=10, minute=0, second=0, microsecond=0)
        batch_name = "MONDAY Deliveries"
    elif dow == 4:  # Friday
        start = now.replace(hour=10, minute=0, second=0, microsecond=0) - timedelta(days=4)
        end = now.replace(hour=10, minute=0, second=0, microsecond=0)
        batch_name = "FRIDAY Deliveries"
    else:
        start = now - timedelta(hours=72)
        end = now
        batch_name = "MANUAL RUN"

    window_label = f"{start.strftime('%m/%d %I:%M %p')} - {end.strftime('%m/%d %I:%M %p PT')}"
    return start.isoformat(), end.isoformat(), batch_name, window_label


# ── Square API ───────────────────────────────────────────────


async def fetch_square_orders(start_iso: str, end_iso: str) -> list[dict]:
    """Fetch orders from all active Square locations within the time window."""
    headers = _square_headers()

    async with httpx.AsyncClient(timeout=30) as client:
        # 1) Get active location IDs
        loc_resp = await client.get(f"{SQUARE_BASE}/locations", headers=headers)
        loc_data = loc_resp.json()
        if "errors" in loc_data:
            logger.error("Square locations error: %s", loc_data["errors"])
            raise RuntimeError(f"Square locations error: {loc_data['errors']}")
        location_ids = [
            loc["id"]
            for loc in loc_data.get("locations", [])
            if loc.get("status") == "ACTIVE"
        ]
        logger.info("Active Square locations: %s", location_ids)

        # 2) Search orders with pagination
        all_orders: list[dict] = []
        cursor = None

        while True:
            body: dict = {
                "location_ids": location_ids,
                "query": {
                    "filter": {
                        "date_time_filter": {
                            "created_at": {"start_at": start_iso, "end_at": end_iso}
                        },
                        "state_filter": {"states": ["OPEN", "COMPLETED"]},
                    }
                },
                "limit": 500,
            }
            if cursor:
                body["cursor"] = cursor

            resp = await client.post(
                f"{SQUARE_BASE}/orders/search", headers=headers, json=body,
            )
            data = resp.json()
            if "errors" in data:
                logger.error("Square orders/search error: %s", data["errors"])
                raise RuntimeError(f"Square orders error: {data['errors']}")
            all_orders.extend(data.get("orders", []))
            cursor = data.get("cursor")
            if not cursor:
                break

    logger.info("Fetched %d orders from Square", len(all_orders))
    return all_orders


# ── parsing ──────────────────────────────────────────────────


def _get_shop_name(order: dict) -> str:
    for ff in order.get("fulfillments", []):
        name = (
            ff.get("delivery_details", {})
            .get("recipient", {})
            .get("display_name", "")
            .strip()
        )
        if name:
            return re.sub(r"\s+", " ", name)
    for key in ("ticket_name", "note"):
        val = order.get(key, "").strip()
        if val:
            return re.sub(r"\s+", " ", val[:60])
    return "Unknown Shop"


def parse_orders(orders: list[dict]) -> dict:
    """Parse raw Square orders into {supplier: {shop: [items]}}."""
    report_data: dict = defaultdict(lambda: defaultdict(list))

    for order in orders:
        shop = _get_shop_name(order)
        for item in order.get("line_items", []):
            name = item.get("name", "")
            qty = int(float(item.get("quantity", "1")))
            match = TAG_PATTERN.search(name)
            if not match:
                continue
            tag = match.group(1).upper()
            supplier = TAG_MAPPING.get(tag, "OTHER")
            # Remove the tag and any price info
            clean = re.sub(
                r"\s*\[" + re.escape(match.group(1)) + r"\]\s*",
                "",
                name,
                flags=re.IGNORECASE,
            ).strip()
            clean = re.sub(r"\$[\d.,]+", "", clean).strip()
            if qty > 1:
                clean += f" x{qty}"
            report_data[supplier][shop].append(clean)

    return report_data


# ── HTML checklist ───────────────────────────────────────────


def build_html_report(
    report_data: dict,
    batch_name: str,
    window_label: str,
    title_suffix: str = "",
) -> str:
    """Build the interactive HTML checklist (same format as the local script)."""
    title_text = f"Six Beans {batch_name}"
    if title_suffix:
        title_text += f" — {title_suffix}"

    suppliers = _sorted_suppliers(report_data)
    total_items = sum(
        len(items)
        for sup in suppliers
        for items in report_data[sup].values()
    )

    sections_html = ""
    item_idx = 0
    for supplier in suppliers:
        shop_count = len(report_data[supplier])
        item_count = sum(len(v) for v in report_data[supplier].values())
        sections_html += (
            f'<div class="supplier-section">'
            f'<div class="supplier-header" onclick="toggleSupplier(\'{supplier}\')">'
            f'<span class="supplier-name">{supplier}</span>'
            f'<span class="supplier-meta">{shop_count} shop{"s" if shop_count != 1 else ""}'
            f' &middot; {item_count} item{"s" if item_count != 1 else ""}</span>'
            f'<span class="toggle-icon" id="icon-{supplier}">&#9660;</span>'
            f'</div>'
            f'<div class="supplier-body" id="body-{supplier}">'
        )
        for shop in sorted(report_data[supplier].keys()):
            sections_html += (
                f'<div class="shop-section">'
                f'<div class="shop-name">{shop}</div>'
                f'<div class="shop-items">'
            )
            for item in report_data[supplier][shop]:
                sections_html += (
                    f'<label class="item-row" id="item-{item_idx}">'
                    f'<input type="checkbox" onchange="updateProgress()">'
                    f'<span class="item-text">{item}</span></label>'
                )
                item_idx += 1
            sections_html += "</div></div>"
        sections_html += "</div></div>"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{title_text}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333}}
.header{{background:#2c3e50;color:#fff;padding:16px 20px;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.3)}}
.header h1{{font-size:1.2em;margin-bottom:4px}}
.header .window{{font-size:.8em;opacity:.8}}
.progress-bar-wrap{{background:rgba(255,255,255,.2);border-radius:6px;height:8px;margin-top:10px}}
.progress-bar{{background:#27ae60;height:8px;border-radius:6px;transition:width .3s ease;width:0%}}
.progress-label{{font-size:.8em;margin-top:4px;opacity:.9}}
.content{{max-width:800px;margin:0 auto;padding:16px}}
.supplier-section{{background:#fff;border-radius:8px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);overflow:hidden}}
.supplier-header{{background:#2c3e50;color:#fff;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:8px}}
.supplier-header:hover{{background:#34495e}}
.supplier-name{{font-weight:bold;font-size:1.05em;flex:1}}
.supplier-meta{{font-size:.8em;opacity:.7}}
.toggle-icon{{font-size:.8em;transition:transform .2s}}
.toggle-icon.collapsed{{transform:rotate(-90deg)}}
.supplier-body{{padding:0 16px 8px}}
.supplier-body.hidden{{display:none}}
.shop-section{{border-bottom:1px solid #eee;padding:10px 0}}
.shop-section:last-child{{border-bottom:none}}
.shop-name{{font-weight:bold;font-size:.95em;color:#1a1a2e;margin-bottom:6px;padding-left:4px}}
.shop-items{{display:flex;flex-direction:column;gap:4px}}
.item-row{{display:flex;align-items:flex-start;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background .15s}}
.item-row:hover{{background:#f0f4ff}}
.item-row input[type=checkbox]{{margin-top:2px;width:18px;height:18px;cursor:pointer;flex-shrink:0;accent-color:#27ae60}}
.item-text{{font-size:.92em;line-height:1.4}}
.item-row.checked .item-text{{text-decoration:line-through;color:#999}}
</style>
</head>
<body>
<div class="header">
  <h1>{title_text}</h1>
  <div class="window">{window_label}</div>
  <div class="progress-bar-wrap"><div class="progress-bar" id="progressBar"></div></div>
  <div class="progress-label" id="progressLabel">0 of {total_items} checked</div>
</div>
<div class="content">{sections_html}</div>
<script>
var total={total_items};
function updateProgress(){{
  var checked=0;
  document.querySelectorAll('input[type=checkbox]').forEach(function(cb){{
    var row=cb.closest('.item-row');
    if(cb.checked){{checked++;row.classList.add('checked');}}
    else{{row.classList.remove('checked');}}
  }});
  var pct=total>0?(checked/total*100):0;
  document.getElementById('progressBar').style.width=pct+'%';
  document.getElementById('progressLabel').textContent=checked+' of '+total+' checked';
}}
function toggleSupplier(s){{
  var body=document.getElementById('body-'+s);
  var icon=document.getElementById('icon-'+s);
  if(body.classList.contains('hidden')){{body.classList.remove('hidden');icon.classList.remove('collapsed');}}
  else{{body.classList.add('hidden');icon.classList.add('collapsed');}}
}}
</script>
</body></html>"""


# ── email HTML builders ──────────────────────────────────────


def build_email_html(
    report_data: dict,
    batch_name: str,
    window_label: str,
    all_orders_count: int,
) -> str:
    """Build the summary email body for the full report."""
    supplier_rows = "".join(
        f"<tr><td style='padding:6px 12px;border-bottom:1px solid #eee;"
        f"font-weight:bold;'>{sup}</td>"
        f"<td style='padding:6px 12px;border-bottom:1px solid #eee;'>"
        f"{len(shops)} shop{'s' if len(shops) != 1 else ''}</td></tr>"
        for sup, shops in sorted(report_data.items())
    )

    return f"""
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#2c3e50;color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
  <h2 style="margin:0;">&#9749; Six Beans Supply Report</h2>
  <p style="margin:8px 0 0;opacity:0.8;">{batch_name}</p>
</div>
<div style="background:white;border:1px solid #ddd;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
  <p><strong>Window:</strong> {window_label}</p>
  <p><strong>Total Orders:</strong> {all_orders_count}</p>
  <h3 style="border-bottom:2px solid #2c3e50;padding-bottom:6px;margin-top:16px;">Suppliers Summary</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <thead><tr style="background:#f5f5f5;">
      <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #ddd;">Supplier</th>
      <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #ddd;">Shops</th>
    </tr></thead>
    <tbody>{supplier_rows}</tbody>
  </table>
  <div style="background:#f0f4ff;border-left:4px solid #2c3e50;padding:12px 16px;margin-bottom:20px;border-radius:0 6px 6px 0;">
    <strong>Note:</strong> A second email follows with the interactive HTML checklist
    you can open on your phone to check off items as you collect them.
  </div>
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
  <p style="font-size:.8em;color:#aaa;text-align:center;">Six Beans Automated Supply Report &middot; {window_label}</p>
</div></body></html>
"""


def build_bakery_email_html(
    bakery_data: dict,
    batch_name: str,
    window_label: str,
) -> str:
    """Build the bakery-only email body."""
    bakery_shops_html = ""
    for shop in sorted(bakery_data.get("BAKERY", {}).keys()):
        items_html = "".join(
            f"<li>{i}</li>" for i in bakery_data["BAKERY"][shop]
        )
        bakery_shops_html += (
            f'<div style="margin-bottom:16px;">'
            f'<strong style="font-size:1.05em;color:#1a1a2e;">{shop}</strong>'
            f'<ul style="margin:6px 0 0;padding-left:20px;color:#333;">'
            f'{items_html}</ul></div>'
        )

    return f"""
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#8B4513;color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
  <h2 style="margin:0;">&#127840; Six Beans Bakery Items</h2>
  <p style="margin:8px 0 0;opacity:0.8;">{batch_name} — Bakery Only</p>
</div>
<div style="background:white;border:1px solid #ddd;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
  <p><strong>Window:</strong> {window_label}</p>
  <h3 style="border-bottom:2px solid #8B4513;padding-bottom:6px;margin-top:16px;">Bakery Items by Shop</h3>
  {bakery_shops_html}
  <div style="background:#fff8f0;border-left:4px solid #8B4513;padding:12px 16px;margin-top:20px;border-radius:0 6px 6px 0;">
    <strong>Note:</strong> A second email follows with the interactive bakery
    checklist you can open on your phone.
  </div>
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
  <p style="font-size:.8em;color:#aaa;text-align:center;">Six Beans Bakery Report &middot; {window_label}</p>
</div></body></html>
"""


# ── email sending ────────────────────────────────────────────


def send_report_email(to_list: list[str], subject: str, html_body: str) -> bool:
    """Send an HTML email via Gmail SMTP."""
    if not settings.gmail_app_password or not settings.gmail_from:
        logger.warning("Gmail not configured, skipping email send")
        return False

    msg = MIMEMultipart()
    msg["From"] = settings.gmail_from
    msg["To"] = ", ".join(to_list)
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(settings.gmail_from, settings.gmail_app_password)
            server.sendmail(settings.gmail_from, to_list, msg.as_string())
        logger.info("Email sent to %s — %s", ", ".join(to_list), subject)
        return True
    except Exception:
        logger.exception("Failed to send email to %s", ", ".join(to_list))
        return False


# ── main entry point ─────────────────────────────────────────


async def run_supply_report(manual: bool = False) -> dict:
    """Run the full supply report pipeline.

    1. Calculate time window
    2. Fetch orders from Square
    3. Parse into report_data
    4. Build HTML checklist + summary email
    5. Send emails
    6. Return summary dict
    """
    start_iso, end_iso, batch_name, window_label = get_time_window()
    logger.info(
        "Running supply report — batch=%s window=%s manual=%s",
        batch_name, window_label, manual,
    )

    # Fetch
    all_orders = await fetch_square_orders(start_iso, end_iso)

    # No orders — send notice
    if not all_orders:
        logger.info("No orders found, sending notice email")
        send_report_email(
            FULL_RECIPIENTS,
            f"Six Beans Scheduled Window (NO ORDERS) ({window_label})",
            f"<p>The Six Beans supply report ran successfully but found no tagged "
            f"supply orders for the window: <strong>{window_label}</strong>.</p>"
            f"<p>Batch: {batch_name}</p>",
        )
        return {
            "status": "ok",
            "batch_name": batch_name,
            "window": window_label,
            "total_orders": 0,
            "tagged_suppliers": 0,
            "emails_sent": 1,
        }

    # Parse
    report_data = parse_orders(all_orders)

    # ── Full report emails ──────────────────────────────────
    emails_sent = 0

    # 1. Summary email
    summary_html = build_email_html(report_data, batch_name, window_label, len(all_orders))
    if send_report_email(
        FULL_RECIPIENTS,
        f"Six Beans Supply Report ({window_label})",
        summary_html,
    ):
        emails_sent += 1

    # 2. Checklist email (full HTML inline so they can use it on their phone)
    checklist_html = build_html_report(report_data, batch_name, window_label)
    if send_report_email(
        FULL_RECIPIENTS,
        f"Six Beans Checklist ({window_label})",
        checklist_html,
    ):
        emails_sent += 1

    # ── Bakery report emails ────────────────────────────────
    has_bakery = "BAKERY" in report_data
    if has_bakery:
        bakery_data: dict = defaultdict(lambda: defaultdict(list))
        bakery_data["BAKERY"] = report_data["BAKERY"]

        bakery_summary = build_bakery_email_html(bakery_data, batch_name, window_label)
        if send_report_email(
            BAKERY_RECIPIENTS,
            f"Six Beans Bakery Items ({window_label})",
            bakery_summary,
        ):
            emails_sent += 1

        bakery_checklist = build_html_report(
            bakery_data, batch_name, window_label, title_suffix="BAKERY ONLY",
        )
        if send_report_email(
            BAKERY_RECIPIENTS,
            f"Six Beans Bakery Checklist ({window_label})",
            bakery_checklist,
        ):
            emails_sent += 1

    return {
        "status": "ok",
        "batch_name": batch_name,
        "window": window_label,
        "total_orders": len(all_orders),
        "tagged_suppliers": len(report_data),
        "has_bakery": has_bakery,
        "emails_sent": emails_sent,
    }
