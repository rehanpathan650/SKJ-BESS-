import { DEFAULT_CALC_INPUTS, formatINR, formatNumber, type CalcInputs, type CalcResults, type Commercial } from "@skj/shared";
import type { ReactNode } from "react";
import { ColumnChart, LineChart } from "./charts";
import { Card, Field, Kpi } from "./ui";

type Inputs = Record<keyof CalcInputs, number | null>;

export const emptyInputs = (): Inputs => ({ ...DEFAULT_CALC_INPUTS } as Inputs);

const GROUPS: { title: string; fields: [keyof CalcInputs, string, string?, boolean?][] }[] = [
  { title: "Load and tariff", fields: [
    ["monthly_consumption_kwh", "Monthly consumption (kWh)"],
    ["peak_share_pct", "Peak-hour share (%)", "Share of units in the DISCOM's peak ToD window"],
    ["peak_window_hours", "Peak window (hours/day)"],
    ["peak_tariff_inr", "Peak energy rate (₹/kWh)", "Incl. ToD surcharge"],
    ["offpeak_tariff_inr", "Charging rate (₹/kWh)", "Off-peak / night rate incl. rebate"],
    ["contract_demand_kva", "Contract demand (kVA)"],
    ["recorded_max_demand_kva", "Recorded max demand (kVA)"],
    ["demand_charge_inr_per_kva", "Demand charge (₹/kVA/month)"],
    ["min_billing_demand_pct", "Min. billing demand (% of CD)"],
    ["power_factor", "Power factor"],
    ["peak_shaving_kva", "Peak shaving target (kVA)", "Blank = automatic", true],
  ] },
  { title: "Battery configuration", fields: [
    ["battery_capacity_kwh", "Battery capacity (kWh)"],
    ["battery_power_kw", "Battery power (kW)"],
    ["depth_of_discharge_pct", "Depth of discharge (%)"],
    ["round_trip_efficiency_pct", "Round-trip efficiency (%)"],
    ["cycles_per_day", "Cycles per day"],
    ["operating_days_per_year", "Operating days per year"],
  ] },
  { title: "Financial (blank = company default)", fields: [
    ["project_life_years", "Project life (years)", undefined, true],
    ["degradation_pct_per_year", "Degradation (%/year)", undefined, true],
    ["tariff_escalation_pct", "Tariff escalation (%/year)", undefined, true],
    ["discount_rate_pct", "Discount rate (%)", undefined, true],
    ["om_pct_of_capex", "O&M (% of price/year)", undefined, true],
    ["sales_discount_pct", "Sales discount (%)", "Limited by the approved maximum"],
  ] },
];

