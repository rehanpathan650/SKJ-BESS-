import { formatINR, type Quotation } from "@skj/shared";
import type { ReactNode } from "react";
import { LineChart } from "./charts";
import { Badge, Card } from "./ui";

const inr = (n: number | null | undefined) => (n === null || n === undefined ? "–" : formatINR(n));
const money = (n: number) => formatINR(n, { compact: true }).replace(".00 ", " ");
const date = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="table-wrap"><table><tbody>
      {rows.map(([k, v]) => <tr key={k}><td className="muted" style={{ width: "42%" }}>{k}</td><td>{v}</td></tr>)}
    </tbody></table></div>
  );
}

/** Single-line installation layout (same content as the PDF drawing). */
export function LayoutDiagram({ q }: { q: Quotation }) {
  const solar = q.bill.rows.find(([k]) => k === "Existing solar plant")?.[1];
  const box = (x: number, y: number, w: number, h: number, t: string, s?: string, accent = false) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={accent ? "var(--brand-soft)" : "var(--surface)"}
        stroke={accent ? "var(--brand)" : "var(--text)"} strokeWidth={1.2} />
      <text x={x + w / 2} y={y + h / 2 - (s ? 3 : -4)} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text)">{t}</text>
      {s && <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fontSize={10.5} fill="var(--muted)">{s}</text>}
    </g>
  );
  const top = 52, bh = 44, bw = 118, gap = 30;
  const xs = [0, 1, 2, 3, 4].map((i) => 8 + i * (bw + gap));
  const lt = xs[3] + bw / 2;
  return (
    <svg viewBox="0 0 760 300" className="chart" role="img"
      aria-label={`Installation layout: grid, DISCOM meter, transformer, main LT panel and plant loads${solar ? `, solar PV ${solar}` : ""}, with a ${q.system.power_kw} kW / ${q.system.capacity_kwh} kWh battery container connected to the main panel`}>
      {box(xs[0], top, bw, bh, "DISCOM grid", "HT supply")}
      {box(xs[1], top, bw, bh, "HT metering", "DISCOM meter")}
      {box(xs[2], top, bw, bh, "Transformer", "step-down")}
      {box(xs[3], top, bw, bh, "Main LT panel", "protection", true)}
      {box(xs[4], top, bw, bh, "Plant loads", "existing")}
      {xs.slice(0, -1).map((x, i) => <line key={i} x1={x + bw} y1={top + bh / 2} x2={xs[i + 1]} y2={top + bh / 2} stroke="var(--text)" strokeWidth={1.6} />)}
      {solar && <>
        <rect x={xs[3]} y={4} width={bw} height={28} rx={6} fill="var(--charge-soft)" stroke="var(--charge)" />
        <text x={lt} y={22} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="var(--text)">Solar PV {solar}</text>
        <line x1={lt} y1={32} x2={lt} y2={top} stroke="var(--text)" strokeWidth={1.6} />
      </>}
      <rect x={150} y={150} width={470} height={140} rx={10} fill="var(--surface-2)" stroke="var(--brand)" strokeWidth={1.6} />
      <text x={166} y={172} fontSize={12.5} fontWeight={700} fill="var(--brand-strong)">
        BESS container: {q.system.power_kw.toLocaleString("en-IN")} kW / {q.system.capacity_kwh.toLocaleString("en-IN")} kWh LFP
      </text>
      {[["Battery racks", `${q.system.capacity_kwh.toLocaleString("en-IN")} kWh`], ["PCS", `${q.system.power_kw.toLocaleString("en-IN")} kW`],
        ["BMS / EMS", "control"], ["HVAC + fire", "suppression"]].map(([t, s], i) => (
        <g key={t}>{box(166 + i * 112, 196, 100, 52, t, s)}</g>
      ))}
      <line x1={266} y1={222} x2={278} y2={222} stroke="var(--brand)" strokeWidth={2} />
      <text x={272} y={214} textAnchor="middle" fontSize={9} fill="var(--brand)">DC</text>
      <polyline points={`328,196 328,124 ${lt},124 ${lt},${top + bh}`} fill="none" stroke="var(--brand)" strokeWidth={2} />
      <text x={334} y={150} fontSize={9.5} fill="var(--brand)">AC</text>
      <polyline points={`440,196 440,112 ${xs[1] + bw / 2},112 ${xs[1] + bw / 2},${top + bh}`} fill="none" stroke="var(--muted)"
        strokeWidth={1.2} strokeDasharray="5 4" />
      <text x={166} y={280} fontSize={10} fill="var(--muted)">Solid: power · Dashed: EMS monitors the DISCOM meter to control peaks</text>
    </svg>
  );
}

