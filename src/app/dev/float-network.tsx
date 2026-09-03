import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { findBalloonAtPoint, type BalloonType, type FloatMatchState } from "@partyup/balloon-core";
import { BalloonRoomField, type FieldPress } from "@/components/balloonRooms/BalloonRoomField";
import { readActiveRoomContext } from "@/lib/activeRoomContext";
import {
  FLOAT_POOL_HEARTBEAT_MS,
  FLOAT_SYNC_INTERVAL_MS,
  cancelFloatPool,
  getFloatPoolStatus,
  joinFloatPool,
  playerIdForUser,
  readyFloatNetworkMatch,
  submitFloatNetworkAction,
  syncFloatNetworkMatch,
  type FloatMatchRow,
  type FloatPoolMode,
} from "@/lib/floatMultiplayer";
import { supabase } from "../../../lib/supabase";

export default function FloatNetworkRoute() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [poolMode, setPoolMode] = useState<FloatPoolMode | null>(null);
  const [match, setMatch] = useState<FloatMatchRow | null>(null);
  const [message, setMessage] = useState("Choose how you want to play Float.");
  const [busy, setBusy] = useState(false);
  const matchRef = useRef<FloatMatchRow | null>(null);

  const acceptMatch = useCallback((row: FloatMatchRow) => {
    if (matchRef.current?.id === row.id && row.state_revision < matchRef.current.state_revision) return;
    matchRef.current = row;
    setMatch(row);
    setPoolMode(null);
  }, [acceptMatch]);

  useEffect(() => {
    void readActiveRoomContext().then((context) => setRoomId(context?.roomId ?? null));
    void supabase.auth.getUser().then(async ({ data }) => {
      setUserId(data.user?.id ?? null);
      if (!data.user) return;
      try {
        const pool = await getFloatPoolStatus();
        if (pool.status === "matched" && pool.match) acceptMatch(pool.match);
        else if (pool.status === "searching" && pool.entry) {
          setPoolMode(pool.entry.pool_mode);
          if (pool.entry.room_id) setRoomId(pool.entry.room_id);
          setMessage(pool.entry.pool_mode === "room" ? "SEARCHING THIS ROOM..." : "SEARCHING PARTYUP...");
        }
      } catch { /* Phase 8.1 deployments remain usable until the Phase 9 migration lands. */ }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  const checkPool = useCallback(async () => {
    const result = await getFloatPoolStatus();
    if (result.status === "matched" && result.match) { acceptMatch(result.match); setMessage("MATCH FOUND"); }
    else if (result.status === "expired") { setPoolMode(null); setMessage("Search expired. Try again."); }
  }, [acceptMatch]);

  useEffect(() => {
    if (!poolMode || !userId || match) return;
    const channel = supabase.channel(`float-pool:mobile:${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "float_pool_entries", filter: `user_id=eq.${userId}` }, () => void checkPool())
      .subscribe();
    const interval = setInterval(() => void checkPool(), FLOAT_POOL_HEARTBEAT_MS);
    return () => { clearInterval(interval); void supabase.removeChannel(channel); };
  }, [checkPool, match, poolMode, userId]);

  useEffect(() => {
    if (!match?.id || !userId) return;
    const channel = supabase.channel(`float-match:mobile:${match.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "float_matches", filter: `id=eq.${match.id}` }, (payload) => acceptMatch(payload.new as FloatMatchRow))
      .subscribe();
    const sync = () => void syncFloatNetworkMatch(match.id).then((result) => acceptMatch(result.match)).catch((error) => setMessage(error.message));
    const interval = setInterval(sync, FLOAT_SYNC_INTERVAL_MS);
    sync();
    return () => { clearInterval(interval); void supabase.removeChannel(channel); };
  }, [acceptMatch, match?.id, userId]);

  const start = async (mode: FloatPoolMode) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await joinFloatPool(mode, mode === "room" ? roomId : null);
      if (result.status === "matched" && result.match) { acceptMatch(result.match); setMessage("MATCH FOUND"); }
      else { setPoolMode(mode); setMessage(mode === "room" ? "SEARCHING THIS ROOM..." : "SEARCHING PARTYUP..."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Float search failed."); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const result = await cancelFloatPool();
      if (result.status === "matched" && result.match) acceptMatch(result.match);
      else { setPoolMode(null); setMessage("Search cancelled."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not cancel search."); }
    finally { setBusy(false); }
  };

  if (!userId) return <Shell onClose={() => router.back()}><Text style={styles.title}>SIGN IN TO PLAY FLOAT</Text><Text style={styles.message}>PartyUp authentication is required.</Text></Shell>;

  if (!match) return <Shell onClose={() => router.back()}>
    <Text style={styles.eyebrow}>FLOAT 8.1</Text><Text style={styles.title}>PLAY FLOAT</Text>
    {poolMode ? <><Text style={styles.searching}>{message}</Text><Button label="CANCEL" onPress={() => void cancel()} disabled={busy} secondary /></> : <>
      <Button label="FIND SOMEONE HERE" sublabel="ROOM POOL" onPress={() => void start("room")} disabled={busy || !roomId} />
      {!roomId ? <Text style={styles.warning}>JOIN A ROOM TO PLAY PEOPLE HERE</Text> : null}
      <Button label="PLAY ANYONE" sublabel="GLOBAL POOL" onPress={() => void start("global")} disabled={busy} secondary />
      <Text style={styles.message}>{message}</Text>
    </>}
  </Shell>;

  const playerId = playerIdForUser(match, userId);
  const opponentId = playerId === "playerA" ? "playerB" : "playerA";
  const state = match.state as FloatMatchState;
  const ownRoom = playerId ? state.players[playerId]?.room : null;
  const opponentRoom = state.players[opponentId]?.room;
  const ready = playerId === "playerA" ? match.player_a_ready : match.player_b_ready;
  if (!playerId || !ownRoom || !opponentRoom) return <Shell onClose={() => router.back()}><Text style={styles.message}>Recovering canonical Float state...</Text></Shell>;

  if (match.status === "waiting") return <Shell onClose={() => router.back()}>
    <Text style={styles.eyebrow}>MATCH FOUND · PLAYER {playerId === "playerA" ? "A" : "B"}</Text><Text style={styles.title}>{match.match_code}</Text>
    <Text style={styles.message}>Both players use the same canonical Supabase match.</Text>
    <Button label={ready ? "READY · WAITING" : "READY"} disabled={busy || ready} onPress={() => { setBusy(true); void readyFloatNetworkMatch(match.id).then((result) => acceptMatch(result.match)).catch((error) => setMessage(error.message)).finally(() => setBusy(false)); }} />
  </Shell>;

  const pop = (press: FieldPress) => {
    const balloon = findBalloonAtPoint(ownRoom, press.x, press.y, 24 / Math.min(press.width, press.height));
    if (balloon) void submitFloatNetworkAction(match.id, { actionType: "POP_BALLOON", payload: { balloonId: balloon.id } }).then((result) => acceptMatch(result.match));
  };
  const send = (balloonType: BalloonType) => void submitFloatNetworkAction(match.id, { actionType: "SEND_BALLOON", payload: { balloonType, lane: 1 } }).then((result) => acceptMatch(result.match)).catch((error) => setMessage(error.message));

  return <SafeAreaView style={styles.game}><View style={styles.header}><Text style={styles.gameTitle}>FLOAT · {match.match_code}</Text><Pressable onPress={() => router.back()}><Text style={styles.close}>×</Text></Pressable></View>
    <View style={styles.rooms}><View style={styles.room}><Text style={styles.roomTitle}>YOUR ROOM · HP {ownRoom.health}</Text><BalloonRoomField room={ownRoom} height={300} debugPaths={false} damageFlash={false} structuralEffects={[]} onPressPosition={pop} onLongPressPosition={() => undefined} /></View>
    <View style={styles.room}><Text style={styles.roomTitle}>OPPONENT · HP {opponentRoom.health}</Text><BalloonRoomField room={opponentRoom} height={300} debugPaths={false} damageFlash={false} structuralEffects={[]} onPressPosition={() => undefined} onLongPressPosition={() => undefined} /></View></View>
    <View style={styles.sendRow}>{(["basic", "speed", "heavy"] as BalloonType[]).map((type) => <Pressable key={type} style={styles.sendButton} onPress={() => send(type)}><Text style={styles.buttonText}>{type.toUpperCase()}</Text></Pressable>)}</View><Text style={styles.message}>{message}</Text>
  </SafeAreaView>;
}

function Shell({ children, onClose }: { children: ReactNode; onClose: () => void }) { return <SafeAreaView style={styles.shell}><Pressable onPress={onClose} style={styles.topClose}><Text style={styles.close}>×</Text></Pressable><View style={styles.card}>{children}</View></SafeAreaView>; }
function Button({ label, sublabel, onPress, disabled, secondary }: { label: string; sublabel?: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text>{sublabel ? <Text style={styles.buttonSub}>{sublabel}</Text> : null}</Pressable>; }

const styles = StyleSheet.create({ shell: { flex: 1, backgroundColor: "#080510", justifyContent: "center", padding: 20 }, topClose: { position: "absolute", right: 20, top: 48, zIndex: 2 }, close: { color: "white", fontSize: 32, fontWeight: "900" }, card: { borderWidth: 1, borderColor: "#553276", backgroundColor: "#160d24", borderRadius: 20, padding: 22 }, eyebrow: { color: "#d8b4fe", fontSize: 12, fontWeight: "900", letterSpacing: 2, textAlign: "center" }, title: { color: "white", fontSize: 30, fontWeight: "900", textAlign: "center", marginBottom: 18 }, button: { minHeight: 58, borderRadius: 14, backgroundColor: "#9333ea", alignItems: "center", justifyContent: "center", marginTop: 12 }, secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#c084fc" }, disabled: { opacity: 0.35 }, buttonText: { color: "white", fontWeight: "900", fontSize: 14 }, buttonSub: { color: "#e9d5ff", fontSize: 9, fontWeight: "800", marginTop: 2 }, warning: { color: "#fcd34d", fontSize: 10, fontWeight: "900", textAlign: "center", marginTop: 8 }, message: { color: "#a1a1aa", fontSize: 11, fontWeight: "700", textAlign: "center", marginTop: 14 }, searching: { color: "white", fontWeight: "900", fontSize: 18, textAlign: "center", paddingVertical: 22 }, game: { flex: 1, backgroundColor: "#080510", padding: 8 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, gameTitle: { color: "white", fontSize: 18, fontWeight: "900" }, rooms: { flex: 1, flexDirection: "row", gap: 6 }, room: { flex: 1 }, roomTitle: { color: "#e9d5ff", fontSize: 9, fontWeight: "900", textAlign: "center", marginBottom: 4 }, sendRow: { flexDirection: "row", gap: 6 }, sendButton: { flex: 1, minHeight: 44, borderRadius: 8, backgroundColor: "#a21caf", alignItems: "center", justifyContent: "center" } });
