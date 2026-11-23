import { formatINR, formatNumber, type BillEstimate } from "@skj/shared";
import { Zap } from "lucide-react";
import type { ReactNode } from "react";
import { LineChart } from "./charts";
import { Badge, Card, Kpi } from "./ui";

const money = (n: number) => formatINR(n, { compact: true }).replace(".00 ", " ");

/**
 * Automatic BESS estimate from uploaded bills: suggested size, investment, savings and payback.
 * It is an indication for sales conversations; proposals still need a configuration validated by an engineer.
 */
export function EstimateCard({ e, action }: { e: BillEstimate | undefined; action?: ReactNode }) {
  if (!e) return null;
  const confirmed = e.basis === "reviewed";
  const head = (
    <span className="row">
      <Badge tone={confirmed ? "ok" : "warn"}>{confirmed ? "from confirmed bills" : "from unconfirmed values"}</Badge>
      {action}
    </span>
  );
  if (!e.available || !e.results || !e.inputs) {
    return <Card title="Automatic estimate" actions={head}><p className="muted"><Zap size={16} style={{ verticalAlign: -3 }} /> {e.reason}</p></Card>;
  }
  const f = e.results.financial;
  const yearly = e.results.yearly;
  return (
    <Card title="Automatic estimate" actions={head}>
      {!confirmed && (
        <p className="notice" style={{ marginBottom: 12 }}>
          Based on values read from the bill that nobody has checked yet. Confirm the bill values to firm this up.
        </p>
      )}
      <div className="grid kpis">
        <Kpi label="Suggested battery" tone="accent" value={`${formatNumber(e.inputs.battery_capacity_kwh)} kWh`}
          hint={`${formatNumber(e.inputs.battery_power_kw)} kW, ${formatNumber(e.inputs.monthly_consumption_kwh)} kWh/month load`} />
        <Kpi label="Investment (incl. GST)" value={money(f.capex_inr)} />
        <Kpi label="Saving, year 1" value={money(f.year1_net_saving_inr)} hint={`${formatINR(f.monthly_saving_inr)} a month`} />
        <Kpi label="Payback" value={f.simple_payback_years ? `${f.simple_payback_years} years` : "Beyond project life"}
          hint={f.irr_pct !== null ? `IRR ${f.irr_pct}%` : undefined} />
        {e.commercial && (
          <Kpi label="Gross margin" value={money(e.commercial.gross_margin_inr)} hint={`${e.commercial.gross_margin_pct}%, confidential`} />
        )}
      </div>
      <div style={{ marginTop: 14 }}>
        <LineChart height={180} caption="Estimated cumulative cash position by year, starting from the investment"
          labels={["Start", ...yearly.map((y) => `Y${y.year}`)]} format={money}
          series={{ name: "Cumulative cash", values: [-f.capex_inr, ...yearly.map((y) => y.cumulative_inr)] }} />
      </div>
      {e.results.warnings.map((w) => <p key={w} className="small muted" style={{ marginTop: 6 }}>{w}</p>)}
      <p className="small muted" style={{ marginTop: 10 }}>
        An estimate, not a quote: time-of-day savings plus demand-charge savings with standard assumptions. To send a
        proposal, save a configuration on a project and have an engineer validate it.
      </p>
    </Card>
  );
}
