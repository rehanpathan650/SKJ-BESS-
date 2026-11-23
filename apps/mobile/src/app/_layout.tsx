import {
  IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold, useFonts,
} from "@expo-google-fonts/ibm-plex-sans";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@skj/shared";
import * as Notifications from "expo-notifications";
import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { font, Loading, useTheme } from "../components/ui";
import { AuthProvider, useAuth } from "../lib/auth";
import { LockScreen } from "../components/LockScreen";

function Gate() {
  const { me, loading, locked, touch } = useAuth();
  const segments = useSegments();
  const t = useTheme();

  useEffect(() => {
    if (loading) return;
    const group = segments[0];
    if (!me) {
      if (group !== "(auth)") router.replace("/login");
    } else if (me.status !== "active") {
      if (segments[0] !== "pending") router.replace("/pending");
    } else if (me.mfa_required && !me.mfa_enabled) {
      if (segments[0] !== "mfa-setup") router.replace("/mfa-setup");
    } else if (group === "(auth)" || group === "pending" || group === "mfa-setup") {
      router.replace("/");
    }
  }, [me, loading, segments]);

  // Open the screen a tapped notification points to (internal paths only).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const link = resp.notification.request.content.data?.link;
      if (typeof link === "string" && /^\/(customers|projects|proposals|bills)\/[A-Za-z0-9-]+$/.test(link)) {
        const [, kind, id] = link.split("/");
        const route = { customers: "customer", projects: "project", proposals: "proposal", bills: "bill" }[kind];
        if (route) router.push(`/${route}/${id}` as never);
      }
    });
    return () => sub.remove();
  }, []);

  if (loading) return <Loading />;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }} onStartShouldSetResponderCapture={() => { touch(); return false; }}>
      <Stack screenOptions={{ headerStyle: { backgroundColor: t.ink }, headerTintColor: t.inkText,
        headerTitleStyle: { ...font.semibold, fontSize: 17 }, contentStyle: { backgroundColor: t.bg }, animation: "slide_from_right" }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="pending" options={{ title: "Awaiting approval" }} />
        <Stack.Screen name="mfa-setup" options={{ title: "Two-step verification" }} />
        <Stack.Screen name="customer/[id]" options={{ title: "Customer" }} />
        <Stack.Screen name="project/[id]" options={{ title: "Project" }} />
        <Stack.Screen name="bill/[id]" options={{ title: "Review bill" }} />
        <Stack.Screen name="proposal/[id]" options={{ title: "Proposal" }} />
        <Stack.Screen name="customer/new" options={{ title: "New customer" }} />
        <Stack.Screen name="project/new" options={{ title: "New project" }} />
        <Stack.Screen name="projects" options={{ title: "Projects" }} />
        <Stack.Screen name="profile" options={{ title: "My profile & security" }} />
        <Stack.Screen name="admin/users" options={{ title: "Users & approvals" }} />
        <Stack.Screen name="admin/roles" options={{ title: "Roles & permissions" }} />
        <Stack.Screen name="admin/pricing" options={{ title: "Pricing & assumptions" }} />
        <Stack.Screen name="security" options={{ title: "Security" }} />
        <Stack.Screen name="quotation/new" options={{ title: "New quotation" }} />
      </Stack>
      {me && locked && <LockScreen />}
    </View>
  );
}

export default function RootLayout() {
  // Brand font; if it fails to load the app continues with the system font.
  const [fontsLoaded, fontError] = useFonts({ IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold });
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: (n, e) => !(e instanceof ApiError && [401, 403, 404].includes(e.status)) && n < 2,
        staleTime: 30_000,
        // Offline viewing: screens already opened this session stay readable without signal (kept in memory
        // only; nothing confidential is written to the phone's storage).
        gcTime: 30 * 60_000,
        networkMode: "offlineFirst",
      },
      mutations: { networkMode: "online" },
    },
  }));
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <StatusBar style="light" />
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
