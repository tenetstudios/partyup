import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { claimLiveNode, consumeLiveNodeClaimHandoff, getLiveNodeScanState, type LiveNodeScanState } from "../../../lib/liveNodes";
import { supabase } from "../../../lib/supabase";
import { createGuestSession, readStoredGuestSession } from "../../lib/matchmaking";

function copyFor(state: LiveNodeScanState) {
  if (state.status === "winner" || state.status === "already_claimed_by_you") return ["NODE FOUND", "YOU GOT IT", "You were the first person to find the hidden node."];
  if (state.status === "inactive") return ["YOU FOUND A PARTYUP NODE", "IT'S NOT ACTIVE YET", "Keep an eye on PartyUp."];
  if (state.status === "claimed") return ["PARTYUP LIVE NODE", "NODE ALREADY CLAIMED", "Someone got here first."];
  if (state.status === "ended") return ["PARTYUP LIVE NODE", "NODE ENDED", "This node is no longer active."];
  if (state.status === "room_ended") return ["PARTYUP LIVE NODE", "ROOM ENDED", "This event has ended."];
  if (state.status === "not_eligible" || (state.status === "active" && state.eligible === false)) return ["PARTYUP LIVE NODE", "NOT ELIGIBLE", "You need to be participating in this room to claim this node."];
  if (state.status === "invalid") return ["PARTYUP LIVE NODE", "NODE NOT FOUND", "This QR is not a valid PartyUp Node."];
  return ["PARTYUP LIVE NODE", state.name?.toUpperCase() || "HIDDEN NODE", state.description || "You found it. Claim it before someone else does."];
}

export default function LiveNodeScreen() {
  const { token: rawToken, handoff: rawHandoff } = useLocalSearchParams<{ token: string; handoff?: string }>();
  const token = String(rawToken ?? "");
  const handoffToken = typeof rawHandoff === "string" ? rawHandoff : null;
  const [state, setState] = useState<LiveNodeScanState | null>(null);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handoffAttemptedRef = useRef(false);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    let nextGuestToken = (await readStoredGuestSession())?.guestToken ?? null;
    if (!data.user && !nextGuestToken) nextGuestToken = (await createGuestSession()).guestToken;
    setGuestToken(nextGuestToken);
    if (handoffToken && !handoffAttemptedRef.current) {
      handoffAttemptedRef.current = true;
      try {
        setState(await consumeLiveNodeClaimHandoff(supabase, handoffToken, nextGuestToken));
        return;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not reconnect this browser win to the app.");
      }
    }
    const nextState = await getLiveNodeScanState(supabase, token, nextGuestToken);
    if (nextState.status === "winner" || nextState.status === "already_claimed_by_you") setError(null);
    setState(nextState);
  }, [handoffToken, token]);

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not open this Live Node.")); }, [load]);

  async function claim() {
    setBusy(true); setError(null);
    try { setState(await claimLiveNode(supabase, token, guestToken)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not claim this Live Node."); }
    finally { setBusy(false); }
  }

  if (!state && !error) return <SafeAreaView style={styles.safe}><View style={styles.card}><ActivityIndicator color="#E879F9" /><Text style={styles.loading}>VERIFYING NODE…</Text></View></SafeAreaView>;
  const content = state ? copyFor(state) : null;
  const won = state?.status === "winner" || state?.status === "already_claimed_by_you";

  return <SafeAreaView style={styles.safe}><View style={[styles.card, won && styles.winnerCard]}>
    {content && <><Text style={[styles.eyebrow, won && styles.winnerEyebrow]}>{content[0]}</Text><Text style={styles.title}>{content[1]}</Text><Text style={styles.body}>{content[2]}</Text>
      {state?.reward_description && <View style={styles.reward}><Text style={styles.rewardLabel}>REWARD</Text><Text style={styles.rewardText}>{state.reward_description}</Text></View>}
      {state?.status === "active" && state.eligible !== false && <TouchableOpacity disabled={busy} onPress={() => void claim()} style={styles.primary}><Text style={styles.primaryText}>{busy ? "Claiming…" : "Claim Live Node"}</Text></TouchableOpacity>}
      {state?.room_id && <TouchableOpacity onPress={() => router.replace(`/room/${state.room_id}`)} style={styles.secondary}><Text style={styles.secondaryText}>{won ? "Return to Room" : "Open Room"}</Text></TouchableOpacity>}</>}
    {error && <Text style={styles.error}>{error}</Text>}
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { alignItems: "center", backgroundColor: "#07000F", flex: 1, justifyContent: "center", padding: 20 },
  card: { alignItems: "center", backgroundColor: "#13091D", borderColor: "rgba(232,121,249,0.28)", borderRadius: 20, borderWidth: 1, maxWidth: 440, padding: 26, width: "100%" },
  winnerCard: { backgroundColor: "#09211B", borderColor: "rgba(110,231,183,0.45)" },
  eyebrow: { color: "#E879F9", fontSize: 11, fontWeight: "900", letterSpacing: 2.2, textAlign: "center" },
  winnerEyebrow: { color: "#6EE7B7" },
  title: { color: "#FFF", fontSize: 34, fontWeight: "900", marginTop: 14, textAlign: "center" },
  body: { color: "#D4D4D8", fontSize: 14, lineHeight: 21, marginTop: 14, textAlign: "center" },
  loading: { color: "#FFF", fontWeight: "900", marginTop: 16 },
  reward: { alignItems: "center", alignSelf: "stretch", backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", borderRadius: 12, borderWidth: 1, marginTop: 20, padding: 16 },
  rewardLabel: { color: "#A1A1AA", fontSize: 10, fontWeight: "900" },
  rewardText: { color: "#FFF", fontSize: 20, fontWeight: "900", marginTop: 5 },
  primary: { alignItems: "center", alignSelf: "stretch", backgroundColor: "#C026D3", borderRadius: 10, justifyContent: "center", marginTop: 22, minHeight: 50 },
  primaryText: { color: "#FFF", fontWeight: "900" },
  secondary: { alignItems: "center", alignSelf: "stretch", borderColor: "rgba(255,255,255,0.16)", borderRadius: 10, borderWidth: 1, justifyContent: "center", marginTop: 12, minHeight: 48 },
  secondaryText: { color: "#FFF", fontWeight: "900" },
  error: { color: "#FDA4AF", fontWeight: "700", textAlign: "center" },
});
