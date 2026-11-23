import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BILL_STATUS_LABELS, formatDate, PERM, STAGE_LABELS } from "@skj/shared";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import {
  Badge, Button, Card, Choice, confirm, Empty, ErrorBox, Input, ListItem, Loading, P, Row, s, Segmented, statusTone,
  useIsTablet, useTheme,
} from "../../components/ui";
import { EstimateCard } from "../../components/estimate";
import { BillUpload } from "../../components/upload";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/session";

type Tab = "profile" | "projects" | "bills" | "notes" | "team";
const EDITABLE: [string, string][] = [["name", "Customer name"], ["company", "Company"], ["industry", "Industry"], ["contact_name", "Contact person"],
  ["phone", "Phone"], ["email", "Email"], ["state", "State"], ["discom", "DISCOM"], ["consumer_number", "Consumer number"],
  ["tariff_category", "Tariff category"], ["gstin", "GSTIN"], ["address", "Address"]];

export default function CustomerScreen() {
  usePreventScreenCapture("customer");
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const t = useTheme();
  const tablet = useIsTablet();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("profile");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const c = useQuery({ queryKey: ["customer", id], queryFn: () => api.customers.get(id) });
  const bills = useQuery({ queryKey: ["customer-bills", id], queryFn: () => api.customers.bills(id), enabled: tab === "bills",
    refetchInterval: (q) => (q.state.data?.some((b) => ["queued", "scanning", "extracting"].includes(b.status)) ? 4000 : false) });
  const billsKey = (bills.data ?? []).map((b) => `${b.id}:${b.status}`).join(",");
  const analysis = useQuery({ queryKey: ["customer-analysis", id, billsKey], queryFn: () => api.customers.analysis(id),
    enabled: tab === "bills" && can(PERM.calculatorUse) });
  const notes = useQuery({ queryKey: ["notes", id], queryFn: () => api.customers.notes(id), enabled: tab === "notes" });
  const dir = useQuery({ queryKey: ["directory"], queryFn: api.users.directory, enabled: tab === "team" && can(PERM.customersAssign) });
  const [assignee, setAssignee] = useState("");
  const team = useMutation({
    mutationFn: ({ uid, add }: { uid: string; add: boolean }) => add ? api.customers.assign(id, uid) : api.customers.unassign(id, uid),
    onSuccess: () => { setAssignee(""); void qc.invalidateQueries({ queryKey: ["customer", id] }); },
  });
  const remove = useMutation({ mutationFn: () => api.customers.remove(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["customers"] }); router.back(); } });
  const save = useMutation({
    mutationFn: () => api.customers.update(id, Object.fromEntries(Object.entries(form).filter(([k, v]) => k !== "email" || v))),
    onSuccess: () => { setEditing(false); void qc.invalidateQueries({ queryKey: ["customer", id] }); },
  });
  const addNote = useMutation({ mutationFn: () => api.customers.addNote(id, note.trim()),
    onSuccess: () => { setNote(""); void qc.invalidateQueries({ queryKey: ["notes", id] }); } });

  if (c.isLoading) return <Loading />;
  if (c.error || !c.data) return <View style={s.content}><ErrorBox error={c.error} /></View>;
  const cust = c.data;
  const canNote = can(PERM.customersEdit) || can(PERM.projectsEdit) || can(PERM.billsUpload);

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={c.isRefetching} onRefresh={() => { void c.refetch(); void bills.refetch(); void notes.refetch(); }} />}>
      <Stack.Screen options={{ title: cust.name }} />
      {can(PERM.proposalsCreate) && can(PERM.billsUpload) && (
        <View style={{ marginBottom: 12 }}>
          <Button title="New quotation from a bill" variant="primary" icon="file-plus" onPress={() => router.push(`/quotation/new?customer=${id}`)} />
        </View>
      )}
      <Segmented<Tab> value={tab} onChange={setTab} options={[
        { key: "profile", label: "Profile" }, { key: "projects", label: `Projects (${cust.projects?.length ?? 0})` },
        { key: "bills", label: "Bills" }, { key: "notes", label: "Notes" }, { key: "team", label: "Team" }]} />

      {tab === "profile" && (
        <Card title={cust.name} right={can(PERM.customersEdit) && !editing ? <Button small title="Edit" onPress={() => {
          setForm(Object.fromEntries(EDITABLE.map(([k]) => [k, String((cust as unknown as Record<string, string>)[k] ?? "")]))); setEditing(true);
        }} /> : undefined}>
          {editing ? (
            <View>
              <ErrorBox error={save.error} />
              <View style={[s.row, { gap: 10 }]}>
                {EDITABLE.map(([k, label]) => (
                  <Input key={k} label={label} value={form[k]} onChangeText={(v) => setForm({ ...form, [k]: v })} multiline={k === "address"}
                    keyboardType={k === "phone" ? "phone-pad" : k === "email" ? "email-address" : "default"} autoCapitalize={k === "email" ? "none" : "sentences"} />
                ))}
              </View>
              <View style={[s.row]}>
                <Button title="Save" variant="primary" onPress={() => save.mutate()} loading={save.isPending} />
                <Button title="Cancel" onPress={() => setEditing(false)} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: tablet ? "row" : "column", gap: tablet ? 24 : 0 }}>
              <View style={{ flex: 1 }}>
                <Row label="Company" value={cust.company || "–"} />
                <Row label="Industry" value={cust.industry || "–"} />
                <Row label="Contact" value={cust.contact_name || "–"} />
                <Row label="Phone" value={cust.phone || "–"} />
                <Row label="Email" value={cust.email || "–"} />
              </View>
              <View style={{ flex: 1 }}>
                <Row label="State" value={cust.state || "–"} />
                <Row label="DISCOM" value={cust.discom || "–"} />
                <Row label="Consumer no." value={cust.consumer_number || "–"} />
                <Row label="Tariff" value={cust.tariff_category || "–"} />
                <Row label="Owner" value={cust.owner?.full_name ?? "–"} />
              </View>
            </View>
          )}
          {!editing && !!cust.address && <P small muted style={{ marginTop: 8 }}>{cust.address}</P>}
          {!editing && can(PERM.customersDelete) && (
            <View style={{ marginTop: 12 }}>
              <ErrorBox error={remove.error} />
              <Button small variant="danger" title="Delete customer" onPress={() => confirm("Delete customer?",
                "This permanently deletes the customer with all projects, bills and proposals.", () => remove.mutate(), "Delete")} />
            </View>
          )}
        </Card>
      )}

      {tab === "projects" && (
        <>
          {can(PERM.projectsCreate) && <View style={{ marginBottom: 8 }}><Button variant="primary" title="+ New project"
            onPress={() => router.push(`/project/new?customer=${id}`)} /></View>}
          {cust.projects?.length ? cust.projects.map((p) => (
            <ListItem key={p.id} title={p.name} subtitle={`${p.progress_pct}% · ${p.engineer?.full_name ?? "No engineer"}`}
              right={<Badge label={STAGE_LABELS[p.stage]} tone={statusTone(p.stage)} />} onPress={() => router.push(`/project/${p.id}`)} />
          )) : <Empty>No projects for this customer.</Empty>}
        </>
      )}

      {tab === "team" && (
        <Card title="People assigned to this customer">
          <ErrorBox error={team.error} />
          {cust.assignments?.length ? cust.assignments.map((a) => (
            <View key={a.user_id} style={[s.rowBetween, { paddingVertical: 6 }]}>
              <P>{a.full_name}</P>
              {can(PERM.customersAssign) && <Button small title="Remove" onPress={() => team.mutate({ uid: a.user_id, add: false })} />}
            </View>
          )) : <Empty>Nobody assigned.</Empty>}
          {can(PERM.customersAssign) && (
            <View style={{ marginTop: 12 }}>
              <Choice label="Add a person" value={assignee} onChange={setAssignee}
                options={(dir.data ?? []).filter((u) => !cust.assignments?.some((a) => a.user_id === u.id))
                  .map((u) => ({ key: u.id, label: u.full_name }))} />
              <Button title="Assign" variant="primary" disabled={!assignee} loading={team.isPending}
                onPress={() => team.mutate({ uid: assignee, add: true })} />
            </View>
          )}
        </Card>
      )}

      {tab === "bills" && (
        <>
          {can(PERM.billsUpload) && <Card title="Add bills"><BillUpload customerId={id} onDone={() => void bills.refetch()} /></Card>}
          {can(PERM.calculatorUse) && !!bills.data?.length && <EstimateCard e={analysis.data?.estimate} />}
          {bills.isLoading ? <Loading /> : !bills.data?.length ? <Empty>No bills yet.</Empty> : bills.data.map((b) => (
            <ListItem key={b.id} title={b.file_name} subtitle={`${b.bill_month ?? "Month ?"} · ${BILL_STATUS_LABELS[b.status]}${b.security_flags.length ? " · ⚠ flagged" : ""}`}
              right={<Badge label={b.status} tone={statusTone(b.status)} />} onPress={() => router.push(`/bill/${b.id}`)} />
          ))}
        </>
      )}

      {tab === "notes" && (
        <>
          {canNote && (
            <Card title="Add note">
              <ErrorBox error={addNote.error} />
              <Input label="Note" value={note} onChangeText={setNote} multiline maxLength={5000} placeholder="Call summary, site visit, next steps…" />
              <Button title="Save note" variant="primary" disabled={!note.trim()} loading={addNote.isPending} onPress={() => addNote.mutate()} />
            </Card>
          )}
          {notes.data?.length ? notes.data.map((n) => (
            <Card key={n.id}>
              <P small muted>{n.author} · {formatDate(n.created_at, true)}</P>
              <P>{n.body}</P>
            </Card>
          )) : <Empty>No notes yet.</Empty>}
        </>
      )}
    </ScrollView>
  );
}
