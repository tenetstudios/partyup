import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { endWildGame, getWildRoomState, publishWildMission, startWildGame, type WildRoomState } from "../../lib/wild";

export default function WildHostManager({ roomId, roomEnded = false }: { roomId: string; roomEnded?: boolean }) {
  const [state, setState] = useState<WildRoomState | null>(null);
  const [faction, setFaction] = useState("all");
  const [territory, setTerritory] = useState("grove");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("10");
  const [duration, setDuration] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gameIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const next = await getWildRoomState(supabase, roomId);
    gameIdRef.current = next.game?.id ?? null;
    setState(next);
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
      <View style={styles.territories}>{state?.territories.map((item) => { const controller = factions.find((candidate) => candidate.key === item.controlling_faction); return <View key={item.id} style={styles.territory}><Text style={styles.statTitle}>{item.display_name}</Text><Text style={styles.statCopy}>{controller ? `${controller.emoji} ${controller.label}` : "Contested"}</Text></View>; })}</View>
      {game.status === "active" && !roomEnded && <View style={styles.form}><Text style={styles.label}>Faction</Text><View style={styles.row}><TouchableOpacity style={[styles.choice, faction === "all" && styles.choiceActive]} onPress={() => setFaction("all")}><Text style={styles.choiceText}>All</Text></TouchableOpacity>{factions.map((item) => <TouchableOpacity key={item.key} style={[styles.choice, faction === item.key && styles.choiceActive]} onPress={() => setFaction(item.key)}><Text style={styles.choiceText}>{item.emoji} {item.label}</Text></TouchableOpacity>)}</View><Text style={styles.label}>Territory</Text><View style={styles.row}>{state?.territories.map((item) => <TouchableOpacity key={item.key} style={[styles.choice, territory === item.key && styles.choiceActive]} onPress={() => setTerritory(item.key)}><Text style={styles.choiceText}>{item.display_name}</Text></TouchableOpacity>)}</View><Text style={styles.label}>Mission title</Text><TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="Find another member of your faction" placeholderTextColor="#71717A" style={styles.input} /><Text style={styles.label}>Description</Text><TextInput value={description} onChangeText={setDescription} maxLength={1000} multiline style={[styles.input, styles.multiline]} /><View style={styles.row}><View style={styles.field}><Text style={styles.label}>Influence</Text><TextInput value={reward} onChangeText={(value) => setReward(value.replace(/\D/g, ""))} keyboardType="number-pad" style={styles.input} /></View><View style={styles.field}><Text style={styles.label}>Minutes</Text><TextInput value={duration} onChangeText={(value) => setDuration(value.replace(/\D/g, ""))} keyboardType="number-pad" style={styles.input} /></View></View><TouchableOpacity style={styles.primary} disabled={busy || !title.trim()} onPress={() => void run(() => publishWildMission(supabase, { gameId: game.id, factionKey: faction, territoryKey: territory, title, description, influenceReward: Number(reward), durationMinutes: Number(duration) }))}><Text style={styles.primaryText}>Launch Mission</Text></TouchableOpacity><TouchableOpacity style={styles.end} disabled={busy} onPress={() => Alert.alert("End Into the Wild?", "The winner will be calculated and no more influence can be earned.", [{ text: "Cancel", style: "cancel" }, { text: "End Wild", style: "destructive", onPress: () => void run(() => endWildGame(supabase, game.id)) }])}><Text style={styles.endText}>End Wild</Text></TouchableOpacity></View>}
      {game.status === "ended" && <View><Text style={styles.ended}>The Wild has ended. {(game.winner_summary?.winners ?? []).map((winner) => `${winner.emoji} ${winner.label}`).join(" + ") || "No faction"} won.</Text><TouchableOpacity style={styles.end} onPress={() => router.push(`/room/${roomId}/wild`)}><Text style={styles.endText}>View final result</Text></TouchableOpacity>{!roomEnded && <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => void run(() => startWildGame(supabase, roomId))}><Text style={styles.primaryText}>Start another Wild</Text></TouchableOpacity>}</View>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "rgba(74,20,105,0.2)", borderColor: "rgba(232,121,249,0.28)", borderRadius: 14, borderWidth: 1, marginTop: 18, padding: 16 },
  eyebrow: { color: "#F0ABFC", fontSize: 11, fontWeight: "900", letterSpacing: 2.2 }, heading: { color: "#FFF", fontSize: 22, fontWeight: "900", marginTop: 6 }, copy: { color: "#A1A1AA", fontSize: 13, marginTop: 4 }, error: { color: "#FDA4AF", marginTop: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }, stat: { backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 9, minWidth: 95, padding: 10 }, statTitle: { color: "#FFF", fontWeight: "900" }, statCopy: { color: "#A1A1AA", fontSize: 12, marginTop: 3 }, territories: { gap: 8, marginTop: 12 }, territory: { backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 9, padding: 10 },
  form: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1, marginTop: 18, paddingTop: 14 }, label: { color: "#E9D5FF", fontSize: 13, fontWeight: "900", marginTop: 12 }, choice: { backgroundColor: "#181425", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 }, choiceActive: { backgroundColor: "#7E22CE" }, choiceText: { color: "#FFF", fontSize: 12, fontWeight: "800" }, input: { backgroundColor: "#09070D", borderRadius: 8, color: "#FFF", marginTop: 6, minHeight: 44, paddingHorizontal: 12 }, multiline: { minHeight: 76, paddingTop: 12, textAlignVertical: "top" }, field: { flex: 1, minWidth: 100 },
  primary: { alignItems: "center", backgroundColor: "#C026D3", borderRadius: 9, justifyContent: "center", marginTop: 16, minHeight: 46 }, primaryText: { color: "#FFF", fontWeight: "900" }, end: { alignItems: "center", borderColor: "rgba(253,164,175,0.35)", borderRadius: 9, borderWidth: 1, justifyContent: "center", marginTop: 10, minHeight: 44 }, endText: { color: "#FDA4AF", fontWeight: "900" }, ended: { color: "#F5D0FE", fontWeight: "800", marginTop: 16 },
});
