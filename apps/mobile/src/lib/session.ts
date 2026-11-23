// Token storage in Android Keystore-backed SecureStore. Tokens never touch AsyncStorage, files or logs.
import { ApiClient, endpoints } from "@skj/shared";
import * as SecureStore from "expo-secure-store";
import { API_URL } from "./config";

const REFRESH_KEY = "skj.refresh";
const BIOMETRIC_KEY = "skj.biometric";
const STORE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

// The short-lived access token lives only in memory.
let accessToken: string | null = null;
let sessionEndedHandler: (() => void) | null = null;

export function onSessionEnded(fn: () => void) { sessionEndedHandler = fn; }

export async function saveTokens(access: string, refresh: string) {
  accessToken = access;
  await SecureStore.setItemAsync(REFRESH_KEY, refresh, STORE_OPTS);
}

export async function clearTokens() {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY, STORE_OPTS);
}

export function getAccessToken() { return accessToken; }

export async function hasStoredSession() {
  return (await SecureStore.getItemAsync(REFRESH_KEY, STORE_OPTS)) !== null;
}

export async function refreshTokens(): Promise<boolean> {
  const refresh = await SecureStore.getItemAsync(REFRESH_KEY, STORE_OPTS);
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) {
      if (res.status === 401) await clearTokens();
      return false;
    }
    const body = await res.json();
    await saveTokens(body.access_token, body.refresh_token);
    return true;
  } catch {
    return false; // offline: keep the stored session, try again later
  }
}

export const client = new ApiClient(API_URL, {
  credentials: "omit", // bearer tokens only; no cookies
  headers(): Record<string, string> {
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  },
  refresh: refreshTokens,
  onSessionEnded() { sessionEndedHandler?.(); },
});

export const api = endpoints(client);

export async function getBiometricEnabled() {
  return (await SecureStore.getItemAsync(BIOMETRIC_KEY)) === "1";
}
export async function setBiometricEnabled(on: boolean) {
  if (on) await SecureStore.setItemAsync(BIOMETRIC_KEY, "1");
  else await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
}
