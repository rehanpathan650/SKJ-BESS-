"""Customer-facing proposal PDF. Contains customer prices only, never vendor cost or margin."""
from __future__ import annotations

import io
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

BRAND = colors.HexColor("#0F5C4A")


def inr(v) -> str:
    if v is None:
        return "-"
    v = float(v)
    neg = v < 0
    s = f"{abs(v):.0f}"
    if len(s) > 3:  # Indian digit grouping: 12,34,567
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if neg else "") + "Rs " + s


def _watermark(canvas, doc, text):
    if not text:
        return
    canvas.saveState()
    canvas.setFont("Helvetica-Bold", 60)
    canvas.setFillColor(colors.Color(0.8, 0.1, 0.1, alpha=0.12))
    canvas.translate(A4[0] / 2, A4[1] / 2)
    canvas.rotate(40)
    canvas.drawCentredString(0, 0, text)
    canvas.restoreState()


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.grey)
    canvas.drawString(18 * mm, 10 * mm, "SKJ Energy Solutions  |  Confidential - prepared for the named customer only")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def render(*, customer: dict, project: dict, calc: dict, title: str, revision: int, approved: bool) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm,
                            bottomMargin=18 * mm, title=title, author="SKJ Energy Solutions")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], textColor=BRAND, fontSize=20, alignment=0)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=BRAND, spaceBefore=10)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9.5, leading=13)
    small = ParagraphStyle("s", parent=body, fontSize=8, textColor=colors.grey)

    def esc(s) -> str:
        return (str(s or "")).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    s, f = calc["results"]["summary"], calc["results"]["financial"]
    story = [
        Paragraph("SKJ Energy Solutions", ParagraphStyle("brand", parent=body, textColor=BRAND, fontSize=11)),
        Paragraph(esc(title), h1),
        Paragraph(f"Prepared for <b>{esc(customer['name'])}</b>"
                  f"{' - ' + esc(customer['company']) if customer.get('company') else ''}<br/>"
                  f"Site: {esc(project.get('site_address') or project['name'])}<br/>"
                  f"Revision {revision} &nbsp;|&nbsp; {date.today().strftime('%d %b %Y')}", body),
        Spacer(1, 6),
        Paragraph("Recommended system", h2),
    ]

    def table(rows, widths=(95 * mm, 75 * mm)):
        t = Table(rows, colWidths=widths)
        t.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#333333")),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#DDDDDD")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return t

    story.append(table([
        ["Battery energy capacity", f"{s['battery_capacity_kwh']:,.0f} kWh"],
        ["Battery power rating", f"{s['battery_power_kw']:,.0f} kW"],
        ["Usable capacity", f"{s['usable_capacity_kwh']:,.0f} kWh"],
        ["Discharge duration", f"{s['duration_hours']} h"],
        ["Energy shifted to off-peak per day", f"{s['daily_energy_shifted_kwh']:,.0f} kWh"],
        ["Peak demand reduction", f"{s['peak_shaving_kva']:,.0f} kVA"],
    ]))
    story += [Paragraph("Investment and savings", h2), table([
        ["System price (excl. GST)", inr(f["price_ex_gst_inr"])],
        ["GST", inr(f["gst_inr"])],
        ["Total investment", inr(f["capex_inr"])],
        ["Year-1 ToD arbitrage saving", inr(f["year1_arbitrage_saving_inr"])],
        ["Year-1 demand charge saving", inr(f["year1_demand_saving_inr"])],
        ["Year-1 O&M cost", inr(f["year1_om_cost_inr"])],
        ["Year-1 net saving", inr(f["year1_net_saving_inr"])],
        ["Average monthly saving (year 1)", inr(f["monthly_saving_inr"])],
        ["Simple payback", f"{f['simple_payback_years']} years" if f["simple_payback_years"] else "Beyond project life"],
        ["Project IRR", f"{f['irr_pct']}%" if f["irr_pct"] is not None else "-"],
        [f"NPV @ {f['discount_rate_pct']}%", inr(f["npv_inr"])],
        [f"Lifetime net saving ({f['project_life_years']} years)", inr(f["lifetime_net_saving_inr"])],
    ])]
    story.append(Paragraph("Year-by-year projection", h2))
    yrows = [["Year", "Battery health", "Energy shifted", "Net saving", "Cumulative"]]
    for y in calc["results"]["yearly"]:
        yrows.append([str(y["year"]), f"{y['battery_health_pct']}%", f"{y['energy_shifted_kwh']:,.0f} kWh",
                      inr(y["net_saving_inr"]), inr(y["cumulative_inr"])])
    yt = Table(yrows, colWidths=(18 * mm, 30 * mm, 38 * mm, 42 * mm, 42 * mm), repeatRows=1)
    yt.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8.5),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8F2EF")),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#DDDDDD")),
    ]))
    story.append(yt)
    story += [
        Paragraph("Key assumptions", h2),
        Paragraph(
            f"Tariff escalation {f['tariff_escalation_pct']}% per year; discount rate {f['discount_rate_pct']}%; "
            f"depth of discharge {calc['inputs']['depth_of_discharge_pct']}%; round-trip efficiency "
            f"{calc['inputs']['round_trip_efficiency_pct']}%; {calc['inputs']['operating_days_per_year']} operating "
            f"days per year; {calc['inputs']['cycles_per_day']} cycle(s) per day.", body),
        Spacer(1, 8),
        Paragraph(esc(calc["results"]["assumptions_note"]) + " This proposal is valid for 30 days and is not a "
                  "binding contract until a purchase agreement is signed.", small),
    ]
    mark = "" if approved else "DRAFT - NOT APPROVED"

    def first(c, d):
        _watermark(c, d, mark)
        _footer(c, d)

    doc.build(story, onFirstPage=first, onLaterPages=first)
    return buf.getvalue()
