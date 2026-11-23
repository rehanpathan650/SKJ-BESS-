"""Techno-commercial quotation PDF (customer-facing: prices only, never vendor cost or margin).

Renders the content built by services/quotation.py, including a single-line installation layout drawing.
Uses IBM Plex Sans (embedded, OFL) so the rupee sign prints correctly.
"""
from __future__ import annotations

import io
from datetime import date
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.quotation import inr

BRAND = colors.HexColor("#0F5C4A")
INK = colors.HexColor("#0D2A23")
SOFT = colors.HexColor("#E2EFE9")
CHARGE = colors.HexColor("#F0B33C")
GRID = colors.HexColor("#D9E1DC")
FONTS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
_registered = False


def _fonts() -> tuple[str, str]:
    global _registered
    if not _registered:
        try:
            pdfmetrics.registerFont(TTFont("Plex", str(FONTS / "IBMPlexSans-Regular.ttf")))
            pdfmetrics.registerFont(TTFont("Plex-Bold", str(FONTS / "IBMPlexSans-SemiBold.ttf")))
            _registered = True
        except Exception:  # fonts missing: fall back to built-ins (rupee sign then shows as a box)
            return "Helvetica", "Helvetica-Bold"
    return "Plex", "Plex-Bold"


def esc(s) -> str:
    return str(s if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def layout_drawing(content: dict, width: float, font: str, bold: str) -> Drawing:
    """Single-line installation layout: grid -> meter -> transformer -> LT panel -> loads; solar and BESS on the panel."""
    h = 92 * mm
    d = Drawing(width, h)
    sys_ = content["system"]
    has_solar = any(r[0] == "Existing solar plant" for r in content["bill"]["rows"])
    solar_kw = next((r[1] for r in content["bill"]["rows"] if r[0] == "Existing solar plant"), "")

    def box(x, y, w, hh, title, sub="", fill=colors.white, stroke=INK, tcolor=INK):
        d.add(Rect(x, y, w, hh, rx=4, ry=4, fillColor=fill, strokeColor=stroke, strokeWidth=1))
        d.add(String(x + w / 2, y + hh / 2 + (3 if sub else -3), title, fontName=bold, fontSize=8, fillColor=tcolor,
                     textAnchor="middle"))
        if sub:
            d.add(String(x + w / 2, y + hh / 2 - 8, sub, fontName=font, fontSize=6.8, fillColor=tcolor, textAnchor="middle"))

    def wire(x1, y1, x2, y2, dashed=False, color=INK):
        ln = Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=1.2 if not dashed else 0.8)
        if dashed:
            ln.strokeDashArray = [3, 2]
        d.add(ln)

    bw, bh = 30 * mm, 14 * mm
    top = h - 22 * mm
    xs = [0, 36 * mm, 72 * mm, 108 * mm, width - bw]
    box(xs[0], top, bw, bh, "DISCOM grid", "HT supply")
    box(xs[1], top, bw, bh, "HT metering", "DISCOM meter")
    box(xs[2], top, bw, bh, "Transformer", "step-down")
    box(xs[3], top, bw, bh, "Main LT panel", "protection", fill=SOFT, stroke=BRAND)
    box(xs[4], top, bw, bh, "Plant loads", "existing")
    for a, b in zip(xs, xs[1:], strict=False):  # consecutive pairs
        wire(a + bw, top + bh / 2, b, top + bh / 2)
    lt_cx = xs[3] + bw / 2
    if has_solar:
        box(xs[3], h - 7 * mm, bw, 6.5 * mm, f"Solar PV {solar_kw}", fill=colors.HexColor("#FDF1D8"), stroke=CHARGE)
        wire(lt_cx, h - 7 * mm, lt_cx, top + bh)
    # BESS container below the LT panel
    cw, ch = 104 * mm, 40 * mm
    cx, cy = lt_cx - cw / 2 - 18 * mm, 6 * mm
    cx = max(0, min(cx, width - cw))
    d.add(Rect(cx, cy, cw, ch, rx=6, ry=6, fillColor=colors.HexColor("#F4F7F5"), strokeColor=BRAND, strokeWidth=1.4))
    d.add(String(cx + 4 * mm, cy + ch - 5 * mm, f"BESS container  -  {sys_['power_kw']:,.0f} kW / {sys_['capacity_kwh']:,.0f} kWh LFP",
                 fontName=bold, fontSize=8, fillColor=BRAND))
    iw, ih = 22 * mm, 12 * mm
    iy = cy + 13 * mm
    items = [("Battery racks", f"{sys_['capacity_kwh']:,.0f} kWh"), ("PCS", f"{sys_['power_kw']:,.0f} kW"),
             ("BMS / EMS", "control"), ("HVAC + fire", "suppression")]
    ix = [cx + 3 * mm + i * (iw + 3.5 * mm) for i in range(4)]
    for (t, sub), x in zip(items, ix, strict=True):
        box(x, iy, iw, ih, t, sub, fill=colors.white, stroke=BRAND, tcolor=INK)
    wire(ix[0] + iw, iy + ih / 2, ix[1], iy + ih / 2, color=BRAND)            # DC link battery -> PCS
    d.add(String((ix[0] + iw + ix[1]) / 2, iy + ih / 2 + 2, "DC", fontName=font, fontSize=6, fillColor=BRAND, textAnchor="middle"))
    pcs_cx = ix[1] + iw / 2
    wire(pcs_cx, iy + ih, pcs_cx, top - 3 * mm, color=BRAND)                  # AC link PCS -> LT panel
    wire(pcs_cx, top - 3 * mm, lt_cx, top - 3 * mm, color=BRAND)
    wire(lt_cx, top - 3 * mm, lt_cx, top, color=BRAND)
    d.add(String(pcs_cx + 2, (iy + ih + top) / 2, "AC", fontName=font, fontSize=6, fillColor=BRAND))
    ems_cx = ix[2] + iw / 2                                                    # EMS reads the meter (control)
    wire(ems_cx, iy + ih, ems_cx, top - 8 * mm, dashed=True, color=colors.grey)
    wire(ems_cx, top - 8 * mm, xs[1] + bw / 2, top - 8 * mm, dashed=True, color=colors.grey)
    wire(xs[1] + bw / 2, top - 8 * mm, xs[1] + bw / 2, top, dashed=True, color=colors.grey)
    d.add(String(cx + 3 * mm, cy + 4 * mm, "Solid: power   Dashed: EMS monitoring of the DISCOM meter (peak control)",
                 fontName=font, fontSize=6.5, fillColor=colors.grey))
    return d


