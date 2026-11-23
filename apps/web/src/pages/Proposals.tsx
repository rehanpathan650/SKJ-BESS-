import { useQuery } from "@tanstack/react-query";
import { formatDate, formatINR, PROPOSAL_STATUS_LABELS, type ProposalStatus } from "@skj/shared";
import { Link, useSearchParams } from "react-router-dom";
import { Card, Empty, ErrorBox, Loading, PageHead, StatusBadge } from "../components/ui";
import { api } from "../lib/api";

export function ProposalsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const setStatus = (v: string) => setParams(v ? { status: v } : {}, { replace: true });
  const q = useQuery({ queryKey: ["proposals", status], queryFn: () => api.proposals.list(status || undefined) });
  return (
    <>
      <PageHead title="Proposals" sub="Generate proposals from a project's validated configuration." />
      <Card>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 240, marginBottom: 12 }}>
          <option value="">All statuses</option>
          {(Object.keys(PROPOSAL_STATUS_LABELS) as ProposalStatus[]).map((s) => <option key={s} value={s}>{PROPOSAL_STATUS_LABELS[s]}</option>)}
        </select>
        {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : !q.data!.length ? <Empty>{status ? "No proposals with this status." : "No proposals yet. Generate one from a project with a validated configuration."}</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Customer / project</th><th>Rev.</th><th>Status</th><th className="num">Size</th><th className="num">Investment</th>
              <th className="num">Payback</th><th>Updated</th></tr></thead>
            <tbody>{q.data!.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/proposals/${p.id}`}>{p.customer_name}</Link><div className="small muted">{p.project_name}</div></td>
                <td>R{p.revision}</td>
                <td><StatusBadge status={p.status} /></td>
                <td className="num">{p.key_figures.battery_capacity_kwh} kWh</td>
                <td className="num">{formatINR(p.key_figures.capex_inr, { compact: true })}</td>
                <td className="num">{p.key_figures.simple_payback_years ?? "–"} yrs</td>
                <td>{formatDate(p.updated_at)}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
