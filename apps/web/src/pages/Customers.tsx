import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, PERM } from "@skj/shared";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export const CUSTOMER_FIELDS: [string, string, string?][] = [
  ["name", "Customer name"], ["company", "Company"], ["industry", "Industry"], ["contact_name", "Contact person"],
  ["email", "Email", "email"], ["phone", "Phone", "tel"], ["state", "State"], ["discom", "DISCOM"],
  ["consumer_number", "Consumer number"], ["tariff_category", "Tariff category"], ["gstin", "GSTIN"],
];

export function CustomerForm({ initial, onSubmit, submitLabel }: {
  initial?: Record<string, string>; onSubmit: (v: Record<string, string>) => Promise<unknown>; submitLabel: string;
}) {
  const [v, setV] = useState<Record<string, string>>({ address: "", ...initial });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const clean = Object.fromEntries(Object.entries(v).filter(([k, x]) => k !== "email" || x));
        await onSubmit(clean);
      } catch (err) { setError(err); } finally { setBusy(false); }
    }}>
      <ErrorBox error={error} />
      <div className="form-grid">
        {CUSTOMER_FIELDS.map(([k, label, type]) => (
          <Field key={k} label={label}>
            <input type={type ?? "text"} required={k === "name"} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Field label="Address"><textarea value={v.address ?? ""} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
      <div><button className="primary" disabled={busy}>{submitLabel}</button></div>
    </form>
  );
}

export function CustomersPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const [creating, setCreatingState] = useState(params.get("new") === "1");
  const setCreating = (v: boolean) => { setCreatingState(v); if (!v && params.has("new")) setParams({}, { replace: true }); };
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["customers", search], queryFn: () => api.customers.list(search || undefined, 100) });
  const create = useMutation({
    mutationFn: (v: Record<string, string>) => api.customers.create(v),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["customers"] }); nav(`/customers/${c.id}`); },
  });

  return (
    <>
      <PageHead title="Customers" sub="Only customers you are permitted to see are listed."
        actions={can(PERM.customersCreate) && <button className="primary" onClick={() => setCreating(true)}>New customer</button>} />
      <Card>
        <input type="search" placeholder="Search by name, company, contact or phone…" value={search}
          onChange={(e) => setSearch(e.target.value)} maxLength={100} style={{ marginBottom: 12 }} />
        {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : q.data!.items.length === 0 ? (
          <Empty>No customers found.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Industry</th><th>State / DISCOM</th><th>Owner</th><th>Updated</th></tr></thead>
              <tbody>
                {q.data!.items.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/customers/${c.id}`}>{c.name}</Link>{c.contact_name && <div className="small muted">{c.contact_name}</div>}</td>
                    <td>{c.industry || "–"}</td>
                    <td>{c.state || "–"}<div className="small muted">{c.discom}</div></td>
                    <td>{c.owner?.full_name ?? "–"}</td>
                    <td className="nowrap">{formatDate(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">{q.data!.total} customer(s)</p>
          </div>
        )}
      </Card>
      {creating && (
        <Modal title="New customer" onClose={() => setCreating(false)}>
          <CustomerForm submitLabel="Create customer" onSubmit={(v) => create.mutateAsync(v)} />
        </Modal>
      )}
    </>
  );
}
