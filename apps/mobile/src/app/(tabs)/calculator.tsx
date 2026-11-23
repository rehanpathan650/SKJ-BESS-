import { useMutation, useQuery } from "@tanstack/react-query";
import { PERM } from "@skj/shared";
import { router } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { CalcFormMobile, CalcResultsMobile, initialValues, toInputs } from "../../components/calc";
import { Button, Card, ErrorBox, Input, Notice, P, s, useTheme } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/session";

export default function Calculator() {
  const { can } = useAuth();
  usePreventScreenCapture("calculator"); // results may include confidential margin data
  const t = useTheme();
  const [values, setValues] = useState(initialValues());
  const [projectId, setProjectId] = useState<string | null>(null);
  const [name, setName] = useState("Mobile estimate");
  const run = useMutation({ mutationFn: () => api.calculator.preview(toInputs(values)) });
  const projects = useQuery({ queryKey: ["projects", "mine-calc"], queryFn: () => api.projects.list({}), enabled: can(PERM.calculatorUse) });
  const save = useMutation({
    mutationFn: () => api.projects.saveCalculation(projectId!, name, toInputs(values)),
    onSuccess: () => router.push(`/project/${projectId}`),
  });
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card title="Inputs">
        <CalcFormMobile value={values} onChange={setValues} />
        <Button title="Calculate savings" variant="primary" onPress={() => run.mutate()} loading={run.isPending} />
      </Card>
      <ErrorBox error={run.error} />
      {run.data && (
        <>
          <CalcResultsMobile results={run.data.results} commercial={run.data.commercial} />
          <Card title="Save to a project for validation">
            <Input label="Configuration name" value={name} onChangeText={setName} maxLength={200} />
            <View style={[s.row, { marginBottom: 12 }]}>
              {(projects.data ?? []).slice(0, 12).map((p) => (
                <Button key={p.id} small title={p.name} variant={projectId === p.id ? "primary" : "default"} onPress={() => setProjectId(p.id)} />
              ))}
            </View>
            {!projects.data?.length && <P muted small>No projects available.</P>}
            <ErrorBox error={save.error} />
            <Button title="Save configuration" disabled={!projectId || !name} loading={save.isPending} onPress={() => save.mutate()} />
            <View style={{ height: 8 }} />
            <Notice tone="info">An engineer must validate a configuration before a proposal can be generated.</Notice>
          </Card>
        </>
      )}
    </ScrollView>
  );
}
