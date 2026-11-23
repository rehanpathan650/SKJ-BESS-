import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, PERM } from "@skj/shared";
import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Badge, Button, Card, Empty, ErrorBox, ListItem, P, Row, s, useTheme } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { VARIANT } from "../../lib/config";
import { api, getBiometricEnabled, setBiometricEnabled } from "../../lib/session";

const ROUTES: Record<string, string> = { customers: "customer", projects: "project", proposals: "proposal", bills: "bill" };

export default function More() {
  const { me, logout, can } = useAuth();
  const t = useTheme();
  const qc = useQueryClient();
  const notes = useQuery({ queryKey: ["notifications"], queryFn: () => api.notifications.list() });
  const readAll = useMutation({ mutationFn: api.notifications.readAll, onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const [bio, setBio] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void getBiometricEnabled().then(setBio);
    void (async () => setBioAvailable((await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())))();
  }, []);

  async function toggleBio(on: boolean) {
    setError(null);
    if (on) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Confirm to enable biometric unlock" });
      if (!r.success) return setError(new Error("Biometric check was not completed"));
    }
    await setBiometricEnabled(on);
    setBio(on);
  }

  function open(link: string) {
    const m = link.match(/^\/(customers|projects|proposals|bills)\/([A-Za-z0-9-]+)$/);
    if (m) router.push(`/${ROUTES[m[1]]}/${m[2]}` as never);
  }

  const isAdmin = can(PERM.usersView) || can(PERM.rolesManage);
  const pending = useQuery({ queryKey: ["users", "pending-count"], queryFn: () => api.users.list("pending_approval"),
    enabled: can(PERM.usersView) });
  const menu: { title: string; sub: string; href: string; show: boolean; badge?: number }[] = [
    { title: "Projects", sub: "All projects you can see, by stage", href: "/projects", show: true },
    { title: "My profile & security", sub: "Password, two-step verification, devices", href: "/profile", show: true },
    { title: "Users & approvals", sub: "Approve sign-ups, roles, disable accounts", href: "/admin/users", show: can(PERM.usersView) && !me?.single_user_mode,
      badge: pending.data?.length },
    { title: "Roles & permissions", sub: "Built-in and custom roles", href: "/admin/roles", show: isAdmin && !me?.single_user_mode },
    { title: "Pricing & assumptions", sub: "Confidential vendor costs and margins", href: "/admin/pricing", show: can(PERM.confidential) },
    { title: "Security", sub: "Alerts, audit log, sessions, AI usage", href: "/security", show: can(PERM.securityView) || can(PERM.auditView) },
  ];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content}>
      {menu.filter((m) => m.show).map((m) => (
        <ListItem key={m.href} title={m.title} subtitle={m.sub} onPress={() => router.push(m.href as never)}
          right={m.badge ? <Badge label={String(m.badge)} tone="warn" /> : <Text style={{ color: t.muted, fontSize: 18 }}>›</Text>} />
      ))}
      <View style={{ height: 8 }} />
      <Card title="Notifications" right={<Button small title="Mark all read" onPress={() => readAll.mutate()} />}>
        {!notes.data?.items.length ? <Empty>You're all caught up.</Empty> : notes.data.items.slice(0, 40).map((n) => (
          <Pressable key={n.id} onPress={async () => { await api.notifications.read(n.id); void qc.invalidateQueries({ queryKey: ["notifications"] }); open(n.link); }}
            style={{ paddingVertical: 10, borderBottomWidth: 0.5, borderColor: t.border, opacity: n.read ? 0.65 : 1 }}>
            <Text style={{ color: t.text, fontWeight: "600" }}>{n.read ? "" : "● "}{n.title}</Text>
            {!!n.body && <P small>{n.body}</P>}
            <P small muted>{formatDate(n.created_at, true)}</P>
          </Pressable>
        ))}
      </Card>
      <Card title="Account">
        <Row label="Name" value={me?.full_name} />
        <Row label="Email" value={me?.email} />
        <Row label="Role" value={me?.role?.name ?? "–"} />
        <Row label="Department" value={me?.department?.name ?? "–"} />
        <Row label="Two-step verification" value={me?.mfa_enabled ? "On" : "Off"} />
      </Card>
      <Card title="Security">
        <ErrorBox error={error} />
        <View style={s.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: "600" }}>Biometric unlock</Text>
            <P small muted>{bioAvailable ? "Ask for fingerprint/face after the app has been in the background." : "No biometrics set up on this device."}</P>
          </View>
          <Switch value={bio} onValueChange={toggleBio} disabled={!bioAvailable} />
        </View>
        <P small muted style={{ marginTop: 8 }}>Sessions end automatically after 30 minutes of inactivity. Sensitive screens block screenshots.</P>
      </Card>
      <Button title="Log out" variant="danger" onPress={() => void logout()} />
      <P small muted style={{ textAlign: "center", marginTop: 16 }}>SKJ BESS · {VARIANT} build</P>
    </ScrollView>
  );
}
