import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text } from "react-native";
import { Button, Card, ErrorBox, Input, Notice, P, s, useTheme } from "../components/ui";
import { useAuth } from "../lib/auth";
import { api } from "../lib/session";

/** Required for admin/commercial roles. Enter the key into an authenticator app on another device or this one. */
export default function MfaSetup() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const t = useTheme();
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.auth.mfaSetup().then((r) => setSecret(r.secret), setError);
  }, []);
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content}>
      <Card title="Set up two-step verification">
        <Notice tone="info">Your role has administrator or commercial privileges, so two-step verification is required.</Notice>
        <ErrorBox error={error} />
        <P>Add this key to your authenticator app (Microsoft or Google Authenticator), then enter the 6-digit code.</P>
        {secret && <Text selectable style={{ fontFamily: "monospace", fontSize: 16, color: t.text, marginVertical: 12, textAlign: "center" }}>{secret}</Text>}
        <Input label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} />
        <Button title="Turn on MFA" variant="primary" disabled={code.length !== 6} onPress={async () => {
          try { await api.auth.mfaEnable(code); await qc.invalidateQueries({ queryKey: ["me"] }); } catch (e) { setError(e); }
        }} />
        <P> </P>
        <Button title="Log out" onPress={() => void logout()} />
      </Card>
    </ScrollView>
  );
}
