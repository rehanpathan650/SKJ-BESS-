import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Button, Card, ErrorBox, H1, Input, P, s, useTheme } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { API_URL, IS_DEV } from "../../lib/config";
import { api } from "../../lib/session";

export default function Login() {
  const cfg = useQuery({ queryKey: ["app-config"], queryFn: api.quotations.appConfig, staleTime: Infinity, retry: false });
  const { login, verifyMfa } = useAuth();
  const t = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (ticket) await verifyMfa(ticket, code);
      else {
        const r = await login(email, password);
        if (r.mfaTicket) { setTicket(r.mfaTicket); setPassword(""); }
      }
    } catch (e) {
      setError(e);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: "center", maxWidth: 480, width: "100%", alignSelf: "center" }]}
        keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", marginBottom: 16 }}>
          <Text style={{ fontSize: 28 }}>🔋</Text>
          <H1>SKJ Energy Solutions</H1>
          <P muted>Internal BESS Platform</P>
        </View>
        <Card title={ticket ? "Enter your authenticator code" : "Log in"}>
          <ErrorBox error={error} />
          {!ticket ? (
            <>
              <Input label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
                keyboardType="email-address" textContentType="username" />
              <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password"
                textContentType="password" />
            </>
          ) : (
            <Input label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ""))} keyboardType="number-pad"
              maxLength={6} autoFocus textContentType="oneTimeCode" />
          )}
          <Button title={ticket ? "Verify" : "Log in"} variant="primary" onPress={submit} loading={busy}
            disabled={ticket ? code.length !== 6 : !email || !password} />
          {ticket && <View style={{ marginTop: 8 }}><Button title="Back" onPress={() => { setTicket(null); setCode(""); }} /></View>}
        </Card>
        <View style={[s.row, { justifyContent: "center" }]}>
          {!cfg.data?.single_user_mode && <>
            <Link href="/signup"><Text style={{ color: t.brand, fontWeight: "600" }}>Create an account</Text></Link>
            <Text style={{ color: t.muted }}>·</Text>
          </>}
          <Link href="/forgot"><Text style={{ color: t.brand, fontWeight: "600" }}>Forgot password?</Text></Link>
        </View>
        <P muted small style={{ textAlign: "center", marginTop: 16 }}>For authorised SKJ employees only. Activity is logged.</P>
        {IS_DEV && <P muted small style={{ textAlign: "center", marginTop: 4 }}>Server: {API_URL}</P>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
