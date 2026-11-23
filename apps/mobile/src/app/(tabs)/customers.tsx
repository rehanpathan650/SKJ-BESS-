import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, TextInput, View } from "react-native";
import { PERM } from "@skj/shared";
import { Button, Empty, ErrorBox, ListItem, Loading, s, useTheme } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/session";

export default function Customers() {
  const t = useTheme();
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["customers", q], queryFn: () => api.customers.list(q || undefined, 100) });
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ padding: 16, paddingBottom: 4 }}>
        <TextInput placeholder="Search customers, contacts or phone" placeholderTextColor={t.muted} value={q} onChangeText={setQ}
          maxLength={100} style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]} />
        <View style={[s.row, { marginTop: 8 }]}>
          {can(PERM.customersCreate) && <Button small variant="primary" title="+ New customer" onPress={() => router.push("/customer/new")} />}
          <Button small title="All projects" onPress={() => router.push("/projects")} />
        </View>
      </View>
      {list.isLoading ? <Loading /> : <View style={{ paddingHorizontal: 16 }}><ErrorBox error={list.error} /></View>}
      <FlatList contentContainerStyle={s.content} data={list.data?.items ?? []} keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => { void list.refetch(); }} />}
        ListEmptyComponent={list.isLoading ? undefined :<Empty>No customers found.</Empty>}
        renderItem={({ item }) => (
          <ListItem title={item.name} subtitle={[item.contact_name, item.state, item.discom].filter(Boolean).join(" · ")}
            onPress={() => router.push(`/customer/${item.id}`)} />
        )} />
    </View>
  );
}
