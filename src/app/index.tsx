import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AntDesign } from "@expo/vector-icons";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  Alert,
  ImageBackground,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { supabase } from "../../lib/supabase";
import * as WebBrowser from "expo-web-browser";
import { signInWithApple } from "../lib/appleSignIn";
import { completeOAuthSession } from "../lib/oauthSession";

WebBrowser.maybeCompleteAuthSession();

type RoutableUser = {
  id: string;
  is_anonymous?: boolean;
};

function isAnonymousUser(user: { is_anonymous?: boolean } | null) {
  return Boolean(user?.is_anonymous);
}

async function routeSignedInUser(user: RoutableUser) {
  if (isAnonymousUser(user)) {
    router.replace("/home");
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  router.replace(profile?.username ? "/home" : "/profile");
}

export default function Index() {
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const routedRef = useRef(false);

  useEffect(() => {
  let mounted = true;
  mountedRef.current = true;

  async function loadSavedSession() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;

  if (!mounted || !user || routedRef.current) return;

  routedRef.current = true;
await routeSignedInUser(user);
}

loadSavedSession();

const {
  data: { subscription },
} = supabase.auth.onAuthStateChange(async (_event, session) => {
  const user = session?.user;
  if (!user || routedRef.current) return;

  routedRef.current = true;
  await routeSignedInUser(user);
});

return () => {
  mounted = false;
  mountedRef.current = false;
  subscription.unsubscribe();
};
}, []);

  const { width } = useWindowDimensions();
  const isDesktop = width > 900;

  const heroImage = isDesktop
    ? require("../../assets/images/desktop-hero.png")
    : require("../../assets/images/rooftop-dj-set.png");


    
 const signInWithGoogle = async () => {
  if (loading) return;

  setLoading(true);


  const redirectTo = "partyup://auth/callback";

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error) {
    setLoading(false);
    Alert.alert("Google sign-in error", error.message);
    return;
  }

  if (!data?.url) {
    setLoading(false);
    Alert.alert("Google sign-in error", "No OAuth URL returned.");
    return;
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  

  if (result.type !== "success") {
  setLoading(false);
  return;
}

const callbackUrl = (result as { url?: string }).url;

if (!callbackUrl) {
  setLoading(false);
  Alert.alert("Google session error", "Missing callback URL.");
  return;
}

  try {
    const signedInUser = await completeOAuthSession(callbackUrl);
    if (mountedRef.current && !routedRef.current) {
      routedRef.current = true;
      await routeSignedInUser(signedInUser);
    }
  } catch (reason) {
    setLoading(false);
    Alert.alert(
      "Google session error",
      reason instanceof Error ? reason.message : "Could not confirm your signed-in session.",
    );
    return;
  }
  setLoading(false);

};

  async function continueWithApple() {
    if (loading || Platform.OS !== "ios") return;

    setLoading(true);
    try {
      const user = await signInWithApple();
      if (mountedRef.current && !routedRef.current) {
        routedRef.current = true;
        await routeSignedInUser(user);
      }
    } catch (reason) {
      if ((reason as { code?: string })?.code !== "ERR_REQUEST_CANCELED") {
        Alert.alert(
          "Apple sign-in error",
          reason instanceof Error ? reason.message : "Could not sign in with Apple.",
        );
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function enterGuest() {
    try {
      setLoading(true);

      const { data, error } = await supabase.auth.signInAnonymously();

      if (error) {
        Alert.alert("Guest sign-in error", error.message);
        return;
      }

      if (!data.user) {
        Alert.alert("Error", "No user returned.");
        return;
      }

      router.replace("/home");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.bg}>
      <ImageBackground
        source={heroImage}
        style={styles.hero}
        imageStyle={styles.heroImage}
        resizeMode="contain"
      >
        <View style={styles.centerText}>
          <Text style={styles.logo}>PartyUp</Text>
          <Text style={styles.tagline}>Live events. Real people. Right now.</Text>
        </View>

        {Platform.OS === "ios" ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={24}
            style={styles.appleButton}
            onPress={() => void continueWithApple()}
          />
        ) : null}

        <TouchableOpacity style={styles.googleButton} onPress={signInWithGoogle} disabled={loading}>
          <AntDesign
            name="google"
            size={22}
            color="#111"
            style={{ marginRight: 10 }}
          />

          <Text style={styles.googleButtonText}>
            {loading ? "Signing in..." : "Continue with Google"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={enterGuest} disabled={loading}>
          <Text style={styles.buttonText}>
            {loading ? "Entering..." : "Enter as Guest"}
          </Text>
        </TouchableOpacity>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: "#000",
  },

  hero: {
    flex: 1,
    width: "100%",
    justifyContent: "flex-end",
    backgroundColor: "#000",
    paddingBottom: 46,
  },

  centerText: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 270,
  },

  logo: {
    color: "#FFFFFF",
    fontSize: 72,
    fontWeight: "900",
    letterSpacing: -1,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.95)",
    textShadowOffset: { width: 0, height: 6 },
    textShadowRadius: 22,
  },

  tagline: {
    color: "#A855F7",
    fontSize: 24,
    fontWeight: "800",
    marginTop: 10,
    textAlign: "center",
  },

  button: {
    width: "86%",
    alignSelf: "center",
    backgroundColor: "#7C3AED",
    paddingVertical: 18,
    borderRadius: 999,
    alignItems: "center",
  },

  buttonText: {
    color: "white",
    fontSize: 17,
    fontWeight: "900",
  },

  heroImage: {
    width: "100%",
    height: "100%",
  },

  googleButton: {
    width: "72%",
    alignSelf: "center",
    backgroundColor: "white",
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginBottom: 14,
  },

  googleButtonText: {
    color: "#111",
    fontWeight: "900",
    fontSize: 16,
  },
  appleButton: {
    alignSelf: "center",
    height: 48,
    marginBottom: 14,
    width: "72%",
  },
});
