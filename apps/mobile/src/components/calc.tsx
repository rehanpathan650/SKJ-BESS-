import { DEFAULT_CALC_INPUTS, formatINR, formatNumber, type CalcInputs, type CalcResults, type Commercial } from "@skj/shared";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ColumnChart, LineChart } from "./charts";
import { Card, Input, Kpi, Notice, P, Row, s, useIsTablet, useTheme } from "./ui";

const money = (n: number) => formatINR(n, { compact: true }).replace(".00 ", " ");

export type CalcValues = Record<keyof CalcInputs, string>;

export function initialValues(prefill?: Partial<Record<string, unknown>>): CalcValues {
  const out = {} as CalcValues;
  for (const [k, v] of Object.entries(DEFAULT_CALC_INPUTS)) out[k as keyof CalcInputs] = v === null ? "" : String(v);
  for (const [k, v] of Object.entries(prefill ?? {})) if (k in out && typeof v === "number" && v > 0) out[k as keyof CalcInputs] = String(v);
  return out;
}

export function toInputs(v: CalcValues): Partial<CalcInputs> {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v)) if (x.trim() !== "" && !Number.isNaN(Number(x))) out[k] = Number(x);
  return out as Partial<CalcInputs>;
}

const MAIN: [keyof CalcInputs, string][] = [
  ["monthly_consumption_kwh", "Monthly consumption (kWh)"],
  ["peak_share_pct", "Peak-hour share (%)"],
  ["peak_tariff_inr", "Peak rate (₹/kWh)"],
  ["offpeak_tariff_inr", "Charging rate (₹/kWh)"],
  ["recorded_max_demand_kva", "Max demand (kVA)"],
  ["contract_demand_kva", "Contract demand (kVA)"],
  ["demand_charge_inr_per_kva", "Demand charge (₹/kVA/month)"],
  ["battery_capacity_kwh", "Battery capacity (kWh)"],
  ["battery_power_kw", "Battery power (kW)"],
];
const ADVANCED: [keyof CalcInputs, string][] = [
  ["peak_window_hours", "Peak window (h/day)"], ["min_billing_demand_pct", "Min billing demand (% CD)"],
  ["power_factor", "Power factor"], ["peak_shaving_kva", "Peak shaving target (kVA, blank=auto)"],
  ["depth_of_discharge_pct", "Depth of discharge (%)"], ["round_trip_efficiency_pct", "Round-trip efficiency (%)"],
  ["cycles_per_day", "Cycles per day"], ["operating_days_per_year", "Operating days/year"],
  ["project_life_years", "Project life (yrs, blank=default)"], ["degradation_pct_per_year", "Degradation %/yr (blank=default)"],
  ["tariff_escalation_pct", "Tariff escalation % (blank=default)"], ["discount_rate_pct", "Discount rate % (blank=default)"],
  ["sales_discount_pct", "Sales discount (%)"],
];

