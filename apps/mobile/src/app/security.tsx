import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDate, PERM, type AuditEntry } from "@skj/shared";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import {
  Badge, Button, Card, Choice, Empty, ErrorBox, Kpi, Loading, Notice, P, s, Segmented, useTheme,
} from "../components/ui";
import { useAuth } from "../lib/auth";
import { api } from "../lib/session";

type Tab = "overview" | "audit" | "logins" | "sessions" | "ai";

function AuditList({ rows }: { rows?: AuditEntry[] }) {
  const t = useTheme();
  if (!rows?.length) return <Empty>No matching events.</Empty>;
  return (
    <>
      {rows.map((e) => (
        <View key={e.id} style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderColor: t.border }}>
          <View style={s.rowBetween}>
            <Text style={{ color: t.text, fontFamily: "monospace", fontSize: 12.5, flex: 1 }}>{e.action}</Text>
            <Badge label={e.outcome} tone={e.outcome === "success" ? "ok" : e.outcome === "denied" ? "danger" : "warn"} />
          </View>
          <P small muted>{formatDate(e.ts, true)} · {e.actor_email || "anonymous"} · {e.ip}</P>
          {Object.keys(e.details).length > 0 && <P small muted>{JSON.stringify(e.details).slice(0, 200)}</P>}
        </View>
      ))}
    </>
  );
}

export default function Security() {
  const { can } = useAuth();
  const t = useTheme();
  const [tab, setTab] = useState<Tab>(can(PERM.securityView) ? "overview" : "audit");
  const [category, setCategory] = useState("");
  const [outcome, setOutcome] = useState("");
  const [days, setDays] = useState("7");
  const overview = useQuery({ queryKey: ["sec-overview"], queryFn: api.security.overview, enabled: tab === "overview" });
  const audit = useQuery({ queryKey: ["sec-audit", category, outcome, days],
    queryFn: () => api.security.audit({ category: category || undefined, outcome: outcome || undefined, days: Number(days) }), enabled: tab === "audit" });
  const logins = useQuery({ queryKey: ["sec-logins"], queryFn: api.security.logins, enabled: tab === "logins" });
  const sessions = useQuery({ queryKey: ["sec-sessions"], queryFn: api.security.sessions, enabled: tab === "sessions" });
  const ai = useQuery({ queryKey: ["sec-ai"], queryFn: api.security.aiUsage, enabled: tab === "ai" });
  const verify = useMutation({ mutationFn: api.security.verifyAudit });
  const revoke = useMutation({ mutationFn: api.security.revokeSession, onSuccess: () => void sessions.refetch() });

  const tabs: { key: Tab; label: string }[] = [];
  if (can(PERM.securityView)) tabs.push({ key: "overview", label: "Alerts" });
  if (can(PERM.auditView)) tabs.push({ key: "audit", label: "Audit" });
  if (can(PERM.securityView)) tabs.push({ key: "logins", label: "Logins" });
  if (can(PERM.sessionsManage)) tabs.push({ key: "sessions", label: "Sessions" });
  if (can(PERM.securityView)) tabs.push({ key: "ai", label: "AI" });
  const active = { overview, audit, logins, sessions, ai }[tab];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={active.isRefetching} onRefresh={() => { void active.refetch(); }} />}>
      {can(PERM.auditView) && (
        <View style={{ marginBottom: 12 }}>
          <Button title="Verify audit integrity" onPress={() => verify.mutate()} loading={verify.isPending} />
          {verify.data && (verify.data.valid
            ? <Notice tone="ok">Audit chain intact: {verify.data.checked} entries verified.</Notice>
            : <ErrorBox error={new Error(`Audit chain BROKEN at entry #${verify.data.broken_at_id}. Investigate immediately.`)} />)}
          <ErrorBox error={verify.error} />
        </View>
      )}
      {tabs.length > 1 && <Segmented<Tab> value={tab} onChange={setTab} options={tabs} />}
      <ErrorBox error={active.error} />

      {tab === "overview" && (overview.isLoading ? <Loading /> : overview.data && (
        <>
          <View style={s.kpis}>
            <Kpi label="Logins (24h)" value={overview.data.logins_24h} />
            <Kpi label="Failed logins (24h)" value={overview.data.failed_logins_24h} />
            <Kpi label="Locked accounts" value={overview.data.locked_accounts} />
            <Kpi label="Permission denials" value={overview.data.permission_denials_24h} />
            <Kpi label="Rate-limited" value={overview.data.rate_limited_24h} />
            <Kpi label="Active sessions" value={overview.data.active_sessions} />
            <Kpi label="Awaiting approval" value={overview.data.pending_users} />
            <Kpi label="AI calls / cost" value={`${overview.data.ai_calls_month} · $${overview.data.ai_cost_month_usd}`} hint="this month" />
          </View>
          <Card title="Security alerts">
            {!overview.data.alerts.length ? <Empty>No alerts.</Empty> : overview.data.alerts.map((a, i) => (
              <Notice key={i} tone={a.severity === "high" ? "warn" : "info"}>{a.severity.toUpperCase()} · {a.message}</Notice>
            ))}
          </Card>
        </>
      ))}

      {tab === "audit" && (
        <Card>
          <Choice label="Category" value={category} onChange={setCategory} allowNone="All"
            options={["auth", "user", "role", "data", "file", "proposal", "security", "admin"].map((c) => ({ key: c, label: c }))} />
          <Choice label="Outcome" value={outcome} onChange={setOutcome} allowNone="Any"
            options={["success", "failure", "denied"].map((c) => ({ key: c, label: c }))} />
          <Choice label="Period" value={days} onChange={(v) => setDays(v || "7")}
            options={[["1", "24h"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"]].map(([k, l]) => ({ key: k, label: l }))} />
          {audit.isLoading ? <Loading /> : <AuditList rows={audit.data} />}
        </Card>
      )}
      {tab === "logins" && <Card>{logins.isLoading ? <Loading /> : <AuditList rows={logins.data} />}</Card>}
      {tab === "sessions" && (
        <Card>
          <ErrorBox error={revoke.error} />
          {sessions.isLoading ? <Loading /> : !sessions.data?.length ? <Empty>No active sessions.</Empty> : sessions.data.map((x) => (
            <View key={x.id} style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderColor: t.border }}>
              <View style={s.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: "600" }}>{x.user?.full_name}</Text>
                  <P small muted>{x.user?.email} · {x.client_type} · {x.ip}</P>
                  <P small muted>Last active {formatDate(x.last_used_at, true)}</P>
                </View>
                <Button small variant="danger" title="Revoke" onPress={() => revoke.mutate(x.id)} />
              </View>
            </View>
          ))}
        </Card>
      )}
      {tab === "ai" && (
        <Card>
          {ai.isLoading ? <Loading /> : !ai.data?.length ? <Empty>No AI calls yet.</Empty> : ai.data.map((u) => (
            <View key={u.id} style={{ paddingVertical: 6, borderBottomWidth: 0.5, borderColor: t.border }}>
              <P small>{formatDate(u.created_at, true)} · {u.outcome}</P>
              <P small muted>{u.model} · {u.input_tokens} in / {u.output_tokens} out · ${u.cost_usd.toFixed(4)}</P>
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
