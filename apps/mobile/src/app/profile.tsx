import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@skj/shared";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button, Card, ErrorBox, Input, Notice, P, s, useTheme } from "../components/ui";
import { useAuth } from "../lib/auth";
import { api } from "../lib/session";

export default function Profile() {
  const { me } = useAuth();
  const t = useTheme();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["my-sessions"], queryFn: api.auth.sessions });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [off, setOff] = useState({ password: "", code: "" });

  const change = useMutation({
    mutationFn: () => {
      if (pw.next !== pw.confirm) throw new Error("New passwords do not match");
      if (pw.next.length < 12) throw new Error("Use at least 12 characters");
      return api.auth.changePassword(pw.current, pw.next);
    },
    onSuccess: () => { setPw({ current: "", next: "", confirm: "" }); void sessions.refetch(); },
  });
  const setup = useMutation({ mutationFn: api.auth.mfaSetup, onSuccess: (r) => setSecret(r.secret) });
  const enable = useMutation({ mutationFn: () => api.auth.mfaEnable(code),
    onSuccess: () => { setSecret(null); setCode(""); void qc.invalidateQueries({ queryKey: ["me"] }); } });
  const disable = useMutation({ mutationFn: () => api.auth.mfaDisable(off.password, off.code),
    onSuccess: () => { setOff({ password: "", code: "" }); void qc.invalidateQueries({ queryKey: ["me"] }); } });
  const revoke = useMutation({ mutationFn: api.auth.revokeSession, onSuccess: () => void sessions.refetch() });

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card title="Change password">
        <ErrorBox error={change.error} />
        {change.isSuccess && <Notice tone="ok">{change.data.detail}</Notice>}
        <Input label="Current password" value={pw.current} secureTextEntry autoComplete="password" onChangeText={(v) => setPw({ ...pw, current: v })} />
        <Input label="New password" help="At least 12 characters" value={pw.next} secureTextEntry autoComplete="new-password"
          onChangeText={(v) => setPw({ ...pw, next: v })} />
        <Input label="Confirm new password" value={pw.confirm} secureTextEntry onChangeText={(v) => setPw({ ...pw, confirm: v })} />
        <Button title="Change password" variant="primary" loading={change.isPending} disabled={!pw.current || !pw.next}
          onPress={() => change.mutate()} />
      </Card>

      <Card title="Two-step verification (MFA)">
        {me?.mfa_enabled ? (
          <>
            <Notice tone="ok">MFA is on for your account.</Notice>
            {me.mfa_required ? <P small muted>Your role requires MFA, so it can't be turned off.</P> : (
              <>
                <ErrorBox error={disable.error} />
                <Input label="Password" value={off.password} secureTextEntry onChangeText={(v) => setOff({ ...off, password: v })} />
                <Input label="Current 6-digit code" value={off.code} keyboardType="number-pad" maxLength={6}
                  onChangeText={(v) => setOff({ ...off, code: v.replace(/\D/g, "") })} />
                <Button title="Turn off MFA" variant="danger" loading={disable.isPending} onPress={() => disable.mutate()} />
              </>
            )}
          </>
        ) : secret ? (
          <>
            <P>Add this key to your authenticator app, then enter the 6-digit code it shows.</P>
            <Text selectable style={{ fontFamily: "monospace", fontSize: 16, color: t.text, marginVertical: 12, textAlign: "center" }}>{secret}</Text>
            <ErrorBox error={enable.error} />
            <Input label="6-digit code" value={code} keyboardType="number-pad" maxLength={6} onChangeText={(v) => setCode(v.replace(/\D/g, ""))} />
            <Button title="Turn on MFA" variant="primary" disabled={code.length !== 6} loading={enable.isPending} onPress={() => enable.mutate()} />
          </>
        ) : (
          <>
            <ErrorBox error={setup.error} />
            <P>Protect your account with an authenticator app.</P>
            <View style={{ height: 8 }} />
            <Button title="Set up MFA" variant="primary" loading={setup.isPending} onPress={() => setup.mutate()} />
          </>
        )}
      </Card>

      <Card title="Where you're signed in">
        <ErrorBox error={revoke.error} />
        {sessions.data?.map((x) => (
          <View key={x.id} style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderColor: t.border }}>
            <View style={s.rowBetween}>
              <Text style={{ color: t.text, fontWeight: "600" }}>{x.client_type === "mobile" ? "Android app" : "Web browser"}</Text>
              {x.current ? <P small muted>This device</P> : <Button small title="Sign out" onPress={() => revoke.mutate(x.id)} />}
            </View>
            <P small muted>{x.ip} · last active {formatDate(x.last_used_at, true)}</P>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
