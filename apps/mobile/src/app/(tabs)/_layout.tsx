import Feather from "@expo/vector-icons/Feather";
import { useQuery } from "@tanstack/react-query";
import { PERM } from "@skj/shared";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { font, useTheme } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/session";

const icon = (name: ComponentProps<typeof Feather>["name"]) =>
  ({ color }: { color: ColorValue }) => <Feather name={name} size={21} color={color as string} />;

export default function TabsLayout() {
  const t = useTheme();
  const { can, me } = useAuth();
  const unread = useQuery({ queryKey: ["notifications", "count"], queryFn: () => api.notifications.list(true),
    refetchInterval: 60_000, enabled: me?.status === "active" });
  const pendingUsers = useQuery({ queryKey: ["users", "pending-count"], queryFn: () => api.users.list("pending_approval"),
    refetchInterval: 120_000, enabled: me?.status === "active" && can(PERM.usersView) });
  const moreBadge = (unread.data?.unread ?? 0) + (pendingUsers.data?.length ?? 0);
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: t.ink }, headerTintColor: t.inkText, headerTitleStyle: { ...font.semibold, fontSize: 17 },
      tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border, height: 62, paddingBottom: 8, paddingTop: 6 },
      tabBarActiveTintColor: t.brand, tabBarInactiveTintColor: t.muted, tabBarLabelStyle: { ...font.medium, fontSize: 11.5 },
      tabBarBadgeStyle: { backgroundColor: t.charge, color: "#2b1d00", fontSize: 11 },
    }}>
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: icon("activity") }} />
      <Tabs.Screen name="customers" options={{ title: "Customers", tabBarIcon: icon("briefcase") }} />
      <Tabs.Screen name="calculator" options={{ title: "Calculator", tabBarIcon: icon("battery-charging"),
        href: can(PERM.calculatorUse) ? undefined : null }} />
      <Tabs.Screen name="proposals" options={{ title: "Proposals", tabBarIcon: icon("file-text"),
        href: can(PERM.proposalsView) ? undefined : null }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: icon("menu"), tabBarBadge: moreBadge || undefined }} />
    </Tabs>
  );
}
