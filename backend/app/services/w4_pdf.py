"""Render a submitted W-4 form to a PDF.

The full SSN flows through this module but is never persisted in
form_submissions.form_data — the PDF is the single source of truth and is
stored as an owner-only CompanyDocument.
"""

from datetime import datetime
from io import BytesIO


FILING_STATUS_LABELS = {
    "single": "Single or Married filing separately",
    "married": "Married filing jointly",
    "head_of_household": "Head of household",
}


def _fmt_ssn(raw: str) -> str:
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if len(digits) == 9:
        return f"{digits[0:3]}-{digits[3:5]}-{digits[5:9]}"
    return raw or ""


def _fmt_money(raw: str) -> str:
    if raw in (None, ""):
        return "$0.00"
    try:
        return f"${float(raw):,.2f}"
    except (TypeError, ValueError):
        return str(raw)


def render_w4_pdf(form_data: dict, employee_name: str, submitted_at: datetime) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        SimpleDocTemplate,
        Paragraph,
        Spacer,
        Table,
        TableStyle,
    )

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=16, spaceAfter=4)
    sub = ParagraphStyle("sub", parent=styles["Normal"], fontSize=10, textColor=colors.grey, spaceAfter=10)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=11, spaceBefore=8, spaceAfter=4)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=10)

    def kv_table(rows: list[tuple[str, str]]) -> Table:
        t = Table(rows, colWidths=[2.0 * inch, 4.6 * inch])
        t.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
            ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
        ]))
        return t

    story: list = []
    story.append(Paragraph("Form W-4 — Employee's Withholding Certificate", h1))
    story.append(Paragraph(
        f"Submitted {submitted_at.strftime('%Y-%m-%d %H:%M UTC')} by {employee_name}",
        sub,
    ))

    full_name = f"{form_data.get('first_name', '')} {form_data.get('last_name', '')}".strip()
    address_lines = [
        form_data.get("address", ""),
        ", ".join(p for p in [form_data.get("city", ""), form_data.get("state", ""), form_data.get("zip", "")] if p),
    ]
    address = "\n".join(line for line in address_lines if line)

    story.append(Paragraph("Step 1 — Personal Information", h2))
    story.append(kv_table([
        ("Name", full_name or "—"),
        ("Social Security Number", _fmt_ssn(form_data.get("ssn", ""))),
        ("Address", address.replace("\n", "<br/>") if address else "—"),
        ("Filing status", FILING_STATUS_LABELS.get(form_data.get("filing_status", ""), form_data.get("filing_status", "—"))),
    ]))

    story.append(Paragraph("Step 2 — Multiple Jobs or Spouse Works", h2))
    story.append(Paragraph(
        "Yes" if form_data.get("multiple_jobs") else "No",
        body,
    ))

    story.append(Paragraph("Step 3 — Claim Dependents", h2))
    story.append(kv_table([
        ("Total amount for dependents", _fmt_money(form_data.get("dependents_amount", ""))),
    ]))

    story.append(Paragraph("Step 4 — Other Adjustments", h2))
    story.append(kv_table([
        ("(a) Other income", _fmt_money(form_data.get("other_income", ""))),
        ("(b) Deductions", _fmt_money(form_data.get("deductions", ""))),
        ("(c) Extra withholding per pay period", _fmt_money(form_data.get("extra_withholding", ""))),
    ]))

    story.append(Paragraph("Exempt Status", h2))
    story.append(Paragraph(
        "Employee claims exemption from withholding." if form_data.get("exempt") else "Not claiming exempt status.",
        body,
    ))

    story.append(Paragraph("Step 5 — Signature", h2))
    story.append(kv_table([
        ("Electronic signature", form_data.get("signature", "—")),
        ("Date", form_data.get("signature_date", "—")),
    ]))

    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph(
        "Signed under penalties of perjury. Submitted electronically through the Six Beans portal.",
        ParagraphStyle("foot", parent=styles["Normal"], fontSize=8, textColor=colors.grey),
    ))

    doc.build(story)
    return buf.getvalue()
