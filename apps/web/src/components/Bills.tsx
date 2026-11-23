import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BILL_STATUS_LABELS, formatDate, formatINR, formatNumber, type Bill, type BillAnalysis } from "@skj/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { EstimateCard } from "./Estimate";
import { BarList, Card, DropZone, Empty, ErrorBox, Kpi, StatusBadge } from "./ui";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.csv";

export function BillUploader({ customerId, projectId, onUploaded }: { customerId: string; projectId?: string; onUploaded?: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: File[]) {
    if (!files?.length) return;
    const form = new FormData();
    Array.from(files).slice(0, 12).forEach((f) => form.append("files", f));
    if (projectId) form.append("project_id", projectId);
    setBusy(true);
    setError(null);
    try {
      await api.customers.uploadBills(customerId, form);
      onUploaded?.();
    } catch (e) { setError(e); } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <DropZone title="Drop electricity bills here" button="Choose files" accept={ACCEPT} multiple busy={busy}
        hint="PDF, photo, Excel or CSV. Up to 12 files, 15 MB each." onFiles={upload} />
      <p className="small muted">Files are scanned for malware and read automatically. Every value must be checked by a person before use.</p>
    </div>
  );
}

export function BillsTable({ bills }: { bills: Bill[] }) {
  if (!bills.length) return <Empty>No bills uploaded yet.</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>File</th><th>Month</th><th className="num">Units (kWh)</th><th>Status</th><th>Flags</th><th>Uploaded</th></tr></thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.id}>
              <td><Link to={`/bills/${b.id}`}>{b.file_name}</Link><div className="small muted">{b.extraction_method || "–"}</div></td>
              <td>{b.bill_month ?? "–"}</td>
              <td className="num">{formatNumber(b.units_kwh)}</td>
              <td><StatusBadge status={b.status} /><div className="small muted">{BILL_STATUS_LABELS[b.status]}</div></td>
              <td>{b.security_flags.length ? <span className="badge warn">{b.security_flags.length} flag(s)</span> : "–"}</td>
              <td className="nowrap">{formatDate(b.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BillAnalysisCard({ a, estimateAction }: { a: BillAnalysis | undefined; estimateAction?: React.ReactNode }) {
  if (!a) return null;
  return (
    <>
      {a.estimate && (a.estimate.available || a.estimate.bill_count > 0 || a.bill_count > 0) && <EstimateCard e={a.estimate} action={estimateAction} />}
      <AnalysisDetails a={a} />
    </>
  );
}

function AnalysisDetails({ a }: { a: BillAnalysis }) {
  if (!a.bill_count) return <Card title="Bill analysis"><Empty>{a.message}</Empty></Card>;
  return (
    <Card title={`Bill analysis (${a.bill_count} reviewed bill${a.bill_count > 1 ? "s" : ""})`}>
      <div className="grid kpis">
        <Kpi label="Average monthly consumption" value={`${formatNumber(a.avg_monthly_kwh)} kWh`} />
        <Kpi label="Max recorded demand" value={`${formatNumber(a.max_recorded_demand_kva)} kVA`}
          hint={a.contract_demand_kva ? `Contract ${formatNumber(a.contract_demand_kva)} kVA` : undefined} />
        <Kpi label="Average monthly bill" value={formatINR(a.avg_monthly_bill_inr)} />
        <Kpi label="Effective rate" value={a.effective_rate_inr_per_kwh ? `₹${a.effective_rate_inr_per_kwh}/kWh` : "–"} />
        <Kpi label="Peak-hour share" value={`${a.peak_share_pct ?? "–"}%`} />
        <Kpi label="Demand charges share" value={a.demand_charge_share_pct ? `${a.demand_charge_share_pct}%` : "–"} />
      </div>
      {a.insights?.length ? <ul>{a.insights.map((i) => <li key={i}>{i}</li>)}</ul> : null}
      {a.monthly && a.monthly.length > 1 && (
        <>
          <h3 style={{ marginTop: 12 }}>Monthly consumption</h3>
          <BarList data={a.monthly.map((m) => [m.month ?? "?", m.units_kwh ?? 0])} format={(n) => formatNumber(n)} />
        </>
      )}
      {a.calculator_prefill?.battery_capacity_kwh && (
        <p className="info" style={{ marginTop: 12 }}>
          Suggested starting size: <strong>{a.calculator_prefill.battery_capacity_kwh} kWh / {a.calculator_prefill.battery_power_kw} kW</strong>.
          Use “New configuration” in the Calculator tab to refine it.
        </p>
      )}
    </Card>
  );
}

export function useBillsRefresh(keys: unknown[][]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

export function usePolling(bills: Bill[] | undefined) {
  return bills?.some((b) => ["queued", "scanning", "extracting"].includes(b.status)) ? 3000 : false;
}

export { useMutation, useQuery };
