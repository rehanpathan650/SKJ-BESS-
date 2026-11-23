import type { ConfigContext, ExpoConfig } from "expo/config";

// APP_VARIANT: development | preview | production (set by eas.json build profiles)
// API_URL: base URL of the SKJ API. Must be https outside development.
const variant = process.env.APP_VARIANT ?? "development";
const isDev = variant === "development";
// In development an empty value means "use the PC that served the app" (see src/lib/config.ts),
// so the phone keeps working when the PC's Wi-Fi address changes.
const apiUrl = process.env.API_URL ?? "";

if (!isDev && !apiUrl.startsWith("https://")) {
  throw new Error("API_URL must be an https:// URL for preview and production builds");
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isDev ? "SKJ BESS (Dev)" : "SKJ BESS",
  slug: "skj-bess",
  version: "1.0.0",
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  scheme: "skjbess",
  android: {
    package: isDev ? "com.skjenergy.bess.dev" : "com.skjenergy.bess",
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
      backgroundColor: "#0F5C4A",
    },
    // No Android auto-backup of app data (tokens, cached files) to Google Drive.
    allowBackup: false,
    permissions: ["android.permission.CAMERA", "android.permission.USE_BIOMETRIC", "android.permission.POST_NOTIFICATIONS"],
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_CONTACTS",
    ],
  },
  plugins: [
    ["expo-secure-store", { configureAndroidBackup: true }],
    ["expo-local-authentication", { faceIDPermission: "Unlock the SKJ app with Face ID." }],
    ["expo-image-picker", { cameraPermission: "Take photos of electricity bills to upload them.", microphonePermission: false }],
    "expo-sharing",
    "expo-font",
    ["expo-notifications", { color: "#0F5C4A" }],
    [
      "expo-build-properties",
      {
        android: {
          // Cleartext HTTP is only allowed in the development build (emulator -> local API).
          usesCleartextTraffic: isDev,
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
  ],
  extra: {
    apiUrl,
    variant,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
