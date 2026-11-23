import { useMutation, useQuery } from "@tanstack/react-query";
import { BILL_FIELD_LABELS, formatINR, type CalcInputs, type QuoteOptions } from "@skj/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { Badge, Button, Card, Choice, ErrorBox, font, Input, Kpi, Loading, Notice, P, s, useTheme } from "../../components/ui";
import { BillUpload } from "../../components/upload";
import { api } from "../../lib/session";

const money = (n: number) => formatINR(n, { compact: true }).replace(".00 ", " ");
const KEY_FIELDS = ["consumer_name", "consumer_address", "bill_month", "contract_demand_kva", "recorded_max_demand_kva",
  "billed_demand_kva", "units_kwh", "units_kvah", "tod_peak_kwh", "energy_rate_inr_per_unit", "tod_peak_surcharge_inr_per_unit",
  "demand_rate_inr_per_kva", "tod_peak_window_hours", "total_amount_inr"];
const TEXT = new Set(["consumer_name", "consumer_address", "consumer_number", "bill_month", "activity", "discom", "tariff_category", "notes"]);
const LABELS: Record<string, string> = { ...BILL_FIELD_LABELS, consumer_address: "Address", tod_peak_window_hours: "Peak zone (hours)",
  tod_peak_surcharge_inr_per_unit: "Peak surcharge (₹/unit)" };

/** Bill in, quotation out: upload -> check values -> choose size/finance -> generate. Progress is kept in the route. */
export default function NewQuotation() {
  const params = useLocalSearchParams<{ customer?: string; project?: string; bill?: string; step?: string }>();
  const t = useTheme();
  const step = params.project && params.bill ? Number(params.step ?? 1) : 0;
  const go = (p: Record<string, string>) => router.setParams(p);
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={[s.row, { marginBottom: 12 }]}>
        {["Upload", "Check", "Generate"].map((n, i) => (
          <Badge key={n} label={`${i + 1}. ${n}`} tone={i === step ? "brand" : i < step ? "ok" : "neutral"} />
        ))}
      </View>
      {step === 0 && (
        <Card title="The customer's electricity bill">
          <P muted>Upload the DISCOM PDF, or photograph the bill. The app reads it and prepares the quotation.</P>
          <View style={{ height: 10 }} />
          <BillUpload onDone={() => undefined} send={async (form) => {
            if (params.customer) form.append("customer_id", params.customer);
            const r = await api.quotations.start(form);
            go({ project: r.project_id, bill: r.bills[0].id, step: "1" });
          }} />
        </Card>
      )}
      {step === 1 && params.bill && <Review billId={params.bill} onDone={() => go({ step: "2" })} />}
      {step === 2 && params.project && <Options projectId={params.project} />}
    </ScrollView>
  );
}

function Review({ billId, onDone }: { billId: string; onDone: () => void }) {
  const q = useQuery({ queryKey: ["bill", billId], queryFn: () => api.bills.get(billId),
    refetchInterval: (x) => (["queued", "scanning", "extracting"].includes(x.state.data?.status ?? "queued") ? 2500 : false) });
  const bill = q.data;
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!bill || !["needs_review", "reviewed"].includes(bill.status)) return;
    const src = (bill.reviewed ?? bill.extracted ?? {}) as Record<string, unknown>;
    setValues(Object.fromEntries((bill.editable_fields ?? []).map((k) => [k, src[k] === null || src[k] === undefined ? "" : String(src[k])])));
  }, [bill?.id, bill?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirm = useMutation({
    mutationFn: () => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (k === "document_is_electricity_bill" || k === "confidence") continue;
        out[k] = v === "" ? null : TEXT.has(k) ? v : Number(v);
      }
      return api.bills.review(billId, out, true);
    },
    onSuccess: onDone,
  });
  if (!bill || ["queued", "scanning", "extracting"].includes(bill.status)) {
    return <Card title="Reading the bill"><Loading rows={2} /><P muted small>Checking for malware and reading the values…</P></Card>;
  }
  if (["failed", "rejected"].includes(bill.status)) return <Card title="The bill could not be read"><ErrorBox error={new Error(bill.status_detail)} /></Card>;
  return (
    <Card title="Check the values" right={<Badge label={bill.extraction_method === "msedcl" ? "MSEDCL reader" : bill.extraction_method === "ai" ? "read by AI" : "enter values"} tone="info" />}>
      <P muted small>Compare with the bill. These values drive every figure in the quotation.</P>
      <View style={{ height: 10 }} />
      {KEY_FIELDS.filter((k) => k in values).map((k) => (
        <Input key={k} label={LABELS[k] ?? k} value={values[k] ?? ""} keyboardType={TEXT.has(k) ? "default" : "decimal-pad"}
          onChangeText={(v) => setValues({ ...values, [k]: TEXT.has(k) ? v : v.replace(/[^0-9.-]/g, "") })} />
      ))}
      <ErrorBox error={confirm.error} />
      <Button title="Values are correct, continue" variant="primary" loading={confirm.isPending} onPress={() => confirm.mutate()} />
    </Card>
  );
}

