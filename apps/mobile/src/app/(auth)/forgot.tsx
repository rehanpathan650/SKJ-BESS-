import { useMutation } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button, Card, ErrorBox, Input, Notice, P, s, useTheme } from "../../components/ui";
import { api } from "../../lib/session";

export default function Forgot() {
  const t = useTheme();
  const [email, setEmail] = useState("");
  const send = useMutation({ mutationFn: () => api.auth.forgot(email.trim()) });
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: "center", maxWidth: 480,
      width: "100%", alignSelf: "center" }]} keyboardShouldPersistTaps="handled">
      <Card title="Reset your password">
        <ErrorBox error={send.error} />
        {send.isSuccess ? (
          <>
            <Notice tone="ok">{send.data.detail}</Notice>
            <P small muted>Open the link in the email (it works on your phone's browser) to choose a new password, then log in here.</P>
          </>
        ) : (
          <>
            <Input label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Button title="Send reset link" variant="primary" disabled={!email.includes("@")} loading={send.isPending} onPress={() => send.mutate()} />
          </>
        )}
      </Card>
      <View style={[s.row, { justifyContent: "center" }]}>
        <Link href="/login"><Text style={{ color: t.brand, fontWeight: "600" }}>Back to log in</Text></Link>
      </View>
    </ScrollView>
  );
}
