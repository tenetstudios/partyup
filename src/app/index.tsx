import { router } from "expo-router";
import { useEffect, useState } from "react";
import { AntDesign } from "@expo/vector-icons";
import {
  Alert,
  ImageBackground,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { supabase } from "../../lib/supabase";
import * as WebBrowser from "expo-web-browser";

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
    .eq("id", user.id)
    .maybeSingle();

  router.replace(profile?.username ? "/home" : "/profile");
}

export default function Index() {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
  let mounted = true;
  let routed = false;

  async function loadSavedSession() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;

  if (!mounted || !user) return;

  routed = true;
await routeSignedInUser(user);
}

loadSavedSession();

const {
  data: { subscription },
} = supabase.auth.onAuthStateChange(async (_event, session) => {
  const user = session?.user;
  if (!user || routed) return;

  routed = true;
  await routeSignedInUser(user);
});

return () => {
  mounted = false;
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

  const fragment = callbackUrl.split("#")[1];

  if (!fragment) {
    setLoading(false);
    Alert.alert("Google session error", "Missing callback fragment.");
    return;
  }

  const params = new URLSearchParams(fragment);

  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");

  if (!access_token || !refresh_token) {
    setLoading(false);
    Alert.alert("Google session error", "Missing tokens.");
    return;
  }


const { data: setSessionData, error: sessionError } =
  await supabase.auth.setSession({
    access_token,
    refresh_token,
  });


  if (sessionError) {
    setLoading(false);
    Alert.alert("Google session error", sessionError.message);
    return;
  }

  const signedInUser = setSessionData.session?.user ?? setSessionData.user;

  if (!signedInUser) {
    setLoading(false);
    Alert.alert("Google session error", "Could not confirm your signed-in session.");
    return;
  }

  await routeSignedInUser(signedInUser);
  setLoading(false);

};

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

        <TouchableOpacity style={styles.googleButton} onPress={signInWithGoogle}>
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

        <TouchableOpacity style={styles.button} onPress={enterGuest}>
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
});
