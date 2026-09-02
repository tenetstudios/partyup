import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { readStoredGuestSession } from "../src/lib/matchmaking";
import { supabase } from "./supabase";

const tokenStorageKey = "partyup_expo_push_token";

async function getNativeNotifications() {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    throw new Error("Push notifications are available on iOS and Android.");
  }

  return import("expo-notifications");
}

async function getNativeStorage() {
  return (await import("@react-native-async-storage/async-storage")).default;
}

export type NotificationPreferences = {
  missions: boolean;
  announcements: boolean;
  recaps: boolean;
  connections: boolean;
  enabled_devices: number;
};

async function guestToken() {
  return (await readStoredGuestSession())?.guestToken ?? null;
}

export async function getStoredPushToken() {
  if (Platform.OS === "web") return null;
  return (await getNativeStorage()).getItem(tokenStorageKey);
}

export async function getPushPermissionStatus() {
  if (Platform.OS === "web") return "unsupported";
  const Notifications = await getNativeNotifications();
  return (await Notifications.getPermissionsAsync()).status;
}

export async function enablePushNotifications() {
  if (Platform.OS !== "android" && Platform.OS !== "ios") throw new Error("Push notifications are available on iOS and Android.");
  if (!Device.isDevice) throw new Error("Push notifications require a physical device.");

  const Notifications = await getNativeNotifications();

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("partyup", {
      name: "PartyUp",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#C026D3",
    });
  }

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") throw new Error("Notifications are disabled. You can enable them in device settings.");

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error("The EAS project ID is missing.");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await supabase.rpc("register_push_device", {
    p_expo_push_token: token,
    p_platform: Platform.OS,
    p_app_version: Constants.expoConfig?.version ?? null,
    p_device_label: Device.modelName ?? null,
    p_guest_token: await guestToken(),
  });
  if (error) throw new Error(error.message);
  await (await getNativeStorage()).setItem(tokenStorageKey, token);
  return token;
}

export async function disablePushNotifications() {
  if (Platform.OS === "web") return;
  const token = await getStoredPushToken();
  if (!token) return;
  const { error } = await supabase.rpc("disable_push_device", {
    p_expo_push_token: token,
    p_guest_token: await guestToken(),
  });
  if (error) throw new Error(error.message);
  await (await getNativeStorage()).removeItem(tokenStorageKey);
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const { data, error } = await supabase.rpc("get_my_notification_preferences", {
    p_guest_token: await guestToken(),
  });
  if (error) throw new Error(error.message);
  return data as NotificationPreferences;
}

export async function setNotificationPreferences(preferences: Pick<NotificationPreferences, "missions" | "announcements" | "recaps" | "connections">) {
  const { data, error } = await supabase.rpc("set_my_notification_preferences", {
    p_missions: preferences.missions,
    p_announcements: preferences.announcements,
    p_recaps: preferences.recaps,
    p_connections: preferences.connections,
    p_guest_token: await guestToken(),
  });
  if (error) throw new Error(error.message);
  return data as NotificationPreferences;
}
