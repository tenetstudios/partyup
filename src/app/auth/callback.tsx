import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { supabase } from "../../../lib/supabase";
import { completeOAuthSession } from "../../lib/oauthSession";

export default function AuthCallback() {
  const callbackUrl = Linking.useURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!callbackUrl) return;

    let active = true;

    async function finishSignIn() {
      try {
        const user = await completeOAuthSession(callbackUrl as string);
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!active) return;

        router.replace(profile?.username ? "/home" : "/profile");
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Google sign-in could not be completed.");
        }
      }
    }

    void finishSignIn();

    return () => {
      active = false;
    };
  }, [callbackUrl]);

  if (error) {
    return (
      <View style={styles.page}>
        <Text style={styles.title}>Sign-in paused</Text>
        <Text style={styles.message}>{error}</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace("/")}>
          <Text style={styles.buttonText}>Return to sign in</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <ActivityIndicator color="#F472B6" size="large" />
      <Text style={styles.title}>Finishing sign-in</Text>
      <Text style={styles.message}>Syncing your profile and PartyUp rooms...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: "center",
    backgroundColor: "#050509",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 18,
    textAlign: "center",
  },
  message: {
    color: "#A7A1B4",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#EC4899",
    borderRadius: 999,
    marginTop: 24,
    minHeight: 50,
    paddingHorizontal: 22,
    justifyContent: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
});