def render(content: dict, *, draft: bool = False) -> bytes:
    font, bold = _fonts()
    buf = io.BytesIO()
    company = content.get("company") or {}
    title = f"Quotation {content['number']}"
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm,
                            bottomMargin=16 * mm, title=title, author=company.get("name") or "SKJ Energy Solutions")
    width = A4[0] - 32 * mm
    body = ParagraphStyle("b", fontName=font, fontSize=9.2, leading=13, textColor=INK)
    small = ParagraphStyle("s", parent=body, fontSize=7.8, leading=10.5, textColor=colors.HexColor("#56655E"))
    h1 = ParagraphStyle("h1", parent=body, fontName=bold, fontSize=17, leading=21, textColor=BRAND, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=body, fontName=bold, fontSize=11.5, leading=15, textColor=BRAND, spaceBefore=10, spaceAfter=4)
    cell = ParagraphStyle("c", parent=body, fontSize=8.6, leading=11)
    cellb = ParagraphStyle("cb", parent=cell, fontName=bold)

    def table(rows, widths, header=True, num_cols=(), total_row=False):
        data = [[Paragraph(esc(c), cellb if (header and i == 0) or (total_row and i == len(rows) - 1) else cell)
                 for c in r] for i, r in enumerate(rows)]
        t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
        st = [("GRID", (0, 0), (-1, -1), 0.4, GRID), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
        if header:
            st.append(("BACKGROUND", (0, 0), (-1, 0), SOFT))
        if total_row:
            st.append(("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F4F7F5")))
        for c in num_cols:
            st.append(("ALIGN", (c, 0), (c, -1), "RIGHT"))
        t.setStyle(TableStyle(st))
        return t

    def bullets(items):
        return [Paragraph(f"&bull;&nbsp; {esc(x)}", body) for x in items]

    def fmt_date(iso):
        return date.fromisoformat(iso).strftime("%d %B %Y")

    cust = content["customer"]
    s, boq, sav = content["system"], content["boq"], content["savings"]
    story = [
        Paragraph(esc(company.get("name") or "SKJ Energy Solutions"),
                  ParagraphStyle("brand", parent=body, fontName=bold, fontSize=10.5, textColor=BRAND)),
        Paragraph(esc(" | ".join(x for x in (company.get("address"), company.get("phone"), company.get("email"),
                                             f"GSTIN {company['gstin']}" if company.get("gstin") else "") if x)), small),
        Spacer(1, 8),
        Paragraph("Techno-commercial quotation", h1),
        Paragraph(f"{s['capacity_kwh']:,.0f} kWh Battery Energy Storage System (BESS)",
                  ParagraphStyle("sub", parent=body, fontSize=11, textColor=INK)),
        Spacer(1, 6),
        table([["Quotation no.", content["number"], "Date", fmt_date(content["date"])],
               ["Valid until", fmt_date(content["valid_until"]), "Consumer no.", cust.get("consumer_number") or "-"]],
              [28 * mm, 60 * mm, 28 * mm, width - 116 * mm], header=False),
        Spacer(1, 8),
        Paragraph("<b>To</b>", body),
        Paragraph(f"<b>{esc(cust.get('name'))}</b><br/>{esc(cust.get('address') or '')}", body),
        Spacer(1, 6),
        Paragraph(f"<b>Subject:</b> {esc(content['subject'])}", body),
        Spacer(1, 6),
        Paragraph("Dear Sir/Madam,", body),
        Paragraph("We are pleased to submit our techno-commercial proposal for the design, supply, installation and "
                  "commissioning of a Battery Energy Storage System for your facility. " + esc(content["executive_summary"]),
                  body),
        Paragraph("1. Electricity bill analysis", h2),
        Paragraph(f"Based on the {esc(content['bill'].get('month') or '')} electricity bill.", small),
        table([["Particulars", "Bill details"]] + content["bill"]["rows"], [70 * mm, width - 70 * mm]),
        Spacer(1, 4), *bullets(content["observations"]),
        Paragraph("2. Recommended system", h2),
        table([["Particulars", "Proposed configuration"]] + s["rows"], [55 * mm, width - 55 * mm]),
        *([Spacer(1, 4), Paragraph("<b>Size options compared</b> (same tariff and assumptions)", body),
           table([["Option", "Price (excl. GST)", "Net saving, year 1", "Payback", "IRR"]]
                 + [[f"{o['battery_power_kw']:,.0f} kW / {o['battery_capacity_kwh']:,.0f} kWh"
                     + ("  (recommended)" if o.get("recommended") else ""), inr(o["price_ex_gst_inr"]), inr(o["net_year1"]),
                     f"{o['payback_years']:g} yrs" if o["payback_years"] else "beyond life",
                     f"{o['irr_pct']:g}%" if o["irr_pct"] is not None else "-"] for o in content.get("size_options", [])],
                 [width - 132 * mm, 36 * mm, 36 * mm, 30 * mm, 30 * mm], num_cols=(1, 2, 3, 4))]
          if content.get("size_options") else []),
        Spacer(1, 4), Paragraph("<b>Operating strategy</b>", body), *bullets(content["operating_strategy"]),
        KeepTogether([Paragraph("3. Installation layout (single-line, indicative)", h2), layout_drawing(content, width, font, bold)]),
        Paragraph("4. Bill of quantities (BOQ)", h2),
        table([["Sr.", "Equipment / services", "Amount"]]
              + [[str(x["sr"]), x["item"], inr(x["amount"])] for x in boq["lines"]]
              + [["", "Total project value (excluding GST)", inr(boq["subtotal"])],
                 ["", f"GST @ {boq['gst_pct']:g}%", inr(boq["gst"])],
                 ["", "Total project value (including GST)", inr(boq["total"])]],
              [12 * mm, width - 52 * mm, 40 * mm], num_cols=(2,), total_row=True),
        Paragraph("Budgetary line split of the turnkey project value.", small),
        Paragraph("5. Commercial payment schedule", h2),
        table([["Milestone", "Payment", "Amount"]]
              + [[m["milestone"], f"{m['pct']:g}%", inr(m["amount"])] for m in content["payment_schedule"]]
              + [["Total (excluding GST)", "100%", inr(boq["subtotal"])]],
              [width - 70 * mm, 25 * mm, 45 * mm], num_cols=(1, 2), total_row=True),
        Paragraph("GST is payable with each milestone as applicable.", small),
    ]
    fin = content.get("financing")
    if fin:
        story += [
            Paragraph("6. Financing proposal (illustrative)", h2),
            table([["Particulars", "Amount"],
                   ["Total project cost (incl. GST)", inr(fin["project_cost"])],
                   [f"Customer contribution ({fin['down_payment_pct']:g}%)", inr(fin["down_payment"])],
                   ["Bank finance", inr(fin["loan"])],
                   ["Interest rate", f"{fin['interest_pct']:g}% per annum"],
                   ["Tenure", f"{fin['tenure_years']} years ({fin['months']} months)"],
                   ["Monthly EMI", inr(fin["emi"])],
                   ["Total EMI payments", inr(fin["total_payments"])],
                   ["Total interest", inr(fin["total_interest"])],
                   ["Total outlay incl. down payment", inr(fin["total_outlay"])],
                   ["Estimated monthly saving minus EMI", inr(fin["net_monthly_during_loan"])]],
                  [width - 60 * mm, 60 * mm], num_cols=(1,)),
            Spacer(1, 4),
            table([["Year", "Principal", "Interest", "Closing balance"]]
                  + [[str(y["year"]), inr(y["principal"]), inr(y["interest"]), inr(y["closing_balance"])] for y in fin["yearly"]],
                  [20 * mm, (width - 20 * mm) / 3, (width - 20 * mm) / 3, (width - 20 * mm) / 3], num_cols=(1, 2, 3)),
            Paragraph("Reducing-balance loan. Actual interest, fees and sanction terms depend on the lender.", small),
        ]
    n = 7 if fin else 6
    sav_rows = [["Saving stream (year 1)", "Amount"],
                ["Time-of-day energy shifting", inr(sav["tod_yearly"])],
                ["Peak shaving by the battery (demand charges)", inr(sav["battery_peak_shaving_yearly"])]]
    if sav["cd_revision_yearly"]:
        sav_rows.append([f"Contract-demand revision to {sav['proposed_contract_demand_kva']:,.0f} kVA "
                         f"({'counted' if sav['cd_revision_counted'] else 'not counted, needs no battery'})",
                         inr(sav["cd_revision_yearly"])])
    sav_rows += [["Operation and maintenance", inr(-sav["om_yearly"])],
                 ["Net saving, year 1", inr(sav["net_year1"])],
                 ["Average monthly saving", inr(sav["monthly"])],
                 ["Simple payback", f"{sav['payback_years']:g} years" if sav["payback_years"] else "Beyond project life"],
                 ["Project IRR", f"{sav['irr_pct']:g}%" if sav["irr_pct"] is not None else "-"],
                 [f"Net saving over {sav['project_life_years']} years", inr(sav["lifetime"])]]
    story += [
        Paragraph(f"{n}. Energy savings and payback", h2),
        table(sav_rows, [width - 60 * mm, 60 * mm], num_cols=(1,)),
        Spacer(1, 4),
        table([["Year", "Battery health", "Time-of-day", "Demand", "O&M", "Net", "Cumulative"]]
              + [[str(y["year"]), f"{y['battery_health_pct']:g}%", inr(y["arbitrage_saving_inr"]), inr(y["demand_saving_inr"]),
                  inr(-y["om_cost_inr"]), inr(y["net_saving_inr"]), inr(y["cumulative_inr"])] for y in sav["yearly"]],
              [12 * mm] + [(width - 12 * mm) / 6] * 6, num_cols=(1, 2, 3, 4, 5, 6)),
        Spacer(1, 3), *[Paragraph(esc(x), small) for x in sav["assumptions"] + sav["warnings"]],
        Paragraph(f"{n + 1}. Scope of supply", h2), *bullets(content["scope"]),
        Paragraph(f"{n + 2}. Warranty and performance", h2), *bullets(content["warranty"]),
        Paragraph(f"{n + 3}. Project implementation", h2), Paragraph(esc(content["implementation"]), body),
        Paragraph(f"{n + 4}. Recommendation", h2), Paragraph(esc(content["recommendation"]), body),
        Paragraph(f"{n + 5}. Terms and conditions", h2),
        *[Paragraph(f"{i}. {esc(t)}", body) for i, t in enumerate(content["terms"], 1)],
        Spacer(1, 14),
        table([[f"For and on behalf of {company.get('name') or 'SKJ Energy Solutions'}", f"Customer acceptance - {cust.get('name') or ''}"],
               [f"Authorised signatory{': ' + company['signatory'] if company.get('signatory') else ''}\n\n\nSignature",
                "Name:\nDesignation:\n\nSignature & company stamp"]],
              [width / 2, width / 2]),
    ]

    def on_page(canvas, doc_):
        canvas.saveState()
        canvas.setFont(font, 7.2)
        canvas.setFillColor(colors.grey)
        canvas.drawString(16 * mm, 9 * mm, f"{company.get('name') or 'SKJ Energy Solutions'}  |  Quotation {content['number']}"
                                           "  |  Prepared for the named customer only")
        canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, f"Page {doc_.page}")
        canvas.setFillColor(CHARGE)
        canvas.rect(0, A4[1] - 4, A4[0], 4, stroke=0, fill=1)
        if draft:
            canvas.setFont(bold, 60)
            canvas.setFillColor(colors.Color(0.8, 0.1, 0.1, alpha=0.12))
            canvas.translate(A4[0] / 2, A4[1] / 2)
            canvas.rotate(40)
            canvas.drawCentredString(0, 0, "DRAFT")
        canvas.restoreState()

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()


__all__ = ["render", "layout_drawing", "PageBreak"]
