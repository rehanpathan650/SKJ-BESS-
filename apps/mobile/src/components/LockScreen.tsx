import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "../lib/auth";
import { Button, H1, P, useTheme } from "./ui";

/** Covers the app (hiding data) until the user passes a biometric check or signs out. */
export function LockScreen() {
  const { unlock, logout } = useAuth();
  const t = useTheme();
  useEffect(() => { void unlock(); }, [unlock]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, justifyContent: "center", padding: 24, gap: 12 }]}>
      <H1>SKJ BESS is locked</H1>
      <P muted>Unlock with your fingerprint, face or device PIN.</P>
      <Button title="Unlock" variant="primary" onPress={() => void unlock()} />
      <Button title="Sign out" onPress={() => void logout()} />
    </View>
  );
}
