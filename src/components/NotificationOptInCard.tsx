import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { enablePushNotifications, getPushPermissionStatus } from "../../lib/pushNotifications";

export default function NotificationOptInCard() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void getPushPermissionStatus().then((status) => setVisible(status !== "granted")); }, []);
  if (!visible) return null;

  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.title}>Don&apos;t miss the next move</Text>
        <Text style={styles.body}>Get Mission starts, host announcements, Wild results, and your recap.</Text>
      </View>
      <TouchableOpacity
        disabled={busy}
        style={styles.button}
        onPress={async () => {
          setBusy(true);
          try { await enablePushNotifications(); setVisible(false); }
          catch (error) { Alert.alert("Notifications", error instanceof Error ? error.message : "Could not enable notifications."); }
          finally { setBusy(false); }
        }}
      >
        <Text style={styles.buttonText}>{busy ? "Enabling…" : "Notify me"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 12, marginHorizontal: 16, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: "#4C1D95", backgroundColor: "#171026", flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1 },
  title: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
  body: { color: "#BDB4CB", fontSize: 12, lineHeight: 17, marginTop: 3 },
  button: { backgroundColor: "#7C3AED", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  buttonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 12 },
});
