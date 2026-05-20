import { router } from "expo-router";
import { useState } from "react";
import {
  ImageBackground,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";

export default function Index() {
  const [loading, setLoading] = useState(false);

  async function enterGuest() {
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInAnonymously();
      setLoading(false);

      if (error) return window.alert(error.message);
      if (!data.user) return window.alert("No user returned.");

      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", data.user.id)
        .maybeSingle();

      router.replace(!profile?.username ? "/profile" : "/home");
    } catch (err: any) {
      setLoading(false);
      window.alert(err.message || "Something went wrong");
    }
  }

  return (
    <View style={styles.bg}>
      <ImageBackground
        source={require("../../assets/images/rooftop-dj-set.png")}
        style={styles.hero}
        resizeMode="contain"
      >
        <View style={styles.centerText}>
          <Text style={styles.logo}>PartyUp</Text>
          <Text style={styles.tagline}>Live events. Real people. Right now.</Text>
          <Text style={styles.subcopy}>
            Discover and join exclusive parties, concerts, DJ sets,
            {"\n"}pop-ups, and live streams near you or online.
            {"\n"}Every night. Everywhere.
          </Text>
        </View>
      </ImageBackground>

      <TouchableOpacity style={styles.button} onPress={enterGuest}>
        <Text style={styles.buttonText}>
          {loading ? "Entering..." : "Enter as Guest"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  hero: {
    width: "100%",
    height: 560,
    alignItems: "center",
    justifyContent: "center",
  },

  centerText: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    marginTop: -90,
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

  subcopy: {
    color: "#F3E8FF",
    fontSize: 16,
    textAlign: "center",
    marginTop: 280,
    lineHeight: 24,
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 12,
  },

  button: {
    width: "90%",
    maxWidth: 520,
    backgroundColor: "#7C3AED",
    paddingVertical: 17,
    borderRadius: 999,
    alignItems: "center",
    marginTop: 20,
  },

  buttonText: {
    color: "white",
    fontSize: 17,
    fontWeight: "900",
  },
});