import { useInfiniteQuery } from "@tanstack/react-query";
import { formatINR, formatNumber, STAGE_LABELS, STAGES, type ProjectStage } from "@skj/shared";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Badge, Button, ChargeMeter, Choice, Empty, ErrorBox, ListItem, Loading, s, statusTone, useTheme } from "../components/ui";
import { api } from "../lib/session";

export default function Projects() {
  const t = useTheme();
  const [stage, setStage] = useState<ProjectStage | "">("");
  const [mine, setMine] = useState(false);
  const PAGE = 50;
  const q = useInfiniteQuery({
    queryKey: ["projects", stage, mine], initialPageParam: 0,
    queryFn: ({ pageParam }) => api.projects.list({ stage: stage || undefined, mine: mine || undefined, limit: PAGE, offset: pageParam }),
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Choice value={stage} onChange={setStage} allowNone="All stages" options={STAGES.map((x) => ({ key: x, label: STAGE_LABELS[x] }))} />
        <View style={s.row}><Button small title={mine ? "☑ Only mine" : "☐ Only mine"} onPress={() => setMine(!mine)} /></View>
        <ErrorBox error={q.error} />
      </View>
      {q.isLoading ? <Loading /> : (
        <FlatList contentContainerStyle={s.content} data={rows} onEndReachedThreshold={0.4}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
          ListFooterComponent={q.isFetchingNextPage ? <Loading rows={1} /> : undefined} initialNumToRender={12} windowSize={7} removeClippedSubviews keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          ListEmptyComponent={<Empty>No projects. Create one from a customer's page.</Empty>}
          renderItem={({ item }) => (
            <ListItem title={item.name}
              subtitle={`${item.customer_name}, ${formatNumber(item.target_capacity_kwh)} kWh, ${formatINR(item.estimated_value_inr, { compact: true })}`}
              right={<View style={{ alignItems: "flex-end", gap: 6 }}><Badge label={STAGE_LABELS[item.stage]} tone={statusTone(item.stage)} />
                <ChargeMeter pct={item.progress_pct} cells={8} /></View>} onPress={() => router.push(`/project/${item.id}`)} />
          )} />
      )}
    </View>
  );
}
