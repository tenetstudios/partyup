import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AntDesign } from "@expo/vector-icons";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { supabase } from "../../lib/supabase";
import * as WebBrowser from "expo-web-browser";
import { signInWithApple } from "../lib/appleSignIn";
import { ensurePartyUpIdentity } from "../lib/matchmaking";
import { completeOAuthSession } from "../lib/oauthSession";

WebBrowser.maybeCompleteAuthSession();

type RoutableUser = {
  id: string;
  is_anonymous?: boolean;
};

type AuthAction = "apple" | "email" | "google" | "guest";

function isAnonymousUser(user: { is_anonymous?: boolean } | null) {
  return Boolean(user?.is_anonymous);
}

async function routeSignedInUser(user: RoutableUser) {
  if (isAnonymousUser(user)) {
    router.replace("/home");
    return;
  }

  await ensurePartyUpIdentity();

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  router.replace(profile?.username ? "/home" : "/profile");
}

export default function Index() {
  const [authAction, setAuthAction] = useState<AuthAction | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const authInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const routedRef = useRef(false);

  function beginAuth(action: AuthAction) {
    if (authInFlightRef.current) return false;

    authInFlightRef.current = true;
    setAuthAction(action);
    return true;
  }

  function endAuth() {
    authInFlightRef.current = false;
    if (mountedRef.current) setAuthAction(null);
  }

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
  if (!beginAuth("google")) return;


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
    endAuth();
    Alert.alert("Google sign-in error", error.message);
    return;
  }

  if (!data?.url) {
    endAuth();
    Alert.alert("Google sign-in error", "No OAuth URL returned.");
    return;
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  

  if (result.type !== "success") {
  endAuth();
  return;
}

const callbackUrl = (result as { url?: string }).url;

if (!callbackUrl) {
  endAuth();
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
    endAuth();
    Alert.alert(
      "Google session error",
      reason instanceof Error ? reason.message : "Could not confirm your signed-in session.",
    );
    return;
  }
  endAuth();

};

  async function continueWithApple() {
    if (Platform.OS !== "ios" || !beginAuth("apple")) return;

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
      endAuth();
    }
  }

  async function signInWithEmail() {
    if (!beginAuth("email")) return;

    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      Alert.alert("Unable to sign in", "Enter your email and password.");
      endAuth();
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error || !data.user) {
        Alert.alert("Unable to sign in", "Check your email and password and try again.");
        return;
      }

      if (mountedRef.current && !routedRef.current) {
        routedRef.current = true;
        await routeSignedInUser(data.user);
      }
    } catch {
      Alert.alert("Unable to sign in", "Check your connection and try again.");
    } finally {
      endAuth();
    }
  }

  async function enterGuest() {
    if (!beginAuth("guest")) return;

    try {
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
      endAuth();
    }
  }

  const loading = authAction !== null;

  return (
    <View style={styles.bg}>
      <ImageBackground
        source={heroImage}
        style={styles.hero}
        imageStyle={styles.heroImage}
        resizeMode="contain"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={styles.authContent}
            keyboardShouldPersistTaps="handled"
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
                style={[styles.appleButton, loading && styles.disabled]}
                onPress={() => void continueWithApple()}
              />
            ) : null}

            <TouchableOpacity style={[styles.googleButton, loading && styles.disabled]} onPress={signInWithGoogle} disabled={loading}>
              <AntDesign
                name="google"
                size={22}
                color="#111"
                style={{ marginRight: 10 }}
              />

              <Text style={styles.googleButtonText}>
                {authAction === "google" ? "Signing in..." : "Continue with Google"}
              </Text>
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.emailForm}>
              <TextInput
                accessibilityLabel="Email"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!loading}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor="#8F8899"
                returnKeyType="next"
                style={styles.input}
                textContentType="emailAddress"
                value={email}
              />
              <TextInput
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoComplete="current-password"
                autoCorrect={false}
                editable={!loading}
                onChangeText={setPassword}
                onSubmitEditing={() => void signInWithEmail()}
                placeholder="Password"
                placeholderTextColor="#8F8899"
                returnKeyType="go"
                secureTextEntry
                style={styles.input}
                textContentType="password"
                value={password}
              />
              <TouchableOpacity
                disabled={loading}
                onPress={() => void signInWithEmail()}
                style={[styles.emailButton, loading && styles.disabled]}
              >
                {authAction === "email" ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.emailButtonText}>Sign In</Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[styles.button, loading && styles.disabled]} onPress={enterGuest} disabled={loading}>
              <Text style={styles.buttonText}>
                {authAction === "guest" ? "Entering..." : "Enter as Guest"}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
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
    backgroundColor: "#000",
  },

  keyboardView: {
    flex: 1,
  },

  authContent: {
    flexGrow: 1,
    justifyContent: "flex-end",
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
  dividerRow: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    marginBottom: 14,
    width: "72%",
  },
  dividerLine: {
    backgroundColor: "#4A4455",
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    color: "#A7A1B4",
    fontSize: 11,
    fontWeight: "900",
    marginHorizontal: 12,
  },
  emailForm: {
    alignSelf: "center",
    marginBottom: 14,
    width: "86%",
  },
  input: {
    backgroundColor: "rgba(8, 8, 13, 0.94)",
    borderColor: "#4A356C",
    borderRadius: 14,
    borderWidth: 1,
    color: "#FFFFFF",
    fontSize: 16,
    marginBottom: 10,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  emailButton: {
    alignItems: "center",
    backgroundColor: "#5B21B6",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 50,
  },
  emailButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.58,
  },
});