export function CalcForm({ value, onChange, defaults }: { value: Inputs; onChange: (v: Inputs) => void; defaults?: Record<string, number> }) {
  return (
    <div className="stack">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <h3>{g.title}</h3>
          <div className="form-grid">
            {g.fields.map(([k, label, help, optional]) => (
              <Field key={k} label={label} help={help ?? (optional && defaults?.[k] !== undefined ? `Default ${defaults[k]}` : undefined)}>
                <input type="number" step="any" min={0} value={value[k] ?? ""} required={!optional}
                  onChange={(e) => onChange({ ...value, [k]: e.target.value === "" ? null : Number(e.target.value) })} />
              </Field>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Strip blanks so the API applies its defaults. */
export function cleanInputs(v: Inputs): Partial<CalcInputs> {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined)) as Partial<CalcInputs>;
}

export function CalcResultsView({ results, commercial, extra }: { results: CalcResults; commercial?: Commercial; extra?: ReactNode }) {
  const f = results.financial;
  const s = results.summary;
  return (
    <div className="stack calc-results">
      {results.warnings.map((w) => <div className="notice" key={w}>{w}</div>)}
      <div className="grid kpis">
        <Kpi label="Total investment (incl. GST)" value={formatINR(f.capex_inr, { compact: true })} tone="accent" />
        <Kpi label="Year-1 net saving" value={formatINR(f.year1_net_saving_inr, { compact: true })}
          hint={`${formatINR(f.monthly_saving_inr)} / month`} />
        <Kpi label="Simple payback" value={f.simple_payback_years ? `${f.simple_payback_years} yrs` : "Beyond life"}
          hint={f.discounted_payback_years ? `Discounted ${f.discounted_payback_years} yrs` : undefined} />
        <Kpi label="Project IRR" value={f.irr_pct !== null ? `${f.irr_pct}%` : "–"} />
        <Kpi label={`NPV @ ${f.discount_rate_pct}%`} value={formatINR(f.npv_inr, { compact: true })} />
        <Kpi label="LCOS" value={f.lcos_inr_per_kwh ? `₹${f.lcos_inr_per_kwh}/kWh` : "–"} />
      </div>
      <div className="grid calc-pair">
        <Card title="System">
          <dl className="dl">
            <dt>Capacity / power</dt><dd>{formatNumber(s.battery_capacity_kwh)} kWh / {formatNumber(s.battery_power_kw)} kW</dd>
            <dt>Usable capacity</dt><dd>{formatNumber(s.usable_capacity_kwh)} kWh</dd>
            <dt>C-rate / duration</dt><dd>{s.c_rate}C, {s.duration_hours} h</dd>
            <dt>Energy shifted per day</dt><dd>{formatNumber(s.daily_energy_shifted_kwh)} kWh (peak load {formatNumber(s.peak_daily_load_kwh)} kWh)</dd>
            <dt>Peak shaving</dt><dd>{formatNumber(s.peak_shaving_kva)} kVA</dd>
            <dt>Billed demand</dt><dd>{formatNumber(s.billed_demand_before_kva)} → {formatNumber(s.billed_demand_after_kva)} kVA</dd>
          </dl>
        </Card>
        <Card title="Savings (year 1)">
          <dl className="dl">
            <dt>ToD arbitrage</dt><dd>{formatINR(f.year1_arbitrage_saving_inr)}</dd>
            <dt>Demand charges</dt><dd>{formatINR(f.year1_demand_saving_inr)}</dd>
            <dt>O&amp;M cost</dt><dd>−{formatINR(f.year1_om_cost_inr)}</dd>
            <dt>Net saving</dt><dd><strong>{formatINR(f.year1_net_saving_inr)}</strong></dd>
            <dt>Price excl. GST</dt><dd>{formatINR(f.price_ex_gst_inr)}</dd>
            <dt>Lifetime net saving</dt><dd>{formatINR(f.lifetime_net_saving_inr)} ({f.project_life_years} yrs)</dd>
          </dl>
        </Card>
      </div>
      {commercial && (
        <Card title="Confidential: cost and margin">
          <dl className="dl">
            <dt>Vendor battery cost</dt><dd>{formatINR(commercial.vendor_battery_cost_inr)}</dd>
            <dt>Vendor PCS cost</dt><dd>{formatINR(commercial.vendor_pcs_cost_inr)}</dd>
            <dt>Installation</dt><dd>{formatINR(commercial.installation_cost_inr)}</dd>
            <dt>Total cost</dt><dd>{formatINR(commercial.total_cost_inr)}</dd>
            <dt>List price (excl. GST)</dt><dd>{formatINR(commercial.list_price_ex_gst_inr)}</dd>
            <dt>Gross margin</dt><dd><strong>{formatINR(commercial.gross_margin_inr)} ({commercial.gross_margin_pct}%)</strong></dd>
          </dl>
        </Card>
      )}
      <div className="grid calc-pair">
        <Card title="Savings by year" actions={<span className="small muted">Before O&amp;M cost</span>}>
          <ColumnChart caption="Time-of-day and demand-charge savings by year" labels={results.yearly.map((y) => `Y${y.year}`)}
            format={(n) => formatINR(n, { compact: true })}
            series={[{ name: "Time-of-day savings", values: results.yearly.map((y) => y.arbitrage_saving_inr) },
              { name: "Demand-charge savings", values: results.yearly.map((y) => y.demand_saving_inr) }]} />
        </Card>
        <Card title="Payback" actions={<span className="small muted">Cumulative cash after the investment</span>}>
          <LineChart caption="Cumulative cash position by year, starting from the investment" labels={["Start", ...results.yearly.map((y) => `Y${y.year}`)]}
            format={(n) => formatINR(n, { compact: true })}
            series={{ name: "Cumulative cash", values: [-f.capex_inr, ...results.yearly.map((y) => y.cumulative_inr)] }}
            zeroLabel={f.simple_payback_years ? `Pays back after ${f.simple_payback_years} years, where the line crosses zero.` : "Does not pay back within the project life."} />
        </Card>
      </div>
      <Card title="Year by year">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Year</th><th className="num">Health</th><th className="num">Energy shifted</th><th className="num">Arbitrage</th>
              <th className="num">Demand</th><th className="num">O&amp;M</th><th className="num">Net</th><th className="num">Cumulative</th></tr></thead>
            <tbody>{results.yearly.map((y) => (
              <tr key={y.year}><td>{y.year}</td><td className="num">{y.battery_health_pct}%</td>
                <td className="num">{formatNumber(y.energy_shifted_kwh)}</td><td className="num">{formatINR(y.arbitrage_saving_inr)}</td>
                <td className="num">{formatINR(y.demand_saving_inr)}</td><td className="num">{formatINR(y.om_cost_inr)}</td>
                <td className="num">{formatINR(y.net_saving_inr)}</td><td className="num">{formatINR(y.cumulative_inr)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>{results.assumptions_note}</p>
      </Card>
      {extra}
    </div>
  );
}
