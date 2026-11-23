import { useQuery } from "@tanstack/react-query";
import {
  formatINR, formatNumber, PERM, PROPOSAL_STATUS_LABELS, STAGE_LABELS, STAGES, type ProjectStage, type ProposalStatus,
} from "@skj/shared";
import { Calculator, FileCheck2, FilePlus2, Plus, UserCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { ColumnChart } from "../components/charts";
import { BarList, Card, ChargeMeter, Empty, ErrorBox, Kpi, Loading, PageHead, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" });

export function DashboardPage() {
  const { me, can } = useAuth();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, refetchInterval: 120_000 });
  const pendingUsers = useQuery({ queryKey: ["users", "pending-count"], queryFn: () => api.users.list("pending_approval"),
    enabled: can(PERM.usersView) });
  if (q.isLoading) return <Loading variant="page" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const k = d.kpis;
  const stageRows = STAGES.filter((s) => d.projects_by_stage[s]).map((s) => [STAGE_LABELS[s], d.projects_by_stage[s]] as [string, number]);
  const months = d.pipeline_by_month ?? [];

  const actions = [
    can(PERM.proposalsCreate) && can(PERM.billsUpload) && { to: "/quotations/new", icon: <FilePlus2 size={18} />, label: "New quotation from a bill" },
    can(PERM.customersCreate) && { to: "/customers?new=1", icon: <Plus size={18} />, label: "Add a customer" },
    can(PERM.calculatorUse) && { to: "/calculator", icon: <Calculator size={18} />, label: "Size a battery" },
    can(PERM.proposalsApprove) && !me?.single_user_mode && { to: "/proposals?status=pending_approval", icon: <FileCheck2 size={18} />,
      label: "Approve proposals", count: k.proposals_pending_approval },
    can(PERM.usersView) && !me?.single_user_mode && { to: "/admin/users", icon: <UserCheck size={18} />, label: "Approve new users", count: pendingUsers.data?.length },
  ].filter(Boolean) as { to: string; icon: React.ReactNode; label: string; count?: number }[];

  return (
    <>
      <PageHead title={`${greeting()}, ${me?.full_name.split(" ")[0]}`}
        sub={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} />

      {actions.length > 0 && (
        <nav className="quick" aria-label="Quick actions">
          {actions.map((a) => (
            <Link key={a.to} to={a.to}>{a.icon}{a.label}{a.count ? <span className="count">{a.count}</span> : null}</Link>
          ))}
        </nav>
      )}

      <div className="grid kpis">
        <Kpi label="Open pipeline" value={formatINR(k.pipeline_value_inr, { compact: true })} tone="accent" to="/projects"
          hint={`${formatNumber(k.pipeline_capacity_kwh)} kWh across ${k.active_projects} projects`} />
        <Kpi label="Won projects" value={formatNumber(k.won_projects)} to="/projects?stage=won"
          hint={k.win_rate_pct !== null ? `${k.win_rate_pct}% of closed deals` : "No closed deals yet"} />
        <Kpi label="Customers" value={formatNumber(k.customers)} to="/customers" />
        {can(PERM.proposalsView) && (
          <Kpi label="Proposals awaiting approval" value={k.proposals_pending_approval} to="/proposals?status=pending_approval"
            tone={k.proposals_pending_approval ? "warn" : undefined} />
        )}
        <Kpi label="Designs awaiting validation" value={k.pending_technical_validations}
          tone={k.pending_technical_validations ? "warn" : undefined} />
        <Kpi label="Bills to review" value={k.bills_to_review} tone={k.bills_to_review ? "warn" : undefined}
          hint={k.bills_to_review ? "Check extracted values before use" : undefined} />
        {k.gross_margin_in_open_proposals_inr !== undefined && (
          <Kpi label="Gross margin, approved proposals" value={formatINR(k.gross_margin_in_open_proposals_inr, { compact: true })}
            hint="Confidential" />
        )}
      </div>
      <div className="spacer" />

      <div className="grid cols-2">
        <Card title="Pipeline by month" actions={<span className="small muted">Last 12 months, by project value</span>}>
          {!months.some((m) => m.projects) ? <Empty>New projects will show up here month by month.</Empty> : (
            <ColumnChart caption="New pipeline and won value by month" labels={months.map((m) => monthLabel(m.month))}
              format={(n) => formatINR(n, { compact: true }).replace(".00 ", " ")}
              series={[{ name: "New pipeline", values: months.map((m) => m.created_value_inr) },
                { name: "Won", values: months.map((m) => m.won_value_inr) }]} />
          )}
        </Card>
        <Card title="Projects by stage" actions={<span className="small muted">Select a stage to open it</span>}>
          <BarList data={stageRows} onSelect={(label) => {
            const s = (Object.keys(STAGE_LABELS) as ProjectStage[]).find((x) => STAGE_LABELS[x] === label);
            if (s) nav(`/projects?stage=${s}`);
          }} />
        </Card>
        <Card title="My projects">
          {d.my_projects.length === 0 ? <Empty>Projects you own or engineer will appear here.</Empty> : (
            <div className="table-wrap"><table>
              <tbody>
                {d.my_projects.map((p) => (
                  <tr key={p.id}>
                    <td><Link to={`/projects/${p.id}`}>{p.name}</Link><div className="small muted">{p.customer_name}</div></td>
                    <td><StatusBadge status={p.stage} /></td>
                    <td className="right"><ChargeMeter pct={p.progress_pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
        <Card title="Largest open opportunities">
          {d.opportunities.length === 0 ? <Empty>No open opportunities.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Project</th><th>Stage</th><th className="num">Capacity</th><th className="num">Value</th></tr></thead>
              <tbody>
                {d.opportunities.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/projects/${o.id}`}>{o.name}</Link><div className="small muted">{o.customer_name}</div></td>
                    <td>{STAGE_LABELS[o.stage]}</td>
                    <td className="num">{formatNumber(o.target_capacity_kwh)} kWh</td>
                    <td className="num">{formatINR(o.estimated_value_inr, { compact: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
        {can(PERM.proposalsView) && Object.keys(d.proposals_by_status).length > 0 && (
          <Card title="Proposals by status">
            <BarList data={Object.entries(d.proposals_by_status).map(([s, n]) => [PROPOSAL_STATUS_LABELS[s as ProposalStatus] ?? s, n])}
              onSelect={(label) => {
                const s = (Object.keys(PROPOSAL_STATUS_LABELS) as ProposalStatus[]).find((x) => PROPOSAL_STATUS_LABELS[x] === label);
                if (s) nav(`/proposals?status=${s}`);
              }} />
          </Card>
        )}
      </div>
    </>
  );
}
