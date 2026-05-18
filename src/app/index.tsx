import { router } from "expo-router";
import { useState } from "react";
import {
  Image,
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

    if (error) {
      window.alert(error.message);
      return;
    }

    const user = data.user;

    if (!user) {
      window.alert("No user returned.");
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.username) {
      router.replace("/profile");
      return;
    }

    router.replace("/home");
  } catch (err: any) {
    setLoading(false);

    window.alert(
      err.message || "Something went wrong"
    );
  }
}

  return (
    <View style={styles.bg}>
      <View style={styles.purpleGlow} pointerEvents="none" />

      <View style={styles.cardsWrap} pointerEvents="box-none">
        <FloatingCard
          title="Rooftop DJ Set"
          viewers={143}
          distance="1.2 km"
          style={styles.cardPos1}
        />

        <FloatingCard
          title="Indie House Concert"
          viewers={89}
          distance="secret"
          style={styles.cardPos2}
        />

        <FloatingCard
          title="Underground Rap Show"
          viewers={112}
          distance="0.5 km"
          style={styles.cardPos3}
        />

        <FloatingCard
          title="Pop-Up Party"
          spotsLeft={32}
          distance="1.6 km"
          style={styles.cardPos4}
        />
      </View>

      <View style={styles.container}>
        <Text style={styles.logo}>PartyUp</Text>

        <Text style={styles.tagline}>
          Live events. Real people. Right now.
        </Text>

        <Text style={styles.subcopy}>
          Discover private parties, concerts, DJ sets, pop-ups, and livestream rooms near you or online.
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={enterGuest}
        >
          <Text style={styles.buttonText}>
            {loading ? "Entering..." : "Enter as Guest"}
          </Text>
        </TouchableOpacity>

        <View style={styles.featuresRow}>
          <Text style={styles.feature}>Near you</Text>
          <Text style={styles.feature}>Join instantly</Text>
          <Text style={styles.feature}>Watch live</Text>
          <Text style={styles.feature}>Private & safe</Text>
        </View>
      </View>
    </View>
  );
}

function FloatingCard({ title, viewers, spotsLeft, distance, style }: any) {
  return (
    <TouchableOpacity style={[styles.card, style]} activeOpacity={0.9}>
      <Image
        source={require("../../assets/images/tabIcons/explore.png")}
        style={styles.cardImage}
        resizeMode="cover"
      />

      <View style={styles.cardMeta}>
        <View style={styles.liveBadge}>
          <Text style={styles.liveText}>LIVE</Text>
        </View>

        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>
          {spotsLeft ? `${spotsLeft} spots left · ${distance}` : `${viewers} watching · ${distance}`}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  logo: {
    color: "#FFFFFF",
    fontSize: 72,
    fontWeight: "900",
    letterSpacing: -1,
    marginTop: -8,
    textShadowColor: "rgba(124,58,237,0.5)",
    textShadowOffset: { width: 0, height: 6 },
    textShadowRadius: 22,
  },

  tagline: {
    color: "#C4B5FD",
    fontSize: 18,
    marginTop: 6,
    marginBottom: 12,
  },

  subcopy: {
    color: "#BFB4FF",
    fontSize: 14,
    maxWidth: 720,
    textAlign: "center",
    marginBottom: 22,
    opacity: 0.95,
  },

  button: {
    width: "90%",
    maxWidth: 520,
    backgroundColor: "#7C3AED",
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 36,
  },

  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "800",
  },
  bg: {
    flex: 1,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
  },

  purpleGlow: {
    position: "absolute",
    width: 720,
    height: 360,
    borderRadius: 360,
    backgroundColor: "rgba(124,58,237,0.14)",
    top: "8%",
    transform: [{ translateY: -40 }],
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 80,
    zIndex: 0,
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.0)",
  },

  logoImage: {
    width: 260,
    height: 120,
    marginBottom: -8,
  },

  featuresRow: {
    marginTop: 28,
    flexDirection: "row",
    gap: 18,
    flexWrap: "wrap",
    justifyContent: "center",
  },

  feature: {
    color: "#E6E6FA",
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    fontSize: 13,
  },
  cardsWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },

  card: {
    width: 220,
    backgroundColor: "rgba(18,18,20,0.94)",
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 40,
    position: "absolute",
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.12)",
  },

  cardImage: {
    width: "100%",
    height: 110,
  },

  cardMeta: {
    padding: 10,
  },

  liveBadge: {
    position: "absolute",
    left: 12,
    top: -12,
    backgroundColor: "#EF4444",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },

  liveText: {
    color: "white",
    fontSize: 11,
    fontWeight: "700",
  },

  cardTitle: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14,
    marginTop: 6,
  },

  cardSub: {
    color: "#C4B5FD",
    marginTop: 6,
    fontSize: 12,
  },

  cardPos1: {
    left: 20,
    top: 48,
    transform: [{ rotate: '-2deg' }],
  },

  cardPos2: {
    right: 34,
    top: 28,
    transform: [{ rotate: '3deg' }],
  },

  cardPos3: {
    left: 36,
    bottom: 140,
    transform: [{ rotate: '4deg' }],
  },

  cardPos4: {
    right: 28,
    bottom: 80,
    transform: [{ rotate: '-3deg' }],
  },
});