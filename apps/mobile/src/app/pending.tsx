import { ScrollView } from "react-native";
import { Button, Card, Notice, P, s, useTheme } from "../components/ui";
import { useAuth } from "../lib/auth";

export default function Pending() {
  const { me, refresh, logout } = useAuth();
  const t = useTheme();
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content}>
      <Card title={`Hello, ${me?.full_name.split(" ")[0] ?? ""}`}>
        <Notice>
          {me?.status === "pending_approval"
            ? "Your account is awaiting approval. An administrator will assign your role shortly."
            : "Your account is not active yet."}
        </Notice>
        <P muted small>Signed in as {me?.email}. You can't see customers, projects or pricing until approved.</P>
        <P> </P>
        <Button title="Check again" variant="primary" onPress={() => void refresh()} />
        <P> </P>
        <Button title="Log out" onPress={() => void logout()} />
      </Card>
    </ScrollView>
  );
}
