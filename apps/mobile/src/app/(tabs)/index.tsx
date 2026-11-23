import { useQuery } from "@tanstack/react-query";
import {
  formatINR, formatNumber, PERM, PROPOSAL_STATUS_LABELS, STAGE_LABELS, STAGES, type ProposalStatus,
} from "@skj/shared";
import { router } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { ColumnChart } from "../../components/charts";
import {
  Badge, Card, ChargeMeter, Empty, ErrorBox, font, H1, Icon, Kpi, ListItem, Loading, P, Row, s, statusTone, useIsTablet, useTheme,
  type IconName,
} from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/session";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" }).slice(0, 3);
const money = (n: number) => formatINR(n, { compact: true }).replace(".00 ", " ");

function QuickAction({ icon, label, count, onPress }: { icon: IconName; label: string; count?: number; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={count ? `${label}, ${count} waiting` : label} onPress={onPress}
      style={({ pressed }) => ({ flexGrow: 1, flexBasis: "46%", flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52,
        paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: pressed ? t.brand : t.border, backgroundColor: t.surface })}>
      <Icon name={icon} color={t.brand} />
      <Text style={[font.semibold, { color: t.text, flex: 1 }]} numberOfLines={2}>{label}</Text>
      {count ? <Text style={[font.bold, { backgroundColor: t.charge, color: "#2b1d00", borderRadius: 99, paddingHorizontal: 7,
        fontSize: 12, overflow: "hidden" }]}>{count}</Text> : null}
    </Pressable>
  );
}

export default function Dashboard() {
  const { me, can } = useAuth();
  const t = useTheme();
  const tablet = useIsTablet();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const pendingUsers = useQuery({ queryKey: ["users", "pending-count"], queryFn: () => api.users.list("pending_approval"),
    enabled: can(PERM.usersView) });
  const d = q.data;
  const k = d?.kpis;
  const months = d?.pipeline_by_month ?? [];
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); void pendingUsers.refetch(); }}
        colors={[t.brand]} />}>
      <H1>{greeting()}, {me?.full_name.split(" ")[0]}</H1>
      <P muted>{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</P>
      <View style={{ height: 14 }} />

      <View style={[s.row, { marginBottom: 14, gap: 10 }]}>
        {can(PERM.proposalsCreate) && can(PERM.billsUpload) && <QuickAction icon="file-plus" label="New quotation from a bill" onPress={() => router.push("/quotation/new")} />}
        {can(PERM.billsUpload) && <QuickAction icon="camera" label="Upload a bill" onPress={() => router.push("/customers")} />}
        {can(PERM.calculatorUse) && <QuickAction icon="battery-charging" label="Size a battery" onPress={() => router.push("/calculator")} />}
        {can(PERM.proposalsApprove) && !me?.single_user_mode && !!k?.proposals_pending_approval && (
          <QuickAction icon="check-square" label="Approve proposals" count={k.proposals_pending_approval} onPress={() => router.push("/proposals")} />
        )}
        {can(PERM.usersView) && !!pendingUsers.data?.length && (
          <QuickAction icon="user-check" label="Approve new users" count={pendingUsers.data.length} onPress={() => router.push("/admin/users")} />
        )}
      </View>

      {q.isLoading ? <Loading /> : <ErrorBox error={q.error} />}
      {k && d && (
        <>
          <View style={s.kpis}>
            <Kpi label="Open pipeline" value={money(k.pipeline_value_inr)} accent="brand"
              hint={`${formatNumber(k.pipeline_capacity_kwh)} kWh, ${k.active_projects} projects`} onPress={() => router.push("/projects")} />
            <Kpi label="Won projects" value={k.won_projects} hint={k.win_rate_pct !== null ? `${k.win_rate_pct}% of closed deals` : undefined} />
            <Kpi label="Customers" value={formatNumber(k.customers)} onPress={() => router.push("/customers")} />
            {can(PERM.proposalsView) && <Kpi label="Awaiting approval" value={k.proposals_pending_approval}
              accent={k.proposals_pending_approval ? "charge" : undefined} onPress={() => router.push("/proposals")} />}
            <Kpi label="Designs to validate" value={k.pending_technical_validations} accent={k.pending_technical_validations ? "charge" : undefined} />
            <Kpi label="Bills to review" value={k.bills_to_review} accent={k.bills_to_review ? "charge" : undefined} />
            {k.gross_margin_in_open_proposals_inr !== undefined && (
              <Kpi label="Gross margin, approved" value={money(k.gross_margin_in_open_proposals_inr)} hint="Confidential" />
            )}
          </View>

          <View style={{ flexDirection: tablet ? "row" : "column", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Card title="Pipeline by month" index={1}>
                {!months.some((m) => m.projects) ? <Empty icon="bar-chart-2">New projects will show up here month by month.</Empty> : (
                  <ColumnChart caption="New pipeline and won value by month, last 12 months" labels={months.map((m) => monthLabel(m.month))}
                    format={money} series={[{ name: "New pipeline", values: months.map((m) => m.created_value_inr) },
                      { name: "Won", values: months.map((m) => m.won_value_inr) }]} />
                )}
              </Card>
              <Card title="My projects" index={2}>
                {d.my_projects.length === 0 ? <Empty icon="folder">Projects you own or engineer will appear here.</Empty> : d.my_projects.map((p) => (
                  <ListItem key={p.id} title={p.name} subtitle={p.customer_name} onPress={() => router.push(`/project/${p.id}`)}
                    right={<View style={{ alignItems: "flex-end", gap: 6 }}><Badge label={STAGE_LABELS[p.stage]} tone={statusTone(p.stage)} />
                      <ChargeMeter pct={p.progress_pct} cells={8} /></View>} />
                ))}
              </Card>
            </View>
            <View style={{ flex: 1 }}>
              <Card title="Projects by stage" index={3}>
                {Object.keys(d.projects_by_stage).length === 0 ? <Empty>No projects yet.</Empty> :
                  STAGES.filter((st) => d.projects_by_stage[st]).map((st) => (
                    <Pressable key={st} accessibilityRole="button" onPress={() => router.push("/projects")}>
                      <Row label={STAGE_LABELS[st]} value={String(d.projects_by_stage[st])} />
                    </Pressable>
                  ))}
              </Card>
              <Card title="Largest open opportunities" index={4}>
                {d.opportunities.length === 0 ? <Empty>No open opportunities.</Empty> : d.opportunities.map((o) => (
                  <ListItem key={o.id} title={o.name} subtitle={`${o.customer_name}, ${formatNumber(o.target_capacity_kwh)} kWh`}
                    right={<P small>{money(o.estimated_value_inr)}</P>} onPress={() => router.push(`/project/${o.id}`)} />
                ))}
              </Card>
              {can(PERM.proposalsView) && Object.keys(d.proposals_by_status).length > 0 && (
                <Card title="Proposals by status" index={5}>
                  {Object.entries(d.proposals_by_status).map(([st, n]) => (
                    <Row key={st} label={PROPOSAL_STATUS_LABELS[st as ProposalStatus] ?? st} value={String(n)} />
                  ))}
                </Card>
              )}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}
