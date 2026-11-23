import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, formatINR, formatNumber, PERM, PROPOSAL_STATUS_LABELS, STAGE_LABELS, STAGES, type Calculation } from "@skj/shared";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BillAnalysisCard, BillsTable, BillUploader, usePolling } from "../components/Bills";
import { CalcForm, CalcResultsView, cleanInputs, emptyInputs } from "../components/Calculator";
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Progress, StatusBadge, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

type Tab = "overview" | "bills" | "calculations" | "proposals";

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [newCalc, setNewCalc] = useState(false);
  const [viewCalc, setViewCalc] = useState<Calculation | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const p = useQuery({ queryKey: ["project", id], queryFn: () => api.projects.get(id) });
  const bills = useQuery({ queryKey: ["project-bills", id], queryFn: () => api.projects.bills(id), enabled: tab === "bills",
    refetchInterval: (q) => usePolling(q.state.data) });
  const billsKey = (bills.data ?? []).map((b) => `${b.id}:${b.status}`).join(",");
  const analysis = useQuery({ queryKey: ["project-analysis", id, billsKey], queryFn: () => api.projects.analysis(id),
    enabled: tab === "bills" || newCalc });
  const calcs = useQuery({ queryKey: ["calcs", id], queryFn: () => api.projects.calculations(id),
    enabled: tab === "calculations" || tab === "proposals" });
  const proposals = useQuery({ queryKey: ["project-proposals", id], queryFn: () => api.projects.proposals(id),
    enabled: tab === "proposals" && can(PERM.proposalsView) });
  const dir = useQuery({ queryKey: ["directory"], queryFn: api.users.directory, enabled: can(PERM.projectsEdit) && tab === "overview" });
  const compare = useMutation({ mutationFn: () => api.calculator.compare(selected) });
  const update = useMutation({ mutationFn: (b: Record<string, unknown>) => api.projects.update(id, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", id] }) });
  const validate = useMutation({
    mutationFn: ({ cid, decision, note }: { cid: string; decision: "approved" | "rejected"; note: string }) =>
      api.calculator.validate(cid, decision, note),
    onSuccess: (c) => { setViewCalc(c); qc.invalidateQueries({ queryKey: ["calcs", id] }); },
  });
  const generate = useMutation({ mutationFn: (cid: string) => api.projects.createProposal(id, cid),
    onSuccess: (pr) => nav(`/proposals/${pr.id}`) });

  if (p.isLoading) return <Loading />;
  if (p.error) return <ErrorBox error={p.error} />;
  const proj = p.data!;

  return (
    <>
      <PageHead title={proj.name}
        sub={<><Link to={`/customers/${proj.customer_id}`}>{proj.customer_name}</Link> · {STAGE_LABELS[proj.stage]}</>} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "overview", label: "Overview" }, { key: "bills", label: `Bills (${proj.bill_count ?? 0})` },
        { key: "calculations", label: `Calculator (${proj.calculation_count ?? 0})` },
        { key: "proposals", label: `Proposals (${proj.proposal_count ?? 0})` },
      ]} />

      {tab === "overview" && (
        <div className="grid cols-2">
          <Card title="Status">
            <ErrorBox error={update.error} />
            <div className="stack">
              <Field label="Stage">
                <select value={proj.stage} disabled={!can(PERM.projectsEdit)} onChange={(e) => update.mutate({ stage: e.target.value })}>
                  {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                </select>
              </Field>
              <Field label={`Progress: ${proj.progress_pct}%`}>
                <input type="range" min={0} max={100} step={5} defaultValue={proj.progress_pct} disabled={!can(PERM.projectsEdit)}
                  onMouseUp={(e) => update.mutate({ progress_pct: Number((e.target as HTMLInputElement).value) })}
                  onKeyUp={(e) => update.mutate({ progress_pct: Number((e.target as HTMLInputElement).value) })} />
              </Field>
              <Progress pct={proj.progress_pct} />
              <Field label="BESS engineer">
                <select value={proj.engineer?.id ?? ""} disabled={!can(PERM.projectsEdit)}
                  onChange={(e) => update.mutate({ engineer_id: e.target.value || null })}>
                  <option value="">Not assigned</option>
                  {(dir.data ?? (proj.engineer ? [{ id: proj.engineer.id, full_name: proj.engineer.full_name, role: null }] : []))
                    .map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </Field>
            </div>
          </Card>
          <Card title="Details">
            <dl className="dl">
              <dt>Site</dt><dd style={{ whiteSpace: "pre-wrap" }}>{proj.site_address || "–"}</dd>
              <dt>Estimated value</dt><dd>{formatINR(proj.estimated_value_inr)}</dd>
              <dt>Target capacity</dt><dd>{formatNumber(proj.target_capacity_kwh)} kWh</dd>
              <dt>Owner</dt><dd>{proj.owner?.full_name ?? "–"}</dd>
              <dt>Created</dt><dd>{formatDate(proj.created_at)}</dd>
            </dl>
          </Card>
        </div>
      )}

      {tab === "bills" && (
        <div className="stack">
          {can(PERM.billsUpload) && <Card title="Upload bills for this project"><BillUploader customerId={proj.customer_id} projectId={id}
            onUploaded={() => { qc.invalidateQueries({ queryKey: ["project-bills", id] }); qc.invalidateQueries({ queryKey: ["project", id] }); }} /></Card>}
          <Card title="Bills">{bills.isLoading ? <Loading /> : <BillsTable bills={bills.data ?? []} />}</Card>
          <BillAnalysisCard a={analysis.data} estimateAction={can(PERM.calculatorUse) && analysis.data?.estimate?.available && analysis.data.basis === "reviewed"
            ? <button className="small primary" onClick={() => setNewCalc(true)}>Save as configuration</button> : undefined} />
        </div>
      )}

      {tab === "calculations" && (
        <Card title="Saved configurations" actions={<>
          {selected.length >= 2 && <button onClick={() => compare.mutate()}>Compare {selected.length}</button>}
          {can(PERM.calculatorUse) && <button className="primary" onClick={() => setNewCalc(true)}>New configuration</button>}
        </>}>
          {calcs.isLoading ? <Loading /> : !calcs.data?.length ? <Empty>No configurations yet.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th /><th>Name</th><th className="num">Size</th><th className="num">Investment</th><th className="num">Year-1 saving</th>
                <th className="num">Payback</th><th className="num">IRR</th><th>Validation</th></tr></thead>
              <tbody>{calcs.data.map((c) => (
                <tr key={c.id}>
                  <td><input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.includes(c.id)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, c.id].slice(-5) : selected.filter((x) => x !== c.id))} /></td>
                  <td><button className="ghost small" onClick={() => setViewCalc(c)}>{c.name}</button></td>
                  <td className="num">{formatNumber(c.results.summary.battery_capacity_kwh)} kWh / {formatNumber(c.results.summary.battery_power_kw)} kW</td>
                  <td className="num">{formatINR(c.results.financial.capex_inr, { compact: true })}</td>
                  <td className="num">{formatINR(c.results.financial.year1_net_saving_inr, { compact: true })}</td>
                  <td className="num">{c.results.financial.simple_payback_years ?? "–"} yrs</td>
                  <td className="num">{c.results.financial.irr_pct ?? "–"}%</td>
                  <td><StatusBadge status={c.validation_status} /></td>
                </tr>))}
              </tbody>
            </table></div>
          )}
          <ErrorBox error={compare.error} />
          {compare.data && (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <h3>Comparison</h3>
              <table>
                <thead><tr><th>Metric</th>{compare.data.map((c) => <th key={String(c.id)} className="num">{String(c.name)}</th>)}</tr></thead>
                <tbody>
                  {([["battery_capacity_kwh", "Capacity (kWh)"], ["battery_power_kw", "Power (kW)"], ["capex_inr", "Investment"],
                    ["year1_net_saving_inr", "Year-1 saving"], ["simple_payback_years", "Payback (yrs)"], ["npv_inr", "NPV"],
                    ["irr_pct", "IRR (%)"], ["lcos_inr_per_kwh", "LCOS (₹/kWh)"], ["gross_margin_pct", "Gross margin (%)"]] as const)
                    .filter(([k]) => compare.data.some((c) => c[k] !== undefined))
                    .map(([k, label]) => (
                      <tr key={k}><td>{label}</td>{compare.data.map((c) => (
                        <td key={String(c.id)} className="num">{k.endsWith("_inr") ? formatINR(c[k] as number, { compact: true }) : String(c[k] ?? "–")}</td>
                      ))}</tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "proposals" && (
        <Card title="Proposals">
          <ErrorBox error={generate.error} />
          {can(PERM.proposalsCreate) && (
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="small muted">Generate from a validated configuration:</span>
              {calcs.data?.filter((c) => c.validation_status === "approved").map((c) => (
                <button key={c.id} className="small" disabled={generate.isPending} onClick={() => generate.mutate(c.id)}>{c.name}</button>
              ))}
              {!calcs.data?.some((c) => c.validation_status === "approved") && <span className="small">None validated yet.</span>}
            </div>
          )}
          {!proposals.data?.length ? <Empty>No proposals yet.</Empty> : (
            <table>
              <thead><tr><th>Revision</th><th>Title</th><th>Status</th><th className="num">Investment</th><th>Updated</th></tr></thead>
              <tbody>{proposals.data.map((x) => (
                <tr key={x.id}>
                  <td>R{x.revision}</td>
                  <td><Link to={`/proposals/${x.id}`}>{x.title}</Link></td>
                  <td><StatusBadge status={x.status} /> <span className="small muted">{PROPOSAL_STATUS_LABELS[x.status]}</span></td>
                  <td className="num">{formatINR(x.key_figures.capex_inr, { compact: true })}</td>
                  <td>{formatDate(x.updated_at)}</td>
                </tr>))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {newCalc && (
        <NewCalcModal projectId={id} prefill={analysis.data?.calculator_prefill}
          onClose={() => setNewCalc(false)}
          onSaved={() => { setNewCalc(false); qc.invalidateQueries({ queryKey: ["calcs", id] }); qc.invalidateQueries({ queryKey: ["project", id] }); }} />
      )}
      {viewCalc && (
        <Modal wide title={viewCalc.name} onClose={() => setViewCalc(null)}>
          <div className="stack">
            <div className="row"><StatusBadge status={viewCalc.validation_status} />
              {viewCalc.validation_note && <span className="small">“{viewCalc.validation_note}”</span>}</div>
            {can(PERM.calculationsValidate) && viewCalc.validation_status === "pending" && viewCalc.created_by_id !== me?.id && (
              <ValidateBox busy={validate.isPending} error={validate.error}
                onDecide={(decision, note) => validate.mutate({ cid: viewCalc.id, decision, note })} />
            )}
            <CalcResultsView results={viewCalc.results} commercial={viewCalc.commercial} />
          </div>
        </Modal>
      )}
    </>
  );
}

function ValidateBox({ onDecide, busy, error }: { onDecide: (d: "approved" | "rejected", note: string) => void; busy: boolean; error: unknown }) {
  const [note, setNote] = useState("");
  return (
    <div className="card">
      <h3>Technical validation</h3>
      <p className="small muted">Confirm the configuration suits the site (load profile, space, grid connection, safety).</p>
      <ErrorBox error={error} />
      <textarea placeholder="Engineering notes" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" disabled={busy} onClick={() => onDecide("approved", note)}>Approve configuration</button>
        <button className="danger" disabled={busy} onClick={() => onDecide("rejected", note)}>Reject</button>
      </div>
    </div>
  );
}

function NewCalcModal({ projectId, prefill, onClose, onSaved }: {
  projectId: string; prefill?: Record<string, unknown>; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState("Option A");
  const [inputs, setInputs] = useState(() => {
    const base = emptyInputs();
    for (const [k, v] of Object.entries(prefill ?? {})) if (k in base && typeof v === "number" && v > 0) (base as Record<string, number | null>)[k] = v;
    return base;
  });
  const defaults = useQuery({ queryKey: ["calc-defaults"], queryFn: api.calculator.defaults });
  const preview = useMutation({ mutationFn: () => api.calculator.preview(cleanInputs(inputs)) });
  const save = useMutation({ mutationFn: () => api.projects.saveCalculation(projectId, name, cleanInputs(inputs)), onSuccess: onSaved });
  return (
    <Modal wide title="New BESS configuration" onClose={onClose}>
      <div className="stack">
        {prefill?.monthly_consumption_kwh ? <div className="info">Pre-filled from reviewed bills. Check every value.</div> : null}
        <Field label="Configuration name"><input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></Field>
        <CalcForm value={inputs} onChange={setInputs} defaults={defaults.data} />
        <ErrorBox error={preview.error || save.error} />
        <div className="row">
          <button onClick={() => preview.mutate()} disabled={preview.isPending}>Preview</button>
          <button className="primary" onClick={() => save.mutate()} disabled={save.isPending || !name}>Save for validation</button>
        </div>
        {preview.data && <CalcResultsView results={preview.data.results} commercial={preview.data.commercial} />}
      </div>
    </Modal>
  );
}
