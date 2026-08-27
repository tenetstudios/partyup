import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { getRoomLiveNodes, type LiveNode } from "../../lib/liveNodes";
import { endWildGame, getWildEncounterState, getWildMatchState, getWildRoomState, getWildSquadsOverview, publishWildMission, startWildGame, type WildEncounterState, type WildMatchState, type WildRoomState, type WildSquadOverview } from "../../lib/wild";

export default function WildHostManager({ roomId, roomEnded = false }: { roomId: string; roomEnded?: boolean }) {
  const [state, setState] = useState<WildRoomState | null>(null);
  const [faction, setFaction] = useState("all");
  const [territory, setTerritory] = useState("grove");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("10");
  const [duration, setDuration] = useState("10");
  const [scope, setScope] = useState<"faction" | "squad">("faction");
  const [verification, setVerification] = useState<"none" | "same_faction" | "different_faction" | "specific_faction" | "memory_upload" | "match_faction" | "live_node" | "form_squad">("none");
  const [requiredEncounters, setRequiredEncounters] = useState("1");
  const [targetFaction, setTargetFaction] = useState("pack");
  const [requiredMediaType, setRequiredMediaType] = useState<"any" | "image" | "video">("any");
  const [requiredMatches, setRequiredMatches] = useState("2");
  const [requiredProgress, setRequiredProgress] = useState("3");
  const [liveNodes, setLiveNodes] = useState<LiveNode[]>([]);
  const [liveNodeId, setLiveNodeId] = useState("");
  const [encounterAnalytics, setEncounterAnalytics] = useState<WildEncounterState | null>(null);
  const [matchAnalytics, setMatchAnalytics] = useState<WildMatchState | null>(null);
  const [squads, setSquads] = useState<WildSquadOverview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gameIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const next = await getWildRoomState(supabase, roomId);
    gameIdRef.current = next.game?.id ?? null;
    setState(next);
    const nodes = (await getRoomLiveNodes(supabase, roomId)).filter((node) => node.status === "active");
    setLiveNodes(nodes);
    setLiveNodeId((current) => current || nodes[0]?.id || "");
    setSquads(next.game ? await getWildSquadsOverview(supabase, next.game.id) : []);
    if (next.mission?.config.verification_type === "encounter") {
      setEncounterAnalytics(await getWildEncounterState(supabase, next.mission.id));
    } else {
      setEncounterAnalytics(null);
    }
    if (next.mission?.config.verification_type === "match_faction") {
      setMatchAnalytics(await getWildMatchState(supabase, next.mission.id));
    } else {
      setMatchAnalytics(null);
    }
  }, [roomId]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load Into the Wild."));
    const subscribe = async () => {
      const channelName = `mobile-wild-host-${roomId}`;
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
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_encounters" }, refreshGame)
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_match_verifications" }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_squads" }, refreshGame)
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_squad_members" }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_squad_mission_completions" }, () => void load())
        .subscribe();
    };
    void subscribe();
    return () => { active = false; if (channel) void supabase.removeChannel(channel); };
  }, [load, roomId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Wild operation failed."); }
    finally { setBusy(false); }
  }

  const game = state?.game;
  const factions = game?.config.factions ?? [];
  return <View style={styles.card}>
    <Text style={styles.eyebrow}>INTO THE WILD</Text><Text style={styles.heading}>Night 1 controls</Text><Text style={styles.copy}>Three factions. Three territories. One shared room game.</Text>
    {error && <Text style={styles.error}>{error}</Text>}
    {!game ? <TouchableOpacity style={styles.primary} disabled={busy || roomEnded} onPress={() => void run(() => startWildGame(supabase, roomId))}><Text style={styles.primaryText}>{busy ? "Starting…" : "Start Into the Wild"}</Text></TouchableOpacity> : <>
      <View style={styles.row}>{(state?.populations ?? []).map((item) => <View key={item.faction_key} style={styles.stat}><Text style={styles.statTitle}>{item.emoji} {item.label}</Text><Text style={styles.statCopy}>{item.population} players</Text></View>)}</View>
      {squads.length > 0 && <View style={styles.preview}><Text style={styles.analytics}>SQUADS</Text>{squads.map((squad) => <Text key={squad.id} style={styles.previewText}>{factions.find((item) => item.key === squad.faction_key)?.emoji} {squad.member_count} members · {squad.status} · {squad.missions_completed} complete</Text>)}</View>}
      <View style={styles.territories}>{state?.territories.map((item) => { const controller = factions.find((candidate) => candidate.key === item.controlling_faction); return <View key={item.id} style={styles.territory}><Text style={styles.statTitle}>{item.display_name}</Text><Text style={styles.statCopy}>{controller ? `${controller.emoji} ${controller.label}` : "Contested"}</Text></View>; })}</View>
      {game.status === "active" && !roomEnded && <View style={styles.form}>
        {state?.mission?.config.verification_type === "encounter" && <Text style={styles.analytics}>Active verified encounters: {encounterAnalytics?.verified_encounter_count ?? 0}</Text>}
        {state?.mission?.config.verification_type === "match_faction" && <Text style={styles.analytics}>Active verified opposing Matches: {matchAnalytics?.verified_match_count ?? 0}</Text>}
        <Text style={styles.label}>Target scope</Text><View style={styles.row}>{([['faction','Individual / faction'],['squad','Squad']] as const).map(([value,label]) => <TouchableOpacity key={value} style={[styles.choice, scope === value && styles.choiceActive]} onPress={() => { setScope(value); if (value === "squad" && verification === "none") setVerification("match_faction"); if (value === "faction" && (verification === "live_node" || verification === "form_squad")) setVerification("none"); }}><Text style={styles.choiceText}>{label}</Text></TouchableOpacity>)}</View>
        <Text style={styles.label}>Faction</Text><View style={styles.row}><TouchableOpacity style={[styles.choice, faction === "all" && styles.choiceActive]} onPress={() => setFaction("all")}><Text style={styles.choiceText}>All</Text></TouchableOpacity>{factions.map((item) => <TouchableOpacity key={item.key} style={[styles.choice, faction === item.key && styles.choiceActive]} onPress={() => setFaction(item.key)}><Text style={styles.choiceText}>{item.emoji} {item.label}</Text></TouchableOpacity>)}</View>
        <Text style={styles.label}>Territory</Text><View style={styles.row}>{state?.territories.map((item) => <TouchableOpacity key={item.key} style={[styles.choice, territory === item.key && styles.choiceActive]} onPress={() => setTerritory(item.key)}><Text style={styles.choiceText}>{item.display_name}</Text></TouchableOpacity>)}</View>
        <Text style={styles.label}>Mission title</Text><TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="Find another member of your faction" placeholderTextColor="#71717A" style={styles.input} />
        <Text style={styles.label}>Description</Text><TextInput value={description} onChangeText={setDescription} maxLength={1000} multiline style={[styles.input, styles.multiline]} />
        <View style={styles.row}><View style={styles.field}><Text style={styles.label}>Influence</Text><TextInput value={reward} onChangeText={(value) => setReward(value.replace(/\D/g, ""))} keyboardType="number-pad" style={styles.input} /></View><View style={styles.field}><Text style={styles.label}>Minutes</Text><TextInput value={duration} onChangeText={(value) => setDuration(value.replace(/\D/g, ""))} keyboardType="number-pad" style={styles.input} /></View></View>
        <Text style={styles.label}>Mission type</Text><View style={styles.row}>{([...(scope === "faction" ? [['none','Manual'] as const] : [['form_squad','Form a squad'] as const]),['same_faction','Same faction'] as const,['different_faction','Different faction'] as const,['specific_faction','Specific faction'] as const,['memory_upload','Memory upload'] as const,['match_faction','Match opponents'] as const,...(scope === "squad" ? [['live_node','Live Node'] as const] : [])]).map(([value,label]) => <TouchableOpacity key={value} style={[styles.choice, verification === value && styles.choiceActive]} onPress={() => { setVerification(value); if (value === "form_squad") { setScope("squad"); setRequiredProgress("1"); } if (value === "match_faction") { setRequiredMatches("2"); setDuration("20"); } if (value === "live_node") setRequiredProgress("1"); }}><Text style={styles.choiceText}>{label}</Text></TouchableOpacity>)}</View>
        {scope === "squad" && verification !== "form_squad" && <><Text style={styles.label}>Required aggregate progress</Text><TextInput value={requiredProgress} onChangeText={(value) => setRequiredProgress(value.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={2} style={styles.input} /></>}
        {verification === "live_node" && <><Text style={styles.label}>Active Live Node</Text><View style={styles.row}>{liveNodes.map((node) => <TouchableOpacity key={node.id} style={[styles.choice, liveNodeId === node.id && styles.choiceActive]} onPress={() => setLiveNodeId(node.id)}><Text style={styles.choiceText}>{node.name}</Text></TouchableOpacity>)}</View>{liveNodes.length === 0 && <Text style={styles.previewText}>Activate a Live Node first.</Text>}</>}
        {verification === "form_squad" ? <View style={styles.preview}><Text style={styles.previewText}>Players in the selected faction must form a new 3–5 player squad while this Mission is active. Each newly formed squad awards the configured influence once.</Text></View> : verification === "memory_upload" ? <><Text style={styles.label}>Required media</Text><View style={styles.row}>{([['any','Photo or video'],['image','Photo'],['video','Video']] as const).map(([value,label]) => <TouchableOpacity key={value} style={[styles.choice, requiredMediaType === value && styles.choiceActive]} onPress={() => setRequiredMediaType(value)}><Text style={styles.choiceText}>{label}</Text></TouchableOpacity>)}</View><View style={styles.preview}><Text style={styles.previewText}>Participants must post a new Room Memory while the Mission is active before influence can be awarded.</Text></View></> : verification === "match_faction" ? <><Text style={styles.label}>Required unique opponents</Text><TextInput value={requiredMatches} onChangeText={(value) => setRequiredMatches(value.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={2} style={styles.input} /><View style={styles.preview}><Text style={styles.previewText}>Real room-specific PartyUp Matches with unique opposing-faction players count automatically. Global Match and repeat opponents do not count.</Text></View></> : verification === "live_node" ? <View style={styles.preview}><Text style={styles.previewText}>Any eligible squad member can claim the selected Node.</Text></View> : verification !== "none" && <><Text style={styles.label}>Required unique encounters</Text><View style={styles.row}>{[1,2,3].map((count) => <TouchableOpacity key={count} style={[styles.choice, requiredEncounters === String(count) && styles.choiceActive]} onPress={() => setRequiredEncounters(String(count))}><Text style={styles.choiceText}>{count}</Text></TouchableOpacity>)}</View>{verification === "specific_faction" && <><Text style={styles.label}>Target faction</Text><View style={styles.row}>{factions.map((item) => <TouchableOpacity key={item.key} style={[styles.choice, targetFaction === item.key && styles.choiceActive]} onPress={() => setTargetFaction(item.key)}><Text style={styles.choiceText}>{item.emoji} {item.label}</Text></TouchableOpacity>)}</View></>}<View style={styles.preview}><Text style={styles.previewText}>Participants must exchange a temporary PartyUp QR/code with {verification === "same_faction" ? "another player in their faction" : verification === "different_faction" ? "a player from another faction" : `a ${factions.find((item) => item.key === targetFaction)?.label ?? "target faction"} player`} before influence can be awarded.</Text></View></>}
        <TouchableOpacity style={styles.primary} disabled={busy || !title.trim() || (verification === "live_node" && !liveNodeId)} onPress={() => void run(() => publishWildMission(supabase, { gameId: game.id, factionKey: faction, territoryKey: territory, title, description, influenceReward: Number(reward), durationMinutes: Number(duration), scope, verificationType: verification === "form_squad" ? "form_squad" : verification === "memory_upload" ? "memory_upload" : verification === "match_faction" ? "match_faction" : verification === "live_node" ? "live_node" : verification === "none" ? "none" : "encounter", encounterRelationship: verification === "same_faction" || verification === "different_faction" || verification === "specific_faction" ? verification : null, requiredEncounters: Number(requiredEncounters), targetFaction: verification === "specific_faction" ? targetFaction : null, requiredMediaType, requiredMatches: Number(requiredMatches), requiredProgress: verification === "form_squad" ? 1 : Number(requiredProgress), liveNodeId: verification === "live_node" ? liveNodeId : null }))}><Text style={styles.primaryText}>Launch Mission</Text></TouchableOpacity>
        <TouchableOpacity style={styles.end} disabled={busy} onPress={() => Alert.alert("End Into the Wild?", "The winner will be calculated and no more influence can be earned.", [{ text: "Cancel", style: "cancel" }, { text: "End Wild", style: "destructive", onPress: () => void run(() => endWildGame(supabase, game.id)) }])}><Text style={styles.endText}>End Wild</Text></TouchableOpacity>
      </View>}
      {game.status === "ended" && <View><Text style={styles.ended}>The Wild has ended. {(game.winner_summary?.winners ?? []).map((winner) => `${winner.emoji} ${winner.label}`).join(" + ") || "No faction"} won.</Text><TouchableOpacity style={styles.end} onPress={() => router.push(`/room/${roomId}/wild`)}><Text style={styles.endText}>View final result</Text></TouchableOpacity>{!roomEnded && <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => void run(() => startWildGame(supabase, roomId))}><Text style={styles.primaryText}>Start another Wild</Text></TouchableOpacity>}</View>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "rgba(74,20,105,0.2)", borderColor: "rgba(232,121,249,0.28)", borderRadius: 14, borderWidth: 1, marginTop: 18, padding: 16 },
  eyebrow: { color: "#F0ABFC", fontSize: 11, fontWeight: "900", letterSpacing: 2.2 }, heading: { color: "#FFF", fontSize: 22, fontWeight: "900", marginTop: 6 }, copy: { color: "#A1A1AA", fontSize: 13, marginTop: 4 }, error: { color: "#FDA4AF", marginTop: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }, stat: { backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 9, minWidth: 95, padding: 10 }, statTitle: { color: "#FFF", fontWeight: "900" }, statCopy: { color: "#A1A1AA", fontSize: 12, marginTop: 3 }, territories: { gap: 8, marginTop: 12 }, territory: { backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 9, padding: 10 },
  form: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1, marginTop: 18, paddingTop: 14 }, analytics: { color: "#F0ABFC", fontSize: 13, fontWeight: "900" }, label: { color: "#E9D5FF", fontSize: 13, fontWeight: "900", marginTop: 12 }, choice: { backgroundColor: "#181425", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 }, choiceActive: { backgroundColor: "#7E22CE" }, choiceText: { color: "#FFF", fontSize: 12, fontWeight: "800" }, input: { backgroundColor: "#09070D", borderRadius: 8, color: "#FFF", marginTop: 6, minHeight: 44, paddingHorizontal: 12 }, multiline: { minHeight: 76, paddingTop: 12, textAlignVertical: "top" }, field: { flex: 1, minWidth: 100 }, preview: { backgroundColor: "rgba(74,20,105,0.35)", borderColor: "rgba(240,171,252,0.2)", borderRadius: 8, borderWidth: 1, marginTop: 12, padding: 10 }, previewText: { color: "#FAE8FF", fontSize: 12, lineHeight: 18 },
  primary: { alignItems: "center", alignSelf: "center", backgroundColor: "#C026D3", borderColor: "#E879F9", borderRadius: 999, borderWidth: 1, justifyContent: "center", marginTop: 16, maxWidth: 320, minHeight: 48, paddingHorizontal: 18, width: "100%" }, primaryText: { color: "#FFF", fontWeight: "900", textAlign: "center" }, end: { alignItems: "center", alignSelf: "center", backgroundColor: "rgba(127,29,29,0.18)", borderColor: "rgba(253,164,175,0.4)", borderRadius: 999, borderWidth: 1, justifyContent: "center", marginTop: 10, maxWidth: 320, minHeight: 48, paddingHorizontal: 18, width: "100%" }, endText: { color: "#FDA4AF", fontWeight: "900", textAlign: "center" }, ended: { color: "#F5D0FE", fontWeight: "800", marginTop: 16 },
});
