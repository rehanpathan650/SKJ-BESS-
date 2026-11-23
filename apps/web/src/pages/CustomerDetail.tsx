import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, formatINR, PERM, STAGE_LABELS } from "@skj/shared";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BillAnalysisCard, BillsTable, BillUploader, usePolling } from "../components/Bills";
import { Card, ConfirmButton, Empty, ErrorBox, Field, Loading, Modal, PageHead, Progress, StatusBadge, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CustomerForm } from "./Customers";

type Tab = "overview" | "projects" | "bills" | "notes" | "team";

export function CustomerDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const c = useQuery({ queryKey: ["customer", id], queryFn: () => api.customers.get(id) });
  const bills = useQuery({ queryKey: ["customer-bills", id], queryFn: () => api.customers.bills(id), enabled: tab === "bills",
    refetchInterval: (q) => usePolling(q.state.data) });
  // Re-analysed (and re-estimated) whenever a bill finishes processing or is confirmed.
  const billsKey = (bills.data ?? []).map((b) => `${b.id}:${b.status}`).join(",");
  const analysis = useQuery({ queryKey: ["customer-analysis", id, billsKey], queryFn: () => api.customers.analysis(id), enabled: tab === "bills" });
  const notes = useQuery({ queryKey: ["notes", id], queryFn: () => api.customers.notes(id), enabled: tab === "notes" });
  const dir = useQuery({ queryKey: ["directory"], queryFn: api.users.directory,
    enabled: (tab === "team" && can(PERM.customersAssign)) || newProject });
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const addNote = useMutation({ mutationFn: () => api.customers.addNote(id, note),
    onSuccess: () => { setNote(""); qc.invalidateQueries({ queryKey: ["notes", id] }); } });
  const assign = useMutation({ mutationFn: (uid: string) => api.customers.assign(id, uid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer", id] }) });
  const unassign = useMutation({ mutationFn: (uid: string) => api.customers.unassign(id, uid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer", id] }) });
  const remove = useMutation({ mutationFn: () => api.customers.remove(id), onSuccess: () => nav("/customers") });

  if (c.isLoading) return <Loading />;
  if (c.error) return <ErrorBox error={c.error} />;
  const cust = c.data!;

  return (
    <>
      <PageHead title={cust.name} sub={[cust.company, cust.industry, cust.state].filter(Boolean).join(" · ")}
        actions={<>
          {can(PERM.customersEdit) && <button onClick={() => setEditing(true)}>Edit</button>}
          {can(PERM.proposalsCreate) && can(PERM.billsUpload) && <Link className="btn primary" to={`/quotations/new?customer=${id}`}>New quotation</Link>}
          {can(PERM.projectsCreate) && <button onClick={() => setNewProject(true)}>New project</button>}
        </>} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "overview", label: "Overview" }, { key: "projects", label: `Projects (${cust.projects?.length ?? 0})` },
        { key: "bills", label: "Electricity bills" }, { key: "notes", label: "Notes" }, { key: "team", label: "Team" },
      ]} />

      {tab === "overview" && (
        <Card>
          <dl className="dl">
            <dt>Contact</dt><dd>{cust.contact_name || "–"}</dd>
            <dt>Email</dt><dd>{cust.email || "–"}</dd>
            <dt>Phone</dt><dd>{cust.phone || "–"}</dd>
            <dt>Address</dt><dd style={{ whiteSpace: "pre-wrap" }}>{cust.address || "–"}</dd>
            <dt>DISCOM</dt><dd>{cust.discom || "–"}</dd>
            <dt>Consumer number</dt><dd>{cust.consumer_number || "–"}</dd>
            <dt>Tariff category</dt><dd>{cust.tariff_category || "–"}</dd>
            <dt>GSTIN</dt><dd>{cust.gstin || "–"}</dd>
            <dt>Owner</dt><dd>{cust.owner?.full_name ?? "–"}</dd>
            <dt>Created</dt><dd>{formatDate(cust.created_at)}</dd>
          </dl>
          {can(PERM.customersDelete) && (
            <div style={{ marginTop: 16 }}>
              <ConfirmButton className="danger" message="Delete this customer and all its projects and bills?"
                onConfirm={() => remove.mutate()}>Delete customer</ConfirmButton>
            </div>
          )}
        </Card>
      )}

      {tab === "projects" && (
        <Card>
          {!cust.projects?.length ? <Empty>No projects yet.</Empty> : (
            <table>
              <thead><tr><th>Project</th><th>Stage</th><th>Progress</th><th>Engineer</th><th className="num">Value</th></tr></thead>
              <tbody>{cust.projects.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                  <td><StatusBadge status={p.stage} /></td>
                  <td style={{ width: 120 }}><Progress pct={p.progress_pct} /></td>
                  <td>{p.engineer?.full_name ?? "–"}</td>
                  <td className="num">{formatINR(p.estimated_value_inr, { compact: true })}</td>
                </tr>))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "bills" && (
        <div className="stack">
          {can(PERM.billsUpload) && <Card title="Upload bills"><BillUploader customerId={id}
            onUploaded={() => qc.invalidateQueries({ queryKey: ["customer-bills", id] })} /></Card>}
          <Card title="Bills">{bills.isLoading ? <Loading /> : <BillsTable bills={bills.data ?? []} />}</Card>
          <BillAnalysisCard a={analysis.data} />
        </div>
      )}

      {tab === "notes" && (
        <Card>
          {canAnyNote(can) && (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
              <ErrorBox error={addNote.error} />
              <textarea placeholder="Add a note (site visit, call summary, next steps)…" maxLength={5000} value={note}
                onChange={(e) => setNote(e.target.value)} />
              <div><button className="primary" disabled={addNote.isPending}>Add note</button></div>
            </form>
          )}
          <div className="spacer" />
          {notes.data?.length ? notes.data.map((n) => (
            <div key={n.id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
              <div className="small muted">{n.author} · {formatDate(n.created_at, true)}</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
            </div>
          )) : <Empty>No notes yet.</Empty>}
        </Card>
      )}

      {tab === "team" && (
        <Card title="People assigned to this customer">
          <ErrorBox error={assign.error || unassign.error} />
          <table><tbody>
            {cust.assignments?.map((a) => (
              <tr key={a.user_id}><td>{a.full_name}</td><td className="right">
                {can(PERM.customersAssign) && <button className="small" onClick={() => unassign.mutate(a.user_id)}>Remove</button>}
              </td></tr>
            ))}
          </tbody></table>
          {can(PERM.customersAssign) && (
            <div className="row" style={{ marginTop: 12 }}>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ maxWidth: 280 }}>
                <option value="">Add a person…</option>
                {dir.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name} {u.role ? `(${u.role})` : ""}</option>)}
              </select>
              <button disabled={!assignee} onClick={() => { assign.mutate(assignee); setAssignee(""); }}>Assign</button>
            </div>
          )}
        </Card>
      )}

      {editing && (
        <Modal title="Edit customer" onClose={() => setEditing(false)}>
          <CustomerForm submitLabel="Save" initial={Object.fromEntries(Object.entries(cust).filter(([, v]) => typeof v === "string")) as Record<string, string>}
            onSubmit={async (v) => {
              const allowed = ["name", "company", "industry", "contact_name", "email", "phone", "address", "state", "gstin",
                "discom", "consumer_number", "tariff_category"];
              await api.customers.update(id, Object.fromEntries(Object.entries(v).filter(([k]) => allowed.includes(k))));
              await qc.invalidateQueries({ queryKey: ["customer", id] });
              setEditing(false);
            }} />
        </Modal>
      )}
      {newProject && <NewProjectModal customerId={id} engineers={dir.data ?? []} onClose={() => setNewProject(false)} />}
    </>
  );
}

function canAnyNote(can: (p: string) => boolean) {
  return can(PERM.customersEdit) || can(PERM.projectsEdit) || can(PERM.billsUpload);
}

function NewProjectModal({ customerId, engineers, onClose }: {
  customerId: string; engineers: { id: string; full_name: string; role: string | null }[]; onClose: () => void;
}) {
  const nav = useNavigate();
  const [v, setV] = useState({ name: "", site_address: "", estimated_value_inr: "", target_capacity_kwh: "", engineer_id: "" });
  const create = useMutation({
    mutationFn: () => api.projects.create({
      customer_id: customerId, name: v.name, site_address: v.site_address,
      estimated_value_inr: Number(v.estimated_value_inr) || 0, target_capacity_kwh: Number(v.target_capacity_kwh) || 0,
      engineer_id: v.engineer_id || null,
    }),
    onSuccess: (p) => nav(`/projects/${p.id}`),
  });
  return (
    <Modal title="New project" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <ErrorBox error={create.error} />
        <Field label="Project name"><input required minLength={2} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Site address"><textarea value={v.site_address} onChange={(e) => setV({ ...v, site_address: e.target.value })} /></Field>
        <div className="form-grid">
          <Field label="Estimated value (₹)"><input type="number" min={0} value={v.estimated_value_inr}
            onChange={(e) => setV({ ...v, estimated_value_inr: e.target.value })} /></Field>
          <Field label="Target capacity (kWh)"><input type="number" min={0} value={v.target_capacity_kwh}
            onChange={(e) => setV({ ...v, target_capacity_kwh: e.target.value })} /></Field>
        </div>
        <Field label="BESS engineer">
          <select value={v.engineer_id} onChange={(e) => setV({ ...v, engineer_id: e.target.value })}>
            <option value="">Assign later</option>
            {engineers.map((u) => <option key={u.id} value={u.id}>{u.full_name} {u.role ? `(${u.role})` : ""}</option>)}
          </select>
        </Field>
        <div><button className="primary" disabled={create.isPending}>Create project</button></div>
      </form>
    </Modal>
  );
}

export { STAGE_LABELS };
