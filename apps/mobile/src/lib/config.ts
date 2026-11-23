import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; variant?: string; eas?: { projectId?: string } };

export const VARIANT = extra.variant ?? "development";
export const IS_DEV = VARIANT === "development";
export const EAS_PROJECT_ID = extra.eas?.projectId;

/**
 * Development: if no API_URL was given, use the same computer that served the app bundle
 * (hostUri = "<pc-address>:8081") with the API's port 8000. This follows Wi-Fi changes automatically.
 * Preview/production: API_URL is required and must be https (enforced here and in app.config.ts).
 */
function resolveApiUrl(): string {
  const configured = (extra.apiUrl ?? "").replace(/\/+$/, "");
  if (configured) return configured;
  if (IS_DEV) {
    const host = (Constants.expoConfig?.hostUri ?? "").split(":")[0];
    return host ? `http://${host}:8000` : "http://10.0.2.2:8000"; // 10.0.2.2 = PC from the Android emulator
  }
  return "";
}

export const API_URL = resolveApiUrl();

/** Lock the app (biometric / re-login) after this long in the background. */
export const BACKGROUND_LOCK_MS = 5 * 60 * 1000;
/** Sign out after this long without any user interaction. */
export const IDLE_LOGOUT_MS = 30 * 60 * 1000;

if (!IS_DEV && !API_URL.startsWith("https://")) {
  // Defence in depth: app.config.ts already refuses to build without https.
  throw new Error("Insecure API configuration");
}
