import { router, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-native-qrcode-svg";
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../../../lib/supabase";
import { completeWildMission, createWildEncounterToken, enterWildGame, getWildEncounterState, getWildRoomState, redeemWildEncounterToken, wildFactionByKey, type WildEncounterState, type WildEncounterStatus, type WildRoomState } from "../../../../lib/wild";
import { createGuestSession, readStoredGuestSession } from "../../../lib/matchmaking";

const encounterMessages: Record<WildEncounterStatus, string> = {
  valid: "Verified encounter ✓", self_scan: "You can't scan yourself.", wrong_mission: "This code belongs to another Mission.", wrong_game: "This player isn't in this Wild game.", wrong_room: "This code belongs to another room.", wrong_faction: "This objective belongs to another faction.", wrong_animal: "That player is in another Animal Pack.", same_faction_required: "Find someone from your own faction.", different_faction_required: "Find someone from another faction.", specific_faction_required: "That player isn't in the required faction.", duplicate: "You've already verified with this player for this Mission.", expired: "That code expired. Ask them to refresh it.", mission_ended: "This Mission is no longer active.", game_ended: "The Wild has ended.", invalid: "That temporary Mission code isn't valid.",
};

export default function WildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const roomId = String(id ?? "");
  const [state, setState] = useState<WildRoomState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<string | null>(null);
  const [encounterState, setEncounterState] = useState<WildEncounterState | null>(null);
  const [encounterMode, setEncounterMode] = useState<"details" | "qr" | "scan">("details");
  const [encounterToken, setEncounterToken] = useState<{ qr_payload: string; short_code: string; expires_at: string } | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [encounterFeedback, setEncounterFeedback] = useState<string | null>(null);
  const [scanLocked, setScanLocked] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const gameIdRef = useRef<string | null>(null);
  const controllersRef = useRef<Record<string, string | null>>({});
  const loadedRef = useRef(false);

  const ensureGuestToken = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    let token = (await readStoredGuestSession())?.guestToken ?? null;
    if (!data.user && !token) token = (await createGuestSession()).guestToken;
    return token;
  }, []);

  const load = useCallback(async (guestToken?: string | null) => {
    const token = guestToken ?? (await readStoredGuestSession())?.guestToken ?? null;
    const next = await getWildRoomState(supabase, roomId, token);
    if (loadedRef.current) {
      for (const territory of next.territories) {
        const prior = controllersRef.current[territory.key];
        if (prior !== undefined && prior !== territory.controlling_faction && territory.controlling_faction) {
          const faction = next.game?.config.factions.find((item) => item.key === territory.controlling_faction);
          setCapture(`${territory.display_name.toUpperCase()} HAS FALLEN\n${faction?.emoji ?? ""} ${faction?.label.toUpperCase() ?? "A FACTION"} TOOK ${territory.display_name.toUpperCase()}`);
        }
      }
    }
    controllersRef.current = Object.fromEntries(next.territories.map((territory) => [territory.key, territory.controlling_faction]));
    loadedRef.current = true;
    gameIdRef.current = next.game?.id ?? null;
    setState(next);
    if (next.assignment && next.mission?.config.verification_type === "encounter") {
      setEncounterState(await getWildEncounterState(supabase, next.mission.id, token));
    } else {
      setEncounterState(null);
      setEncounterMode("details");
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let guestRefresh: ReturnType<typeof setInterval> | null = null;
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load Into the Wild."));
    void supabase.auth.getUser().then(({ data }) => {
      if (active && !data.user) guestRefresh = setInterval(() => void load(), 10_000);
    });
    const subscribe = async () => {
      const channelName = `mobile-wild-screen-${roomId}`;
      const stale = supabase.getChannels().find((candidate) => candidate.topic === `realtime:${channelName}`);
      if (stale) await supabase.removeChannel(stale);
      if (!active) return;
      const refreshGame = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
        const changedGame = payload.new?.game_id ?? payload.old?.game_id;
        if (!changedGame || changedGame === gameIdRef.current) void load();
      };
      channel = supabase.channel(channelName)
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_games", filter: `room_id=eq.${roomId}` }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_territories" }, refreshGame)
        .on("postgres_changes", { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_completions" }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_encounters" }, refreshGame)
        .subscribe();
    };
    void subscribe();
    return () => { active = false; if (guestRefresh) clearInterval(guestRefresh); if (channel) void supabase.removeChannel(channel); };
  }, [load, roomId]);

  useEffect(() => {
    if (!capture) return;
    const timer = setTimeout(() => setCapture(null), 3200);
    return () => clearTimeout(timer);
  }, [capture]);

  const encounterMissionId = state?.mission?.config.verification_type === "encounter" ? state.mission.id : null;

  useEffect(() => {
    if (encounterMode !== "qr" || !encounterMissionId) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => {
      try {
        const token = await ensureGuestToken();
        const next = await createWildEncounterToken(supabase, encounterMissionId, token);
        if (cancelled) return;
        setEncounterToken(next);
        refreshTimer = setTimeout(() => void refresh(), Math.max(5_000, Date.parse(next.expires_at) - Date.now() - 5_000));
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not create a temporary encounter code."); }
    };
    void refresh();
    return () => { cancelled = true; if (refreshTimer) clearTimeout(refreshTimer); };
  }, [encounterMissionId, encounterMode, ensureGuestToken]);

  async function enter() {
    if (!state?.game) return;
    setBusy(true); setError(null);
    try { const token = await ensureGuestToken(); await enterWildGame(supabase, state.game.id, token); await load(token); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not enter the Wild."); }
    finally { setBusy(false); }
  }

  async function complete() {
    if (!state?.mission) return;
    setBusy(true); setError(null);
    try { const token = await ensureGuestToken(); await completeWildMission(supabase, state.mission.id, token); await load(token); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete this Wild Mission."); }
    finally { setBusy(false); }
  }

  async function openScanner() {
    setEncounterFeedback(null); setError(null); setScanLocked(false); setTorchEnabled(false);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) { setError("Camera permission is required to scan a player QR. You can still enter their temporary code."); }
    }
    setEncounterMode("scan");
  }

  function closeEncounterModal() {
    setEncounterMode("details"); setScanLocked(false); setTorchEnabled(false); setManualCode("");
  }

  async function redeemEncounter(value: string) {
    if (!state?.mission || !value.trim() || busy || scanLocked) return;
    setBusy(true); setScanLocked(true); setError(null); setEncounterFeedback(null);
    try {
      const token = await ensureGuestToken();
      const result = await redeemWildEncounterToken(supabase, state.mission.id, value.trim(), token);
      setEncounterFeedback(encounterMessages[result.status]);
      setManualCode("");
      await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify this encounter."); }
    finally { setBusy(false); setTimeout(() => setScanLocked(false), 1200); }
  }

  const factions = state?.game?.config.factions ?? [];
  const winners = state?.game?.winner_summary?.winners ?? [];
  const encounterRequirement = state?.mission?.config.encounter_relationship === "same_faction" ? `Meet another ${state.assignment?.emoji ?? ""} ${state.assignment?.label ?? "faction"} player.` : state?.mission?.config.encounter_relationship === "different_faction" ? "Meet a player from another faction." : state?.mission?.config.encounter_relationship === "specific_faction" ? `Meet a ${state ? wildFactionByKey(state, state.mission.config.target_faction)?.emoji ?? "" : ""} ${state ? wildFactionByKey(state, state.mission.config.target_faction)?.label ?? "specific faction" : "specific faction"} player.` : null;

  return <SafeAreaView style={styles.safe}><ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back to room</Text></TouchableOpacity>
    <Text style={styles.present}>PARTYUP PRESENTS</Text><Text style={styles.hero}>INTO THE WILD</Text>
    {!state ? <Text style={styles.muted}>Loading the Wild…</Text> : !state.game ? <View style={styles.panel}><Text style={styles.title}>THE WILD IS QUIET</Text><Text style={styles.muted}>The host has not started Into the Wild.</Text></View> : <>
      {state.game.status === "ended" ? <View style={[styles.panel, styles.center]}><Text style={styles.present}>THE WILD HAS ENDED</Text><Text style={styles.winner}>{winners.length === 1 ? `${winners[0].emoji} ${winners[0].label.toUpperCase()} WINS` : winners.length ? `${winners.map((winner) => `${winner.emoji} ${winner.label}`).join(" + ")} TIE` : "CONTESTED"}</Text>{(state.game.winner_summary?.scores ?? []).map((score) => <Text key={score.faction_key} style={styles.score}>{score.emoji} {score.label}: {score.territories_controlled} territories · {score.total_influence} influence</Text>)}</View> : state.assignment ? <View style={styles.panel}><Text style={styles.label}>YOUR FACTION</Text><Text style={styles.faction}>{state.assignment.emoji} {state.assignment.label.toUpperCase()}</Text></View> : <View style={styles.panel}><Text style={styles.title}>Get your faction.</Text><Text style={styles.muted}>Complete Missions. Help your side take the map.</Text><TouchableOpacity style={styles.primary} disabled={busy || state.room_closed} onPress={() => void enter()}><Text style={styles.primaryText}>{busy ? "Entering…" : "Enter the Wild"}</Text></TouchableOpacity></View>}
      <View style={styles.territories}>{state.territories.map((territory) => { const controller = wildFactionByKey(state, territory.controlling_faction); const total = Object.values(territory.influence).reduce((sum, amount) => sum + amount, 0); return <View key={territory.id} style={styles.territory}><Text style={styles.territoryTitle}>{territory.display_name.toUpperCase()}</Text>{factions.map((faction) => { const amount = territory.influence[faction.key] ?? 0; return <View key={faction.key} style={styles.influenceBlock}><View style={styles.influenceRow}><Text style={styles.influenceText}>{faction.emoji} {faction.label}</Text><Text style={styles.influenceText}>{amount}</Text></View>{total > 0 && <View style={styles.track}><View style={[styles.fill, { width: `${(amount / total) * 100}%`, backgroundColor: faction.color ?? "#D946EF" }]} /></View>}</View>; })}<Text style={styles.controller}>{controller ? `Controlled by ${controller.emoji} ${controller.label}` : "Contested"}</Text></View>; })}</View>
      {state.assignment && state.game.status === "active" && <View style={styles.panel}><Text style={styles.present}>YOUR MISSION</Text>{state.mission ? <><Text style={styles.title}>{state.mission.title}</Text>{state.mission.description && <Text style={styles.muted}>{state.mission.description}</Text>}<Text style={styles.reward}>+{state.mission.config.influence_reward} influence · {state.territories.find((item) => item.key === state.mission?.config.territory_key)?.display_name}</Text>{state.mission.config.verification_type === "encounter" ? <View style={styles.encounterBlock}><Text style={styles.requirement}>Requirement: {encounterRequirement}</Text>{encounterState?.eligible ? <Text style={styles.encounterProgress}>{Math.min(encounterState.progress, encounterState.required_encounters)} / {encounterState.required_encounters}</Text> : <Text style={styles.warning}>You can help an eligible player by showing your QR.</Text>}{encounterState?.completed ? <Text style={styles.success}>VERIFIED ✓ Influence awarded.</Text> : <View style={styles.encounterActions}><TouchableOpacity style={styles.secondaryButton} onPress={() => setEncounterMode("qr")}><Text style={styles.primaryText}>Show My QR</Text></TouchableOpacity>{encounterState?.eligible && <TouchableOpacity style={styles.primary} onPress={() => void openScanner()}><Text style={styles.primaryText}>Scan Player</Text></TouchableOpacity>}</View>}</View> : !state.mission.eligible ? <Text style={styles.warning}>This objective belongs to another faction.</Text> : state.mission.viewer_completed ? <Text style={styles.success}>✓ Mission complete. Influence added.</Text> : <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => void complete()}><Text style={styles.primaryText}>{busy ? "Completing…" : "Complete Mission"}</Text></TouchableOpacity>}</> : <Text style={styles.muted}>No active Mission right now.</Text>}</View>}
      {state.assignment && <View style={styles.panel}><Text style={styles.present}>YOUR IMPACT</Text><View style={styles.impactRow}><View><Text style={styles.impactValue}>{state.impact.missions_completed}</Text><Text style={styles.muted}>Missions completed</Text></View><View><Text style={styles.impactValue}>+{state.impact.influence_added}</Text><Text style={styles.muted}>Influence added</Text></View></View></View>}
    </>}
    {error && <Text style={styles.error}>{error}</Text>}
  </ScrollView>
    <Modal visible={encounterMode === "qr"} animationType="slide" onRequestClose={closeEncounterModal}>
      <View style={styles.modal}><TouchableOpacity style={styles.closeButton} onPress={closeEncounterModal}><Text style={styles.closeText}>Close</Text></TouchableOpacity><Text style={styles.modalTitle}>SHOW MY WILD CODE</Text><Text style={styles.modalCopy}>{encounterRequirement}</Text>{encounterToken ? <View style={styles.qrBox}><QRCode value={encounterToken.qr_payload} size={240} /><Text style={styles.shortCode}>{encounterToken.short_code}</Text><Text style={styles.refreshText}>Refreshes every 60 seconds</Text></View> : <Text style={styles.muted}>Creating secure code…</Text>}</View>
    </Modal>
    <Modal visible={encounterMode === "scan"} animationType="slide" onRequestClose={closeEncounterModal}>
      <View style={styles.modal}><TouchableOpacity style={styles.closeButton} onPress={closeEncounterModal}><Text style={styles.closeText}>Close</Text></TouchableOpacity><Text style={styles.modalTitle}>VERIFY A WILD ENCOUNTER</Text><Text style={styles.modalCopy}>{encounterRequirement}</Text>{permission?.granted ? <><CameraView style={styles.camera} facing="back" enableTorch={torchEnabled} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanLocked ? undefined : ({ data }) => void redeemEncounter(data)} /><TouchableOpacity style={[styles.torch, torchEnabled && styles.torchActive]} onPress={() => setTorchEnabled((value) => !value)}><Text style={styles.torchText}>{torchEnabled ? "Turn Flashlight Off" : "Turn Flashlight On"}</Text></TouchableOpacity></> : <TouchableOpacity style={styles.primary} onPress={() => void openScanner()}><Text style={styles.primaryText}>Allow Camera</Text></TouchableOpacity>}<Text style={styles.or}>OR ENTER THEIR TEMPORARY CODE</Text><TextInput value={manualCode} onChangeText={(value) => setManualCode(value.toUpperCase())} autoCapitalize="characters" maxLength={64} placeholder="F7K2A1B9" placeholderTextColor="#71717A" style={styles.codeInput} /><TouchableOpacity style={styles.primaryWide} disabled={busy || !manualCode.trim()} onPress={() => void redeemEncounter(manualCode)}><Text style={styles.primaryText}>{busy ? "Checking…" : "Verify Encounter"}</Text></TouchableOpacity>{encounterFeedback && <Text style={[styles.feedback, encounterFeedback.includes("✓") && styles.success]}>{encounterFeedback}</Text>}{error && <Text style={styles.error}>{error}</Text>}</View>
    </Modal>
    {capture && <View pointerEvents="none" style={styles.capture}><Text style={styles.captureText}>{capture}</Text></View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: "#08050D", flex: 1 }, page: { flex: 1 }, content: { padding: 18, paddingBottom: 50 }, back: { color: "#D8B4FE", fontWeight: "900" }, present: { color: "#F0ABFC", fontSize: 11, fontWeight: "900", letterSpacing: 2.5, marginTop: 24 }, hero: { color: "#FFF", fontSize: 42, fontWeight: "900", marginTop: 5 }, panel: { backgroundColor: "rgba(0,0,0,0.36)", borderColor: "rgba(255,255,255,0.1)", borderRadius: 15, borderWidth: 1, marginTop: 18, padding: 17 }, center: { alignItems: "center" }, title: { color: "#FFF", fontSize: 21, fontWeight: "900", marginTop: 8 }, muted: { color: "#A1A1AA", fontSize: 13, lineHeight: 19, marginTop: 5 }, label: { color: "#A1A1AA", fontSize: 11, fontWeight: "900" }, faction: { color: "#FFF", fontSize: 29, fontWeight: "900", marginTop: 6 }, winner: { color: "#FFF", fontSize: 27, fontWeight: "900", marginTop: 12, textAlign: "center" }, score: { color: "#D4D4D8", fontSize: 12, fontWeight: "700", marginTop: 7, textAlign: "center" }, primary: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#C026D3", borderRadius: 9, justifyContent: "center", marginTop: 14, minHeight: 46, paddingHorizontal: 18 }, primaryWide: { alignItems: "center", backgroundColor: "#C026D3", borderRadius: 9, justifyContent: "center", minHeight: 48, paddingHorizontal: 18 }, primaryText: { color: "#FFF", fontWeight: "900" }, secondaryButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#7E22CE", borderRadius: 9, justifyContent: "center", marginTop: 14, minHeight: 46, paddingHorizontal: 18 }, territories: { gap: 12, marginTop: 18 }, territory: { backgroundColor: "#120C1B", borderColor: "rgba(196,181,253,0.22)", borderRadius: 15, borderWidth: 1, padding: 17 }, territoryTitle: { color: "#FFF", fontSize: 20, fontWeight: "900" }, influenceBlock: { marginTop: 11 }, influenceRow: { flexDirection: "row", justifyContent: "space-between" }, influenceText: { color: "#FFF", fontSize: 13, fontWeight: "900" }, track: { backgroundColor: "rgba(255,255,255,0.09)", borderRadius: 4, height: 6, marginTop: 5, overflow: "hidden" }, fill: { borderRadius: 4, height: 6 }, controller: { color: "#A1A1AA", fontSize: 11, fontWeight: "900", marginTop: 16, textTransform: "uppercase" }, reward: { color: "#E9D5FF", fontSize: 13, fontWeight: "900", marginTop: 10 }, warning: { color: "#FCD34D", fontWeight: "800", marginTop: 13 }, success: { color: "#6EE7B7", fontWeight: "900", marginTop: 13 }, encounterBlock: { marginTop: 14 }, requirement: { color: "#FFF", fontSize: 15, fontWeight: "900", lineHeight: 21 }, encounterProgress: { color: "#F0ABFC", fontSize: 31, fontWeight: "900", marginTop: 10 }, encounterActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, impactRow: { flexDirection: "row", gap: 36, marginTop: 10 }, impactValue: { color: "#FFF", fontSize: 30, fontWeight: "900" }, error: { backgroundColor: "rgba(127,29,29,0.3)", borderRadius: 8, color: "#FDA4AF", fontWeight: "700", marginTop: 16, padding: 10 }, modal: { backgroundColor: "#08050D", flex: 1, padding: 22, paddingTop: 52 }, closeButton: { alignSelf: "flex-end", padding: 8 }, closeText: { color: "#D8B4FE", fontWeight: "900" }, modalTitle: { color: "#FFF", fontSize: 24, fontWeight: "900", marginTop: 12 }, modalCopy: { color: "#D4D4D8", lineHeight: 20, marginTop: 8 }, qrBox: { alignItems: "center", alignSelf: "center", backgroundColor: "#FFF", borderRadius: 16, marginTop: 28, padding: 20 }, shortCode: { color: "#18181B", fontSize: 26, fontWeight: "900", letterSpacing: 5, marginTop: 18 }, refreshText: { color: "#52525B", fontSize: 11, fontWeight: "700", marginTop: 8 }, camera: { borderRadius: 14, height: 300, marginTop: 20, overflow: "hidden", width: "100%" }, torch: { alignItems: "center", borderColor: "#A855F7", borderRadius: 9, borderWidth: 1, marginTop: 10, padding: 11 }, torchActive: { backgroundColor: "#7E22CE" }, torchText: { color: "#FFF", fontWeight: "900" }, or: { color: "#A1A1AA", fontSize: 11, fontWeight: "900", marginVertical: 17, textAlign: "center" }, codeInput: { backgroundColor: "#18131F", borderColor: "#3F3F46", borderRadius: 9, borderWidth: 1, color: "#FFF", fontSize: 20, fontWeight: "900", letterSpacing: 4, marginBottom: 10, padding: 14, textAlign: "center" }, feedback: { color: "#FCD34D", fontWeight: "900", marginTop: 14, textAlign: "center" }, capture: { backgroundColor: "rgba(59,7,100,0.97)", borderColor: "rgba(240,171,252,0.55)", borderRadius: 14, borderWidth: 1, left: 18, padding: 18, position: "absolute", right: 18, top: 28, zIndex: 50 }, captureText: { color: "#FFF", fontSize: 17, fontWeight: "900", lineHeight: 25, textAlign: "center" },
});
