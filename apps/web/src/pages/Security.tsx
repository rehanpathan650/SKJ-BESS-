import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDate, PERM } from "@skj/shared";
import { useState } from "react";
import { Card, Empty, ErrorBox, Kpi, Loading, PageHead, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

type Tab = "overview" | "audit" | "logins" | "sessions" | "ai";

export function SecurityPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>(can(PERM.securityView) ? "overview" : "audit");
  const [filters, setFilters] = useState({ category: "", action: "", actor: "", outcome: "", days: 7 });
  const overview = useQuery({ queryKey: ["sec-overview"], queryFn: api.security.overview, enabled: tab === "overview", refetchInterval: 30_000 });
  const audit = useQuery({ queryKey: ["sec-audit", filters], queryFn: () => api.security.audit(filters), enabled: tab === "audit" });
  const logins = useQuery({ queryKey: ["sec-logins"], queryFn: api.security.logins, enabled: tab === "logins" });
  const sessions = useQuery({ queryKey: ["sec-sessions"], queryFn: api.security.sessions, enabled: tab === "sessions" });
  const ai = useQuery({ queryKey: ["sec-ai"], queryFn: api.security.aiUsage, enabled: tab === "ai" });
  const verify = useMutation({ mutationFn: api.security.verifyAudit });
  const revoke = useMutation({ mutationFn: api.security.revokeSession, onSuccess: () => sessions.refetch() });

  const tabs: { key: Tab; label: string }[] = [];
  if (can(PERM.securityView)) tabs.push({ key: "overview", label: "Overview & alerts" });
  if (can(PERM.auditView)) tabs.push({ key: "audit", label: "Audit log" });
  if (can(PERM.securityView)) tabs.push({ key: "logins", label: "Login activity" });
  if (can(PERM.sessionsManage)) tabs.push({ key: "sessions", label: "Active sessions" });
  if (can(PERM.securityView)) tabs.push({ key: "ai", label: "AI usage" });

  return (
    <>
      <PageHead title="Security operations" sub="Monitoring, investigation and session control."
        actions={can(PERM.auditView) && <button onClick={() => verify.mutate()}>Verify audit integrity</button>} />
      {verify.data && (verify.data.valid
        ? <div className="success">Audit chain intact: {verify.data.checked} entries verified.</div>
        : <div className="error">Audit chain BROKEN at entry #{verify.data.broken_at_id}. Investigate immediately.</div>)}
      <ErrorBox error={verify.error} />
      <div className="spacer" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={tabs} />

      {tab === "overview" && (overview.isLoading ? <Loading /> : overview.data && (
        <>
          <div className="grid kpis">
            <Kpi label="Logins (24h)" value={overview.data.logins_24h} />
            <Kpi label="Failed logins (24h)" value={overview.data.failed_logins_24h} tone={overview.data.failed_logins_24h > 10 ? "warn" : undefined} />
            <Kpi label="Locked accounts" value={overview.data.locked_accounts} />
            <Kpi label="Permission denials (24h)" value={overview.data.permission_denials_24h} />
            <Kpi label="Rate-limited requests (24h)" value={overview.data.rate_limited_24h} />
            <Kpi label="Active sessions" value={overview.data.active_sessions} />
            <Kpi label="Users awaiting approval" value={overview.data.pending_users} />
            <Kpi label="AI calls / cost (month)" value={`${overview.data.ai_calls_month} · $${overview.data.ai_cost_month_usd}`} />
          </div>
          <div className="spacer" />
          <Card title="Security alerts">
            {!overview.data.alerts.length ? <Empty>No alerts.</Empty> : overview.data.alerts.map((a, i) => (
              <div key={i} className={a.severity === "high" ? "error" : "notice"} style={{ marginBottom: 8 }}>
                <strong>{a.severity.toUpperCase()}</strong> · {a.message}
              </div>
            ))}
          </Card>
        </>
      ))}

      {tab === "audit" && (
        <Card>
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
              <option value="">All categories</option>
              {["auth", "user", "role", "data", "file", "proposal", "security", "admin", "api"].map((c) => <option key={c}>{c}</option>)}
            </select>
            <input placeholder="Action starts with…" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
            <input placeholder="Actor email contains…" value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} />
            <select value={filters.outcome} onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}>
              <option value="">Any outcome</option><option>success</option><option>failure</option><option>denied</option>
            </select>
            <select value={filters.days} onChange={(e) => setFilters({ ...filters, days: Number(e.target.value) })}>
              {[1, 7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} day(s)</option>)}
            </select>
          </div>
          <AuditTable rows={audit.data} loading={audit.isLoading} error={audit.error} />
        </Card>
      )}
      {tab === "logins" && <Card><AuditTable rows={logins.data} loading={logins.isLoading} error={logins.error} /></Card>}
      {tab === "sessions" && (
        <Card>
          <ErrorBox error={revoke.error} />
          {sessions.isLoading ? <Loading /> : (
            <table><thead><tr><th>User</th><th>Client</th><th>IP</th><th>Signed in</th><th>Last active</th><th /></tr></thead>
              <tbody>{sessions.data?.map((s) => (
                <tr key={s.id}><td>{s.user?.full_name}<div className="small muted">{s.user?.email}</div></td><td>{s.client_type}</td>
                  <td className="mono">{s.ip}</td><td>{formatDate(s.created_at, true)}</td><td>{formatDate(s.last_used_at, true)}</td>
                  <td className="right"><button className="small danger" onClick={() => revoke.mutate(s.id)}>Revoke</button></td></tr>
              ))}</tbody></table>
          )}
        </Card>
      )}
      {tab === "ai" && (
        <Card>
          {ai.isLoading ? <Loading /> : !ai.data?.length ? <Empty>No AI calls yet.</Empty> : (
            <table><thead><tr><th>When</th><th>Model</th><th className="num">Input tokens</th><th className="num">Output tokens</th>
              <th className="num">Cost (USD)</th><th>Outcome</th></tr></thead>
              <tbody>{ai.data.map((u) => (
                <tr key={u.id}><td>{formatDate(u.created_at, true)}</td><td className="mono">{u.model}</td><td className="num">{u.input_tokens}</td>
                  <td className="num">{u.output_tokens}</td><td className="num">{u.cost_usd.toFixed(4)}</td><td>{u.outcome}</td></tr>
              ))}</tbody></table>
          )}
        </Card>
      )}
    </>
  );
}

function AuditTable({ rows, loading, error }: { rows?: import("@skj/shared").AuditEntry[]; loading: boolean; error: unknown }) {
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!rows?.length) return <Empty>No matching events.</Empty>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Time</th><th>Action</th><th>Outcome</th><th>Actor</th><th>Target</th><th>IP</th><th>Details</th></tr></thead>
      <tbody>{rows.map((e) => (
        <tr key={e.id}>
          <td className="nowrap small">{formatDate(e.ts, true)}</td>
          <td><span className="mono">{e.action}</span><div className="small muted">{e.category}</div></td>
          <td><span className={`badge ${e.outcome === "success" ? "ok" : e.outcome === "denied" ? "danger" : "warn"}`}>{e.outcome}</span></td>
          <td className="small">{e.actor_email || "–"}</td>
          <td className="small mono">{e.target_type}{e.target_id ? `:${e.target_id.slice(0, 8)}` : ""}</td>
          <td className="small mono">{e.ip}</td>
          <td className="small mono" style={{ maxWidth: 280, wordBreak: "break-word" }}>{Object.keys(e.details).length ? JSON.stringify(e.details) : ""}</td>
        </tr>))}
      </tbody>
    </table></div>
  );
}
