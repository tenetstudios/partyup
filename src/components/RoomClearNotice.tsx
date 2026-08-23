import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";

type RoomClearNoticeRecord = {
  clear_event_id: string;
  room_id: string;
  message: string | null;
  created_at: string;
};

export default function RoomClearNotice() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [notice, setNotice] = useState<RoomClearNoticeRecord | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPendingNotice = useCallback(async () => {
    const { data, error: noticeError } = await supabase.rpc(
      "get_pending_room_clear_notice",
    );

    if (noticeError || !data) return;

    setNotice(data as RoomClearNoticeRecord);
    setError(null);
    router.replace("/home");
  }, [router]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) setNotice(null);
        setUserId(session?.user.id ?? null);
      },
    );

    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`mobile-room-clear-notice-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_clear_recipients",
          filter: `user_id=eq.${userId}`,
        },
        () => void loadPendingNotice(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadPendingNotice();
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadPendingNotice, userId]);

  async function acknowledgeNotice() {
    if (!notice || acknowledging) return;

    setAcknowledging(true);
    setError(null);

    const { error: acknowledgeError } = await supabase.rpc(
      "acknowledge_room_clear_notice",
      { p_clear_event_id: notice.clear_event_id },
    );

    if (acknowledgeError) {
      setError(acknowledgeError.message);
      setAcknowledging(false);
      return;
    }

    setNotice(null);
    setAcknowledging(false);
    await loadPendingNotice();
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => undefined}
      transparent
      visible={Boolean(notice)}
    >
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.card}>
          <View style={styles.iconCircle}>
            <Text style={styles.icon}>✦</Text>
          </View>
          <Text style={styles.eyebrow}>MESSAGE FROM THE HOST</Text>
          <Text accessibilityRole="header" style={styles.title}>
            The room has been cleared
          </Text>
          <Text style={styles.description}>
            Your current room session has ended. The host can invite you back for a future event.
          </Text>
          <View style={styles.messageCard}>
            <Text style={styles.message}>
              {notice?.message ||
                "Thanks for joining. This room has been cleared for the next event."}
            </Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            accessibilityRole="button"
            disabled={acknowledging}
            onPress={() => void acknowledgeNotice()}
            style={[styles.button, acknowledging && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>
              {acknowledging ? "Closing..." : "Got it"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.84)",
    flex: 1,
    justifyContent: "center",
    padding: 22,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 22,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  card: {
    alignItems: "center",
    backgroundColor: "#12051E",
    borderColor: "rgba(196,181,253,0.32)",
    borderRadius: 26,
    borderWidth: 1,
    maxWidth: 520,
    padding: 26,
    width: "100%",
  },
  description: {
    color: "#A1A1AA",
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
    textAlign: "center",
  },
  error: {
    color: "#FCA5A5",
    fontWeight: "700",
    marginTop: 14,
    textAlign: "center",
  },
  eyebrow: {
    color: "#C4B5FD",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginTop: 18,
  },
  icon: {
    color: "#C4B5FD",
    fontSize: 26,
  },
  iconCircle: {
    alignItems: "center",
    backgroundColor: "rgba(124,58,237,0.22)",
    borderRadius: 999,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  message: {
    color: "#F4F4F5",
    fontSize: 15,
    lineHeight: 23,
  },
  messageCard: {
    alignSelf: "stretch",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderColor: "rgba(255,255,255,0.09)",
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 18,
    padding: 16,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "900",
    marginTop: 8,
    textAlign: "center",
  },
});
