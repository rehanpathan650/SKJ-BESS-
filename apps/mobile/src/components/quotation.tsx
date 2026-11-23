import { formatINR, type Quotation } from "@skj/shared";
import { View } from "react-native";
import { LineChart } from "./charts";
import { Badge, Card, Kpi, P, Row, s } from "./ui";

const inr = (n: number) => formatINR(n);
const money = (n: number) => formatINR(n, { compact: true }).replace(".00 ", " ");

/** Phone view of a techno-commercial quotation. The full document (with the layout drawing) is the PDF. */
export function QuotationSummary({ q }: { q: Quotation }) {
  const s2 = q.savings;
  const f = q.financing;
  return (
    <>
      <Card title={q.number} right={q.narrative_source === "ai" ? <Badge label="AI wording" tone="info" /> : undefined}>
        <P>{q.executive_summary}</P>
      </Card>
      <View style={s.kpis}>
        <Kpi label="System" accent="brand" value={`${q.system.power_kw} kW / ${q.system.capacity_kwh} kWh`} hint={`${q.system.duration_h} h LFP`} />
        <Kpi label="Project value" value={money(q.boq.total)} hint={`${money(q.boq.subtotal)} + GST`} />
        <Kpi label="Saving, year 1" value={money(s2.net_year1)} hint={`${inr(s2.monthly)}/month`} />
        <Kpi label="Payback" accent="charge" value={s2.payback_years ? `${s2.payback_years} yrs` : "Beyond life"}
          hint={s2.irr_pct !== null ? `IRR ${s2.irr_pct}%` : undefined} />
        {f && <Kpi label="EMI" value={money(f.emi)} hint={`${f.tenure_years} yrs @ ${f.interest_pct}%`} />}
      </View>
      <Card title={`Bill analysis${q.bill.month ? ` (${q.bill.month})` : ""}`}>
        {q.bill.rows.map(([k, v]) => <Row key={k} label={k} value={v} />)}
        {q.observations.map((o) => <P key={o} small style={{ marginTop: 6 }}>• {o}</P>)}
      </Card>
      {q.size_options.length > 0 && (
        <Card title="Size options">
          {q.size_options.map((o) => (
            <Row key={`${o.battery_power_kw}-${o.battery_capacity_kwh}`}
              label={`${o.battery_power_kw} kW / ${o.battery_capacity_kwh} kWh${o.recommended ? " (recommended)" : ""}`}
              value={o.payback_years ? `${o.payback_years} yrs` : "beyond life"} />
          ))}
        </Card>
      )}
      <Card title="Bill of quantities">
        {q.boq.lines.map((l) => <Row key={l.sr} label={`${l.sr}. ${l.item}`} value={inr(l.amount)} />)}
        <Row label="Total excl. GST" value={inr(q.boq.subtotal)} />
        <Row label={`GST @ ${q.boq.gst_pct}%`} value={inr(q.boq.gst)} />
        <Row label="Total incl. GST" value={inr(q.boq.total)} />
      </Card>
      <Card title="Payment schedule">
        {q.payment_schedule.map((m) => <Row key={m.milestone} label={`${m.milestone} (${m.pct}%)`} value={inr(m.amount)} />)}
      </Card>
      {f && (
        <Card title="Financing (illustrative)">
          <Row label={`Down payment (${f.down_payment_pct}%)`} value={inr(f.down_payment)} />
          <Row label="Bank finance" value={inr(f.loan)} />
          <Row label="Monthly EMI" value={inr(f.emi)} />
          <Row label="Total interest" value={inr(f.total_interest)} />
          <Row label="Saving minus EMI" value={`${inr(f.net_monthly_during_loan)}/month`} />
          {f.yearly.map((y) => <Row key={y.year} label={`Year ${y.year}: principal / interest`} value={`${money(y.principal)} / ${money(y.interest)}`} />)}
        </Card>
      )}
      <Card title="Savings and payback">
        <Row label="Time-of-day shifting" value={inr(s2.tod_yearly)} />
        <Row label="Peak shaving (demand)" value={inr(s2.battery_peak_shaving_yearly)} />
        {!!s2.cd_revision_yearly && <Row label={`Contract-demand revision${s2.cd_revision_counted ? "" : " (not counted)"}`} value={inr(s2.cd_revision_yearly)} />}
        <Row label="O&M" value={inr(-s2.om_yearly)} />
        <Row label="Net saving, year 1" value={inr(s2.net_year1)} />
        <View style={{ height: 10 }} />
        <LineChart height={170} caption="Cumulative cash by year, starting from the investment" format={money}
          labels={["Start", ...s2.yearly.map((y) => `Y${y.year}`)]}
          series={{ name: "Cumulative cash", values: [-s2.capex, ...s2.yearly.map((y) => y.cumulative_inr)] }} />
        {s2.warnings.map((w) => <P key={w} small muted style={{ marginTop: 6 }}>{w}</P>)}
      </Card>
      <Card title="Recommendation"><P>{q.recommendation}</P></Card>
    </>
  );
}
