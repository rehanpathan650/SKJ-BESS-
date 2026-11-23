import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BILL_STATUS_LABELS, formatINR, formatNumber, PERM, PROPOSAL_STATUS_LABELS, STAGE_LABELS, STAGES, type Calculation } from "@skj/shared";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { CalcFormMobile, CalcResultsMobile, initialValues, toInputs } from "../../components/calc";
import {
  Badge, Button, Card, Choice, Empty, ErrorBox, Input, Kpi, ListItem, Loading, Notice, P, Row, s, Segmented, statusTone, useTheme,
} from "../../components/ui";
import { EstimateCard } from "../../components/estimate";
import { BillUpload } from "../../components/upload";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/session";

type Tab = "overview" | "bills" | "configs" | "proposals";

export default function ProjectScreen() {
  usePreventScreenCapture("project");
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can, me } = useAuth();
  const t = useTheme();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<Calculation | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [newCalc, setNewCalc] = useState(false);
  const [values, setValues] = useState(initialValues());
  const [calcName, setCalcName] = useState("Option A");
  const [note, setNote] = useState("");

  const p = useQuery({ queryKey: ["project", id], queryFn: () => api.projects.get(id) });
  const bills = useQuery({ queryKey: ["project-bills", id], queryFn: () => api.projects.bills(id), enabled: tab === "bills",
    refetchInterval: (x) => (x.state.data?.some((b) => ["queued", "scanning", "extracting"].includes(b.status)) ? 4000 : false) });
  const billsKey = (bills.data ?? []).map((b) => `${b.id}:${b.status}`).join(",");
  const analysis = useQuery({ queryKey: ["project-analysis", id, billsKey], queryFn: () => api.projects.analysis(id), enabled: tab === "bills" || newCalc });
  const calcs = useQuery({ queryKey: ["calcs", id], queryFn: () => api.projects.calculations(id), enabled: tab === "configs" || tab === "proposals" });
  const proposals = useQuery({ queryKey: ["project-proposals", id], queryFn: () => api.projects.proposals(id),
    enabled: tab === "proposals" && can(PERM.proposalsView) });
  const dir = useQuery({ queryKey: ["directory"], queryFn: api.users.directory, enabled: tab === "overview" && can(PERM.projectsEdit) });
  const update = useMutation({ mutationFn: (b: Record<string, unknown>) => api.projects.update(id, b),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["project", id] }) });
  const compare = useMutation({ mutationFn: () => api.calculator.compare(compareIds) });
  const saveCalc = useMutation({ mutationFn: () => api.projects.saveCalculation(id, calcName, toInputs(values)),
    onSuccess: () => { setNewCalc(false); void calcs.refetch(); } });
  const validate = useMutation({
    mutationFn: (decision: "approved" | "rejected") => api.calculator.validate(selected!.id, decision, note),
    onSuccess: (c) => { setSelected(c); setNote(""); void calcs.refetch(); },
  });
  const generate = useMutation({ mutationFn: (cid: string) => api.projects.createProposal(id, cid),
    onSuccess: (pr) => router.push(`/proposal/${pr.id}`) });

  if (p.isLoading) return <Loading />;
  if (p.error || !p.data) return <View style={s.content}><ErrorBox error={p.error} /></View>;
  const proj = p.data;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={p.isRefetching} onRefresh={() => { void p.refetch(); void calcs.refetch(); void bills.refetch(); }} />}>
      <Stack.Screen options={{ title: proj.name }} />
      <P muted>{proj.customer_name}</P>
      <View style={{ height: 8 }} />
      <Segmented<Tab> value={tab} onChange={setTab} options={[
        { key: "overview", label: "Overview" }, { key: "bills", label: "Bills" }, { key: "configs", label: "BESS" },
        { key: "proposals", label: "Proposals" }]} />

      {tab === "overview" && (
        <>
          <View style={s.kpis}>
            <Kpi label="Stage" value={STAGE_LABELS[proj.stage]} />
            <Kpi label="Progress" value={`${proj.progress_pct}%`} />
            <Kpi label="Value" value={formatINR(proj.estimated_value_inr, { compact: true })} />
            <Kpi label="Target" value={`${formatNumber(proj.target_capacity_kwh)} kWh`} />
          </View>
          <Card title="Details">
            <Row label="Engineer" value={proj.engineer?.full_name ?? "Not assigned"} />
            <Row label="Owner" value={proj.owner?.full_name ?? "–"} />
            <Row label="Bills / configs / proposals" value={`${proj.bill_count} / ${proj.calculation_count} / ${proj.proposal_count}`} />
            {!!proj.site_address && <P small muted style={{ marginTop: 6 }}>{proj.site_address}</P>}
          </Card>
          {can(PERM.projectsEdit) && (
            <Card title="Update progress">
              <ErrorBox error={update.error} />
              <View style={[s.row, { marginBottom: 8 }]}>
                {STAGES.map((st) => <Button key={st} small title={STAGE_LABELS[st]} variant={proj.stage === st ? "primary" : "default"}
                  onPress={() => update.mutate({ stage: st })} />)}
              </View>
              <View style={[s.row, { marginBottom: 12 }]}>
                {[0, 25, 50, 75, 100].map((n) => <Button key={n} small title={`${n}%`} variant={proj.progress_pct === n ? "primary" : "default"}
                  onPress={() => update.mutate({ progress_pct: n })} />)}
              </View>
              <Choice label="BESS engineer" value={proj.engineer?.id ?? ""} allowNone="Not assigned"
                onChange={(uid) => update.mutate({ engineer_id: uid || null })}
                options={(dir.data ?? (proj.engineer ? [{ id: proj.engineer.id, full_name: proj.engineer.full_name, role: null }] : []))
                  .map((u) => ({ key: u.id, label: u.full_name }))} />
            </Card>
          )}
        </>
      )}

      {tab === "bills" && (
        <>
          {can(PERM.billsUpload) && <Card title="Add bills"><BillUpload customerId={proj.customer_id} projectId={id} onDone={() => void bills.refetch()} /></Card>}
          {bills.data?.length ? bills.data.map((b) => (
            <ListItem key={b.id} title={b.file_name} subtitle={`${b.bill_month ?? "Month ?"} · ${BILL_STATUS_LABELS[b.status]}`}
              right={<Badge label={b.status} tone={statusTone(b.status)} />} onPress={() => router.push(`/bill/${b.id}`)} />
          )) : <Empty>No bills for this project.</Empty>}
          {can(PERM.calculatorUse) && <EstimateCard e={analysis.data?.estimate} />}
          {analysis.data && analysis.data.bill_count > 0 && (
            <Card title={`Analysis (${analysis.data.bill_count} reviewed)`}>
              <Row label="Avg monthly consumption" value={`${formatNumber(analysis.data.avg_monthly_kwh)} kWh`} />
              <Row label="Max demand" value={`${formatNumber(analysis.data.max_recorded_demand_kva)} kVA`} />
              <Row label="Avg monthly bill" value={formatINR(analysis.data.avg_monthly_bill_inr)} />
              <Row label="Effective rate" value={analysis.data.effective_rate_inr_per_kwh ? `₹${analysis.data.effective_rate_inr_per_kwh}/kWh` : "–"} />
              <Row label="Peak-hour share" value={`${analysis.data.peak_share_pct}%`} />
              {analysis.data.insights?.map((i) => <P key={i} small>• {i}</P>)}
            </Card>
          )}
        </>
      )}

      {tab === "configs" && (
        <>
          {can(PERM.calculatorUse) && !newCalc && <Button title="New configuration" variant="primary" onPress={() => {
            setValues(initialValues(analysis.data?.calculator_prefill as Record<string, unknown> | undefined)); setNewCalc(true);
          }} />}
          {newCalc && (
            <Card title="New configuration">
              {analysis.data?.calculator_prefill?.monthly_consumption_kwh ? <Notice tone="info">Pre-filled from reviewed bills.</Notice> : null}
              <Input label="Name" value={calcName} onChangeText={setCalcName} />
              <CalcFormMobile value={values} onChange={setValues} />
              <ErrorBox error={saveCalc.error} />
              <View style={s.row}>
                <Button title="Save for validation" variant="primary" onPress={() => saveCalc.mutate()} loading={saveCalc.isPending} />
                <Button title="Cancel" onPress={() => setNewCalc(false)} />
              </View>
            </Card>
          )}
          <View style={{ height: 8 }} />
          {calcs.data?.length ? calcs.data.map((c) => (
            <ListItem key={c.id} title={`${compareIds.includes(c.id) ? "☑ " : ""}${c.name}`}
              subtitle={`${formatNumber(c.results.summary.battery_capacity_kwh)} kWh · payback ${c.results.financial.simple_payback_years ?? "–"} yrs · IRR ${c.results.financial.irr_pct ?? "–"}%`}
              right={<Badge label={c.validation_status} tone={statusTone(c.validation_status)} />}
              onPress={() => setSelected(selected?.id === c.id ? null : c)} />
          )) : <Empty>No configurations yet.</Empty>}
          {selected && (
            <Card title={selected.name} right={<Button small title={compareIds.includes(selected.id) ? "Remove from compare" : "Add to compare"}
              onPress={() => setCompareIds(compareIds.includes(selected.id) ? compareIds.filter((x) => x !== selected.id) : [...compareIds, selected.id].slice(-5))} />}>
              {can(PERM.calculationsValidate) && selected.validation_status === "pending" && selected.created_by_id !== me?.id && (
                <View style={{ marginBottom: 12 }}>
                  <Input label="Engineering notes" value={note} onChangeText={setNote} multiline />
                  <ErrorBox error={validate.error} />
                  <View style={s.row}>
                    <Button title="Approve" variant="primary" onPress={() => validate.mutate("approved")} loading={validate.isPending} />
                    <Button title="Reject" variant="danger" onPress={() => validate.mutate("rejected")} />
                  </View>
                </View>
              )}
              {!!selected.validation_note && <Notice tone="info">Engineer: {selected.validation_note}</Notice>}
              <CalcResultsMobile results={selected.results} commercial={selected.commercial} />
            </Card>
          )}
          {compareIds.length >= 2 && <Button title={`Compare ${compareIds.length} configurations`} onPress={() => compare.mutate()} />}
          <ErrorBox error={compare.error} />
          {compare.data && (
            <Card title="Comparison">
              {compare.data.map((c) => (
                <View key={String(c.id)} style={{ marginBottom: 10 }}>
                  <Text style={{ color: t.text, fontWeight: "700" }}>{String(c.name)}</Text>
                  <Row label="Size" value={`${c.battery_capacity_kwh} kWh / ${c.battery_power_kw} kW`} />
                  <Row label="Investment" value={formatINR(c.capex_inr as number, { compact: true })} />
                  <Row label="Year-1 saving" value={formatINR(c.year1_net_saving_inr as number, { compact: true })} />
                  <Row label="Payback / IRR" value={`${c.simple_payback_years ?? "–"} yrs / ${c.irr_pct ?? "–"}%`} />
                  {c.gross_margin_pct !== undefined && <Row label="Gross margin" value={`${c.gross_margin_pct}%`} />}
                </View>
              ))}
            </Card>
          )}
        </>
      )}

      {tab === "proposals" && (
        <>
          {can(PERM.proposalsCreate) && (
            <Card title="Generate proposal">
              <ErrorBox error={generate.error} />
              <P small muted>From a technically validated configuration:</P>
              <View style={[s.row, { marginTop: 6 }]}>
                {calcs.data?.filter((c) => c.validation_status === "approved").map((c) => (
                  <Button key={c.id} small title={c.name} onPress={() => generate.mutate(c.id)} loading={generate.isPending} />
                ))}
              </View>
              {!calcs.data?.some((c) => c.validation_status === "approved") && <P small>None validated yet.</P>}
            </Card>
          )}
          {proposals.data?.length ? proposals.data.map((x) => (
            <ListItem key={x.id} title={`R${x.revision} · ${x.title}`} subtitle={formatINR(x.key_figures.capex_inr, { compact: true })}
              right={<Badge label={PROPOSAL_STATUS_LABELS[x.status]} tone={statusTone(x.status)} />} onPress={() => router.push(`/proposal/${x.id}`)} />
          )) : <Empty>No proposals yet.</Empty>}
        </>
      )}
    </ScrollView>
  );
}
