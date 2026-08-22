import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";
import {
  endRoomMission,
  getActiveRoomMission,
  getRoomMissionHistory,
  publishRoomMission,
  type RoomMission,
  type RoomMissionHistoryItem,
} from "../../lib/roomMissions";

const durations = [
  { label: "None", value: null },
  { label: "5 min", value: 5 },
  { label: "10 min", value: 10 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
];

function endedLabel(reason: RoomMissionHistoryItem["ended_reason"]) {
  if (reason === "expired") return "Expired";
  if (reason === "replaced") return "Replaced";
  if (reason === "room_ended") return "Room ended";
  return "Ended";
}

export default function RoomMissionManager({
  roomId,
  isHost,
  roomEnded = false,
}: {
  roomId: string;
  isHost: boolean;
  roomEnded?: boolean;
}) {
  const [mission, setMission] = useState<RoomMission | null>(null);
  const [history, setHistory] = useState<RoomMissionHistoryItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<number | null>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const nextMission = await getActiveRoomMission(supabase, roomId);
    setMission(nextMission);

    if (isHost) {
      setHistory(await getRoomMissionHistory(supabase, roomId, 5));
    }
  }, [isHost, roomId]);

  useEffect(() => {
    void loadData().catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Could not load Missions.");
    });

    const channel = supabase
      .channel(`mobile-manage-missions-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` },
        () => void loadData(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mission_completions" },
        () => void loadData(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadData, roomId]);

  useEffect(() => {
    if (!mission?.ends_at) return;

    const timeout = setTimeout(
      () => void loadData(),
      Math.max(0, Date.parse(mission.ends_at) - Date.now()) + 250,
    );

    return () => clearTimeout(timeout);
  }, [loadData, mission?.ends_at]);

  async function publish() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      await publishRoomMission(supabase, roomId, {
        title,
        description,
        durationMinutes: duration,
      });
      setTitle("");
      setDescription("");
      setDuration(10);
      setCreating(false);
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not publish the Mission.");
    } finally {
      setBusy(false);
    }
  }

  function confirmEnd() {
    if (!mission || busy) return;

    Alert.alert("End Mission?", "It will stop being active for everyone in this room.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End Mission",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            await endRoomMission(supabase, mission.id);
            await loadData();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not end the Mission.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Missions</Text>
      <Text style={styles.subheading}>One focused action for everyone in the room.</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {mission ? (
        <View style={styles.activeCard}>
          <View style={styles.metaRow}>
            <Text style={styles.activeBadge}>ACTIVE</Text>
            <Text style={styles.count}>{mission.completion_count} completed</Text>
          </View>
          <Text style={styles.title}>{mission.title}</Text>
          {mission.description ? <Text style={styles.description}>{mission.description}</Text> : null}
          {mission.ends_at ? (
            <Text style={styles.endTime}>Ends {new Date(mission.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
          ) : null}
          {isHost && (
            <TouchableOpacity style={styles.endButton} onPress={confirmEnd} disabled={busy}>
              <Text style={styles.endButtonText}>End Mission</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <Text style={styles.empty}>No active Mission.</Text>
      )}

      {isHost && !roomEnded && !creating && (
        <TouchableOpacity style={styles.createButton} onPress={() => setCreating(true)}>
          <Text style={styles.createButtonText}>{mission ? "Create Replacement Mission" : "Create Mission"}</Text>
        </TouchableOpacity>
      )}

      {isHost && !roomEnded && creating && (
        <View style={styles.form}>
          <Text style={styles.label}>Mission title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            placeholder="Meet someone new"
            placeholderTextColor="#71717A"
            style={styles.input}
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            maxLength={1000}
            multiline
            numberOfLines={4}
            placeholder="Introduce yourself to someone you haven't met yet."
            placeholderTextColor="#71717A"
            style={[styles.input, styles.descriptionInput]}
          />

          <Text style={styles.label}>Duration</Text>
          <View style={styles.durationRow}>
            {durations.map((option) => (
              <TouchableOpacity
                key={option.label}
                style={[styles.durationButton, duration === option.value && styles.durationButtonActive]}
                onPress={() => setDuration(option.value)}
              >
                <Text style={[styles.durationText, duration === option.value && styles.durationTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.publishButton} onPress={() => void publish()} disabled={busy}>
              <Text style={styles.publishButtonText}>{busy ? "Publishing..." : "Publish Mission"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setCreating(false)} disabled={busy}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {isHost && history.length > 0 && (
        <View style={styles.history}>
          <Text style={styles.historyHeading}>PAST MISSIONS</Text>
          {history.map((item) => (
            <View key={item.id} style={styles.historyRow}>
              <View style={styles.historyText}>
                <Text style={styles.historyTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.historyMeta}>{endedLabel(item.ended_reason)}</Text>
              </View>
              <Text style={styles.historyCount}>{item.completion_count} completed</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: "#11101B",
    borderColor: "rgba(244,114,182,0.24)",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 18,
    padding: 16,
  },
  heading: { color: "#FFFFFF", fontSize: 22, fontWeight: "900" },
  subheading: { color: "#A1A1AA", fontSize: 13, lineHeight: 19, marginTop: 5 },
  activeCard: { backgroundColor: "#08080D", borderRadius: 8, marginTop: 14, padding: 14 },
  metaRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 9 },
  activeBadge: { backgroundColor: "#047857", borderRadius: 4, color: "#FFFFFF", fontSize: 10, fontWeight: "900", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  count: { color: "#FBCFE8", fontSize: 12, fontWeight: "900" },
  title: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", lineHeight: 23, marginTop: 10 },
  description: { color: "#D4D4D8", fontSize: 13, lineHeight: 20, marginTop: 7 },
  endTime: { color: "#A1A1AA", fontSize: 12, fontWeight: "700", marginTop: 9 },
  endButton: { alignItems: "center", borderColor: "rgba(248,113,113,0.45)", borderRadius: 8, borderWidth: 1, marginTop: 13, minHeight: 44, justifyContent: "center" },
  endButtonText: { color: "#FCA5A5", fontWeight: "900" },
  empty: { color: "#71717A", fontSize: 13, fontWeight: "700", marginTop: 14 },
  createButton: { alignItems: "center", backgroundColor: "#DB2777", borderRadius: 8, justifyContent: "center", marginTop: 14, minHeight: 48, paddingHorizontal: 15 },
  createButtonText: { color: "#FFFFFF", fontWeight: "900", textAlign: "center" },
  form: { backgroundColor: "#08080D", borderRadius: 8, marginTop: 14, padding: 14 },
  label: { color: "#E9D5FF", fontSize: 13, fontWeight: "900", marginBottom: 7, marginTop: 10 },
  input: { backgroundColor: "#000000", borderRadius: 8, color: "#FFFFFF", fontSize: 14, minHeight: 46, paddingHorizontal: 12, paddingVertical: 11 },
  descriptionInput: { minHeight: 92, textAlignVertical: "top" },
  durationRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  durationButton: { borderColor: "rgba(255,255,255,0.14)", borderRadius: 8, borderWidth: 1, minHeight: 40, justifyContent: "center", paddingHorizontal: 11 },
  durationButtonActive: { backgroundColor: "#7C3AED", borderColor: "#A78BFA" },
  durationText: { color: "#A1A1AA", fontSize: 12, fontWeight: "800" },
  durationTextActive: { color: "#FFFFFF" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 16 },
  publishButton: { alignItems: "center", backgroundColor: "#DB2777", borderRadius: 8, flexGrow: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 14 },
  publishButtonText: { color: "#FFFFFF", fontWeight: "900" },
  cancelButton: { alignItems: "center", borderColor: "rgba(255,255,255,0.16)", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 14 },
  cancelButtonText: { color: "#D4D4D8", fontWeight: "900" },
  history: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1, marginTop: 16, paddingTop: 14 },
  historyHeading: { color: "#A1A1AA", fontSize: 11, fontWeight: "900", marginBottom: 8 },
  historyRow: { alignItems: "center", backgroundColor: "#08080D", borderRadius: 8, flexDirection: "row", gap: 10, justifyContent: "space-between", marginTop: 7, padding: 12 },
  historyText: { flex: 1, minWidth: 0 },
  historyTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  historyMeta: { color: "#71717A", fontSize: 11, fontWeight: "700", marginTop: 3 },
  historyCount: { color: "#D4D4D8", fontSize: 12, fontWeight: "900" },
  error: { color: "#FCA5A5", fontSize: 13, fontWeight: "800", lineHeight: 18, marginTop: 10 },
});
