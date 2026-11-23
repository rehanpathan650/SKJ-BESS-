import { useMutation, useQuery } from "@tanstack/react-query";
import { BILL_FIELD_LABELS, formatINR, type Bill, type CalcInputs, type QuoteOptions } from "@skj/shared";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Card, ErrorBox, Field, Kpi, PageHead } from "../components/ui";
import { api } from "../lib/api";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.csv";
const money = (n: number) => formatINR(n, { compact: true }).replace(".00 ", " ");
const KEY_FIELDS = [
  "consumer_name", "consumer_address", "consumer_number", "bill_month", "activity", "contract_demand_kva",
  "recorded_max_demand_kva", "billed_demand_kva", "units_kwh", "units_kvah", "tod_peak_kwh",
  "energy_rate_inr_per_unit", "tod_peak_surcharge_inr_per_unit", "demand_rate_inr_per_kva", "tod_peak_window_hours",
  "solar_capacity_kw", "total_amount_inr",
];
const TEXT = new Set(["consumer_name", "consumer_address", "consumer_number", "bill_month", "activity"]);
const LABELS: Record<string, string> = {
  ...BILL_FIELD_LABELS, consumer_address: "Address", activity: "Activity", tod_peak_window_hours: "Peak zone length (hours)",
  solar_capacity_kw: "Existing solar (kW)", tod_peak_surcharge_inr_per_unit: "Peak-zone surcharge (₹/unit)",
};

function Steps({ step }: { step: number }) {
  const names = ["Upload the bill", "Check the values", "Choose and generate"];
  return (
    <ol className="row" style={{ listStyle: "none", padding: 0, margin: "0 0 18px", gap: 18 }} aria-label="Progress">
      {names.map((n, i) => (
        <li key={n} className="row" style={{ gap: 6, color: i === step ? "var(--text)" : "var(--muted)", fontWeight: i === step ? 600 : 400 }}
          aria-current={i === step ? "step" : undefined}>
          {i < step ? <CheckCircle2 size={18} color="var(--ok)" /> : <span className="count" style={{ background: i === step ? "var(--brand)" : "var(--border)", color: "#fff" }}>{i + 1}</span>}
          {n}
        </li>
      ))}
    </ol>
  );
}

export function NewQuotationPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  // The address keeps the progress (?project=…&bill=…&step=…), so a refresh does not lose the upload.
  const projectId = params.get("project");
  const billId = params.get("bill");
  const step = projectId && billId ? Number(params.get("step") ?? 1) : 0;
  const go = (next: Record<string, string>) => setParams({ ...Object.fromEntries(params), ...next }, { replace: true });

  return (
    <>
      <PageHead title="New quotation" sub="Upload the customer's electricity bill. The app reads it, sizes the battery and prepares a complete techno-commercial quotation." />
      <Steps step={step} />
      {step === 0 && <UploadStep customerId={params.get("customer")} onDone={(pid, bid) => go({ project: pid, bill: bid, step: "1" })} />}
      {step === 1 && billId && <ReviewStep billId={billId} onDone={() => go({ step: "2" })} />}
      {step === 2 && projectId && <OptionsStep projectId={projectId} onCreated={(id) => nav(`/proposals/${id}`)} />}
    </>
  );
}

