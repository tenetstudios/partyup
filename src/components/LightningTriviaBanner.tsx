import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { getRoomTrivia, type TriviaRoundSummary } from "../../lib/lightningTrivia";

const dismissedResultStorageKey = (roundId: string) => `partyup_trivia_result_dismissed:${roundId}`;

export default function LightningTriviaBanner({ roomId }: { roomId: string }) {
  const [round, setRound] = useState<TriviaRoundSummary | null>(null);
  const [dismissedRoundId, setDismissedRoundId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    const nextRound = await getRoomTrivia(supabase, roomId);
    let dismissedId: string | null = null;
    if (nextRound?.status === "ended") {
      try {
        if (await AsyncStorage.getItem(dismissedResultStorageKey(nextRound.id)) === "1") dismissedId = nextRound.id;
      } catch {
        // A storage failure should not prevent the latest trivia state from loading.
      }
    }
    setDismissedRoundId(dismissedId);
    setRound(nextRound);
  }, [roomId]);
  useEffect(() => {
    void load();
    const clock = setInterval(() => setNow(Date.now()), 250);
    const channel = supabase.channel(`mobile-trivia-banner-${roomId}-${Date.now()}-${Math.random()}`).on("postgres_changes", { event: "*", schema: "public", table: "trivia_rounds", filter: `room_id=eq.${roomId}` }, () => void load()).subscribe();
    return () => { clearInterval(clock); void supabase.removeChannel(channel); };
  }, [load, roomId]);
  function dismissFinalResult() {
    if (!round || round.status !== "ended") return;
    setDismissedRoundId(round.id);
    void AsyncStorage.setItem(dismissedResultStorageKey(round.id), "1").catch(() => undefined);
  }

  if (!round || (round.status === "ended" && dismissedRoundId === round.id)) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(round.starts_at) - now) / 1000));
  return <View style={[styles.card, round.status === "ended" && styles.endedCard]}>{round.status === "ended" ? <TouchableOpacity accessibilityLabel="Dismiss Lightning Trivia results" accessibilityRole="button" hitSlop={8} onPress={dismissFinalResult} style={styles.dismissButton}><Text style={styles.dismissText}>×</Text></TouchableOpacity> : null}<View style={styles.copy}><Text style={styles.eyebrow}>⚡ VERIFIED MISSION</Text><Text style={styles.title}>LIGHTNING TRIVIA</Text><Text style={styles.subtitle}>{round.status === "scheduled" ? `Starts in ${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}` : round.status === "ended" ? "Round complete" : "10 questions · 5 seconds each"}</Text></View><TouchableOpacity style={styles.button} onPress={() => router.push(`/room/${roomId}/trivia` as never)}><Text style={styles.buttonText}>{round.status === "scheduled" ? "JOIN" : round.status === "ended" ? "RESULTS" : "OPEN"}</Text></TouchableOpacity></View>;
}
const styles = StyleSheet.create({ card: { marginVertical: 10, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: "rgba(250,204,21,.45)", backgroundColor: "#211428", flexDirection: "row", alignItems: "center", gap: 12 }, endedCard: { paddingRight: 56 }, copy: { flex: 1 }, eyebrow: { color: "#FDE047", fontSize: 11, fontWeight: "900", letterSpacing: 1.5 }, title: { color: "#FFF", fontSize: 22, fontWeight: "900", marginTop: 4 }, subtitle: { color: "#D4D4D8", fontWeight: "700", marginTop: 3 }, button: { backgroundColor: "#FACC15", minHeight: 48, justifyContent: "center", paddingHorizontal: 18, borderRadius: 10 }, buttonText: { color: "#09090B", fontWeight: "900" }, dismissButton: { alignItems: "center", height: 44, justifyContent: "center", position: "absolute", right: 4, top: 4, width: 44, zIndex: 1 }, dismissText: { color: "#D4D4D8", fontSize: 28, fontWeight: "500", lineHeight: 30 } });
