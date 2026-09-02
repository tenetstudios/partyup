import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function ExploreWebScreen() {
  const router = useRouter();

  return (
    <View style={styles.page}>
      <TouchableOpacity
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        style={styles.backButton}
      >
        <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <View style={styles.card}>
        <Ionicons name="map-outline" size={34} color="#A78BFA" />
        <Text style={styles.title}>Explore maps are available on mobile</Text>
        <Text style={styles.message}>
          Open PartyUp on iOS or Android to browse nearby live rooms on the map.
        </Text>
      </View>
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
  backButton: {
    alignItems: "center",
    backgroundColor: "rgba(20,20,30,0.9)",
    borderColor: "rgba(123,75,255,0.4)",
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    left: 24,
    position: "absolute",
    top: 24,
    width: 48,
  },
  card: {
    alignItems: "center",
    backgroundColor: "#11111A",
    borderColor: "#2A2140",
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 460,
    padding: 28,
    width: "100%",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 14,
    textAlign: "center",
  },
  message: {
    color: "#A9A1B6",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
    textAlign: "center",
  },
});
