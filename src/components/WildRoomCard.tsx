import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { enterWildGame, getWildRoomState, type WildRoomState } from "../../lib/wild";
import { createGuestSession, readStoredGuestSession } from "../lib/matchmaking";

export default function WildRoomCard({ roomId }: { roomId: string }) {
  const [state, setState] = useState<WildRoomState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const guestToken = (await readStoredGuestSession())?.guestToken ?? null;
    setState(await getWildRoomState(supabase, roomId, guestToken));
  }, [roomId]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void load().catch(() => undefined);
    const subscribe = async () => {
      const channelName = `mobile-wild-card-${roomId}`;
      const stale = supabase.getChannels().find((candidate) => candidate.topic === `realtime:${channelName}`);
      if (stale) await supabase.removeChannel(stale);
      if (!active) return;
      channel = supabase.channel(channelName)
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_games", filter: `room_id=eq.${roomId}` }, () => void load())
        .subscribe();
    };
    void subscribe();
    return () => { active = false; if (channel) void supabase.removeChannel(channel); };
  }, [load, roomId]);

  if (!state?.game) return null;

  const assignmentScore = state.assignment
    ? state.game.winner_summary?.scores.find((score) => score.faction_key === state.assignment?.key) ?? null
    : null;
  const assignmentWon = Boolean(
    state.assignment
      && state.game.winner_summary?.winners.some((winner) => winner.faction_key === state.assignment?.key),
  );

  async function enter() {
    setBusy(true); setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      let guestToken = (await readStoredGuestSession())?.guestToken ?? null;
      if (!data.user && !guestToken) guestToken = (await createGuestSession()).guestToken;
      await enterWildGame(supabase, state!.game!.id, guestToken);
      setState(await getWildRoomState(supabase, roomId, guestToken));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not enter the Wild."); }
    finally { setBusy(false); }
  }

  if (state.game.status === "ended") {
    return <View style={[styles.card, styles.endedCard, assignmentWon && styles.winnerCard]}>
      <Text style={[styles.eyebrow, assignmentWon && styles.winnerEyebrow]}>{assignmentWon ? "YOUR FACTION WON" : "INTO THE WILD"}</Text>
      <Text style={styles.title}>{assignmentWon && state.assignment ? `${state.assignment.emoji} ${state.assignment.label.toUpperCase()} WON THE WILD` : "THE WILD HAS ENDED"}</Text>
      {state.assignment ? <Text style={styles.copy}>
        {assignmentWon ? "Final result: " : `Your faction: ${state.assignment.emoji} ${state.assignment.label}. `}
        {assignmentScore ? `${assignmentScore.territories_controlled} ${assignmentScore.territories_controlled === 1 ? "territory" : "territories"} controlled · ${assignmentScore.total_influence} final influence.` : "Your final result is ready."}
      </Text> : <Text style={styles.copy}>Final territories and influence are ready to view.</Text>}
      <TouchableOpacity style={[styles.button, styles.endedButton]} onPress={() => router.push(`/room/${roomId}/wild`)}><Text style={styles.buttonText}>View Final Results</Text></TouchableOpacity>
    </View>;
  }

  if (state.game.status !== "active") return null;

  return <View style={styles.card}>
    <Text style={styles.eyebrow}>INTO THE WILD</Text>
    {state.assignment ? <><Text style={styles.title}>YOU ARE {state.assignment.emoji} {state.assignment.label.toUpperCase()}</Text><TouchableOpacity style={styles.button} onPress={() => router.push(`/room/${roomId}/wild`)}><Text style={styles.buttonText}>View the Wild</Text></TouchableOpacity></> : <><Text style={styles.title}>Something is happening here.</Text><Text style={styles.copy}>Get your faction. Complete Missions. Help your side take the map.</Text><TouchableOpacity style={styles.button} onPress={() => void enter()} disabled={busy}><Text style={styles.buttonText}>{busy ? "Entering…" : "Enter the Wild"}</Text></TouchableOpacity></>}
    {error && <Text style={styles.error}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#241138", borderColor: "rgba(232,121,249,0.38)", borderRadius: 14, borderWidth: 1, marginBottom: 16, padding: 16 },
  endedCard: { backgroundColor: "#1B1028", borderColor: "rgba(232,121,249,0.28)" },
  winnerCard: { backgroundColor: "#152C2B", borderColor: "rgba(110,231,183,0.48)" },
  eyebrow: { color: "#F0ABFC", fontSize: 11, fontWeight: "900", letterSpacing: 2.5 },
  winnerEyebrow: { color: "#6EE7B7" },
  title: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginTop: 8 },
  copy: { color: "#D4D4D8", fontSize: 13, lineHeight: 19, marginTop: 5 },
  button: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#C026D3", borderRadius: 9, marginTop: 13, minHeight: 44, justifyContent: "center", paddingHorizontal: 18 },
  endedButton: { alignSelf: "stretch", minHeight: 48 },
  buttonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  error: { color: "#FDA4AF", fontSize: 12, fontWeight: "700", marginTop: 10 },
});
