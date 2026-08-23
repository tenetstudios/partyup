import { useCallback, useEffect, useRef, useState } from "react";
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
  getMissionCompletedParticipants,
  getMissionOperationsDashboard,
  getRoomMissionHistory,
  publishRoomMission,
  publishAnimalPackMission,
  type MissionCompletedParticipants,
  type MissionOperationsDashboard as MissionOperationsData,
  type RoomMission,
  type RoomMissionHistoryItem,
} from "../../lib/roomMissions";
import MissionOperationsDashboard from "./MissionOperationsDashboard";

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
  const [missionType, setMissionType] = useState<"generic" | "animal_pack">("generic");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<number | null>(10);
  const [animalCount, setAnimalCount] = useState(6);
  const [targetEncounters, setTargetEncounters] = useState(3);
  const [hostResults, setHostResults] = useState<MissionCompletedParticipants | null>(null);
  const [operations, setOperations] = useState<MissionOperationsData | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [historyResultsMissionId, setHistoryResultsMissionId] = useState<string | null>(null);
  const [historyResults, setHistoryResults] = useState<MissionCompletedParticipants | null>(null);
  const [historyOperationsMissionId, setHistoryOperationsMissionId] = useState<string | null>(null);
  const [historyOperations, setHistoryOperations] = useState<MissionOperationsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recommendedParticipants = animalCount * (targetEncounters + 1);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const missionIdRef = useRef<string | null>(null);

  missionIdRef.current = mission?.id ?? null;

  const loadData = useCallback(async () => {
    const nextMission = await getActiveRoomMission(supabase, roomId);
    setMission(nextMission);
    setOperations(isHost && nextMission ? await getMissionOperationsDashboard(supabase, nextMission.id) : null);

    if (isHost) {
      setHistory(await getRoomMissionHistory(supabase, roomId, 5));
    }
  }, [isHost, roomId]);

  const scheduleLoadData = useCallback(() => {
    if (refreshTimeoutRef.current) return;
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      void loadData().catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Could not refresh Mission operations.");
      });
    }, 750);
  }, [loadData]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void loadData().catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Could not load Missions.");
    });

    const refreshCurrentMission = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const changedMissionId = payload.new?.mission_id ?? payload.old?.mission_id;
      if (!changedMissionId || changedMissionId === missionIdRef.current) scheduleLoadData();
    };

    const subscribe = async () => {
      const channelName = `mobile-manage-missions-${roomId}`;
      const existingChannel = supabase
        .getChannels()
        .find((candidate) => candidate.topic === `realtime:${channelName}`);

      if (existingChannel) await supabase.removeChannel(existingChannel);
      if (!active) return;

      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` },
          scheduleLoadData,
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_participant_assignments" }, refreshCurrentMission)
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_encounters" }, refreshCurrentMission)
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_completions" }, refreshCurrentMission)
        .subscribe();
    };

    void subscribe().catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not subscribe to Mission updates.");
    });

    return () => {
      active = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (channel) void supabase.removeChannel(channel);
    };
  }, [loadData, roomId, scheduleLoadData]);

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
      if (missionType === "animal_pack") {
        await publishAnimalPackMission(supabase, roomId, {
          animalCount,
          targetEncounters,
          durationMinutes: duration ?? 10,
        });
      } else {
        await publishRoomMission(supabase, roomId, { title, description, durationMinutes: duration });
      }
      setTitle("");
      setDescription("");
      setDuration(10);
      setMissionType("generic");
      setCreating(false);
      setShowCompleted(false);
      setHostResults(null);
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
            setShowCompleted(false);
            setHostResults(null);
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

  async function toggleHistoryResults(missionId: string) {
    if (historyResultsMissionId === missionId) {
      setHistoryResultsMissionId(null);
      setHistoryResults(null);
      return;
    }
    setError(null);
    try {
      setHistoryResults(await getMissionCompletedParticipants(supabase, missionId));
      setHistoryResultsMissionId(missionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load completed participants.");
    }
  }

  async function toggleCompletedResults() {
    if (!mission) return;
    if (showCompleted) {
      setShowCompleted(false);
      return;
    }
    setError(null);
    try {
      setHostResults(await getMissionCompletedParticipants(supabase, mission.id));
      setShowCompleted(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load completed participants.");
    }
  }

  async function toggleHistoryOperations(missionId: string) {
    if (historyOperationsMissionId === missionId) {
      setHistoryOperationsMissionId(null);
      setHistoryOperations(null);
      return;
    }
    setError(null);
    try {
      setHistoryOperations(await getMissionOperationsDashboard(supabase, missionId));
      setHistoryOperationsMissionId(missionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load Mission operations.");
    }
  }

  async function loadMoreCompletedResults() {
    if (!mission || !hostResults?.has_more) return;
    const next = await getMissionCompletedParticipants(supabase, mission.id, 100, hostResults.participants.length);
    setHostResults({ ...next, participants: [...hostResults.participants, ...next.participants] });
  }

  async function loadMoreHistoryResults() {
    if (!historyResultsMissionId || !historyResults?.has_more) return;
    const next = await getMissionCompletedParticipants(supabase, historyResultsMissionId, 100, historyResults.participants.length);
    setHistoryResults({ ...next, participants: [...historyResults.participants, ...next.participants] });
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
            {mission.mission_type === "animal_pack" && <Text style={styles.count}>{operations?.summary.participant_count ?? mission.participant_count} participating</Text>}
            <Text style={styles.count}>{operations?.summary.completed_count ?? mission.completion_count} completed</Text>
          </View>
          <Text style={styles.title}>{mission.title}</Text>
          {mission.description ? <Text style={styles.description}>{mission.description}</Text> : null}
          {mission.ends_at ? (
            <Text style={styles.endTime}>Ends {new Date(mission.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
          ) : null}
          {operations && <MissionOperationsDashboard dashboard={operations} />}
          {isHost && (
            <TouchableOpacity style={styles.endButton} onPress={confirmEnd} disabled={busy}>
              <Text style={styles.endButtonText}>End Mission</Text>
            </TouchableOpacity>
          )}
          {isHost && (
            <>
              <TouchableOpacity style={styles.completedListButton} onPress={() => void toggleCompletedResults()}>
                <Text style={styles.completedListButtonText}>{showCompleted ? "Hide Completed" : "View Completed"}</Text>
              </TouchableOpacity>
              {showCompleted && (
                <View style={styles.completedList}>
                  {(hostResults?.participants ?? []).length === 0 ? <Text style={styles.empty}>No completed participants yet.</Text> : hostResults?.participants.map((person) => (
                    <View key={person.identity_id} style={styles.completedPerson}>
                      <Text style={styles.completedName}>{person.display_name}</Text>
                      <Text style={styles.completedAt}>{person.assignment_key ? `${person.assignment_key} | ` : ""}{new Date(person.completed_at).toLocaleString()}</Text>
                    </View>
                  ))}
                  {hostResults?.has_more && <TouchableOpacity style={styles.historyResultsButton} onPress={() => void loadMoreCompletedResults()}><Text style={styles.historyResultsText}>Load More ({hostResults.participants.length} of {hostResults.total_count})</Text></TouchableOpacity>}
                </View>
              )}
            </>
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
          <Text style={styles.label}>Mission Type</Text>
          <View style={styles.durationRow}>
            {(["generic", "animal_pack"] as const).map((value) => (
              <TouchableOpacity key={value} style={[styles.durationButton, missionType === value && styles.durationButtonActive]} onPress={() => setMissionType(value)}>
                <Text style={[styles.durationText, missionType === value && styles.durationTextActive]}>{value === "generic" ? "Standard Mission" : "Find Your Pack"}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {missionType === "generic" ? (
            <>
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
            </>
          ) : (
            <>
              <Text style={styles.label}>Number of animal groups</Text>
              <View style={styles.durationRow}>{[4, 6, 8, 10, 12].map((value) => <TouchableOpacity key={value} style={[styles.durationButton, animalCount === value && styles.durationButtonActive]} onPress={() => setAnimalCount(value)}><Text style={[styles.durationText, animalCount === value && styles.durationTextActive]}>{value}</Text></TouchableOpacity>)}</View>
              <Text style={styles.label}>People each participant must find</Text>
              <View style={styles.durationRow}>{[1, 2, 3].map((value) => <TouchableOpacity key={value} style={[styles.durationButton, targetEncounters === value && styles.durationButtonActive]} onPress={() => setTargetEncounters(value)}><Text style={[styles.durationText, targetEncounters === value && styles.durationTextActive]}>{value}</Text></TouchableOpacity>)}</View>
              <View style={styles.capacityNotice}>
                <Text style={styles.capacityNoticeText}>For every participant to have enough possible pack members, plan for at least <Text style={styles.capacityNoticeStrong}>{recommendedParticipants} participants</Text>.</Text>
              </View>
            </>
          )}

          <Text style={styles.label}>Duration</Text>
          <View style={styles.durationRow}>
            {durations.filter((option) => missionType === "generic" || option.value !== null).map((option) => (
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
            <View key={item.id} style={styles.historyCard}>
              <View style={styles.historyRow}>
                <View style={styles.historyText}>
                  <Text style={styles.historyTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.historyMeta}>{endedLabel(item.ended_reason)}</Text>
                </View>
                <Text style={styles.historyCount}>{item.completion_count} completed</Text>
              </View>
              <TouchableOpacity style={styles.historyResultsButton} onPress={() => void toggleHistoryOperations(item.id)}><Text style={styles.historyResultsText}>{historyOperationsMissionId === item.id ? "Hide Operations" : "View Operations"}</Text></TouchableOpacity>
              {historyOperationsMissionId === item.id && historyOperations && <MissionOperationsDashboard dashboard={historyOperations} />}
              <TouchableOpacity style={styles.historyResultsButton} onPress={() => void toggleHistoryResults(item.id)}><Text style={styles.historyResultsText}>{historyResultsMissionId === item.id ? "Hide" : "View Completed"}</Text></TouchableOpacity>
              {historyResultsMissionId === item.id && <View style={styles.completedList}>
                {(historyResults?.participants ?? []).length === 0 ? <Text style={styles.empty}>No completed participants.</Text> : historyResults?.participants.map((person) => <View key={person.identity_id} style={styles.completedPerson}><Text style={styles.completedName}>{person.display_name}</Text><Text style={styles.completedAt}>{person.assignment_key ? `${person.assignment_key} | ` : ""}{new Date(person.completed_at).toLocaleString()}</Text></View>)}
                {historyResults?.has_more && <TouchableOpacity style={styles.historyResultsButton} onPress={() => void loadMoreHistoryResults()}><Text style={styles.historyResultsText}>Load More ({historyResults.participants.length} of {historyResults.total_count})</Text></TouchableOpacity>}
              </View>}
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
  completedListButton: { alignItems: "center", borderColor: "rgba(196,181,253,0.4)", borderRadius: 8, borderWidth: 1, marginTop: 12, minHeight: 44, justifyContent: "center" },
  completedListButtonText: { color: "#E9D5FF", fontWeight: "900" },
  completedList: { gap: 7, marginTop: 8 },
  completedPerson: { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 7, padding: 10 },
  completedName: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  completedAt: { color: "#A1A1AA", fontSize: 11, marginTop: 3 },
  empty: { color: "#71717A", fontSize: 13, fontWeight: "700", marginTop: 14 },
  createButton: { alignItems: "center", backgroundColor: "#7C3AED", borderColor: "#A78BFA", borderRadius: 999, borderWidth: 1, justifyContent: "center", marginTop: 14, minHeight: 48, paddingHorizontal: 20 },
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
  capacityNotice: { backgroundColor: "rgba(120,53,15,0.22)", borderColor: "rgba(252,211,77,0.28)", borderRadius: 8, borderWidth: 1, marginTop: 12, padding: 12 },
  capacityNoticeText: { color: "#FEF3C7", fontSize: 13, lineHeight: 19 },
  capacityNoticeStrong: { fontWeight: "900" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 16 },
  publishButton: { alignItems: "center", backgroundColor: "#7C3AED", borderColor: "#A78BFA", borderRadius: 999, borderWidth: 1, flexGrow: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 18 },
  publishButtonText: { color: "#FFFFFF", fontWeight: "900" },
  cancelButton: { alignItems: "center", borderColor: "rgba(255,255,255,0.16)", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 14 },
  cancelButtonText: { color: "#D4D4D8", fontWeight: "900" },
  history: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1, marginTop: 16, paddingTop: 14 },
  historyHeading: { color: "#A1A1AA", fontSize: 11, fontWeight: "900", marginBottom: 8 },
  historyCard: { backgroundColor: "#08080D", borderRadius: 8, marginTop: 7, padding: 12 },
  historyRow: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  historyText: { flex: 1, minWidth: 0 },
  historyTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  historyMeta: { color: "#71717A", fontSize: 11, fontWeight: "700", marginTop: 3 },
  historyCount: { color: "#D4D4D8", fontSize: 12, fontWeight: "900" },
  historyResultsButton: { alignItems: "center", borderColor: "rgba(255,255,255,0.16)", borderRadius: 7, borderWidth: 1, marginTop: 9, minHeight: 38, justifyContent: "center" },
  historyResultsText: { color: "#E9D5FF", fontSize: 12, fontWeight: "900" },
  error: { color: "#FCA5A5", fontSize: 13, fontWeight: "800", lineHeight: 18, marginTop: 10 },
});
