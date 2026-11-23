import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Button, Card, ErrorBox, Input, s, useTheme } from "../../components/ui";
import { api } from "../../lib/session";

const FIELDS: [string, string, ("default" | "email-address" | "phone-pad")?][] = [
  ["name", "Customer name *"], ["company", "Company"], ["industry", "Industry"], ["contact_name", "Contact person"],
  ["email", "Email", "email-address"], ["phone", "Phone", "phone-pad"], ["state", "State"], ["discom", "DISCOM"],
  ["consumer_number", "Consumer number"], ["tariff_category", "Tariff category"], ["gstin", "GSTIN"], ["address", "Address"],
];

export default function NewCustomer() {
  const t = useTheme();
  const qc = useQueryClient();
  const [v, setV] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => api.customers.create(Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim()))),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: ["customers"] }); router.replace(`/customer/${c.id}`); },
  });
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card title="New customer">
        <ErrorBox error={create.error} />
        <View style={[s.row, { gap: 10 }]}>
          {FIELDS.map(([k, label, kb]) => (
            <Input key={k} label={label} value={v[k] ?? ""} onChangeText={(x) => setV({ ...v, [k]: x })} keyboardType={kb ?? "default"}
              autoCapitalize={kb === "email-address" ? "none" : "sentences"} multiline={k === "address"} />
          ))}
        </View>
        <Button title="Create customer" variant="primary" disabled={(v.name ?? "").trim().length < 2} loading={create.isPending}
          onPress={() => create.mutate()} />
      </Card>
    </ScrollView>
  );
}
