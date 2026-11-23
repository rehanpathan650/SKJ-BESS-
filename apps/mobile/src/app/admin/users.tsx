import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, PERM, type AdminUser, isFuture } from "@skj/shared";
import { useState } from "react";
import { RefreshControl, ScrollView, TextInput, View } from "react-native";
import {
  Badge, Button, Card, Choice, confirm, Empty, ErrorBox, Loading, Notice, P, s, Segmented, statusTone, useTheme,
} from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/session";

type Tab = "pending_approval" | "active" | "all";

export default function Users() {
  const { can, me } = useAuth();
  const t = useTheme();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending_approval");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [dept, setDept] = useState("");
  const users = useQuery({ queryKey: ["users", tab, search], queryFn: () => api.users.list(tab === "all" ? undefined : tab, search || undefined) });
  const pending = useQuery({ queryKey: ["users", "pending-count"], queryFn: () => api.users.list("pending_approval") });
  const roles = useQuery({ queryKey: ["roles"], queryFn: api.roles.list });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.auth.departments });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setOpen(null); void qc.invalidateQueries({ queryKey: ["users"] }); },
  });
  const manage = can(PERM.usersManage);

  function expand(u: AdminUser) {
    if (open === u.id) return setOpen(null);
    setOpen(u.id);
    setRole(u.role?.id ?? "");
    setDept(u.department?.id ?? u.requested_department?.id ?? "");
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={users.isRefetching} onRefresh={() => { void users.refetch(); void pending.refetch(); }} />}>
      <Segmented<Tab> value={tab} onChange={(v) => { setTab(v); setOpen(null); }} options={[
        { key: "pending_approval", label: `Pending (${pending.data?.length ?? 0})` }, { key: "active", label: "Active" }, { key: "all", label: "All" }]} />
      <TextInput placeholder="Search name or email" placeholderTextColor={t.muted} value={search} onChangeText={setSearch}
        style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface, marginBottom: 12 }]} />
      <ErrorBox error={act.error} />
      {users.isLoading ? <Loading /> : !users.data?.length ? <Empty>No users here.</Empty> : users.data.map((u) => {
        const locked = isFuture(u.locked_until);
        return (
          <Card key={u.id}>
            <View style={s.rowBetween}>
              <View style={{ flex: 1 }}>
                <P style={{ fontWeight: "700" }}>{u.full_name}</P>
                <P small muted>{u.email}</P>
                <P small muted>{u.role?.name ?? "No role"} · {u.department?.name ?? (u.requested_department ? `${u.requested_department.name} (requested)` : "No department")}
                  {" · MFA "}{u.mfa_enabled ? "on" : "off"}</P>
                <P small muted>Last login {formatDate(u.last_login_at, true)}</P>
              </View>
              <View style={{ gap: 4, alignItems: "flex-end" }}>
                <Badge label={u.status} tone={statusTone(u.status)} />
                {locked && <Badge label="locked" tone="danger" />}
              </View>
            </View>
            {manage && u.id !== me?.id && (
              <View style={{ marginTop: 10 }}>
                <Button small title={open === u.id ? "Close" : u.status === "pending_approval" ? "Review & approve" : "Manage"} variant={
                  u.status === "pending_approval" ? "primary" : "default"} onPress={() => expand(u)} />
                {open === u.id && (
                  <View style={{ marginTop: 12 }}>
                    {(u.status === "pending_approval" || u.status === "active") && (
                      <>
                        <Choice label="Role" value={role} onChange={setRole}
                          options={(roles.data ?? []).map((r) => ({ key: r.id, label: r.name }))} />
                        <Choice label="Department" value={dept} onChange={setDept} allowNone="None"
                          options={(depts.data ?? []).map((d) => ({ key: d.id, label: d.name }))} />
                        <Notice tone="info">You can only assign roles whose permissions you hold. Role changes sign the user out.</Notice>
                      </>
                    )}
                    <View style={s.row}>
                      {u.status === "pending_approval" && <>
                        <Button title="Approve" variant="primary" disabled={!role} loading={act.isPending}
                          onPress={() => act.mutate(() => api.users.approve(u.id, role, dept || null))} />
                        <Button title="Reject" variant="danger" onPress={() => confirm("Reject account?", `${u.email} will not get access.`,
                          () => act.mutate(() => api.users.reject(u.id, "")), "Reject")} />
                      </>}
                      {u.status === "active" && <>
                        <Button title="Save role" variant="primary" disabled={!role} loading={act.isPending}
                          onPress={() => act.mutate(() => api.users.update(u.id, { role_id: role, department_id: dept }))} />
                        <Button title="Reset MFA" onPress={() => act.mutate(() => api.users.resetMfa(u.id))} />
                        {can(PERM.sessionsManage) && <Button title="Sign out everywhere" onPress={() => act.mutate(() => api.users.revokeSessions(u.id))} />}
                        <Button title="Disable" variant="danger" onPress={() => confirm("Disable account?", "The user is signed out immediately.",
                          () => act.mutate(() => api.users.disable(u.id)), "Disable")} />
                      </>}
                      {u.status === "disabled" && <Button title="Enable" variant="primary" onPress={() => act.mutate(() => api.users.enable(u.id))} />}
                      {locked && <Button title="Unlock" onPress={() => act.mutate(() => api.users.unlock(u.id))} />}
                    </View>
                  </View>
                )}
              </View>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}
