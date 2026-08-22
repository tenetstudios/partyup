import { useCallback, useEffect, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { createGuestSession, readStoredGuestSession } from "../lib/matchmaking";
import {
  animalDetails,
  completeRoomMission,
  createMissionEncounterToken,
  getActiveRoomMission,
  getMissionTimeRemaining,
  getMyAnimalPackState,
  joinAnimalPackMission,
  redeemMissionEncounterToken,
  type AnimalPackState,
  type EncounterResultStatus,
  type MissionEncounterToken,
  type RoomMission,
} from "../../lib/roomMissions";

const messages: Record<EncounterResultStatus, string> = {
  valid: "PACK MEMBER FOUND ✓",
  self_scan: "That’s your own code.",
  wrong_mission: "This person is in a different Mission.",
  wrong_animal: "You found a different pack.",
  duplicate: "You already found each other.",
  expired: "That code expired. Ask them to refresh it.",
  mission_ended: "This Mission is no longer active.",
  invalid: "That Mission code isn’t valid.",
};

export default function RoomMissionCard({ roomId }: { roomId: string }) {
  const [mission, setMission] = useState<RoomMission | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [animalState, setAnimalState] = useState<AnimalPackState | null>(null);
  const [mode, setMode] = useState<"details" | "animal" | "qr" | "scan">("details");
  const [encounterToken, setEncounterToken] = useState<MissionEncounterToken | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [scanLocked, setScanLocked] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const loadMission = useCallback(async () => {
    const next = await getActiveRoomMission(supabase, roomId);
    setMission(next);
    if (!next) { setExpanded(false); setAnimalState(null); }
  }, [roomId]);

  const refreshState = useCallback(async (missionId: string, token: string | null) => {
    setAnimalState(await getMyAnimalPackState(supabase, missionId, token));
  }, []);

  const prepareAnimalPack = useCallback(async (missionId: string) => {
    const { data } = await supabase.auth.getUser();
    let token = (await readStoredGuestSession())?.guestToken ?? null;
    if (!data.user && !token) token = (await createGuestSession()).guestToken;
    setGuestToken(token);
    await joinAnimalPackMission(supabase, missionId, token);
    await refreshState(missionId, token);
  }, [refreshState]);

  useEffect(() => {
    setNow(Date.now());
    void loadMission().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load the Mission."));
    const channel = supabase
      .channel(`mobile-room-missions-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` }, () => void loadMission())
      .on("postgres_changes", { event: "*", schema: "public", table: "mission_completions" }, () => void loadMission())
      .on("postgres_changes", { event: "*", schema: "public", table: "mission_encounters" }, () => {
        if (mission?.mission_type === "animal_pack") void refreshState(mission.id, guestToken);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [guestToken, loadMission, mission?.id, mission?.mission_type, refreshState, roomId]);

  useEffect(() => {
    if (!mission?.ends_at) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    const timeout = setTimeout(() => void loadMission(), Math.max(0, Date.parse(mission.ends_at) - Date.now()) + 250);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [loadMission, mission?.ends_at]);

  useEffect(() => {
    if (!expanded || mission?.mission_type !== "animal_pack") return;
    void prepareAnimalPack(mission.id).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not join Find Your Pack."));
    const interval = setInterval(() => void refreshState(mission.id, guestToken), 10_000);
    return () => clearInterval(interval);
  }, [expanded, guestToken, mission?.id, mission?.mission_type, prepareAnimalPack, refreshState]);

  useEffect(() => {
    if (mode !== "qr" || mission?.mission_type !== "animal_pack") return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const next = await createMissionEncounterToken(supabase, mission.id, guestToken);
        if (!active) return;
        setEncounterToken(next);
        timeout = setTimeout(refresh, Math.max(5_000, Date.parse(next.expires_at) - Date.now() - 5_000));
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not create your Mission QR.");
      }
    };
    void refresh();
    return () => { active = false; if (timeout) clearTimeout(timeout); };
  }, [guestToken, mission, mode]);

  if (!mission) return null;
  const remaining = now ? getMissionTimeRemaining(mission.ends_at, now) : null;
  const isAnimalPack = mission.mission_type === "animal_pack";
  const plural = animalState ? (animalDetails[animalState.assignment_key]?.plural ?? "pack members") : "pack members";
  const tokenRefreshSeconds = encounterToken && now
    ? Math.max(0, Math.ceil((Date.parse(encounterToken.expires_at) - now - 5_000) / 1000))
    : null;

  async function markComplete() {
    if (busy || mission!.viewer_completed || remaining?.expired) return;
    setBusy(true); setError(null);
    try { await completeRoomMission(supabase, mission!.id); await loadMission(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete the Mission."); }
    finally { setBusy(false); }
  }

  async function redeem(value: string) {
    if (!value.trim() || busy) return;
    setBusy(true); setScanLocked(true); setFeedback(null); setError(null);
    try {
      const result = await redeemMissionEncounterToken(supabase, mission!.id, value.trim(), guestToken);
      setFeedback(messages[result.status]);
      setManualCode("");
      await refreshState(mission!.id, guestToken);
      if (result.status === "valid") setMode("details");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not verify that code.");
    } finally {
      setBusy(false);
      setTimeout(() => setScanLocked(false), 1200);
    }
  }

  async function openScanner() {
    setFeedback(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) { setError("Camera permission is needed to scan a Mission QR."); return; }
    }
    setScanLocked(false);
    setMode("scan");
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.textBlock}>
          <View style={styles.metaRow}>
            <Text style={styles.badge}>{isAnimalPack ? "FIND YOUR PACK" : "NEW MISSION"}</Text>
            {remaining && <Text style={styles.timer}>{remaining.expired ? "Ending..." : `${remaining.label} left`}</Text>}
          </View>
          <Text style={styles.title} numberOfLines={expanded ? undefined : 2}>{mission.title}</Text>
        </View>
        <TouchableOpacity style={styles.viewButton} onPress={() => { setExpanded((value) => !value); setMode("details"); }}>
          <Text style={styles.viewButtonText}>{expanded ? "Close" : "View"}</Text>
        </TouchableOpacity>
      </View>

      {expanded && (
        <View style={styles.detail}>
          {isAnimalPack ? animalState ? (
            <View style={styles.animalContent}>
              <Text style={styles.eyebrow}>YOUR ANIMAL</Text>
              <TouchableOpacity onPress={() => setMode("animal")}><Text style={styles.animal}>{animalState.assignment_key}</Text></TouchableOpacity>
              <Text style={styles.instruction}>Find {animalState.target_encounters} other {plural} in this room.</Text>
              <Text style={styles.progress}>{Math.min(animalState.progress, animalState.target_encounters)} / {animalState.target_encounters} found</Text>
              {animalState.completed ? (
                <View style={styles.completePanel}><Text style={styles.completeTitle}>PACK FOUND ✓</Text><Text style={styles.completeCopy}>You found {animalState.target_encounters} other {plural}.</Text></View>
              ) : (
                <View style={styles.actionStack}>
                  <TouchableOpacity style={styles.primaryButton} onPress={() => { setMode("qr"); setFeedback(null); }}><Text style={styles.primaryText}>Show My QR</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.scanButton} onPress={() => void openScanner()}><Text style={styles.primaryText}>Scan Someone</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.outlineButton} onPress={() => setMode("animal")}><Text style={styles.outlineText}>Show My Animal</Text></TouchableOpacity>
                </View>
              )}
              {feedback && <Text style={[styles.feedback, feedback.includes("✓") && styles.success]}>{feedback}</Text>}
            </View>
          ) : <Text style={styles.description}>Joining Find Your Pack…</Text> : (
            <>
              {mission.description ? <Text style={styles.description}>{mission.description}</Text> : null}
              <TouchableOpacity style={[styles.genericCompleteButton, mission.viewer_completed && styles.completedButton]} onPress={() => void markComplete()} disabled={busy || mission.viewer_completed || Boolean(remaining?.expired)}>
                <Text style={styles.primaryText}>{mission.viewer_completed ? "Completed" : busy ? "Completing..." : "Mark Complete"}</Text>
              </TouchableOpacity>
              {mission.can_manage && <Text style={styles.count}>{mission.completion_count} completed</Text>}
            </>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      )}

      {mode === "animal" && <Modal visible animationType="fade" onRequestClose={() => setMode("details")}>
        <View style={styles.animalModal}>
          <TouchableOpacity style={styles.closeButton} onPress={() => setMode("details")}><Text style={styles.closeText}>Close</Text></TouchableOpacity>
          <Text style={styles.modalEyebrow}>SHOW MY ANIMAL</Text>
          <Text style={styles.giantAnimal}>{animalState?.assignment_key}</Text>
        </View>
      </Modal>}

      {mode === "qr" && <Modal visible animationType="slide" onRequestClose={() => setMode("details")}>
        <View style={styles.qrModal}>
          <TouchableOpacity style={styles.closeButton} onPress={() => setMode("details")}><Text style={styles.closeText}>Close</Text></TouchableOpacity>
          <Text style={styles.qrAnimal}>{animalState?.assignment_key}</Text>
          <Text style={styles.qrInstruction}>Scan this when you find another {animalState ? animalDetails[animalState.assignment_key]?.singular ?? "pack member" : "pack member"}.</Text>
          {encounterToken ? <View style={styles.qrBox}><QRCode value={encounterToken.qr_payload} size={240} /><Text style={styles.shortCode}>{encounterToken.short_code}</Text><Text style={styles.refreshing}>{tokenRefreshSeconds === 0 ? "Refreshing…" : `Refreshes in ${tokenRefreshSeconds ?? "–"} seconds`}</Text></View> : <Text style={styles.loading}>Creating secure code…</Text>}
        </View>
      </Modal>}

      {mode === "scan" && <Modal visible animationType="slide" onRequestClose={() => setMode("details")}>
        <View style={styles.scannerModal}>
          <TouchableOpacity style={styles.closeButton} onPress={() => setMode("details")}><Text style={styles.closeText}>Close</Text></TouchableOpacity>
          <Text style={styles.scannerTitle}>SCAN A PACK MEMBER</Text>
          {permission?.granted ? (
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={scanLocked ? undefined : ({ data }) => void redeem(data)}
            />
          ) : <TouchableOpacity style={styles.primaryButton} onPress={() => void openScanner()}><Text style={styles.primaryText}>Allow Camera</Text></TouchableOpacity>}
          <Text style={styles.or}>OR ENTER THEIR TEMPORARY CODE</Text>
          <TextInput value={manualCode} onChangeText={(value) => setManualCode(value.toUpperCase())} autoCapitalize="characters" maxLength={64} placeholder="F7K2A1B9" placeholderTextColor="#71717A" style={styles.codeInput} />
          <TouchableOpacity style={styles.scanButton} disabled={busy || !manualCode.trim()} onPress={() => void redeem(manualCode)}><Text style={styles.primaryText}>{busy ? "Checking…" : "Confirm Encounter"}</Text></TouchableOpacity>
          {feedback && <Text style={[styles.feedback, feedback.includes("✓") && styles.success]}>{feedback}</Text>}
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      </Modal>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#171020", borderColor: "rgba(244,114,182,0.32)", borderRadius: 8, borderWidth: 1, marginBottom: 14, padding: 16 },
  headerRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  textBlock: { flex: 1, minWidth: 0 },
  metaRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { backgroundColor: "#DB2777", borderRadius: 4, color: "#FFF", fontSize: 10, fontWeight: "900", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  timer: { color: "#FBCFE8", fontSize: 12, fontWeight: "900" },
  title: { color: "#FFF", fontSize: 19, fontWeight: "900", lineHeight: 24, marginTop: 8 },
  viewButton: { alignItems: "center", borderColor: "rgba(255,255,255,0.18)", borderRadius: 8, borderWidth: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: 15 },
  viewButtonText: { color: "#FFF", fontSize: 13, fontWeight: "900" },
  detail: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1, marginTop: 14, paddingTop: 14 },
  animalContent: { alignItems: "center" },
  eyebrow: { color: "#E9D5FF", fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  animal: { fontSize: 88, lineHeight: 108, marginTop: 5 },
  instruction: { color: "#FFF", fontSize: 17, fontWeight: "900", lineHeight: 24, textAlign: "center" },
  progress: { color: "#F9A8D4", fontSize: 27, fontWeight: "900", marginTop: 9 },
  actionStack: { gap: 9, marginTop: 16, width: "100%" },
  primaryButton: { alignItems: "center", backgroundColor: "#7C3AED", borderRadius: 8, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  scanButton: { alignItems: "center", backgroundColor: "#DB2777", borderRadius: 8, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  outlineButton: { alignItems: "center", borderColor: "rgba(255,255,255,0.22)", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 48 },
  outlineText: { color: "#FFF", fontWeight: "900" },
  primaryText: { color: "#FFF", fontSize: 15, fontWeight: "900" },
  completePanel: { backgroundColor: "rgba(6,78,59,0.42)", borderColor: "rgba(52,211,153,0.34)", borderRadius: 8, borderWidth: 1, marginTop: 16, padding: 15, width: "100%" },
  completeTitle: { color: "#6EE7B7", fontSize: 20, fontWeight: "900", textAlign: "center" },
  completeCopy: { color: "#D1FAE5", fontSize: 13, marginTop: 4, textAlign: "center" },
  description: { color: "#D4D4D8", fontSize: 14, lineHeight: 21 },
  genericCompleteButton: { alignItems: "center", backgroundColor: "#DB2777", borderRadius: 8, justifyContent: "center", marginTop: 14, minHeight: 48 },
  completedButton: { backgroundColor: "#047857" },
  count: { color: "#D4D4D8", fontSize: 13, fontWeight: "800", marginTop: 10, textAlign: "center" },
  feedback: { color: "#FDE68A", fontSize: 14, fontWeight: "900", marginTop: 13, textAlign: "center" },
  success: { color: "#6EE7B7" },
  error: { color: "#FCA5A5", fontSize: 13, fontWeight: "800", lineHeight: 18, marginTop: 10, textAlign: "center" },
  animalModal: { alignItems: "center", backgroundColor: "#030006", flex: 1, justifyContent: "center", padding: 24 },
  modalEyebrow: { color: "#E9D5FF", fontSize: 14, fontWeight: "900", letterSpacing: 3 },
  giantAnimal: { fontSize: 180, lineHeight: 220, marginTop: 20 },
  closeButton: { borderColor: "rgba(255,255,255,0.24)", borderRadius: 8, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 11, position: "absolute", right: 20, top: 55, zIndex: 2 },
  closeText: { color: "#FFF", fontWeight: "900" },
  qrModal: { alignItems: "center", backgroundColor: "#09040F", flex: 1, justifyContent: "center", padding: 24 },
  qrAnimal: { fontSize: 70, lineHeight: 86 },
  qrInstruction: { color: "#FFF", fontSize: 16, fontWeight: "900", lineHeight: 23, maxWidth: 320, textAlign: "center" },
  qrBox: { alignItems: "center", backgroundColor: "#FFF", borderRadius: 14, marginTop: 20, padding: 20 },
  shortCode: { color: "#000", fontSize: 25, fontWeight: "900", letterSpacing: 6, marginTop: 15 },
  refreshing: { color: "#52525B", fontSize: 11, fontWeight: "700", marginTop: 7 },
  loading: { color: "#D4D4D8", fontWeight: "800", marginTop: 24 },
  scannerModal: { backgroundColor: "#09040F", flex: 1, justifyContent: "center", padding: 24 },
  scannerTitle: { color: "#FFF", fontSize: 22, fontWeight: "900", marginBottom: 18, textAlign: "center" },
  camera: { borderRadius: 12, height: 320, overflow: "hidden", width: "100%" },
  or: { color: "#A1A1AA", fontSize: 11, fontWeight: "900", marginVertical: 15, textAlign: "center" },
  codeInput: { backgroundColor: "#000", borderRadius: 8, color: "#FFF", fontSize: 20, fontWeight: "900", letterSpacing: 5, minHeight: 50, paddingHorizontal: 14, textAlign: "center" },
});