function Options({ projectId }: { projectId: string }) {
  const t = useTheme();
  const defaults = useQuery({ queryKey: ["quote-defaults"], queryFn: api.quotations.defaults });
  const [opts, setOpts] = useState<QuoteOptions | null>(null);
  useEffect(() => { if (defaults.data && !opts) setOpts(defaults.data.options); }, [defaults.data, opts]);
  const [base, setBase] = useState<CalcInputs | null>(null);
  const [size, setSize] = useState("auto");
  const [price, setPrice] = useState("");

  const inputs: Partial<CalcInputs> | null = (() => {
    if (!base) return null;
    const over: Partial<CalcInputs> = {};
    if (size !== "auto") {
      const [kw, kwh] = size.split("/").map(Number);
      Object.assign(over, { battery_power_kw: kw, battery_capacity_kwh: kwh });
    }
    if (Number(price) > 0) over.project_value_ex_gst_inr = Number(price);
    return Object.keys(over).length ? { ...base, ...over } : null;
  })();
  const body = { inputs, options: opts ?? undefined };
  const preview = useQuery({ queryKey: ["quote-preview", projectId, JSON.stringify(body)], enabled: !!opts,
    queryFn: () => api.quotations.preview(projectId, body), placeholderData: (prev) => prev });
  useEffect(() => { if (preview.data && !base) setBase(preview.data.inputs); }, [preview.data, base]);
  const create = useMutation({ mutationFn: () => api.quotations.create(projectId, body),
    onSuccess: (p) => router.replace(`/proposal/${p.id}`) });

  if (!opts) return <Loading rows={3} />;
  const c = preview.data?.content;
  const set = <K extends keyof QuoteOptions>(k: K, v: QuoteOptions[K]) => setOpts({ ...opts, [k]: v });
  return (
    <>
      <Card title="Battery size">
        <Choice value={size} onChange={(v) => setSize(v || "auto")} options={[{ key: "auto", label: "Best value" },
          ...(c?.size_options ?? []).filter((o) => !o.recommended).map((o) => ({ key: `${o.battery_power_kw}/${o.battery_capacity_kwh}`,
            label: `${o.battery_power_kw} kW / ${o.battery_capacity_kwh} kWh` }))]} />
        <Input label="Project value excl. GST (₹)" help="Blank = from pricing settings" keyboardType="number-pad" value={price}
          placeholder={c ? String(c.boq.subtotal) : ""} onChangeText={(v) => setPrice(v.replace(/\D/g, ""))} />
      </Card>
      <Card title="Finance">
        <View style={s.rowBetween}>
          <Text style={[font.regular, { color: t.text }]}>Include bank finance (EMI)</Text>
          <Switch value={opts.financing} onValueChange={(v) => set("financing", v)} accessibilityLabel="Include bank finance" />
        </View>
        {opts.financing && (
          <View style={[s.row, { gap: 10, marginTop: 10 }]}>
            <Input label="Down payment %" keyboardType="decimal-pad" value={String(opts.down_payment_pct)} onChangeText={(v) => set("down_payment_pct", Number(v) || 0)} />
            <Input label="Interest % p.a." keyboardType="decimal-pad" value={String(opts.interest_pct)} onChangeText={(v) => set("interest_pct", Number(v) || 0)} />
            <Choice label="Tenure" value={String(opts.tenure_years)} onChange={(v) => set("tenure_years", Number(v) || 5)}
              options={["3", "5", "7", "10"].map((y) => ({ key: y, label: `${y} yrs` }))} />
          </View>
        )}
      </Card>
      <Card title="Quotation figures">
        <ErrorBox error={preview.error} />
        {!c ? <Loading rows={2} /> : (
          <>
            <View style={s.kpis}>
              <Kpi label="System" accent="brand" value={`${c.system.power_kw} kW / ${c.system.capacity_kwh} kWh`} />
              <Kpi label="Project value" value={money(c.boq.total)} hint="incl. GST" />
              <Kpi label="Saving, year 1" value={money(c.savings.net_year1)} hint={`${formatINR(c.savings.monthly)}/month`} />
              <Kpi label="Payback" accent="charge" value={c.savings.payback_years ? `${c.savings.payback_years} yrs` : "Beyond life"} />
              {c.financing && <Kpi label="EMI" value={money(c.financing.emi)} hint={`net ${money(c.financing.net_monthly_during_loan)}/month`} />}
            </View>
            {c.savings.warnings.map((w) => <Notice key={w}>{w}</Notice>)}
          </>
        )}
        <ErrorBox error={create.error} />
        <Button title="Generate quotation" variant="primary" icon="file-plus" disabled={!c} loading={create.isPending} onPress={() => create.mutate()} />
        <P muted small style={{ marginTop: 6 }}>Full quotation with BOQ, payment and EMI schedules, savings, layout drawing and PDF.</P>
      </Card>
    </>
  );
}
