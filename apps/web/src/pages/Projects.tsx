import { useInfiniteQuery } from "@tanstack/react-query";
import { formatINR, formatNumber, STAGE_LABELS, STAGES } from "@skj/shared";
import { Link, useSearchParams } from "react-router-dom";
import { Card, ChargeMeter, Empty, ErrorBox, Loading, LoadMore, PageHead, StatusBadge } from "../components/ui";
import { api } from "../lib/api";

const PAGE = 50;

export function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const stage = params.get("stage") ?? "";
  const mine = params.get("mine") === "1";
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const q = useInfiniteQuery({
    queryKey: ["projects", stage, mine],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.projects.list({ stage: stage || undefined, mine: mine || undefined, limit: PAGE, offset: pageParam }),
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <>
      <PageHead title="Projects" sub="Every BESS project you can see. Create new ones from a customer's page." />
      <Card>
        <div className="row" style={{ marginBottom: 14 }}>
          <select aria-label="Stage" value={stage} onChange={(e) => set("stage", e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
          <label className="row small"><input type="checkbox" checked={mine} onChange={(e) => set("mine", e.target.checked ? "1" : "")} /> Only mine</label>
        </div>
        {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : !rows.length ? <Empty>No projects match these filters.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Customer</th><th>Stage</th><th>Progress</th><th>Engineer</th>
                <th className="num">Capacity</th><th className="num">Value</th></tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                  <td><Link to={`/customers/${p.customer_id}`}>{p.customer_name}</Link></td>
                  <td><StatusBadge status={p.stage} /></td>
                  <td><ChargeMeter pct={p.progress_pct} /></td>
                  <td>{p.engineer?.full_name ?? "–"}</td>
                  <td className="num">{formatNumber(p.target_capacity_kwh)} kWh</td>
                  <td className="num">{formatINR(p.estimated_value_inr, { compact: true })}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
        {q.hasNextPage && <LoadMore shown={rows.length} onMore={() => q.fetchNextPage()} loading={q.isFetchingNextPage} />}
      </Card>
    </>
  );
}
