import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

type Props = {
  guestToken?: string | null;
  isGuest?: boolean;
  nextBusy: boolean;
  onNextMatch: (sessionId: string) => Promise<void>;
  onRemoteParticipantLeft: () => void;
  onReturnToMatch: () => void;
  sessionId: string;
};

export default function MatchLiveKitRoomView({ onReturnToMatch }: Props) {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Match video is available in the PartyUp app.</Text>
      <Text style={styles.message}>
        Open PartyUp on iOS or Android to join this private video match.
      </Text>
      <TouchableOpacity style={styles.button} onPress={onReturnToMatch}>
        <Text style={styles.buttonText}>Return to Match</Text>
      </TouchableOpacity>
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
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  message: {
    color: "#A1A1AA",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    maxWidth: 420,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    marginTop: 24,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
});
