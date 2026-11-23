import { formatINR, formatNumber, type BillEstimate } from "@skj/shared";
import { View } from "react-native";
import { LineChart } from "./charts";
import { Badge, Card, Kpi, Notice, P, s } from "./ui";

const money = (n: number) => formatINR(n, { compact: true }).replace(".00 ", " ");

/** Automatic BESS estimate from bills (same content as the website). An indication, not a quote. */
export function EstimateCard({ e }: { e: BillEstimate | undefined }) {
  if (!e) return null;
  const confirmed = e.basis === "reviewed";
  const badge = <Badge label={confirmed ? "confirmed bills" : "unconfirmed values"} tone={confirmed ? "ok" : "warn"} />;
  if (!e.available || !e.results || !e.inputs) {
    return <Card title="Automatic estimate" right={badge}><P muted>{e.reason}</P></Card>;
  }
  const f = e.results.financial;
  const yearly = e.results.yearly;
  return (
    <Card title="Automatic estimate" right={badge}>
      {!confirmed && <Notice>Based on values read from the bill that nobody has checked yet. Confirm the values to firm this up.</Notice>}
      <View style={s.kpis}>
        <Kpi label="Suggested battery" accent="brand" value={`${formatNumber(e.inputs.battery_capacity_kwh)} kWh`}
          hint={`${formatNumber(e.inputs.battery_power_kw)} kW`} />
        <Kpi label="Investment" value={money(f.capex_inr)} hint="incl. GST" />
        <Kpi label="Saving, year 1" value={money(f.year1_net_saving_inr)} hint={`${formatINR(f.monthly_saving_inr)}/month`} />
        <Kpi label="Payback" value={f.simple_payback_years ? `${f.simple_payback_years} yrs` : "Beyond life"}
          hint={f.irr_pct !== null ? `IRR ${f.irr_pct}%` : undefined} />
        {e.commercial && <Kpi label="Gross margin" value={money(e.commercial.gross_margin_inr)} hint="Confidential" />}
      </View>
      <LineChart height={170} caption="Estimated cumulative cash by year, starting from the investment"
        labels={["Start", ...yearly.map((y) => `Y${y.year}`)]} format={money}
        series={{ name: "Cumulative cash", values: [-f.capex_inr, ...yearly.map((y) => y.cumulative_inr)] }} />
      <P muted small style={{ marginTop: 8 }}>
        An estimate, not a quote. To send a proposal, save a configuration on a project and have an engineer validate it.
      </P>
    </Card>
  );
}
