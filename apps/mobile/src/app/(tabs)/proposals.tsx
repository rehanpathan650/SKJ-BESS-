import { useQuery } from "@tanstack/react-query";
import { formatDate, formatINR, PROPOSAL_STATUS_LABELS } from "@skj/shared";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Badge, Empty, ErrorBox, ListItem, Loading, s, Segmented, statusTone, useTheme } from "../../components/ui";
import { api } from "../../lib/session";

type Filter = "all" | "pending_approval" | "approved" | "sent";

export default function Proposals() {
  const t = useTheme();
  const [filter, setFilter] = useState<Filter>("all");
  const q = useQuery({ queryKey: ["proposals", filter], queryFn: () => api.proposals.list(filter === "all" ? undefined : filter) });
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Segmented<Filter> value={filter} onChange={setFilter} options={[
          { key: "all", label: "All" }, { key: "pending_approval", label: "Pending" }, { key: "approved", label: "Approved" },
          { key: "sent", label: "Sent" }]} />
        <ErrorBox error={q.error} />
      </View>
      {q.isLoading ? <Loading /> : (
        <FlatList contentContainerStyle={s.content} data={q.data ?? []} keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          ListEmptyComponent={<Empty>No proposals.</Empty>}
          renderItem={({ item }) => (
            <ListItem title={`${item.customer_name} · R${item.revision}`}
              subtitle={`${item.project_name} · ${formatINR(item.key_figures.capex_inr, { compact: true })} · ${formatDate(item.updated_at)}`}
              right={<Badge label={PROPOSAL_STATUS_LABELS[item.status]} tone={statusTone(item.status)} />}
              onPress={() => router.push(`/proposal/${item.id}`)} />
          )} />
      )}
    </View>
  );
}
