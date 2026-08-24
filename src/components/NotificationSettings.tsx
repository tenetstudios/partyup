import { useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import {
  disablePushNotifications,
  enablePushNotifications,
  getNotificationPreferences,
  getPushPermissionStatus,
  setNotificationPreferences,
  type NotificationPreferences,
} from "../../lib/pushNotifications";

const defaults: NotificationPreferences = { missions: true, announcements: true, recaps: true, connections: true, enabled_devices: 0 };

export default function NotificationSettings() {
  const [preferences, setPreferences] = useState(defaults);
  const [permission, setPermission] = useState<string>("undetermined");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([getPushPermissionStatus(), getNotificationPreferences()]).then(([status, next]) => {
      setPermission(status); setPreferences(next);
    }).catch(() => undefined);
  }, []);

  async function update(key: "missions" | "announcements" | "recaps" | "connections", value: boolean) {
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    try { setPreferences(await setNotificationPreferences(next)); }
    catch (error) { setPreferences(preferences); Alert.alert("Notifications", error instanceof Error ? error.message : "Could not save preferences."); }
  }

  async function toggleDevice() {
    setBusy(true);
    try {
      if (permission === "granted" && preferences.enabled_devices > 0) {
        await disablePushNotifications(); setPreferences((current) => ({ ...current, enabled_devices: 0 }));
      } else {
        await enablePushNotifications(); setPermission("granted"); setPreferences((current) => ({ ...current, enabled_devices: Math.max(1, current.enabled_devices) }));
      }
    } catch (error) { Alert.alert("Notifications", error instanceof Error ? error.message : "Could not update notifications."); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Push notifications</Text>
      <Text style={styles.subtitle}>Activity stays in PartyUp even when push is off.</Text>
      {(["missions", "announcements", "recaps", "connections"] as const).map((key) => (
        <View key={key} style={styles.row}>
          <Text style={styles.label}>{key === "missions" ? "Missions & Wild" : key === "announcements" ? "Host announcements" : key[0].toUpperCase() + key.slice(1)}</Text>
          <Switch value={preferences[key]} onValueChange={(value) => void update(key, value)} trackColor={{ true: "#7C3AED" }} />
        </View>
      ))}
      <TouchableOpacity disabled={busy} onPress={() => void toggleDevice()} style={styles.button}>
        <Text style={styles.buttonText}>{busy ? "Updating…" : permission === "granted" && preferences.enabled_devices > 0 ? "Disable on this device" : "Enable on this device"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#11111A", borderColor: "#2A2140", borderWidth: 1, borderRadius: 24, padding: 18, marginBottom: 18 },
  title: { color: "white", fontSize: 20, fontWeight: "900" },
  subtitle: { color: "#A9A1B6", marginTop: 5, marginBottom: 10, fontSize: 12 },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#2A2140" },
  label: { color: "white", fontWeight: "700" },
  button: { marginTop: 12, borderRadius: 999, borderWidth: 1, borderColor: "#6D28D9", paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#C4B5FD", fontWeight: "900" },
});
