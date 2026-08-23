import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";

const confirmationText = "CLEAR";
const messageLimit = 500;

type ClearRoomResult = {
  removed_count?: number;
};

export default function ClearRoomParticipantsCard({
  hostId,
  onCleared,
  roomId,
}: {
  hostId: string;
  onCleared: () => void | Promise<void>;
  roomId: string;
}) {
  const [participantCount, setParticipantCount] = useState(0);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadParticipantCount = useCallback(async () => {
    const { count, error: countError } = await supabase
      .from("event_attendees")
      .select("user_id", { count: "exact", head: true })
      .eq("event_room_id", roomId)
      .neq("user_id", hostId);

    if (!countError) setParticipantCount(count ?? 0);
  }, [hostId, roomId]);

  useEffect(() => {
    void loadParticipantCount();

    const channel = supabase
      .channel(`mobile-clear-room-count-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_attendees",
          filter: `event_room_id=eq.${roomId}`,
        },
        () => void loadParticipantCount(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadParticipantCount, roomId]);

  function closeModal() {
    if (clearing) return;
    setVisible(false);
    setConfirmation("");
    setError(null);
  }

  async function clearRoom() {
    if (clearing || confirmation !== confirmationText) return;

    setClearing(true);
    setError(null);

    const { data, error: clearError } = await supabase.rpc("clear_event_room", {
      p_message: message.trim() || null,
      p_room_id: roomId,
    });

    if (clearError) {
      setError(clearError.message);
      setClearing(false);
      return;
    }

    const removedCount = (data as ClearRoomResult | null)?.removed_count ?? 0;
    setParticipantCount(0);
    setVisible(false);
    setMessage("");
    setConfirmation("");
    setClearing(false);
    await onCleared();
    Alert.alert(
      "Room cleared",
      removedCount === 1
        ? "1 participant was removed."
        : `${removedCount} participants were removed.`,
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>IRREVERSIBLE ACTION</Text>
      <Text style={styles.title}>Clear participants</Text>
      <Text style={styles.description}>
        Remove everyone except you while keeping the room, settings, chat, Missions,
        announcements, and Memories. The waiting queue is cleared too.
      </Text>
      <Text style={styles.count}>
        {participantCount === 1
          ? "1 participant is eligible for removal."
          : `${participantCount} participants are eligible for removal.`}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={styles.openButton}
      >
        <Text style={styles.openButtonText}>Clear participants</Text>
      </TouchableOpacity>

      <Modal
        animationType="fade"
        onRequestClose={closeModal}
        transparent
        visible={visible}
      >
        <View style={styles.backdrop}>
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View accessibilityViewIsModal style={styles.modalCard}>
              <Text style={styles.modalEyebrow}>THIS CANNOT BE UNDONE</Text>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                Clear {participantCount} {participantCount === 1 ? "participant" : "participants"}?
              </Text>
              <Text style={styles.modalDescription}>
                Everyone except you will be removed from the current room session and active
                event matching. They will receive the message below.
              </Text>

              <Text style={styles.label}>Message to participants (optional)</Text>
              <TextInput
                maxLength={messageLimit}
                multiline
                numberOfLines={4}
                onChangeText={setMessage}
                placeholder="Thanks for joining! We’ll share details for the next event soon."
                placeholderTextColor="#71717A"
                style={styles.messageInput}
                textAlignVertical="top"
                value={message}
              />
              <Text style={styles.characterCount}>
                {message.length}/{messageLimit}
              </Text>

              <Text style={styles.label}>
                Type <Text style={styles.confirmationWord}>{confirmationText}</Text> to confirm
              </Text>
              <TextInput
                autoCapitalize="characters"
                autoComplete="off"
                onChangeText={setConfirmation}
                style={styles.confirmationInput}
                value={confirmation}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.actions}>
                <TouchableOpacity
                  disabled={clearing}
                  onPress={closeModal}
                  style={styles.cancelButton}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={clearing || confirmation !== confirmationText}
                  onPress={() => void clearRoom()}
                  style={[
                    styles.confirmButton,
                    (clearing || confirmation !== confirmationText) &&
                      styles.confirmButtonDisabled,
                  ]}
                >
                  <Text style={styles.confirmButtonText}>
                    {clearing ? "Clearing..." : "Clear participants"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 22,
  },
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.82)",
    flex: 1,
  },
  cancelButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  cancelButtonText: {
    color: "#E4E4E7",
    fontWeight: "900",
  },
  card: {
    backgroundColor: "rgba(120,53,15,0.14)",
    borderColor: "rgba(252,211,77,0.28)",
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 24,
    padding: 18,
  },
  characterCount: {
    color: "#71717A",
    fontSize: 12,
    marginTop: 6,
    textAlign: "right",
  },
  confirmationInput: {
    backgroundColor: "#08080D",
    borderColor: "rgba(252,211,77,0.32)",
    borderRadius: 14,
    borderWidth: 1,
    color: "#FFFFFF",
    fontWeight: "900",
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  confirmationWord: {
    color: "#FCD34D",
  },
  confirmButton: {
    alignItems: "center",
    backgroundColor: "#FBBF24",
    borderRadius: 999,
    flex: 1.35,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  confirmButtonDisabled: {
    opacity: 0.38,
  },
  confirmButtonText: {
    color: "#1C1102",
    fontWeight: "900",
    textAlign: "center",
  },
  count: {
    color: "#FDE68A",
    fontWeight: "800",
    marginTop: 12,
  },
  description: {
    color: "#A1A1AA",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 7,
  },
  error: {
    color: "#FCA5A5",
    fontWeight: "700",
    marginTop: 14,
  },
  eyebrow: {
    color: "#FCD34D",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  label: {
    color: "#FFFFFF",
    fontWeight: "900",
    marginTop: 18,
  },
  messageInput: {
    backgroundColor: "#08080D",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    borderWidth: 1,
    color: "#FFFFFF",
    marginTop: 8,
    minHeight: 108,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalCard: {
    backgroundColor: "#12051E",
    borderColor: "rgba(252,211,77,0.3)",
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 560,
    padding: 22,
    width: "100%",
  },
  modalDescription: {
    color: "#A1A1AA",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  modalEyebrow: {
    color: "#FCD34D",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  modalScroll: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  modalTitle: {
    color: "#FFFFFF",
    fontSize: 25,
    fontWeight: "900",
    marginTop: 8,
  },
  openButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "rgba(252,211,77,0.5)",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 16,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  openButtonText: {
    color: "#FDE68A",
    fontWeight: "900",
  },
  title: {
    color: "#FEF3C7",
    fontSize: 19,
    fontWeight: "900",
    marginTop: 6,
  },
});