export function QuotationView({ q }: { q: Quotation }) {
  const s = q.savings;
  const f = q.financing;
  return (
    <div className="stack">
      <Card>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="small muted">{q.company.name}</div>
            <h2 style={{ margin: "2px 0 4px", fontSize: 22 }}>Techno-commercial quotation</h2>
            <div className="muted">{q.system.capacity_kwh.toLocaleString("en-IN")} kWh Battery Energy Storage System</div>
          </div>
          <div className="small" style={{ textAlign: "right" }}>
            <div><strong>{q.number}</strong></div>
            <div className="muted">{date(q.date)} · valid until {date(q.valid_until)}</div>
            {q.narrative_source === "ai" && <Badge tone="info">wording drafted by AI, figures calculated</Badge>}
          </div>
        </div>
        <p style={{ marginTop: 14 }}><strong>To:</strong> {q.customer.name}{q.customer.address ? `, ${q.customer.address}` : ""}</p>
        <p><strong>Subject:</strong> {q.subject}</p>
        <p>{q.executive_summary}</p>
      </Card>

      <div className="grid kpis">
        <div className="kpi accent"><div className="label">Recommended system</div><div className="value">{q.system.power_kw.toLocaleString("en-IN")} kW / {q.system.capacity_kwh.toLocaleString("en-IN")} kWh</div><div className="hint">{q.system.duration_h} h, LFP</div></div>
        <div className="kpi"><div className="label">Project value (incl. GST)</div><div className="value">{money(q.boq.total)}</div><div className="hint">{money(q.boq.subtotal)} + GST</div></div>
        <div className="kpi"><div className="label">Net saving, year 1</div><div className="value">{money(s.net_year1)}</div><div className="hint">{inr(s.monthly)} a month</div></div>
        <div className="kpi warn"><div className="label">Payback</div><div className="value">{s.payback_years ? `${s.payback_years} yrs` : "Beyond life"}</div><div className="hint">{s.irr_pct !== null ? `IRR ${s.irr_pct}%` : "No positive return"}</div></div>
        {f && <div className="kpi"><div className="label">Monthly EMI</div><div className="value">{money(f.emi)}</div><div className="hint">{f.tenure_years} yrs @ {f.interest_pct}%</div></div>}
      </div>

      <div className="grid cols-2">
        <Card title={`1. Bill analysis${q.bill.month ? ` (${q.bill.month})` : ""}`}>
          <KV rows={q.bill.rows} />
          <ul style={{ marginTop: 10 }}>{q.observations.map((o) => <li key={o}>{o}</li>)}</ul>
        </Card>
        <Card title="2. Recommended system">
          <KV rows={q.system.rows} />
          <h3 style={{ marginTop: 12 }}>Operating strategy</h3>
          <ul>{q.operating_strategy.map((o) => <li key={o}>{o}</li>)}</ul>
        </Card>
      </div>

      {q.size_options.length > 0 && (
        <Card title="Size options compared" actions={<span className="small muted">Same tariff and assumptions</span>}>
          <div className="table-wrap"><table>
            <thead><tr><th>Option</th><th className="num">Price (excl. GST)</th><th className="num">Net saving, year 1</th><th className="num">Payback</th><th className="num">IRR</th></tr></thead>
            <tbody>{q.size_options.map((o) => (
              <tr key={`${o.battery_power_kw}-${o.battery_capacity_kwh}`}>
                <td>{o.battery_power_kw.toLocaleString("en-IN")} kW / {o.battery_capacity_kwh.toLocaleString("en-IN")} kWh {o.recommended && <Badge tone="ok">recommended</Badge>}</td>
                <td className="num">{inr(o.price_ex_gst_inr)}</td><td className="num">{inr(o.net_year1)}</td>
                <td className="num">{o.payback_years ? `${o.payback_years} yrs` : "beyond life"}</td>
                <td className="num">{o.irr_pct !== null ? `${o.irr_pct}%` : "–"}</td>
              </tr>))}</tbody>
          </table></div>
        </Card>
      )}

      <Card title="3. Installation layout (single-line, indicative)"><LayoutDiagram q={q} /></Card>

      <div className="grid cols-2">
        <Card title="4. Bill of quantities">
          <div className="table-wrap"><table>
            <thead><tr><th>Sr.</th><th>Equipment / services</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {q.boq.lines.map((l) => <tr key={l.sr}><td>{l.sr}</td><td>{l.item}</td><td className="num">{inr(l.amount)}</td></tr>)}
              <tr><td /><td><strong>Total (excl. GST)</strong></td><td className="num"><strong>{inr(q.boq.subtotal)}</strong></td></tr>
              <tr><td /><td>GST @ {q.boq.gst_pct}%</td><td className="num">{inr(q.boq.gst)}</td></tr>
              <tr><td /><td><strong>Total (incl. GST)</strong></td><td className="num"><strong>{inr(q.boq.total)}</strong></td></tr>
            </tbody>
          </table></div>
        </Card>
        <Card title="5. Payment schedule">
          <div className="table-wrap"><table>
            <thead><tr><th>Milestone</th><th className="num">Payment</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {q.payment_schedule.map((m) => <tr key={m.milestone}><td>{m.milestone}</td><td className="num">{m.pct}%</td><td className="num">{inr(m.amount)}</td></tr>)}
              <tr><td><strong>Total (excl. GST)</strong></td><td className="num">100%</td><td className="num"><strong>{inr(q.boq.subtotal)}</strong></td></tr>
            </tbody>
          </table></div>
          <p className="small muted" style={{ marginTop: 8 }}>GST is payable with each milestone.</p>
        </Card>
      </div>

      {f && (
        <Card title="6. Financing and repayment schedule" actions={<span className="small muted">Illustrative, subject to lender approval</span>}>
          <div className="grid cols-2">
            <KV rows={[["Project cost (incl. GST)", inr(f.project_cost)], [`Customer contribution (${f.down_payment_pct}%)`, inr(f.down_payment)],
              ["Bank finance", inr(f.loan)], ["Interest", `${f.interest_pct}% p.a., ${f.tenure_years} years`], ["Monthly EMI", <strong key="e">{inr(f.emi)}</strong>],
              ["Total interest", inr(f.total_interest)], ["Total outlay", inr(f.total_outlay)],
              ["Monthly saving minus EMI", <span key="n" style={{ color: f.net_monthly_during_loan < 0 ? "var(--danger)" : "var(--ok)" }}>{inr(f.net_monthly_during_loan)}</span>]]} />
            <div className="table-wrap"><table>
              <thead><tr><th>Year</th><th className="num">Principal</th><th className="num">Interest</th><th className="num">Balance</th></tr></thead>
              <tbody>{f.yearly.map((y) => <tr key={y.year}><td>{y.year}</td><td className="num">{inr(y.principal)}</td><td className="num">{inr(y.interest)}</td><td className="num">{inr(y.closing_balance)}</td></tr>)}</tbody>
            </table></div>
          </div>
        </Card>
      )}

      <Card title={`${f ? 7 : 6}. Savings and payback`}>
        <div className="grid cols-2">
          <KV rows={[["Time-of-day energy shifting", inr(s.tod_yearly)], ["Peak shaving by the battery", inr(s.battery_peak_shaving_yearly)],
            ...(s.cd_revision_yearly ? [[`Contract-demand revision to ${s.proposed_contract_demand_kva} kVA (${s.cd_revision_counted ? "counted" : "not counted: needs no battery"})`, inr(s.cd_revision_yearly)] as [string, ReactNode]] : []),
            ["Operation and maintenance", inr(-s.om_yearly)], ["Net saving, year 1", <strong key="n">{inr(s.net_year1)}</strong>],
            ["Simple payback", s.payback_years ? `${s.payback_years} years` : "Beyond project life"],
            ["Project IRR", s.irr_pct !== null ? `${s.irr_pct}%` : "–"], [`Net saving over ${s.project_life_years} years`, inr(s.lifetime)]]} />
          <LineChart height={200} caption="Cumulative cash position by year, starting from the investment" format={money}
            labels={["Start", ...s.yearly.map((y) => `Y${y.year}`)]}
            series={{ name: "Cumulative cash", values: [-s.capex, ...s.yearly.map((y) => y.cumulative_inr)] }} />
        </div>
        {[...s.warnings, ...s.assumptions].map((w) => <p key={w} className="small muted" style={{ marginTop: 6 }}>{w}</p>)}
      </Card>

      <div className="grid cols-2">
        <Card title="Scope of supply"><ol>{q.scope.map((x) => <li key={x}>{x}</li>)}</ol></Card>
        <Card title="Warranty, implementation and recommendation">
          <ul>{q.warranty.map((x) => <li key={x}>{x}</li>)}</ul>
          <p><strong>Implementation:</strong> {q.implementation}</p>
          <p className="info">{q.recommendation}</p>
        </Card>
      </div>
      <Card title="Terms and conditions"><ol>{q.terms.map((x) => <li key={x}>{x}</li>)}</ol></Card>
    </div>
  );
}
