import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../../../lib/supabase";
import { completeWildMission, enterWildGame, getWildRoomState, wildFactionByKey, type WildRoomState } from "../../../../lib/wild";
import { createGuestSession, readStoredGuestSession } from "../../../lib/matchmaking";

export default function WildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const roomId = String(id ?? "");
  const [state, setState] = useState<WildRoomState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<string | null>(null);
  const gameIdRef = useRef<string | null>(null);
  const controllersRef = useRef<Record<string, string | null>>({});
  const loadedRef = useRef(false);

  const load = useCallback(async (guestToken?: string | null) => {
    const next = await getWildRoomState(supabase, roomId, guestToken ?? (await readStoredGuestSession())?.guestToken ?? null);
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

  async function ensureGuestToken() {
    const { data } = await supabase.auth.getUser();
    let token = (await readStoredGuestSession())?.guestToken ?? null;
    if (!data.user && !token) token = (await createGuestSession()).guestToken;
    return token;
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
    try { const token = await ensureGuestToken(); await completeWildMission(supabase, state.mission.id, token); await load(token); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete this Wild Mission."); }
    finally { setBusy(false); }
  }

  const factions = state?.game?.config.factions ?? [];
  const winners = state?.game?.winner_summary?.winners ?? [];

  return <SafeAreaView style={styles.safe}><ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back to room</Text></TouchableOpacity>
    <Text style={styles.present}>PARTYUP PRESENTS</Text><Text style={styles.hero}>INTO THE WILD</Text>
    {!state ? <Text style={styles.muted}>Loading the Wild…</Text> : !state.game ? <View style={styles.panel}><Text style={styles.title}>THE WILD IS QUIET</Text><Text style={styles.muted}>The host has not started Into the Wild.</Text></View> : <>
      {state.game.status === "ended" ? <View style={[styles.panel, styles.center]}><Text style={styles.present}>THE WILD HAS ENDED</Text><Text style={styles.winner}>{winners.length === 1 ? `${winners[0].emoji} ${winners[0].label.toUpperCase()} WINS` : winners.length ? `${winners.map((winner) => `${winner.emoji} ${winner.label}`).join(" + ")} TIE` : "CONTESTED"}</Text>{(state.game.winner_summary?.scores ?? []).map((score) => <Text key={score.faction_key} style={styles.score}>{score.emoji} {score.label}: {score.territories_controlled} territories · {score.total_influence} influence</Text>)}</View> : state.assignment ? <View style={styles.panel}><Text style={styles.label}>YOUR FACTION</Text><Text style={styles.faction}>{state.assignment.emoji} {state.assignment.label.toUpperCase()}</Text></View> : <View style={styles.panel}><Text style={styles.title}>Get your faction.</Text><Text style={styles.muted}>Complete Missions. Help your side take the map.</Text><TouchableOpacity style={styles.primary} disabled={busy || state.room_closed} onPress={() => void enter()}><Text style={styles.primaryText}>{busy ? "Entering…" : "Enter the Wild"}</Text></TouchableOpacity></View>}
      <View style={styles.territories}>{state.territories.map((territory) => { const controller = wildFactionByKey(state, territory.controlling_faction); const total = Object.values(territory.influence).reduce((sum, amount) => sum + amount, 0); return <View key={territory.id} style={styles.territory}><Text style={styles.territoryTitle}>{territory.display_name.toUpperCase()}</Text>{factions.map((faction) => { const amount = territory.influence[faction.key] ?? 0; return <View key={faction.key} style={styles.influenceBlock}><View style={styles.influenceRow}><Text style={styles.influenceText}>{faction.emoji} {faction.label}</Text><Text style={styles.influenceText}>{amount}</Text></View>{total > 0 && <View style={styles.track}><View style={[styles.fill, { width: `${(amount / total) * 100}%`, backgroundColor: faction.color ?? "#D946EF" }]} /></View>}</View>; })}<Text style={styles.controller}>{controller ? `Controlled by ${controller.emoji} ${controller.label}` : "Contested"}</Text></View>; })}</View>
      {state.assignment && state.game.status === "active" && <View style={styles.panel}><Text style={styles.present}>YOUR MISSION</Text>{state.mission ? <><Text style={styles.title}>{state.mission.title}</Text>{state.mission.description && <Text style={styles.muted}>{state.mission.description}</Text>}<Text style={styles.reward}>+{state.mission.config.influence_reward} influence · {state.territories.find((item) => item.key === state.mission?.config.territory_key)?.display_name}</Text>{!state.mission.eligible ? <Text style={styles.warning}>This objective belongs to another faction.</Text> : state.mission.viewer_completed ? <Text style={styles.success}>✓ Mission complete. Influence added.</Text> : <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => void complete()}><Text style={styles.primaryText}>{busy ? "Completing…" : "Complete Mission"}</Text></TouchableOpacity>}</> : <Text style={styles.muted}>No active Mission right now.</Text>}</View>}
      {state.assignment && <View style={styles.panel}><Text style={styles.present}>YOUR IMPACT</Text><View style={styles.impactRow}><View><Text style={styles.impactValue}>{state.impact.missions_completed}</Text><Text style={styles.muted}>Missions completed</Text></View><View><Text style={styles.impactValue}>+{state.impact.influence_added}</Text><Text style={styles.muted}>Influence added</Text></View></View></View>}
    </>}
    {error && <Text style={styles.error}>{error}</Text>}
  </ScrollView>{capture && <View pointerEvents="none" style={styles.capture}><Text style={styles.captureText}>{capture}</Text></View>}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: "#08050D", flex: 1 }, page: { flex: 1 }, content: { padding: 18, paddingBottom: 50 }, back: { color: "#D8B4FE", fontWeight: "900" }, present: { color: "#F0ABFC", fontSize: 11, fontWeight: "900", letterSpacing: 2.5, marginTop: 24 }, hero: { color: "#FFF", fontSize: 42, fontWeight: "900", marginTop: 5 }, panel: { backgroundColor: "rgba(0,0,0,0.36)", borderColor: "rgba(255,255,255,0.1)", borderRadius: 15, borderWidth: 1, marginTop: 18, padding: 17 }, center: { alignItems: "center" }, title: { color: "#FFF", fontSize: 21, fontWeight: "900", marginTop: 8 }, muted: { color: "#A1A1AA", fontSize: 13, lineHeight: 19, marginTop: 5 }, label: { color: "#A1A1AA", fontSize: 11, fontWeight: "900" }, faction: { color: "#FFF", fontSize: 29, fontWeight: "900", marginTop: 6 }, winner: { color: "#FFF", fontSize: 27, fontWeight: "900", marginTop: 12, textAlign: "center" }, score: { color: "#D4D4D8", fontSize: 12, fontWeight: "700", marginTop: 7, textAlign: "center" }, primary: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#C026D3", borderRadius: 9, justifyContent: "center", marginTop: 14, minHeight: 46, paddingHorizontal: 18 }, primaryText: { color: "#FFF", fontWeight: "900" }, territories: { gap: 12, marginTop: 18 }, territory: { backgroundColor: "#120C1B", borderColor: "rgba(196,181,253,0.22)", borderRadius: 15, borderWidth: 1, padding: 17 }, territoryTitle: { color: "#FFF", fontSize: 20, fontWeight: "900" }, influenceBlock: { marginTop: 11 }, influenceRow: { flexDirection: "row", justifyContent: "space-between" }, influenceText: { color: "#FFF", fontSize: 13, fontWeight: "900" }, track: { backgroundColor: "rgba(255,255,255,0.09)", borderRadius: 4, height: 6, marginTop: 5, overflow: "hidden" }, fill: { borderRadius: 4, height: 6 }, controller: { color: "#A1A1AA", fontSize: 11, fontWeight: "900", marginTop: 16, textTransform: "uppercase" }, reward: { color: "#E9D5FF", fontSize: 13, fontWeight: "900", marginTop: 10 }, warning: { color: "#FCD34D", fontWeight: "800", marginTop: 13 }, success: { color: "#6EE7B7", fontWeight: "900", marginTop: 13 }, impactRow: { flexDirection: "row", gap: 36, marginTop: 10 }, impactValue: { color: "#FFF", fontSize: 30, fontWeight: "900" }, error: { backgroundColor: "rgba(127,29,29,0.3)", borderRadius: 8, color: "#FDA4AF", fontWeight: "700", marginTop: 16, padding: 10 }, capture: { backgroundColor: "rgba(59,7,100,0.97)", borderColor: "rgba(240,171,252,0.55)", borderRadius: 14, borderWidth: 1, left: 18, padding: 18, position: "absolute", right: 18, top: 28, zIndex: 50 }, captureText: { color: "#FFF", fontSize: 17, fontWeight: "900", lineHeight: 25, textAlign: "center" },
});
