import { useEffect, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { disablePushNotifications } from "../../../lib/pushNotifications";
import NotificationSettings from "../../components/NotificationSettings";
import { requestAccountDeletion } from "../../lib/accountDeletion";

type AccountDetails = { id: string; email: string; provider: string; verified: boolean };

function providerLabel(provider: string) {
  if (provider === "google") return "Google";
  if (provider === "apple") return "Apple";
  if (provider === "email") return "Email";
  return provider;
}

export default function ProfileSettings() {
  const [account, setAccount] = useState<AccountDetails | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      if (!user) return;
      setAccount({
        id: user.id,
        email: user.email ?? "No email available",
        provider: typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "account",
        verified: Boolean(user.email_confirmed_at),
      });
    });
  }, []);

  async function openAccountLink(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Could not open link", "Please visit partyup.io in your browser.");
    }
  }

  async function signOut() {
    await disablePushNotifications().catch(() => undefined);
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      Alert.alert("Sign-out error", error.message);
      return;
    }
    router.replace("/");
  }

  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);
    const result = await requestAccountDeletion();
    setDeleting(false);

    if (result.status === "completed") {
      router.replace("/");
      return;
    }
    if (result.status === "reauthentication_required") {
      Alert.alert("Sign in again", result.message, [
        { text: "Cancel", style: "cancel" },
        { text: "Sign In Again", onPress: () => void supabase.auth.signOut({ scope: "local" }).finally(() => router.replace("/")) },
      ]);
      return;
    }
    const supportReference = result.requestId ? `\n\nSupport reference: ${result.requestId}` : "";
    Alert.alert("Deletion failed", `${result.message}${supportReference}`);
  }

  function confirmDelete() {
    Alert.alert(
      "Delete Account",
      "This permanently deletes your PartyUp account and removes or anonymizes associated personal data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete Account", style: "destructive", onPress: () => void deleteAccount() },
      ],
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>Back</Text></TouchableOpacity>
      <Text style={styles.eyebrow}>PRIVATE CONTROLS</Text>
      <Text style={styles.title}>Profile Settings</Text>
      <Text style={styles.subtitle}>These details and controls never appear on your public profile.</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Sign-in details</Text>
        <Detail label="Email" value={account?.email ?? "Loading..."} />
        <Detail label="Sign-in provider" value={account ? providerLabel(account.provider) : "Loading..."} />
        <Detail label="Email status" value={account ? (account.verified ? "Verified" : "Not verified") : "Loading..."} />
        <Detail label="Account ID" value={account?.id ?? "Loading..."} />
      </View>

      <NotificationSettings />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Your account</Text>
        <TouchableOpacity style={styles.linkRow} onPress={() => router.push("/connections")}><Text style={styles.linkText}>Connections & Memories</Text><Text style={styles.arrow}>›</Text></TouchableOpacity>
        <TouchableOpacity style={styles.linkRow} onPress={() => void openAccountLink("https://partyup.io/privacy")}><Text style={styles.linkText}>Privacy Policy</Text><Text style={styles.arrow}>›</Text></TouchableOpacity>
        <TouchableOpacity style={styles.linkRow} onPress={() => void openAccountLink("https://partyup.io/terms")}><Text style={styles.linkText}>Terms of Use</Text><Text style={styles.arrow}>›</Text></TouchableOpacity>
        <TouchableOpacity style={styles.linkRow} onPress={() => void openAccountLink("https://partyup.io/contact")}><Text style={styles.linkText}>Support</Text><Text style={styles.arrow}>›</Text></TouchableOpacity>
        <TouchableOpacity style={styles.signOutButton} onPress={() => void signOut()}><Text style={styles.signOutText}>Sign Out</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.deleteButton, deleting && styles.disabled]} disabled={deleting} onPress={confirmDelete}><Text style={styles.deleteText}>{deleting ? "Deleting Account..." : "Delete Account"}</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#050509" },
  container: { minHeight: "100%", padding: 24, paddingTop: 58, paddingBottom: 60 },
  backButton: { alignSelf: "flex-start", marginBottom: 24, paddingVertical: 8 },
  backText: { color: "#C8B5FF", fontWeight: "800" },
  eyebrow: { color: "#FF63A8", fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  title: { color: "#FFFFFF", fontSize: 36, fontWeight: "900", marginTop: 8 },
  subtitle: { color: "#B8B2C8", fontSize: 14, lineHeight: 21, marginBottom: 18, marginTop: 10 },
  card: { backgroundColor: "#11111A", borderColor: "#2A2140", borderRadius: 24, borderWidth: 1, marginBottom: 18, padding: 18 },
  sectionTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginBottom: 10 },
  detail: { borderTopColor: "#2A2140", borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  detailLabel: { color: "#8F8899", fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  detailValue: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", marginTop: 5 },
  linkRow: { alignItems: "center", borderTopColor: "#2A2140", borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 },
  linkText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  arrow: { color: "#A78BFA", fontSize: 24 },
  signOutButton: { alignItems: "center", backgroundColor: "#5B21B6", borderRadius: 12, marginTop: 18, paddingVertical: 14 },
  signOutText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  deleteButton: { alignItems: "center", borderColor: "#FF6B6B", borderRadius: 12, borderWidth: 1, marginTop: 12, paddingVertical: 14 },
  deleteText: { color: "#FF8A8A", fontSize: 15, fontWeight: "900" },
  disabled: { opacity: 0.55 },
});
