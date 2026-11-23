import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Button, Card, Choice, ErrorBox, Input, s, useTheme } from "../../components/ui";
import { api } from "../../lib/session";

export default function NewProject() {
  const { customer } = useLocalSearchParams<{ customer: string }>();
  const t = useTheme();
  const dir = useQuery({ queryKey: ["directory"], queryFn: api.users.directory });
  const [v, setV] = useState({ name: "", site_address: "", estimated_value_inr: "", target_capacity_kwh: "" });
  const [engineer, setEngineer] = useState("");
  const create = useMutation({
    mutationFn: () => api.projects.create({
      customer_id: customer, name: v.name.trim(), site_address: v.site_address,
      estimated_value_inr: Number(v.estimated_value_inr) || 0, target_capacity_kwh: Number(v.target_capacity_kwh) || 0,
      engineer_id: engineer || null,
    }),
    onSuccess: (p) => router.replace(`/project/${p.id}`),
  });
  const engineers = (dir.data ?? []).filter((u) => !u.role || /engineer/i.test(u.role));
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card title="New project">
        <ErrorBox error={create.error} />
        <Input label="Project name *" value={v.name} onChangeText={(x) => setV({ ...v, name: x })} />
        <Input label="Site address" value={v.site_address} multiline onChangeText={(x) => setV({ ...v, site_address: x })} />
        <View style={[s.row, { gap: 10 }]}>
          <Input label="Estimated value (₹)" value={v.estimated_value_inr} keyboardType="number-pad"
            onChangeText={(x) => setV({ ...v, estimated_value_inr: x.replace(/\D/g, "") })} />
          <Input label="Target capacity (kWh)" value={v.target_capacity_kwh} keyboardType="number-pad"
            onChangeText={(x) => setV({ ...v, target_capacity_kwh: x.replace(/\D/g, "") })} />
        </View>
        <Choice label="BESS engineer" value={engineer} onChange={setEngineer} allowNone="Assign later"
          options={(engineers.length ? engineers : dir.data ?? []).map((u) => ({ key: u.id, label: u.full_name }))} />
        <Button title="Create project" variant="primary" disabled={v.name.trim().length < 2} loading={create.isPending}
          onPress={() => create.mutate()} />
      </Card>
    </ScrollView>
  );
}
