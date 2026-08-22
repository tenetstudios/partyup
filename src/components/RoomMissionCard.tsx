import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import {
  completeRoomMission,
  getActiveRoomMission,
  getMissionTimeRemaining,
  type RoomMission,
} from "../../lib/roomMissions";

export default function RoomMissionCard({ roomId }: { roomId: string }) {
  const [mission, setMission] = useState<RoomMission | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const loadMission = useCallback(async () => {
    const nextMission = await getActiveRoomMission(supabase, roomId);
    setMission(nextMission);
    setError(null);
    if (!nextMission) setExpanded(false);
  }, [roomId]);

  useEffect(() => {
    Promise.resolve().then(() => {
      setNow(Date.now());
      void loadMission().catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Could not load the Mission.");
      });
    });

    const channel = supabase
      .channel(`mobile-room-missions-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` },
        () => void loadMission(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mission_completions" },
        () => void loadMission(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadMission, roomId]);

  useEffect(() => {
    if (!mission?.ends_at) return;

    const interval = setInterval(() => setNow(Date.now()), 1000);
    const timeout = setTimeout(
      () => void loadMission(),
      Math.max(0, Date.parse(mission.ends_at) - Date.now()) + 250,
    );

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [loadMission, mission?.ends_at]);

  if (!mission) return null;

  const remaining = now ? getMissionTimeRemaining(mission.ends_at, now) : null;

  async function markComplete() {
    const missionToComplete = mission;

    if (busy || !missionToComplete || missionToComplete.viewer_completed || remaining?.expired) return;

    setBusy(true);
    setError(null);

    try {
      await completeRoomMission(supabase, missionToComplete.id);
      await loadMission();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not complete the Mission.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.textBlock}>
          <View style={styles.metaRow}>
            <Text style={styles.badge}>NEW MISSION</Text>
            {remaining && (
              <Text style={styles.timer}>{remaining.expired ? "Ending..." : `${remaining.label} left`}</Text>
            )}
          </View>
          <Text style={styles.title} numberOfLines={expanded ? undefined : 2}>{mission.title}</Text>
        </View>

        <TouchableOpacity style={styles.viewButton} onPress={() => setExpanded((value) => !value)}>
          <Text style={styles.viewButtonText}>{expanded ? "Close" : "View"}</Text>
        </TouchableOpacity>
      </View>

      {expanded && (
        <View style={styles.detail}>
          {mission.description ? <Text style={styles.description}>{mission.description}</Text> : null}

          <TouchableOpacity
            style={[styles.completeButton, mission.viewer_completed && styles.completedButton]}
            onPress={() => void markComplete()}
            disabled={busy || mission.viewer_completed || Boolean(remaining?.expired)}
          >
            <Text style={styles.completeButtonText}>
              {mission.viewer_completed ? "Completed" : busy ? "Completing..." : "Mark Complete"}
            </Text>
          </TouchableOpacity>

          {mission.can_manage && (
            <Text style={styles.count}>{mission.completion_count} completed</Text>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#171020",
    borderColor: "rgba(244, 114, 182, 0.32)",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  headerRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  textBlock: { flex: 1, minWidth: 0 },
  metaRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: {
    backgroundColor: "#DB2777",
    borderRadius: 4,
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  timer: { color: "#FBCFE8", fontSize: 12, fontWeight: "900" },
  title: { color: "#FFFFFF", fontSize: 19, fontWeight: "900", lineHeight: 24, marginTop: 8 },
  viewButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 15,
  },
  viewButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  detail: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1, marginTop: 14, paddingTop: 14 },
  description: { color: "#D4D4D8", fontSize: 14, lineHeight: 21 },
  completeButton: {
    alignItems: "center",
    backgroundColor: "#DB2777",
    borderRadius: 8,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  completedButton: { backgroundColor: "#047857" },
  completeButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  count: { color: "#D4D4D8", fontSize: 13, fontWeight: "800", marginTop: 10, textAlign: "center" },
  error: { color: "#FCA5A5", fontSize: 13, fontWeight: "800", lineHeight: 18, marginTop: 10 },
});