function UploadStep({ customerId, onDone }: { customerId: string | null; onDone: (projectId: string, billId: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const start = useMutation({
    mutationFn: (files: FileList) => {
      const form = new FormData();
      Array.from(files).slice(0, 12).forEach((f) => form.append("files", f));
      if (customerId) form.append("customer_id", customerId);
      return api.quotations.start(form);
    },
    onSuccess: (r) => onDone(r.project_id, r.bills[0].id),
  });
  return (
    <Card title="1. The customer's electricity bill">
      <ErrorBox error={start.error} />
      <div className={`dropzone ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) start.mutate(e.dataTransfer.files); }}>
        <FileUp size={32} color="var(--brand)" aria-hidden="true" />
        <p><strong>{start.isPending ? "Uploading…" : "Drop the bill here"}</strong></p>
        <p className="small">PDF from the DISCOM portal works best. Photos, Excel and CSV are also accepted.</p>
        <button type="button" className="primary" disabled={start.isPending} onClick={() => input.current?.click()}>Choose bill</button>
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files?.length && start.mutate(e.target.files)} />
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        {customerId ? "The bill is added to this customer." : "A new customer is created and named from the bill."} Files are scanned for malware and stored encrypted.
      </p>
    </Card>
  );
}

function ReviewStep({ billId, onDone }: { billId: string; onDone: () => void }) {
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
        out[k] = v === "" ? null : TEXT.has(k) || ["discom", "tariff_category", "notes"].includes(k) ? v : Number(v);
      }
      return api.bills.review(billId, out, true);
    },
    onSuccess: onDone,
  });
  if (!bill || ["queued", "scanning", "extracting"].includes(bill.status)) {
    return (
      <Card title="2. Reading the bill">
        <p className="row"><Loader2 size={18} className="spin" aria-hidden="true" /> {bill?.status === "scanning" ? "Checking the file for malware…" : "Reading the values from the bill…"}</p>
        <p className="small muted">Usually takes a few seconds. Keep the Worker running.</p>
      </Card>
    );
  }
  if (["failed", "rejected"].includes(bill.status)) {
    return <Card title="2. The bill could not be read"><ErrorBox error={new Error(bill.status_detail || "Processing failed")} /></Card>;
  }
  return (
    <Card title="2. Check the values read from the bill" actions={<MethodBadge bill={bill} />}>
      <p className="small muted">Compare with the bill and correct anything wrong. These values drive every figure in the quotation.</p>
      <form onSubmit={(e) => { e.preventDefault(); confirm.mutate(); }}>
        <div className="form-grid" style={{ marginTop: 12 }}>
          {KEY_FIELDS.filter((k) => k in values).map((k) => (
            <Field key={k} label={LABELS[k] ?? k}>
              <input type={TEXT.has(k) ? "text" : "number"} step="any" value={values[k] ?? ""}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="small muted">All other fields</summary>
          <div className="form-grid" style={{ marginTop: 10 }}>
            {Object.keys(values).filter((k) => !KEY_FIELDS.includes(k) && !["document_is_electricity_bill", "confidence", "notes"].includes(k)).map((k) => (
              <Field key={k} label={LABELS[k] ?? k}>
                <input value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
        </details>
        <ErrorBox error={confirm.error} />
        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" disabled={confirm.isPending}>{confirm.isPending ? "Saving…" : "Values are correct, continue"}</button>
        </div>
      </form>
    </Card>
  );
}

function MethodBadge({ bill }: { bill: Bill }) {
  const label = bill.extraction_method === "ai" ? "read by AI" : bill.extraction_method === "msedcl" ? "MSEDCL bill reader" : "enter values";
  return <Badge tone={bill.extraction_method === "manual" ? "warn" : "info"}>{label}</Badge>;
}

type SizeChoice = { kind: "auto" } | { kind: "option"; kwh: number; kw: number } | { kind: "custom" };

function OptionsStep({ projectId, onCreated }: { projectId: string; onCreated: (proposalId: string) => void }) {
  const defaults = useQuery({ queryKey: ["quote-defaults"], queryFn: api.quotations.defaults });
  const [opts, setOpts] = useState<QuoteOptions | null>(null);
  useEffect(() => { if (defaults.data && !opts) setOpts(defaults.data.options); }, [defaults.data, opts]);
  const [size, setSize] = useState<SizeChoice>({ kind: "auto" });
  const [custom, setCustom] = useState({ kwh: "", kw: "" });
  const [price, setPrice] = useState("");
  const [cd, setCd] = useState({ value: "", count: false });
  const [base, setBase] = useState<CalcInputs | null>(null);

  const inputs: Partial<CalcInputs> | null = (() => {
    if (!base) return null;
    const over: Partial<CalcInputs> = {};
    if (size.kind === "option") Object.assign(over, { battery_capacity_kwh: size.kwh, battery_power_kw: size.kw });
    if (size.kind === "custom" && Number(custom.kwh) > 0 && Number(custom.kw) > 0)
      Object.assign(over, { battery_capacity_kwh: Number(custom.kwh), battery_power_kw: Number(custom.kw) });
    if (Number(price) > 0) over.project_value_ex_gst_inr = Number(price);
    if (Number(cd.value) > 0) Object.assign(over, { proposed_contract_demand_kva: Number(cd.value), count_cd_revision_in_savings: cd.count });
    return Object.keys(over).length ? { ...base, ...over } : null;
  })();
  const request = useDeferredValue(JSON.stringify({ inputs, options: opts }));
  const preview = useQuery({
    queryKey: ["quote-preview", projectId, request],
    queryFn: () => api.quotations.preview(projectId, JSON.parse(request)),
    enabled: !!opts, placeholderData: (prev) => prev,
  });
  useEffect(() => { if (preview.data && !base && !inputs) setBase(preview.data.inputs); }, [preview.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useMutation({ mutationFn: () => api.quotations.create(projectId, JSON.parse(request)), onSuccess: (p) => onCreated(p.id) });

  if (!opts) return <Card title="3. Choose and generate"><p className="muted">Loading…</p></Card>;
  const c = preview.data?.content;
  const set = <K extends keyof QuoteOptions>(k: K, v: QuoteOptions[K]) => setOpts({ ...opts, [k]: v });

  return (
    <div className="split">
      <div className="stack">
        <Card title="Battery size">
          <div className="stack">
            <label className="row"><input type="radio" checked={size.kind === "auto"} onChange={() => setSize({ kind: "auto" })} /> Best value for this bill (recommended)</label>
            {c?.size_options.filter((o) => !o.recommended).map((o) => (
              <label key={`${o.battery_power_kw}-${o.battery_capacity_kwh}`} className="row">
                <input type="radio" checked={size.kind === "option" && size.kwh === o.battery_capacity_kwh && size.kw === o.battery_power_kw}
                  onChange={() => setSize({ kind: "option", kwh: o.battery_capacity_kwh, kw: o.battery_power_kw })} />
                {o.battery_power_kw.toLocaleString("en-IN")} kW / {o.battery_capacity_kwh.toLocaleString("en-IN")} kWh
                <span className="small muted">payback {o.payback_years ? `${o.payback_years} yrs` : "beyond life"}</span>
              </label>
            ))}
            <label className="row"><input type="radio" checked={size.kind === "custom"} onChange={() => setSize({ kind: "custom" })} /> Custom size</label>
            {size.kind === "custom" && (
              <div className="form-grid">
                <Field label="Battery capacity (kWh)"><input type="number" min={50} value={custom.kwh} onChange={(e) => setCustom({ ...custom, kwh: e.target.value })} /></Field>
                <Field label="PCS power (kW)"><input type="number" min={25} value={custom.kw} onChange={(e) => setCustom({ ...custom, kw: e.target.value })} /></Field>
              </div>
            )}
          </div>
        </Card>
        <Card title="Price and purpose">
          <div className="form-grid">
            <Field label="Project value excl. GST (₹)" help="Blank = from your pricing settings">
              <input type="number" min={0} value={price} placeholder={c ? String(c.boq.subtotal) : ""} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Main purpose">
              <select value={opts.purpose} onChange={(e) => set("purpose", e.target.value as QuoteOptions["purpose"])}>
                {Object.entries(defaults.data?.purposes ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Backup">
              <select value={opts.backup} onChange={(e) => set("backup", e.target.value as QuoteOptions["backup"])}>
                <option value="none">No backup</option><option value="critical">Critical loads only</option><option value="full">Whole plant</option>
              </select>
            </Field>
            <Field label="Proposed contract demand (kVA)" help="Optional: a revision scenario with the DISCOM">
              <input type="number" min={0} value={cd.value} onChange={(e) => setCd({ ...cd, value: e.target.value })} />
            </Field>
          </div>
          {Number(cd.value) > 0 && <label className="row small" style={{ marginTop: 8 }}><input type="checkbox" checked={cd.count} onChange={(e) => setCd({ ...cd, count: e.target.checked })} />
            Count the contract-demand saving in payback (it does not need the battery)</label>}
        </Card>
        <Card title="Finance and terms">
          <label className="row"><input type="checkbox" checked={opts.financing} onChange={(e) => set("financing", e.target.checked)} /> Include a bank-finance (EMI) schedule</label>
          {opts.financing && (
            <div className="form-grid" style={{ marginTop: 10 }}>
              <Field label="Down payment (%)"><input type="number" min={0} max={100} value={opts.down_payment_pct} onChange={(e) => set("down_payment_pct", Number(e.target.value))} /></Field>
              <Field label="Interest (% p.a.)"><input type="number" min={0} max={30} step="0.1" value={opts.interest_pct} onChange={(e) => set("interest_pct", Number(e.target.value))} /></Field>
              <Field label="Tenure (years)">
                <select value={opts.tenure_years} onChange={(e) => set("tenure_years", Number(e.target.value))}>{[3, 5, 7, 10].map((y) => <option key={y} value={y}>{y}</option>)}</select>
              </Field>
            </div>
          )}
          <h3 style={{ marginTop: 14 }}>Payment milestones</h3>
          {opts.milestones.map((m, i) => (
            <div key={i} className="row" style={{ marginBottom: 6, flexWrap: "nowrap" }}>
              <input aria-label={`Milestone ${i + 1}`} value={m.label} onChange={(e) => set("milestones", opts.milestones.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <input aria-label={`Milestone ${i + 1} percent`} type="number" min={1} max={100} value={m.pct} style={{ width: 90 }}
                onChange={(e) => set("milestones", opts.milestones.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) } : x))} />
              <span>%</span>
            </div>
          ))}
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label="Validity (days)"><input type="number" min={1} max={120} value={opts.validity_days} onChange={(e) => set("validity_days", Number(e.target.value))} /></Field>
            <Field label="Execution (weeks)"><input value={opts.execution_weeks} onChange={(e) => set("execution_weeks", e.target.value)} /></Field>
            <Field label="Battery warranty (years)"><input type="number" min={1} max={20} value={opts.battery_warranty_years} onChange={(e) => set("battery_warranty_years", Number(e.target.value))} /></Field>
          </div>
          <Field label="Extra note in terms (optional)"><textarea maxLength={1000} value={opts.extra_notes} onChange={(e) => set("extra_notes", e.target.value)} /></Field>
        </Card>
      </div>

      <div className="stack" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
        <Card title="Quotation figures" actions={preview.isFetching ? <span className="small muted">Updating…</span> : undefined}>
          <ErrorBox error={preview.error} />
          {c && (
            <>
              <div className="grid kpis">
                <Kpi label="System" tone="accent" value={`${c.system.power_kw.toLocaleString("en-IN")} kW / ${c.system.capacity_kwh.toLocaleString("en-IN")} kWh`} hint={`${c.system.duration_h} hours`} />
                <Kpi label="Project value" value={money(c.boq.total)} hint={`${money(c.boq.subtotal)} + GST`} />
                <Kpi label="Net saving, year 1" value={money(c.savings.net_year1)} hint={`${formatINR(c.savings.monthly)}/month`} />
                <Kpi label="Payback" tone="warn" value={c.savings.payback_years ? `${c.savings.payback_years} yrs` : "Beyond life"} hint={c.savings.irr_pct !== null ? `IRR ${c.savings.irr_pct}%` : undefined} />
                {c.financing && <Kpi label="EMI" value={money(c.financing.emi)} hint={`saving − EMI: ${money(c.financing.net_monthly_during_loan)}/month`} />}
              </div>
              {c.savings.warnings.map((w) => <p key={w} className="notice" style={{ marginTop: 8 }}>{w}</p>)}
              <ul className="small" style={{ marginTop: 10 }}>{c.observations.map((o) => <li key={o}>{o}</li>)}</ul>
            </>
          )}
          <ErrorBox error={create.error} />
          <button className="primary" style={{ marginTop: 12, width: "100%", justifyContent: "center" }} disabled={!c || create.isPending}
            onClick={() => create.mutate()}>{create.isPending ? "Generating quotation…" : "Generate quotation"}</button>
          <p className="small muted" style={{ marginTop: 6 }}>Creates the full quotation with BOQ, payment and EMI schedules, savings, layout drawing and PDF.</p>
        </Card>
      </div>
    </div>
  );
}
