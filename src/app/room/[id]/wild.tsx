import { router, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-native-qrcode-svg";
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../../../lib/supabase";
import { beginWildSquad, completeWildMission, createWildEncounterToken, createWildSquadToken, enterWildGame, getMyWildSquadMissionState, getMyWildSquadState, getWildEncounterState, getWildMatchState, getWildRoomState, redeemWildEncounterToken, redeemWildSquadToken, wildFactionByKey, type WildEncounterState, type WildEncounterStatus, type WildMatchState, type WildRoomState, type WildSquadFormationStatus, type WildSquadMissionState, type WildSquadState } from "../../../../lib/wild";
import { claimMemoryMissionCompletion, verifyMemoryMissionCompletion } from "../../../../lib/roomMissions";
import { createGuestSession, ensurePartyUpIdentity, getOrCreateEventMatchPool, readStoredGuestSession } from "../../../lib/matchmaking";

const imageSizeLimit = 12 * 1024 * 1024;
const videoSizeLimit = 50 * 1024 * 1024;
const videoDurationLimitMs = 60 * 1000;

function formatCountdown(endsAt: string | null, now: number) {
  if (!endsAt) return "No time limit";
  const seconds = Math.ceil((Date.parse(endsAt) - now) / 1000);
  if (seconds <= 0) return "MISSION EXPIRED";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`;
}

const encounterMessages: Record<WildEncounterStatus, string> = {
  valid: "Verified encounter ✓", self_scan: "You can't scan yourself.", wrong_mission: "This code belongs to another Mission.", wrong_game: "This player isn't in this Wild game.", wrong_room: "This code belongs to another room.", wrong_faction: "This objective belongs to another faction.", wrong_animal: "That player is in another Animal Pack.", same_faction_required: "Find someone from your own faction.", different_faction_required: "Find someone from another faction.", specific_faction_required: "That player isn't in the required faction.", duplicate: "You've already verified with this player for this Mission.", expired: "That code expired. Ask them to refresh it.", mission_ended: "This Mission is no longer active.", game_ended: "The Wild has ended.", invalid: "That temporary Mission code isn't valid.",
};
const squadMessages: Record<WildSquadFormationStatus, string> = { ...encounterMessages, valid: "Squad verification accepted ✓", duplicate: "You already verified with this player for squad formation.", wrong_faction: "Squads can only include your faction.", already_in_squad: "That player already belongs to another squad.", squad_full: "This squad already has 5 members." };

export default function WildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const roomId = String(id ?? "");
  const [state, setState] = useState<WildRoomState | null>(null);
  const [busy, setBusy] = useState(false);
  const [memoryUploading, setMemoryUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<string | null>(null);
  const [encounterState, setEncounterState] = useState<WildEncounterState | null>(null);
  const [matchState, setMatchState] = useState<WildMatchState | null>(null);
  const [squad, setSquad] = useState<WildSquadState | null>(null);
  const [squadMissionState, setSquadMissionState] = useState<WildSquadMissionState | null>(null);
  const [squadMode, setSquadMode] = useState<"details" | "qr" | "scan">("details");
  const [squadToken, setSquadToken] = useState<{ qr_payload: string; short_code: string; expires_at: string } | null>(null);
  const [squadCode, setSquadCode] = useState("");
  const [squadFeedback, setSquadFeedback] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
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
  const scanLockedRef = useRef(false);
  const scanUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (next.assignment && next.game) setSquad(await getMyWildSquadState(supabase, next.game.id, token));
    else setSquad(null);
    if (next.assignment && next.mission?.config.scope === "squad") setSquadMissionState(await getMyWildSquadMissionState(supabase, next.mission.id, token));
    else setSquadMissionState(null);
    if (next.assignment && next.mission?.config.scope !== "squad" && next.mission?.config.verification_type === "encounter") {
      setEncounterState(await getWildEncounterState(supabase, next.mission.id, token));
    } else {
      setEncounterState(null);
      setEncounterMode("details");
    }
    if (next.assignment && next.mission?.config.scope !== "squad" && next.mission?.config.verification_type === "match_faction") {
      setMatchState(await getWildMatchState(supabase, next.mission.id, token));
    } else {
      setMatchState(null);
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
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_match_verifications" }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_squads" }, refreshGame)
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_squad_members" }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_squad_mission_completions" }, () => void load())
        .subscribe();
    };
    void subscribe();
    return () => { active = false; if (guestRefresh) clearInterval(guestRefresh); if (channel) void supabase.removeChannel(channel); };
  }, [load, roomId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!capture) return;
    const timer = setTimeout(() => setCapture(null), 3200);
    return () => clearTimeout(timer);
  }, [capture]);

  useEffect(() => () => {
    if (scanUnlockTimerRef.current) clearTimeout(scanUnlockTimerRef.current);
  }, []);

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

  const squadGameId = state?.game?.status === "active" && state.assignment ? state.game.id : null;
  useEffect(() => {
    if (squadMode !== "qr" || !squadGameId || squad?.can_add_members === false) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => {
      try {
        const token = await ensureGuestToken();
        await beginWildSquad(supabase, squadGameId, token);
        const next = await createWildSquadToken(supabase, squadGameId, token);
        if (cancelled) return;
        setSquadToken(next);
        refreshTimer = setTimeout(() => void refresh(), Math.max(5_000, Date.parse(next.expires_at) - Date.now() - 5_000));
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not create a temporary squad code."); }
    };
    void refresh();
    return () => { cancelled = true; if (refreshTimer) clearTimeout(refreshTimer); };
  }, [ensureGuestToken, squad?.can_add_members, squadGameId, squadMode]);

  async function startSquad() {
    if (!state?.game) return;
    setBusy(true); setError(null);
    try { const token = await ensureGuestToken(); await beginWildSquad(supabase, state.game.id, token); await load(token); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not begin squad formation."); }
    finally { setBusy(false); }
  }

  async function openSquadScanner() {
    if (scanUnlockTimerRef.current) clearTimeout(scanUnlockTimerRef.current);
    scanLockedRef.current = false;
    setSquadFeedback(null); setError(null); setScanLocked(false); setTorchEnabled(false);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) setError("Camera permission is required to scan a player QR. You can still enter their temporary code.");
    }
    setSquadMode("scan");
  }

  async function redeemSquad(value: string) {
    if (!state?.game || !value.trim() || scanLockedRef.current) return;
    scanLockedRef.current = true;
    let shouldUnlock = true;
    setBusy(true); setScanLocked(true); setError(null); setSquadFeedback(null);
    try {
      const token = await ensureGuestToken();
      const result = await redeemWildSquadToken(supabase, state.game.id, value.trim(), token);
      shouldUnlock = result.status !== "valid" && result.status !== "duplicate";
      setSquadFeedback(squadMessages[result.status]); setSquadCode(""); await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify this squad member."); }
    finally {
      setBusy(false);
      if (shouldUnlock) scanUnlockTimerRef.current = setTimeout(() => { scanLockedRef.current = false; scanUnlockTimerRef.current = null; setScanLocked(false); }, 1200);
    }
  }

  function closeSquadModal() {
    if (scanUnlockTimerRef.current) clearTimeout(scanUnlockTimerRef.current);
    scanUnlockTimerRef.current = null; scanLockedRef.current = false;
    setSquadMode("details"); setScanLocked(false); setTorchEnabled(false); setSquadCode("");
  }

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
    try {
      if (state.mission.config.verification_type === "memory_upload") {
        await claimMemoryMissionCompletion(supabase, state.mission.id);
        await load();
      } else {
        const token = await ensureGuestToken();
        await completeWildMission(supabase, state.mission.id, token);
        await load(token);
      }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete this Wild Mission."); }
    finally { setBusy(false); }
  }

  async function uploadMissionMemory() {
    if (!state?.mission || memoryUploading) return;
    setMemoryUploading(true); setError(null);
    let uploadedPath: string | null = null;
    let memoryCreated = false;
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Sign in to upload and verify a Mission Memory.");

      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) throw new Error("Allow photo library access to upload a Mission Memory.");
      const requiredType = state.mission.config.required_media_type ?? "any";
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        mediaTypes: requiredType === "image" ? ["images"] : requiredType === "video" ? ["videos"] : ["images", "videos"],
        quality: 0.85,
        videoMaxDuration: 60,
      });
      if (pickerResult.canceled || !pickerResult.assets.length) return;

      const asset = pickerResult.assets[0];
      const mediaType = asset.type === "image" ? "image" : asset.type === "video" ? "video" : null;
      if (!mediaType) throw new Error("Choose a photo or video.");
      if (requiredType !== "any" && mediaType !== requiredType) {
        throw new Error(requiredType === "image" ? "This Mission requires a photo." : "This Mission requires a video.");
      }
      const sizeLimit = mediaType === "image" ? imageSizeLimit : videoSizeLimit;
      if (asset.fileSize && asset.fileSize > sizeLimit) {
        throw new Error(mediaType === "image" ? "Photos must be 12 MB or smaller." : "Videos must be 50 MB or smaller.");
      }
      if (mediaType === "video" && asset.duration && asset.duration > videoDurationLimitMs) {
        throw new Error("Memories supports short clips up to 60 seconds.");
      }

      const identity = await ensurePartyUpIdentity();
      const fallbackName = mediaType === "image" ? "memory.jpg" : "memory.mp4";
      const cleanName = (asset.fileName || fallbackName).replace(/[^a-zA-Z0-9._-]/g, "-");
      uploadedPath = `${roomId}/${identity.id}/${Date.now()}-${cleanName}`;
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("Could not read the selected media file.");
      const { error: uploadError } = await supabase.storage.from("room-memories").upload(uploadedPath, await response.arrayBuffer(), {
        contentType: asset.mimeType || (mediaType === "image" ? "image/jpeg" : "video/mp4"),
        upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);

      const { data: memory, error: insertError } = await supabase.from("room_memories").insert({
        room_id: roomId,
        uploader_identity_id: identity.id,
        media_type: mediaType,
        media_path: uploadedPath,
      }).select("id").single<{ id: string }>();
      if (insertError) throw new Error(insertError.message);
      memoryCreated = true;

      await verifyMemoryMissionCompletion(supabase, state.mission.id, memory.id);
      Alert.alert(state.mission.config.scope === "squad" ? "Memory verified" : "Mission complete", state.mission.config.scope === "squad" ? "Your Memory was added to your squad's shared progress." : "Your Memory was verified and the influence reward was applied.");
      await load();
    } catch (reason) {
      if (uploadedPath && !memoryCreated) await supabase.storage.from("room-memories").remove([uploadedPath]);
      const detail = reason instanceof Error ? reason.message : "Could not upload this Memory.";
      setError(memoryCreated ? `Memory uploaded, but Mission verification failed: ${detail}` : detail);
    } finally {
      setMemoryUploading(false);
    }
  }

  async function openScanner() {
    if (scanUnlockTimerRef.current) clearTimeout(scanUnlockTimerRef.current);
    scanLockedRef.current = false;
    setEncounterFeedback(null); setError(null); setScanLocked(false); setTorchEnabled(false);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) { setError("Camera permission is required to scan a player QR. You can still enter their temporary code."); }
    }
    setEncounterMode("scan");
  }

  async function startEventMatch() {
    setBusy(true); setError(null);
    try {
      const pool = await getOrCreateEventMatchPool(roomId);
      router.push({ pathname: "/match", params: { pool: pool.poolId, roomId } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open this event's Match pool.");
      setBusy(false);
    }
  }

  function closeEncounterModal() {
    if (scanUnlockTimerRef.current) clearTimeout(scanUnlockTimerRef.current);
    scanUnlockTimerRef.current = null;
    scanLockedRef.current = false;
    setEncounterMode("details"); setScanLocked(false); setTorchEnabled(false); setManualCode("");
  }

  async function redeemEncounter(value: string) {
    if (!state?.mission || !value.trim() || scanLockedRef.current) return;
    scanLockedRef.current = true;
    let shouldUnlock = true;
    setBusy(true); setScanLocked(true); setError(null); setEncounterFeedback(null);
    try {
      const token = await ensureGuestToken();
      const result = await redeemWildEncounterToken(supabase, state.mission.id, value.trim(), token);
      shouldUnlock = result.status !== "valid" && result.status !== "duplicate";
      setEncounterFeedback(encounterMessages[result.status]);
      setManualCode("");
      await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify this encounter."); }
    finally {
      setBusy(false);
      if (shouldUnlock) {
        scanUnlockTimerRef.current = setTimeout(() => {
          scanLockedRef.current = false;
          scanUnlockTimerRef.current = null;
          setScanLocked(false);
        }, 1200);
      }
    }
  }

  const factions = state?.game?.config.factions ?? [];
  const winners = state?.game?.winner_summary?.winners ?? [];
  const assignmentScore = state?.assignment
    ? state.game?.winner_summary?.scores.find((score) => score.faction_key === state.assignment?.key) ?? null
    : null;
  const assignmentWon = Boolean(
    state?.assignment && winners.some((winner) => winner.faction_key === state.assignment?.key),
  );
  const encounterRequirement = state?.mission?.config.encounter_relationship === "same_faction" ? `Meet another ${state.assignment?.emoji ?? ""} ${state.assignment?.label ?? "faction"} player.` : state?.mission?.config.encounter_relationship === "different_faction" ? "Meet a player from another faction." : state?.mission?.config.encounter_relationship === "specific_faction" ? `Meet a ${state ? wildFactionByKey(state, state.mission.config.target_faction)?.emoji ?? "" : ""} ${state ? wildFactionByKey(state, state.mission.config.target_faction)?.label ?? "specific faction" : "specific faction"} player.` : null;
  const isSquadMission = state?.mission?.config.scope === "squad";
  const missionEligible = isSquadMission ? Boolean(squadMissionState?.eligible) : Boolean(state?.mission?.eligible);
  const missionCompleted = isSquadMission ? Boolean(squadMissionState?.completed) : Boolean(state?.mission?.viewer_completed);

  return <SafeAreaView style={styles.safe}><ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <TouchableOpacity onPress={() => router.replace(`/room/${roomId}`)}><Text style={styles.back}>← Back to room</Text></TouchableOpacity>
    <Text style={styles.present}>PARTYUP PRESENTS</Text><Text style={styles.hero}>INTO THE WILD</Text>
    {!state ? <Text style={styles.muted}>Loading the Wild…</Text> : !state.game ? <View style={styles.panel}><Text style={styles.title}>THE WILD IS QUIET</Text><Text style={styles.muted}>The host has not started Into the Wild.</Text></View> : <>
      {state.game.status === "ended" ? <View style={[styles.panel, styles.center]}><Text style={styles.present}>THE WILD HAS ENDED</Text><Text style={styles.winner}>{winners.length === 1 ? `${winners[0].emoji} ${winners[0].label.toUpperCase()} WINS` : winners.length ? `${winners.map((winner) => `${winner.emoji} ${winner.label}`).join(" + ")} TIE` : "CONTESTED"}</Text>{(state.game.winner_summary?.scores ?? []).map((score) => <Text key={score.faction_key} style={styles.score}>{score.emoji} {score.label}: {score.territories_controlled} territories · {score.total_influence} influence</Text>)}{state.assignment && <View style={[styles.finalFaction, assignmentWon && styles.finalFactionWinner]}><Text style={[styles.label, assignmentWon && styles.finalFactionWinnerLabel]}>{assignmentWon ? "YOUR FACTION WON" : "YOUR FACTION"}</Text><Text style={styles.finalFactionName}>{state.assignment.emoji} {state.assignment.label.toUpperCase()}</Text>{assignmentScore && <Text style={styles.finalFactionScore}>{assignmentScore.territories_controlled} {assignmentScore.territories_controlled === 1 ? "territory" : "territories"} controlled · {assignmentScore.total_influence} final influence</Text>}</View>}</View> : state.assignment ? <View style={styles.panel}><Text style={styles.label}>YOUR FACTION</Text><Text style={styles.faction}>{state.assignment.emoji} {state.assignment.label.toUpperCase()}</Text></View> : <View style={styles.panel}><Text style={styles.title}>Get your faction.</Text><Text style={styles.muted}>Complete Missions. Help your side take the map.</Text><TouchableOpacity style={styles.primary} disabled={busy || state.room_closed} onPress={() => void enter()}><Text style={styles.primaryText}>{busy ? "Entering…" : "Enter the Wild"}</Text></TouchableOpacity></View>}
      {state.assignment && <View style={styles.squadPanel}><Text style={styles.squadEyebrow}>{squad?.status === "active" || squad?.status === "ended" ? "YOUR SQUAD" : "FORM A SQUAD"}</Text>{squad ? <><Text style={styles.title}>{state.assignment.emoji} {squad.label}</Text><View style={styles.memberWrap}>{squad.members.map((member) => <Text key={member.identity_id} style={styles.memberChip}>{member.display_name}{member.is_you ? " (you)" : ""}</Text>)}</View><Text style={styles.muted}>{squad.member_count} {squad.member_count === 1 ? "member" : "members"}</Text>{squad.status === "provisional" && <Text style={styles.encounterProgress}>{squad.formation_progress} / 2</Text>}{squad.status === "active" && <Text style={styles.success}>SQUAD FORMED ✓</Text>}{squad.can_add_members && <View style={styles.encounterActions}><TouchableOpacity style={styles.secondaryButton} onPress={() => setSquadMode("qr")}><Text style={styles.primaryText}>Show My Code</Text></TouchableOpacity><TouchableOpacity style={styles.primary} onPress={() => void openSquadScanner()}><Text style={styles.primaryText}>Scan Player</Text></TouchableOpacity></View>}</> : state.game.status === "active" ? <><Text style={styles.title}>Find 2 other members of your faction.</Text><Text style={styles.encounterProgress}>0 / 2</Text><TouchableOpacity style={styles.primary} disabled={busy} onPress={() => void startSquad()}><Text style={styles.primaryText}>{busy ? "Starting…" : "Form a Squad"}</Text></TouchableOpacity></> : <Text style={styles.muted}>Final squad membership is read-only.</Text>}</View>}
      <View style={styles.territories}>{state.territories.map((territory) => { const controller = wildFactionByKey(state, territory.controlling_faction); const total = Object.values(territory.influence).reduce((sum, amount) => sum + amount, 0); return <View key={territory.id} style={styles.territory}><Text style={styles.territoryTitle}>{territory.display_name.toUpperCase()}</Text>{factions.map((faction) => { const amount = territory.influence[faction.key] ?? 0; return <View key={faction.key} style={styles.influenceBlock}><View style={styles.influenceRow}><Text style={styles.influenceText}>{faction.emoji} {faction.label}</Text><Text style={styles.influenceText}>{amount}</Text></View>{total > 0 && <View style={styles.track}><View style={[styles.fill, { width: `${(amount / total) * 100}%`, backgroundColor: faction.color ?? "#D946EF" }]} /></View>}</View>; })}<Text style={styles.controller}>{controller ? `Controlled by ${controller.emoji} ${controller.label}` : "Contested"}</Text></View>; })}</View>
      {state.assignment && state.game.status === "active" && <View style={styles.panel}>
        <Text style={styles.present}>YOUR MISSION</Text>
        {state.mission ? <>
          <Text style={styles.title}>{state.mission.title}</Text>
          {state.mission.description && <Text style={styles.muted}>{state.mission.description}</Text>}
          <Text style={styles.reward}>+{state.mission.config.influence_reward} influence · {state.territories.find((item) => item.key === state.mission?.config.territory_key)?.display_name}</Text>
          <Text style={styles.countdown}>{formatCountdown(state.mission.ends_at, now)}</Text>
          {isSquadMission && <View style={styles.squadMission}><Text style={styles.squadEyebrow}>SQUAD MISSION · AGGREGATE</Text>{squadMissionState?.eligible ? <><Text style={styles.encounterProgress}>{Math.min(squadMissionState.progress, squadMissionState.required_progress)} / {squadMissionState.required_progress}</Text><Text style={styles.muted}>Your contribution: {squadMissionState.personal_progress} verified {squadMissionState.personal_progress === 1 ? "action" : "actions"}</Text></> : <Text style={styles.warning}>Form an active 3–5 player squad in the eligible faction to contribute.</Text>}</View>}
          {state.mission.config.verification_type === "match_faction" ? <View style={styles.encounterBlock}>
            <Text style={styles.requirement}>Match with unique players from opposing factions.</Text>
            {!isSquadMission && (matchState?.eligible ? <Text style={styles.encounterProgress}>{Math.min(matchState.progress, matchState.required_matches)} / {matchState.required_matches}</Text> : <Text style={styles.warning}>This objective belongs to another faction.</Text>)}
            {(isSquadMission ? squadMissionState?.completed : matchState?.completed) ? <Text style={styles.success}>MISSION COMPLETE ✓ {isSquadMission ? "One squad reward awarded." : "Influence awarded."}</Text> : (isSquadMission ? squadMissionState?.eligible : matchState?.eligible) && <TouchableOpacity style={styles.primary} disabled={busy || !(isSquadMission ? squadMissionState?.mission_active : matchState?.mission_active)} onPress={() => void startEventMatch()}><Text style={styles.primaryText}>{busy ? "Opening Match…" : "Match with people here"}</Text></TouchableOpacity>}
          </View> : state.mission.config.verification_type === "memory_upload" ? <View style={styles.encounterBlock}>
            <Text style={styles.requirement}>Requirement: {state.mission.config.required_media_type === "image" ? "Upload a new photo." : state.mission.config.required_media_type === "video" ? "Upload a new video." : "Upload a new photo or video."}</Text>
            {!missionEligible ? <Text style={styles.warning}>{isSquadMission ? "An active eligible squad is required." : "This objective belongs to another faction."}</Text> : missionCompleted ? <Text style={styles.success}>MEMORY VERIFIED ✓ {isSquadMission ? "One squad reward awarded." : "Influence awarded."}</Text> : <View style={styles.encounterActions}>
              <TouchableOpacity style={styles.primary} disabled={memoryUploading || busy} onPress={() => void uploadMissionMemory()}><Text style={styles.primaryText}>{memoryUploading ? "Uploading…" : state.mission.config.required_media_type === "image" ? "Upload Photo" : state.mission.config.required_media_type === "video" ? "Upload Video" : "Upload Memory"}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} disabled={busy || memoryUploading} onPress={() => void complete()}><Text style={styles.primaryText}>{busy ? "Checking…" : "Complete Mission"}</Text></TouchableOpacity>
            </View>}
          </View> : state.mission.config.verification_type === "encounter" ? <View style={styles.encounterBlock}>
            <Text style={styles.requirement}>Requirement: {encounterRequirement}</Text>
            {!isSquadMission && (encounterState?.eligible ? <Text style={styles.encounterProgress}>{Math.min(encounterState.progress, encounterState.required_encounters)} / {encounterState.required_encounters}</Text> : <Text style={styles.warning}>You can help an eligible player by showing your QR.</Text>)}
            {(isSquadMission ? squadMissionState?.completed : encounterState?.completed) ? <Text style={styles.success}>VERIFIED ✓ {isSquadMission ? "One squad reward awarded." : "Influence awarded."}</Text> : <View style={styles.encounterActions}><TouchableOpacity style={styles.secondaryButton} onPress={() => setEncounterMode("qr")}><Text style={styles.primaryText}>Show My QR</Text></TouchableOpacity>{(isSquadMission ? squadMissionState?.eligible : encounterState?.eligible) && <TouchableOpacity style={styles.primary} onPress={() => void openScanner()}><Text style={styles.primaryText}>Scan Player</Text></TouchableOpacity>}</View>}
          </View> : state.mission.config.verification_type === "live_node" ? <View style={styles.encounterBlock}><Text style={styles.requirement}>Find and claim the active Live Node. Any squad member can complete this objective.</Text>{missionCompleted && <Text style={styles.success}>NODE CLAIMED ✓ One squad reward awarded.</Text>}</View> : !state.mission.eligible ? <Text style={styles.warning}>This objective belongs to another faction.</Text> : state.mission.viewer_completed ? <Text style={styles.success}>✓ Mission complete. Influence added.</Text> : <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => void complete()}><Text style={styles.primaryText}>{busy ? "Completing…" : "Complete Mission"}</Text></TouchableOpacity>}
        </> : <Text style={styles.muted}>No active Mission right now.</Text>}
      </View>}
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
    <Modal visible={squadMode === "qr"} animationType="slide" onRequestClose={closeSquadModal}>
      <View style={styles.modal}><TouchableOpacity style={styles.closeButton} onPress={closeSquadModal}><Text style={styles.closeText}>Close</Text></TouchableOpacity><Text style={styles.modalTitle}>SHOW MY SQUAD CODE</Text><Text style={styles.modalCopy}>A same-faction player can scan this temporary code to join your squad.</Text>{squadToken ? <View style={styles.qrBox}><QRCode value={squadToken.qr_payload} size={240} /><Text style={styles.shortCode}>{squadToken.short_code}</Text><Text style={styles.refreshText}>Refreshes every 60 seconds</Text></View> : <Text style={styles.muted}>Creating secure code…</Text>}</View>
    </Modal>
    <Modal visible={squadMode === "scan"} animationType="slide" onRequestClose={closeSquadModal}>
      <View style={styles.modal}><TouchableOpacity style={styles.closeButton} onPress={closeSquadModal}><Text style={styles.closeText}>Close</Text></TouchableOpacity><Text style={styles.modalTitle}>VERIFY A SQUAD MEMBER</Text><Text style={styles.modalCopy}>Only a player in your active Wild game, room, and faction can join.</Text>{permission?.granted ? <><CameraView style={styles.camera} facing="back" enableTorch={torchEnabled} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanLocked ? undefined : ({ data }) => void redeemSquad(data)} /><TouchableOpacity style={[styles.torch, torchEnabled && styles.torchActive]} onPress={() => setTorchEnabled((value) => !value)}><Text style={styles.torchText}>{torchEnabled ? "Turn Flashlight Off" : "Turn Flashlight On"}</Text></TouchableOpacity></> : <TouchableOpacity style={styles.primary} onPress={() => void openSquadScanner()}><Text style={styles.primaryText}>Allow Camera</Text></TouchableOpacity>}<Text style={styles.or}>OR ENTER THEIR TEMPORARY CODE</Text><TextInput value={squadCode} onChangeText={(value) => setSquadCode(value.toUpperCase())} autoCapitalize="characters" maxLength={64} placeholder="F7K2A1B9" placeholderTextColor="#71717A" style={styles.codeInput} /><TouchableOpacity style={styles.primaryWide} disabled={busy || !squadCode.trim()} onPress={() => void redeemSquad(squadCode)}><Text style={styles.primaryText}>{busy ? "Checking…" : "Verify Squad Member"}</Text></TouchableOpacity>{squadFeedback && <Text style={[styles.feedback, squadFeedback.includes("✓") && styles.success]}>{squadFeedback}</Text>}{error && <Text style={styles.error}>{error}</Text>}</View>
    </Modal>
    {capture && <View pointerEvents="none" style={styles.capture}><Text style={styles.captureText}>{capture}</Text></View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: "#08050D", flex: 1 }, page: { flex: 1 }, content: { padding: 18, paddingBottom: 50 }, back: { color: "#D8B4FE", fontWeight: "900" }, present: { color: "#F0ABFC", fontSize: 11, fontWeight: "900", letterSpacing: 2.5, marginTop: 24 }, hero: { color: "#FFF", fontSize: 42, fontWeight: "900", marginTop: 5 }, panel: { backgroundColor: "rgba(0,0,0,0.36)", borderColor: "rgba(255,255,255,0.1)", borderRadius: 15, borderWidth: 1, marginTop: 18, padding: 17 }, center: { alignItems: "center" }, title: { color: "#FFF", fontSize: 21, fontWeight: "900", marginTop: 8 }, muted: { color: "#A1A1AA", fontSize: 13, lineHeight: 19, marginTop: 5 }, label: { color: "#A1A1AA", fontSize: 11, fontWeight: "900" }, faction: { color: "#FFF", fontSize: 29, fontWeight: "900", marginTop: 6 }, winner: { color: "#FFF", fontSize: 27, fontWeight: "900", marginTop: 12, textAlign: "center" }, score: { color: "#D4D4D8", fontSize: 12, fontWeight: "700", marginTop: 7, textAlign: "center" }, finalFaction: { alignItems: "center", alignSelf: "stretch", backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", borderRadius: 12, borderWidth: 1, marginTop: 20, padding: 15 }, finalFactionWinner: { backgroundColor: "rgba(16,185,129,0.1)", borderColor: "rgba(110,231,183,0.35)" }, finalFactionWinnerLabel: { color: "#6EE7B7" }, finalFactionName: { color: "#FFFFFF", fontSize: 21, fontWeight: "900", marginTop: 7 }, finalFactionScore: { color: "#D4D4D8", fontSize: 12, fontWeight: "700", marginTop: 6, textAlign: "center" }, primary: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#C026D3", borderRadius: 9, justifyContent: "center", marginTop: 14, minHeight: 46, paddingHorizontal: 18 }, primaryWide: { alignItems: "center", backgroundColor: "#C026D3", borderRadius: 9, justifyContent: "center", minHeight: 48, paddingHorizontal: 18 }, primaryText: { color: "#FFF", fontWeight: "900" }, secondaryButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#7E22CE", borderRadius: 9, justifyContent: "center", marginTop: 14, minHeight: 46, paddingHorizontal: 18 }, territories: { gap: 12, marginTop: 18 }, territory: { backgroundColor: "#120C1B", borderColor: "rgba(196,181,253,0.22)", borderRadius: 15, borderWidth: 1, padding: 17 }, territoryTitle: { color: "#FFF", fontSize: 20, fontWeight: "900" }, influenceBlock: { marginTop: 11 }, influenceRow: { flexDirection: "row", justifyContent: "space-between" }, influenceText: { color: "#FFF", fontSize: 13, fontWeight: "900" }, track: { backgroundColor: "rgba(255,255,255,0.09)", borderRadius: 4, height: 6, marginTop: 5, overflow: "hidden" }, fill: { borderRadius: 4, height: 6 }, controller: { color: "#A1A1AA", fontSize: 11, fontWeight: "900", marginTop: 16, textTransform: "uppercase" }, reward: { color: "#E9D5FF", fontSize: 13, fontWeight: "900", marginTop: 10 }, countdown: { color: "#D4D4D8", fontSize: 13, fontWeight: "900", marginTop: 7 }, warning: { color: "#FCD34D", fontWeight: "800", marginTop: 13 }, success: { color: "#6EE7B7", fontWeight: "900", marginTop: 13 }, encounterBlock: { marginTop: 14 }, requirement: { color: "#FFF", fontSize: 15, fontWeight: "900", lineHeight: 21 }, encounterProgress: { color: "#F0ABFC", fontSize: 31, fontWeight: "900", marginTop: 10 }, encounterActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, impactRow: { flexDirection: "row", gap: 36, marginTop: 10 }, impactValue: { color: "#FFF", fontSize: 30, fontWeight: "900" }, error: { backgroundColor: "rgba(127,29,29,0.3)", borderRadius: 8, color: "#FDA4AF", fontWeight: "700", marginTop: 16, padding: 10 }, modal: { backgroundColor: "#08050D", flex: 1, padding: 22, paddingTop: 52 }, closeButton: { alignSelf: "flex-end", padding: 8 }, closeText: { color: "#D8B4FE", fontWeight: "900" }, modalTitle: { color: "#FFF", fontSize: 24, fontWeight: "900", marginTop: 12 }, modalCopy: { color: "#D4D4D8", lineHeight: 20, marginTop: 8 }, qrBox: { alignItems: "center", alignSelf: "center", backgroundColor: "#FFF", borderRadius: 16, marginTop: 28, padding: 20 }, shortCode: { color: "#18181B", fontSize: 26, fontWeight: "900", letterSpacing: 5, marginTop: 18 }, refreshText: { color: "#52525B", fontSize: 11, fontWeight: "700", marginTop: 8 }, camera: { borderRadius: 14, height: 300, marginTop: 20, overflow: "hidden", width: "100%" }, torch: { alignItems: "center", borderColor: "#A855F7", borderRadius: 9, borderWidth: 1, marginTop: 10, padding: 11 }, torchActive: { backgroundColor: "#7E22CE" }, torchText: { color: "#FFF", fontWeight: "900" }, or: { color: "#A1A1AA", fontSize: 11, fontWeight: "900", marginVertical: 17, textAlign: "center" }, codeInput: { backgroundColor: "#18131F", borderColor: "#3F3F46", borderRadius: 9, borderWidth: 1, color: "#FFF", fontSize: 20, fontWeight: "900", letterSpacing: 4, marginBottom: 10, padding: 14, textAlign: "center" }, feedback: { color: "#FCD34D", fontWeight: "900", marginTop: 14, textAlign: "center" }, capture: { backgroundColor: "rgba(59,7,100,0.97)", borderColor: "rgba(240,171,252,0.55)", borderRadius: 14, borderWidth: 1, left: 18, padding: 18, position: "absolute", right: 18, top: 28, zIndex: 50 }, captureText: { color: "#FFF", fontSize: 17, fontWeight: "900", lineHeight: 25, textAlign: "center" },
  squadPanel: { backgroundColor: "rgba(6,78,59,0.18)", borderColor: "rgba(110,231,183,0.25)", borderRadius: 15, borderWidth: 1, marginTop: 18, padding: 17 }, squadEyebrow: { color: "#6EE7B7", fontSize: 11, fontWeight: "900", letterSpacing: 2 }, memberWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11 }, memberChip: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 999, color: "#FFF", fontSize: 12, fontWeight: "800", paddingHorizontal: 10, paddingVertical: 6 }, squadMission: { backgroundColor: "rgba(6,78,59,0.18)", borderColor: "rgba(110,231,183,0.2)", borderRadius: 10, borderWidth: 1, marginTop: 13, padding: 12 },
});
