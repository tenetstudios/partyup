import { useEffect, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../../lib/supabase";

export default function AccountManagement() {
  const [userId, setUserId] = useState("");

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? ""));
  }, []);

  async function shareProfile() {
    if (!userId) return;
    await Share.share({
      title: "My PartyUp profile",
      message: `See my PartyUp profile: https://partyup.io/user/${userId}`,
      url: `https://partyup.io/user/${userId}`,
    });
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.eyebrow}>YOUR ACCOUNT</Text>
      <Text style={styles.title}>Account Management</Text>
      <Text style={styles.subtitle}>Choose what other people see or manage the private settings behind your account.</Text>

      <TouchableOpacity style={styles.card} activeOpacity={0.86} onPress={() => router.push("/account/public-profile" as never)}>
        <Text style={styles.cardEyebrow}>WHAT OTHERS SEE</Text>
        <Text style={styles.cardTitle}>Public Profile</Text>
        <Text style={styles.cardCopy}>Edit your photo, unique PartyUp name, bio, and general location.</Text>
        <Text style={styles.cardAction}>Edit public profile →</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} activeOpacity={0.86} onPress={() => router.push("/account/profile-settings" as never)}>
        <Text style={styles.cardEyebrow}>PRIVATE CONTROLS</Text>
        <Text style={styles.cardTitle}>Profile Settings</Text>
        <Text style={styles.cardCopy}>Manage sign-in details, notifications, support, your session, and account deletion.</Text>
        <Text style={styles.cardAction}>Open settings →</Text>
      </TouchableOpacity>

      {userId ? (
        <View style={styles.secondaryActions}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push(`/user/${userId}` as never)}>
            <Text style={styles.secondaryText}>View public profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => void shareProfile()}>
            <Text style={styles.secondaryText}>Share profile</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#050509" },
  container: { minHeight: "100%", padding: 24, paddingTop: 58, paddingBottom: 60 },
  backButton: { alignSelf: "flex-start", marginBottom: 24, paddingVertical: 8 },
  backText: { color: "#C8B5FF", fontWeight: "800" },
  eyebrow: { color: "#FF63A8", fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  title: { color: "#FFFFFF", fontSize: 36, fontWeight: "900", marginTop: 8 },
  subtitle: { color: "#B8B2C8", fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 12 },
  card: { backgroundColor: "#11111A", borderColor: "#2A2140", borderRadius: 24, borderWidth: 1, marginTop: 16, padding: 20 },
  cardEyebrow: { color: "#C35DFF", fontSize: 10, fontWeight: "900", letterSpacing: 0.9 },
  cardTitle: { color: "#FFFFFF", fontSize: 25, fontWeight: "900", marginTop: 8 },
  cardCopy: { color: "#A9A1B6", fontSize: 14, lineHeight: 21, marginTop: 8 },
  cardAction: { color: "#D8B4FE", fontSize: 14, fontWeight: "900", marginTop: 18 },
  secondaryActions: { gap: 10, marginTop: 18 },
  secondaryButton: { alignItems: "center", borderColor: "#4C3371", borderRadius: 999, borderWidth: 1, paddingVertical: 13 },
  secondaryText: { color: "#E9D5FF", fontWeight: "900" },
});