export function CalcFormMobile({ value, onChange }: { value: CalcValues; onChange: (v: CalcValues) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const t = useTheme();
  const field = ([k, label]: [keyof CalcInputs, string]) => (
    <Input key={k} label={label} value={value[k]} keyboardType="decimal-pad" onChangeText={(x) => onChange({ ...value, [k]: x.replace(/[^0-9.]/g, "") })} />
  );
  return (
    <View>
      <View style={[s.row, { gap: 10 }]}>{MAIN.map(field)}</View>
      <Pressable onPress={() => setAdvanced(!advanced)} style={{ paddingVertical: 8 }}>
        <Text style={{ color: t.brand, fontWeight: "600" }}>{advanced ? "▾ Hide" : "▸ Show"} technical & financial settings</Text>
      </Pressable>
      {advanced && <View style={[s.row, { gap: 10 }]}>{ADVANCED.map(field)}</View>}
    </View>
  );
}

export function CalcResultsMobile({ results, commercial }: { results: CalcResults; commercial?: Commercial }) {
  const f = results.financial;
  const sm = results.summary;
  const tablet = useIsTablet();
  return (
    <View>
      {results.warnings.map((w) => <Notice key={w}>{w}</Notice>)}
      <View style={s.kpis}>
        <Kpi label="Investment (incl. GST)" value={formatINR(f.capex_inr, { compact: true })} />
        <Kpi label="Year-1 net saving" value={formatINR(f.year1_net_saving_inr, { compact: true })} hint={`${formatINR(f.monthly_saving_inr)}/month`} />
        <Kpi label="Payback" value={f.simple_payback_years ? `${f.simple_payback_years} yrs` : "Beyond life"} />
        <Kpi label="IRR" value={f.irr_pct !== null ? `${f.irr_pct}%` : "–"} />
        <Kpi label="NPV" value={formatINR(f.npv_inr, { compact: true })} />
        <Kpi label="LCOS" value={f.lcos_inr_per_kwh ? `₹${f.lcos_inr_per_kwh}` : "–"} hint="per kWh" />
      </View>
      <View style={{ flexDirection: tablet ? "row" : "column", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Card title="System">
            <Row label="Capacity / power" value={`${formatNumber(sm.battery_capacity_kwh)} kWh / ${formatNumber(sm.battery_power_kw)} kW`} />
            <Row label="Usable" value={`${formatNumber(sm.usable_capacity_kwh)} kWh`} />
            <Row label="Energy shifted / day" value={`${formatNumber(sm.daily_energy_shifted_kwh)} kWh`} />
            <Row label="Peak shaving" value={`${formatNumber(sm.peak_shaving_kva)} kVA`} />
            <Row label="Billed demand" value={`${formatNumber(sm.billed_demand_before_kva)} → ${formatNumber(sm.billed_demand_after_kva)} kVA`} />
          </Card>
        </View>
        <View style={{ flex: 1 }}>
          <Card title="Year 1">
            <Row label="ToD arbitrage" value={formatINR(f.year1_arbitrage_saving_inr)} />
            <Row label="Demand charges" value={formatINR(f.year1_demand_saving_inr)} />
            <Row label="O&M" value={`−${formatINR(f.year1_om_cost_inr)}`} />
            <Row label="Lifetime net saving" value={formatINR(f.lifetime_net_saving_inr, { compact: true })} />
          </Card>
        </View>
      </View>
      <View style={{ flexDirection: tablet ? "row" : "column", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Card title="Savings by year">
            <ColumnChart caption="Time-of-day and demand-charge savings by year" labels={results.yearly.map((y) => `Y${y.year}`)}
              format={money} series={[{ name: "Time-of-day", values: results.yearly.map((y) => y.arbitrage_saving_inr) },
                { name: "Demand charges", values: results.yearly.map((y) => y.demand_saving_inr) }]} />
          </Card>
        </View>
        <View style={{ flex: 1 }}>
          <Card title="Payback">
            <LineChart caption="Cumulative cash position by year, starting from the investment"
              labels={["Start", ...results.yearly.map((y) => `Y${y.year}`)]} format={money}
              series={{ name: "Cumulative cash", values: [-f.capex_inr, ...results.yearly.map((y) => y.cumulative_inr)] }}
              note={f.simple_payback_years ? `Pays back after ${f.simple_payback_years} years, where the line crosses zero. Tap a point for its value.`
                : "Does not pay back within the project life."} />
          </Card>
        </View>
      </View>
      {commercial && (
        <Card title="Confidential: cost & margin">
          <Row label="Total cost" value={formatINR(commercial.total_cost_inr)} />
          <Row label="Gross margin" value={`${formatINR(commercial.gross_margin_inr)} (${commercial.gross_margin_pct}%)`} />
        </Card>
      )}
      <P muted small>{results.assumptions_note}</P>
    </View>
  );
}
