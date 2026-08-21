import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { supabase } from "../../../lib/supabase";
import { completeOAuthSession, hasOAuthResponse } from "../../lib/oauthSession";

export default function AuthCallback() {
  const callbackUrl = Linking.useURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let routed = false;
    let routing = false;
    let processingOAuthReturn = Boolean(callbackUrl && hasOAuthResponse(callbackUrl));

    async function routeSignedInUser(userId: string, isAnonymous = false) {
      if (!active || routed || routing) return;

      routing = true;

      try {
        if (isAnonymous) {
          routed = true;
          router.replace("/home");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", userId)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!active || routed) return;

        routed = true;
        router.replace(profile?.username ? "/home" : "/profile");
      } finally {
        routing = false;
      }
    }

    async function finishSignIn() {
      try {
        const initialUrl = callbackUrl ?? (await Linking.getInitialURL());

        if (initialUrl && hasOAuthResponse(initialUrl)) {
          processingOAuthReturn = true;
          const user = await completeOAuthSession(initialUrl);
          await routeSignedInUser(user.id, Boolean(user.is_anonymous));
          return;
        }

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;
        if (sessionData.session?.user) {
          const user = sessionData.session.user;
          await routeSignedInUser(user.id, Boolean(user.is_anonymous));
          return;
        }

      } catch (reason) {
        if (active && !routed) {
          setError(reason instanceof Error ? reason.message : "Google sign-in could not be completed.");
        }
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user && !processingOAuthReturn) {
        void routeSignedInUser(session.user.id, Boolean(session.user.is_anonymous)).catch(
          (reason) => {
            if (active && !routed) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Your profile could not be loaded after sign-in.",
              );
            }
          },
        );
      }
    });

    void finishSignIn();

    const timeoutId = setTimeout(() => {
      if (!active || routed) return;

      void supabase.auth
        .getSession()
        .then(({ data, error: sessionError }) => {
          if (!active || routed) return;

          if (sessionError) {
            setError(sessionError.message);
            return;
          }

          if (data.session?.user) {
            routed = true;
            router.replace("/home");
            return;
          }

          setError("The sign-in return was interrupted. Please try signing in again.");
        })
        .catch((reason) => {
          if (active && !routed) {
            setError(reason instanceof Error ? reason.message : "Sign-in could not be confirmed.");
          }
        });
    }, 10000);

    return () => {
      active = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
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
