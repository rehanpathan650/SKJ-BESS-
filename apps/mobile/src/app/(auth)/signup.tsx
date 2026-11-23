import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button, Card, ErrorBox, H1, Input, Notice, P, s, useTheme } from "../../components/ui";
import { api } from "../../lib/session";

export default function Signup() {
  const t = useTheme();
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.auth.departments });
  const [f, setF] = useState({ full_name: "", email: "", password: "", confirm: "", department_id: "" });
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (f.password !== f.confirm) return setError(new Error("Passwords do not match"));
    if (f.password.length < 12) return setError(new Error("Password must be at least 12 characters"));
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.signup({ full_name: f.full_name.trim(), email: f.email.trim(), password: f.password,
        department_id: f.department_id || null });
      setDone(r.detail);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={[s.content, { maxWidth: 520, width: "100%", alignSelf: "center" }]}
      keyboardShouldPersistTaps="handled">
      <H1>Create your account</H1>
      <P muted>An administrator must approve your account before you can see any data.</P>
      <View style={{ height: 12 }} />
      {done ? (
        <Card>
          <Notice tone="ok">{done}</Notice>
          <P>1. Open the link in the email to verify your address.</P>
          <P>2. An administrator assigns your role.</P>
          <P>3. You'll get an email when you can log in.</P>
        </Card>
      ) : (
        <Card>
          <ErrorBox error={error} />
          <Input label="Full name" value={f.full_name} onChangeText={(v) => setF({ ...f, full_name: v })} autoComplete="name" />
          <Input label="Work email" help="Use your SKJ company email." value={f.email} onChangeText={(v) => setF({ ...f, email: v })}
            autoCapitalize="none" keyboardType="email-address" />
          <Text style={{ color: t.text, fontWeight: "600", marginBottom: 4, fontSize: 13 }}>Department (optional)</Text>
          {depts.data && (
            <View style={[s.row, { marginBottom: 12 }]}>
              {depts.data.map((d) => (
                <Button key={d.id} small title={d.name} variant={f.department_id === d.id ? "primary" : "default"}
                  onPress={() => setF({ ...f, department_id: f.department_id === d.id ? "" : d.id })} />
              ))}
            </View>
          )}
          <Input label="Password" help="At least 12 characters." value={f.password} secureTextEntry autoComplete="new-password"
            onChangeText={(v) => setF({ ...f, password: v })} />
          <Input label="Confirm password" value={f.confirm} secureTextEntry onChangeText={(v) => setF({ ...f, confirm: v })} />
          <Button title="Sign up" variant="primary" onPress={submit} loading={busy} disabled={!f.full_name || !f.email || !f.password} />
        </Card>
      )}
      <View style={[s.row, { justifyContent: "center" }]}>
        <Link href="/login"><Text style={{ color: t.brand, fontWeight: "600" }}>Back to log in</Text></Link>
      </View>
    </ScrollView>
  );
}
