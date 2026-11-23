import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PERM, type Role } from "@skj/shared";
import { useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { Badge, Button, Card, confirm, ErrorBox, Input, Loading, Notice, P, s, useTheme } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/session";

export default function Roles() {
  const { can } = useAuth();
  const t = useTheme();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ["roles"], queryFn: api.roles.list });
  const catalogue = useQuery({ queryKey: ["perm-catalogue"], queryFn: api.roles.permissions });
  const [editing, setEditing] = useState<Partial<Role> | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const manage = can(PERM.rolesManage);
  const refresh = () => qc.invalidateQueries({ queryKey: ["roles"] });
  const save = useMutation({
    mutationFn: () => editing?.id ? api.roles.update(editing.id, { name, description, permissions: perms })
      : api.roles.create({ name, description, permissions: perms }),
    onSuccess: () => { setEditing(null); void refresh(); },
  });
  const remove = useMutation({ mutationFn: api.roles.remove, onSuccess: () => void refresh() });

  function edit(r: Partial<Role>) {
    setEditing(r);
    setName(r.name ?? "");
    setDescription(r.description ?? "");
    setPerms(r.permissions ?? []);
  }

  if (editing) {
    return (
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Card title={editing.id ? `Edit ${editing.name}` : "New role"}>
          <ErrorBox error={save.error} />
          <Input label="Name" value={name} editable={!editing.is_system} onChangeText={setName} />
          <Input label="Description" value={description} onChangeText={setDescription} maxLength={500} />
          {catalogue.data?.map((p) => (
            <View key={p.key} style={[s.rowBetween, { paddingVertical: 6, borderBottomWidth: 0.5, borderColor: t.border }]}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ color: t.text, fontFamily: "monospace", fontSize: 12.5 }}>{p.key}{p.requires_mfa ? "  (MFA)" : ""}</Text>
                <P small muted>{p.description}</P>
              </View>
              <Switch value={perms.includes(p.key)} onValueChange={(on) => setPerms(on ? [...perms, p.key] : perms.filter((x) => x !== p.key))} />
            </View>
          ))}
          <View style={{ height: 8 }} />
          <Notice tone="info">Saving signs out everyone with this role so new permissions apply immediately.</Notice>
          <View style={s.row}>
            <Button title="Save role" variant="primary" disabled={name.trim().length < 2} loading={save.isPending} onPress={() => save.mutate()} />
            <Button title="Cancel" onPress={() => setEditing(null)} />
          </View>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content}>
      {manage && <View style={{ marginBottom: 12 }}><Button title="+ New role" variant="primary" onPress={() => edit({ permissions: [] })} /></View>}
      <ErrorBox error={remove.error} />
      {roles.isLoading ? <Loading /> : roles.data?.map((r) => (
        <Card key={r.id} title={r.name} right={r.is_system ? <Badge label="built-in" /> : undefined}>
          <P small muted>{r.description}</P>
          <P small>{r.user_count} user(s)</P>
          <View style={[s.row, { marginTop: 6 }]}>
            {(r.permissions.includes("*") ? ["All permissions"] : r.permissions).map((p) => <Badge key={p} label={p} />)}
          </View>
          {manage && !r.permissions.includes("*") && (
            <View style={[s.row, { marginTop: 10 }]}>
              <Button small title="Edit" onPress={() => edit(r)} />
              {!r.is_system && <Button small variant="danger" title="Delete" onPress={() =>
                confirm("Delete role?", `Delete the role "${r.name}"?`, () => remove.mutate(r.id), "Delete")} />}
            </View>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
