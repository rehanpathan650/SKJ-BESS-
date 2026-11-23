import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { EAS_PROJECT_ID } from "./config";
import { api } from "./session";

let registered = false;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true,
  }),
});

/** Ask for permission and register this device's Expo push token. Push bodies never contain customer data. */
export async function registerForPush() {
  if (registered || !Device.isDevice || !EAS_PROJECT_ID) return;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "SKJ updates", importance: Notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return;
    const token = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    await api.notifications.registerPush(token.data);
    registered = true;
  } catch {
    // Push is optional; in-app notifications still work.
  }
}
