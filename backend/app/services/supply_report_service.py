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

    async with httpx.AsyncClient(timeout=60) as client:
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
    """Build the interactive HTML checklist with collapsible categories and shops."""
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
    sup_idx = 0
    for supplier in suppliers:
        shop_count = len(report_data[supplier])
        item_count = sum(len(v) for v in report_data[supplier].values())
        sup_id = f"sup{sup_idx}"
        sections_html += (
            f'<div class="section">'
            f'<div class="section-header" onclick="toggle(\'{sup_id}\')">'
            f'<span class="arrow" id="arrow-{sup_id}">&#9654;</span>'
            f'<span class="section-title">{supplier}</span>'
            f'<span class="section-meta">{shop_count} shop{"s" if shop_count != 1 else ""}'
            f' &middot; {item_count} item{"s" if item_count != 1 else ""}</span>'
            f'</div>'
            f'<div class="section-body hidden" id="{sup_id}">'
        )
        shop_idx = 0
        for shop in sorted(report_data[supplier].keys()):
            shop_id = f"{sup_id}_shop{shop_idx}"
            shop_item_count = len(report_data[supplier][shop])
            sections_html += (
                f'<div class="shop">'
                f'<div class="shop-header" onclick="toggle(\'{shop_id}\')">'
                f'<span class="arrow" id="arrow-{shop_id}">&#9654;</span>'
                f'<span class="shop-name">{shop}</span>'
                f'<span class="shop-meta">{shop_item_count} item{"s" if shop_item_count != 1 else ""}</span>'
                f'</div>'
                f'<div class="shop-body hidden" id="{shop_id}">'
            )
            for item in report_data[supplier][shop]:
                sections_html += (
                    f'<label class="item-row" id="item-{item_idx}">'
                    f'<input type="checkbox" onchange="updateProgress()">'
                    f'<span class="item-text">{item}</span></label>'
                )
                item_idx += 1
            sections_html += "</div></div>"
            shop_idx += 1
        sections_html += "</div></div>"
        sup_idx += 1

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
.content{{max-width:800px;margin:0 auto;padding:12px}}
.section{{background:#fff;border-radius:8px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);overflow:hidden}}
.section-header{{background:#2c3e50;color:#fff;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;-webkit-tap-highlight-color:transparent}}
.section-header:active{{background:#34495e}}
.section-title{{font-weight:bold;font-size:1.05em;flex:1}}
.section-meta{{font-size:.8em;opacity:.7}}
.section-body{{padding:0 8px 8px}}
.shop{{margin-top:6px;border:1px solid #e8e8e8;border-radius:6px;overflow:hidden}}
.shop-header{{background:#f0f4ff;padding:10px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;-webkit-tap-highlight-color:transparent}}
.shop-header:active{{background:#e0e8f8}}
.shop-name{{font-weight:bold;font-size:.95em;color:#1a1a2e;flex:1}}
.shop-meta{{font-size:.8em;color:#888}}
.shop-body{{padding:4px 8px 8px}}
.arrow{{font-size:.7em;color:#999;width:16px;text-align:center;transition:transform .15s}}
.arrow.open{{transform:rotate(90deg)}}
.hidden{{display:none}}
.item-row{{display:flex;align-items:flex-start;gap:10px;padding:8px;border-radius:6px;cursor:pointer;transition:background .15s;border-bottom:1px solid #f0f0f0}}
.item-row:last-child{{border-bottom:none}}
.item-row:hover,.item-row:active{{background:#f0f4ff}}
.item-row input[type=checkbox]{{margin-top:2px;width:20px;height:20px;cursor:pointer;flex-shrink:0;accent-color:#27ae60}}
.item-text{{font-size:.95em;line-height:1.4}}
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
  var c=0;
  document.querySelectorAll('input[type=checkbox]').forEach(function(cb){{
    var row=cb.closest('.item-row');
    if(cb.checked){{c++;row.classList.add('checked')}}
    else{{row.classList.remove('checked')}}
  }});
  var pct=total>0?(c/total*100):0;
  document.getElementById('progressBar').style.width=pct+'%';
  document.getElementById('progressLabel').textContent=c+' of '+total+' checked';
}}
function toggle(id){{
  var el=document.getElementById(id);
  var arrow=document.getElementById('arrow-'+id);
  if(el.classList.contains('hidden')){{
    el.classList.remove('hidden');
    if(arrow)arrow.classList.add('open');
  }}else{{
    el.classList.add('hidden');
    if(arrow)arrow.classList.remove('open');
  }}
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


def _build_orders_pdf(
    report_data: dict,
    batch_name: str,
    window_label: str,
    total_orders: int,
) -> bytes:
    """Build a professional multi-page PDF of all orders by supplier and shop."""
    from io import BytesIO
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    )

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.5 * inch, bottomMargin=0.5 * inch)
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle("Title2", parent=styles["Title"], fontSize=18,
                                  textColor=colors.HexColor("#2c3e50"), spaceAfter=4)
    subtitle_style = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=10,
                                     textColor=colors.gray, spaceAfter=12)
    supplier_style = ParagraphStyle("Supplier", parent=styles["Heading2"], fontSize=14,
                                     textColor=colors.white, backColor=colors.HexColor("#2c3e50"),
                                     spaceBefore=16, spaceAfter=8, leftIndent=6,
                                     borderPadding=(6, 8, 6, 8))
    shop_style = ParagraphStyle("Shop", parent=styles["Heading3"], fontSize=11,
                                 textColor=colors.HexColor("#1a1a2e"), spaceBefore=10, spaceAfter=4)
    item_style = ParagraphStyle("Item", parent=styles["Normal"], fontSize=9.5,
                                 leftIndent=20, spaceBefore=1, spaceAfter=1,
                                 textColor=colors.HexColor("#333333"))

    story = []

    # Header
    story.append(Paragraph("Six Beans Supply Report", title_style))
    story.append(Paragraph(f"<b>{batch_name}</b> &nbsp;&middot;&nbsp; {window_label}", subtitle_style))

    # Summary table
    suppliers = _sorted_suppliers(report_data)
    summary_data = [["Supplier", "Shops", "Items"]]
    grand_total = 0
    for sup in suppliers:
        shop_count = len(report_data[sup])
        item_count = sum(len(v) for v in report_data[sup].values())
        grand_total += item_count
        summary_data.append([sup, str(shop_count), str(item_count)])
    summary_data.append(["TOTAL", "", str(grand_total)])

    summary_table = Table(summary_data, colWidths=[3.5 * inch, 1.2 * inch, 1.2 * inch])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2c3e50")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#e8e8e8")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#f8f8f8")]),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 16))

    # Detail sections
    for supplier in suppliers:
        item_count = sum(len(v) for v in report_data[supplier].values())
        story.append(Paragraph(f"{supplier} &nbsp;&mdash;&nbsp; {item_count} items", supplier_style))

        for shop in sorted(report_data[supplier].keys()):
            shop_items = report_data[supplier][shop]
            story.append(Paragraph(f"{shop} ({len(shop_items)} items)", shop_style))

            # Items as a table with checkbox column
            item_data = []
            for item in shop_items:
                item_data.append(["\u2610", item])

            if item_data:
                item_table = Table(item_data, colWidths=[0.3 * inch, 5.0 * inch])
                item_table.setStyle(TableStyle([
                    ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                    ("FONTNAME", (0, 0), (0, -1), "Helvetica"),
                    ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#999999")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 2),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                    ("LEFTPADDING", (0, 0), (0, -1), 20),
                    ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
                ]))
                story.append(item_table)

    doc.build(story)
    return buf.getvalue()


def send_report_email_with_attachment(
    to_list: list[str], subject: str, html_body: str,
    attachment_data: bytes, attachment_name: str,
) -> bool:
    """Send an HTML email with a PDF attachment via Gmail SMTP."""
    if not settings.gmail_app_password or not settings.gmail_from:
        logger.warning("Gmail not configured, skipping email send")
        return False

    from email.mime.application import MIMEApplication

    msg = MIMEMultipart()
    msg["From"] = settings.gmail_from
    msg["To"] = ", ".join(to_list)
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))

    pdf_part = MIMEApplication(attachment_data, _subtype="pdf")
    pdf_part.add_header("Content-Disposition", "attachment", filename=attachment_name)
    msg.attach(pdf_part)

    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(settings.gmail_from, settings.gmail_app_password)
            server.sendmail(settings.gmail_from, to_list, msg.as_string())
        logger.info("Email with attachment sent to %s — %s", ", ".join(to_list), subject)
        return True
    except Exception:
        logger.exception("Failed to send email to %s", ", ".join(to_list))
        return False


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

    # ── Build PDF of all orders ────────────────────────────
    pdf_data = _build_orders_pdf(report_data, batch_name, window_label, len(all_orders))

    # ── Full checklist email with PDF attached ─────────────
    emails_sent = 0
    from app.routers.supply_reports import store_checklist

    checklist_html = build_html_report(report_data, batch_name, window_label)
    checklist_token = store_checklist(checklist_html)
    base_url = "https://sixbeans-api.onrender.com/api"
    checklist_url = f"{base_url}/supply-reports/checklist/{checklist_token}"

    checklist_email = f"""
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#27ae60;color:white;padding:24px;border-radius:8px;text-align:center;">
  <h2 style="margin:0 0 8px;">&#9745; Six Beans Supply Checklist</h2>
  <p style="margin:0;opacity:.9;">{batch_name} &middot; {window_label}</p>
</div>
<div style="padding:24px;text-align:center;">
  <p style="font-size:1.1em;margin-bottom:20px;">Your interactive checklist is ready:</p>
  <a href="{checklist_url}" style="display:inline-block;background:#27ae60;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:1.1em;">Open Checklist</a>
  <p style="margin-top:16px;font-size:.85em;color:#888;">A PDF of all orders is attached to this email.</p>
</div>
</body></html>"""

    if send_report_email_with_attachment(
        FULL_RECIPIENTS,
        f"Six Beans Checklist ({window_label})",
        checklist_email,
        pdf_data,
        f"SixBeans_Orders_{datetime.now(LA_TZ).strftime('%Y-%m-%d')}.pdf",
    ):
        emails_sent += 1

    # ── Bakery checklist email ──────────────────────────────
    has_bakery = "BAKERY" in report_data
    if has_bakery:
        bakery_data: dict = defaultdict(lambda: defaultdict(list))
        bakery_data["BAKERY"] = report_data["BAKERY"]

        bakery_checklist = build_html_report(
            bakery_data, batch_name, window_label, title_suffix="BAKERY ONLY",
        )
        bakery_token = store_checklist(bakery_checklist)
        bakery_url = f"{base_url}/supply-reports/checklist/{bakery_token}"

        bakery_link_email = f"""
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#8B4513;color:white;padding:24px;border-radius:8px;text-align:center;">
  <h2 style="margin:0 0 8px;">&#127840; Six Beans Bakery Checklist</h2>
  <p style="margin:0;opacity:.9;">{batch_name} &middot; {window_label}</p>
</div>
<div style="padding:24px;text-align:center;">
  <p style="font-size:1.1em;margin-bottom:20px;">Your bakery checklist is ready:</p>
  <a href="{bakery_url}" style="display:inline-block;background:#8B4513;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:1.1em;">Open Bakery Checklist</a>
</div>
</body></html>"""

        if send_report_email(
            BAKERY_RECIPIENTS,
            f"Six Beans Bakery Checklist ({window_label})",
            bakery_link_email,
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
