import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  findBalloonAtPoint,
  MAX_FRAME_DELTA_SECONDS,
  SIMULATION_STEP_SECONDS,
  updateFloatMatch,
  type BalloonType,
  type FloatMatchState,
} from "@partyup/balloon-core";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  FLOAT_REALTIME_PROTOCOL_VERSION,
  FLOAT_MAX_ACTIONS_PER_SECOND,
  FLOAT_MAX_RESEND_ACTIONS,
  FloatRealtimeTimeline,
  FloatSequenceInbox,
  canonicalFloatJson,
  floatActorTopic,
  floatHashCoordinateKey,
  simulationTimeMsToTick,
  validateFloatRealtimeAction,
  type FloatActionAck,
  type FloatActionRequest,
  type FloatHashCoordinates,
  type FloatHashReport,
  type FloatRealtimeAction,
} from "@partyup/float-realtime-protocol";
import { BalloonRoomField, type FieldPress } from "@/components/balloonRooms/BalloonRoomField";
import { readActiveRoomContext } from "@/lib/activeRoomContext";
import {
  FLOAT_POOL_HEARTBEAT_MS,
  FLOAT_SYNC_INTERVAL_MS,
  cancelFloatPool,
  checkpointFloatRealtimeMatch,
  getFloatPoolStatus,
  heartbeatFloatNetworkMatch,
  joinFloatPool,
  playerIdForUser,
  persistFloatRealtimeActions,
  readyFloatNetworkMatch,
  recoverFloatRealtimeMatch,
  type FloatActionIntent,
  type FloatMatchRow,
  type FloatPoolMode,
} from "@/lib/floatMultiplayer";
import { supabase } from "../../../lib/supabase";

function hashMobileFloatState(coordinates: FloatHashCoordinates, state: FloatMatchState) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, canonicalFloatJson({ coordinates, state }));
}

export default function FloatNetworkRoute() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [poolMode, setPoolMode] = useState<FloatPoolMode | null>(null);
  const [match, setMatch] = useState<FloatMatchRow | null>(null);
  const [message, setMessage] = useState("Choose how you want to play Float.");
  const [busy, setBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const matchRef = useRef<FloatMatchRow | null>(null);
  const stateRef = useRef<FloatMatchState | null>(null);
  const timelineRef = useRef<FloatRealtimeTimeline | null>(null);
  const realtimeChannelsRef = useRef<Partial<Record<"playerA" | "playerB", RealtimeChannel>>>({});
  const realtimeReadyRef = useRef(false);
  const realtimeSequenceRef = useRef(0);
  const realtimeInboxRef = useRef<Partial<Record<"playerA" | "playerB", FloatSequenceInbox>>>({});
  const realtimeJournalRef = useRef(new Map<number, FloatRealtimeAction>());
  const persistenceQueueRef = useRef<FloatRealtimeAction[]>([]);
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkpointRevisionRef = useRef(0);
  const stateHashesRef = useRef(new Map<string, string>());
  const remoteStateHashesRef = useRef(new Map<string, string>());
  const lastHashTickRef = useRef(-1);
  const mismatchRecoveryTickRef = useRef(-1);
  const recentActionTimesRef = useRef<number[]>([]);
  const recoveredMatchIdRef = useRef<string | null>(null);
  const [realtimeRecoveredMatchId, setRealtimeRecoveredMatchId] = useState<string | null>(null);

  const publishState = useCallback((state: FloatMatchState) => {
    stateRef.current = state;
    if (!matchRef.current) return;
    setMatch({ ...matchRef.current, state: structuredClone(state) });
  }, []);

  const acceptMatch = useCallback((row: FloatMatchRow) => {
    const current = matchRef.current;
    if (current?.id === row.id && row.state_revision < current.state_revision) return;
    if (current?.id === row.id && row.state_revision === current.state_revision && row.updated_at < current.updated_at) return;

    const isNewMatch = current?.id !== row.id;
    if (isNewMatch) {
      setPendingCount(0);
      matchRef.current = row;
      const state = structuredClone(row.state);
      stateRef.current = state;
      timelineRef.current = new FloatRealtimeTimeline(state);
      realtimeSequenceRef.current = 0;
      realtimeInboxRef.current = {};
      realtimeJournalRef.current.clear();
      checkpointRevisionRef.current = Number(row.checkpoint_revision ?? 0);
      recoveredMatchIdRef.current = null;
      setRealtimeRecoveredMatchId(null);
      setMatch(row);
    } else {
      matchRef.current = row;
      if (stateRef.current) {
        setMatch({ ...row, state: structuredClone(stateRef.current) });
      }
    }
    matchRef.current = row;
    setPoolMode(null);
  }, []);

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
  }, [acceptMatch]);

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
    const sync = () => void heartbeatFloatNetworkMatch(match.id).then((result) => acceptMatch(result.match)).catch((error) => setMessage(error.message));
    const interval = setInterval(sync, FLOAT_SYNC_INTERVAL_MS);
    sync();
    return () => { clearInterval(interval); void supabase.removeChannel(channel); };
  }, [acceptMatch, match?.id, userId]);

  const activePlayerId = match && userId ? playerIdForUser(match, userId) : null;
  const activeOpponentId = activePlayerId === "playerA" ? "playerB" : activePlayerId === "playerB" ? "playerA" : null;

  const recoverRealtime = useCallback(async (matchId: string, localPlayerId: "playerA" | "playerB") => {
    const previousTick = timelineRef.current?.currentTick ?? 0;
    const recovery = await recoverFloatRealtimeMatch(matchId);
    const baseState = recovery.match.checkpoint_state ?? recovery.match.state;
    const baseTick = recovery.match.checkpoint_state ? Number(recovery.match.checkpoint_tick) : simulationTimeMsToTick(baseState.simulationTimeMs);
    if (recovery.match.protocol_version !== FLOAT_REALTIME_PROTOCOL_VERSION || recovery.match.core_version !== "8.1.0") throw new Error("FLOAT UPDATE REQUIRED");
    if (recovery.match.checkpoint_state && recovery.match.checkpoint_hash) {
      const checkpointCoordinates: FloatHashCoordinates = {
        protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION,
        coreVersion: "8.1.0",
        simulationTick: baseTick,
        playerASequence: Number(recovery.match.player_a_checkpoint_sequence),
        playerBSequence: Number(recovery.match.player_b_checkpoint_sequence),
      };
      if (await hashMobileFloatState(checkpointCoordinates, baseState) !== recovery.match.checkpoint_hash) throw new Error("Float checkpoint hash validation failed");
    }
    const timeline = new FloatRealtimeTimeline(baseState, baseTick);
    const cursors = {
      playerA: Number(recovery.match.player_a_checkpoint_sequence ?? 0),
      playerB: Number(recovery.match.player_b_checkpoint_sequence ?? 0),
    };
    const inboxes = {
      playerA: new FloatSequenceInbox(cursors.playerA),
      playerB: new FloatSequenceInbox(cursors.playerB),
    };
    const ownJournal = new Map<number, FloatRealtimeAction>();
    let ownSequence = cursors[localPlayerId];
    for (const raw of recovery.actions) {
      const actor = raw.actorPlayerId;
      if (actor !== "playerA" && actor !== "playerB") continue;
      const action = validateFloatRealtimeAction(raw, { matchId, actorPlayerId: actor });
      const received = inboxes[actor].receive(action);
      for (const ready of received.ready) {
        if (ready.simulationTick > timeline.currentTick) timeline.advanceTo(ready.simulationTick);
        timeline.insert(ready);
      }
      if (actor === localPlayerId) {
        ownSequence = Math.max(ownSequence, action.clientSequence);
        ownJournal.set(action.clientSequence, action);
      }
    }
    const serverTick = recovery.match.started_at
      ? simulationTimeMsToTick(Math.max(0, Date.now() - Date.parse(recovery.match.started_at)))
      : timeline.currentTick;
    timeline.advanceTo(Math.max(previousTick, serverTick, timeline.currentTick));
    timelineRef.current = timeline;
    stateRef.current = timeline.state;
    realtimeInboxRef.current = inboxes;
    realtimeSequenceRef.current = ownSequence;
    realtimeJournalRef.current = ownJournal;
    checkpointRevisionRef.current = Number(recovery.match.checkpoint_revision ?? 0);
    matchRef.current = recovery.match;
    setMatch({ ...recovery.match, state: structuredClone(timeline.state) });
    setPendingCount(ownJournal.size);
    setRealtimeRecoveredMatchId(matchId);
    setMessage("Realtime state recovered.");
  }, []);

  useEffect(() => {
    if (!match?.id || !activePlayerId || match.status !== "active" || recoveredMatchIdRef.current === match.id) return;
    recoveredMatchIdRef.current = match.id;
    void recoverRealtime(match.id, activePlayerId).catch((error) => {
      recoveredMatchIdRef.current = null;
      setMessage(error instanceof Error ? error.message : "Realtime recovery failed.");
    });
  }, [activePlayerId, match?.id, match?.status, recoverRealtime]);

  useEffect(() => {
    if (!match?.id || realtimeRecoveredMatchId !== match.id || !activePlayerId || !activeOpponentId || match.status !== "active") return;
    let closed = false;
    const joinedActors = new Set<"playerA" | "playerB">();
    let replayInterval: ReturnType<typeof setInterval> | null = null;
    realtimeReadyRef.current = false;
    if (!realtimeInboxRef.current.playerA) realtimeInboxRef.current.playerA = new FloatSequenceInbox();
    if (!realtimeInboxRef.current.playerB) realtimeInboxRef.current.playerB = new FloatSequenceInbox();
    const send = (actor: "playerA" | "playerB", event: string, payload: object) => {
      const channel = realtimeChannelsRef.current[actor];
      if (channel) void channel.send({ type: "broadcast", event, payload });
    };
    const receiveAction = (topicActor: "playerA" | "playerB", raw: unknown) => {
      try {
        const action = validateFloatRealtimeAction(raw, { matchId: match.id, actorPlayerId: topicActor });
        const inbox = realtimeInboxRef.current[topicActor];
        if (!inbox) return;
        const received = inbox.receive(action);
        for (const ready of received.ready) {
          const result = timelineRef.current?.insert(ready);
          if (result?.status === "too_old" || result?.status === "too_far_ahead") {
            void recoverRealtime(match.id, activePlayerId);
            return;
          }
          else if (result?.status === "rejected") setMessage(result.result.message);
        }
        if (received.missing) {
          const request: FloatActionRequest = { protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION, type: "REQUEST_ACTIONS", actorPlayerId: topicActor, ...received.missing };
          send(activePlayerId, "protocol_control", request);
        }
        const ack: FloatActionAck = { protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION, type: "ACTION_ACK", actorPlayerId: topicActor, throughSequence: inbox.getThroughSequence() };
        send(activePlayerId, "protocol_control", ack);
      } catch (error) {
        if (error instanceof Error && /sequence gap/i.test(error.message)) void recoverRealtime(match.id, activePlayerId);
        setMessage(error instanceof Error ? error.message : "Invalid realtime action.");
      }
    };
    const connect = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) throw error ?? new Error("Float Realtime authentication is unavailable.");
      await supabase.realtime.setAuth(data.session.access_token);
      if (closed) return;
      for (const topicActor of ["playerA", "playerB"] as const) {
      const channel = supabase.channel(floatActorTopic(match.id, topicActor), { config: { private: true, broadcast: { ack: true, self: false } } })
        .on("broadcast", { event: "gameplay_action" }, ({ payload }) => receiveAction(topicActor, payload))
        .on("broadcast", { event: "action_replay" }, ({ payload }) => receiveAction(topicActor, payload))
        .on("broadcast", { event: "protocol_control" }, ({ payload }) => {
          if (!payload || typeof payload !== "object" || topicActor === activePlayerId) return;
          const control = payload as Record<string, unknown>;
          if (control.type === "HASH_REPORT" && control.protocolVersion === FLOAT_REALTIME_PROTOCOL_VERSION && control.coreVersion === "8.1.0" && control.actorPlayerId === topicActor && Number.isSafeInteger(control.simulationTick) && Number.isSafeInteger(control.playerASequence) && Number.isSafeInteger(control.playerBSequence) && typeof control.stateHash === "string") {
            const coordinates = control as FloatHashReport;
            const key = floatHashCoordinateKey(coordinates);
            const tick = coordinates.simulationTick;
            remoteStateHashesRef.current.set(key, coordinates.stateHash);
            const localHash = stateHashesRef.current.get(key);
            if (localHash && localHash !== coordinates.stateHash && mismatchRecoveryTickRef.current !== tick) {
              mismatchRecoveryTickRef.current = tick;
              void recoverRealtime(match.id, activePlayerId);
            }
            return;
          }
          if (control.protocolVersion !== FLOAT_REALTIME_PROTOCOL_VERSION || control.actorPlayerId !== activePlayerId) return;
          if (control.type === "ACTION_ACK" && Number.isSafeInteger(control.throughSequence)) {
            for (const sequence of realtimeJournalRef.current.keys()) if (sequence <= Number(control.throughSequence)) realtimeJournalRef.current.delete(sequence);
            setPendingCount(realtimeJournalRef.current.size);
          } else if (control.type === "REQUEST_ACTIONS" && Number.isSafeInteger(control.fromSequence) && Number.isSafeInteger(control.toSequence)) {
            for (let sequence = Number(control.fromSequence); sequence <= Number(control.toSequence); sequence += 1) {
              const action = realtimeJournalRef.current.get(sequence);
              if (action) send(activePlayerId, "action_replay", action);
            }
          }
        }).subscribe((status, error) => {
          if (status === "SUBSCRIBED") {
            joinedActors.add(topicActor);
            if (joinedActors.size === 2) { realtimeReadyRef.current = true; setMessage("Realtime connected."); }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            joinedActors.delete(topicActor);
            realtimeReadyRef.current = false;
            if (__DEV__) console.error("[FLOAT REALTIME SUBSCRIBE FAILED]", { topicActor, status, error });
            setMessage(`Private Float realtime failed on ${topicActor}${error?.message ? `: ${error.message}` : "."}`);
          }
        });
      realtimeChannelsRef.current[topicActor] = channel;
      }
      replayInterval = setInterval(() => {
        if (!realtimeReadyRef.current) return;
        for (const action of realtimeJournalRef.current.values()) send(activePlayerId, "action_replay", action);
      }, 500);
    };
    void connect().catch((error) => setMessage(error instanceof Error ? error.message : "Float Realtime authentication failed."));
    return () => {
      closed = true;
      if (replayInterval) clearInterval(replayInterval);
      realtimeReadyRef.current = false;
      const channels = Object.values(realtimeChannelsRef.current);
      realtimeChannelsRef.current = {};
      for (const channel of channels) if (channel) void supabase.removeChannel(channel);
    };
  }, [activeOpponentId, activePlayerId, match?.id, match?.status, realtimeRecoveredMatchId, recoverRealtime]);

  useEffect(() => {
    if (!match?.id || match.status !== "active") return;
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;
    let lastPublish = previous;
    const tick = (now: number) => {
      const state = stateRef.current;
      if (state && matchRef.current?.id === match.id) {
        accumulator += Math.min((now - previous) / 1000, MAX_FRAME_DELTA_SECONDS);
        while (accumulator >= SIMULATION_STEP_SECONDS) {
          const timeline = timelineRef.current;
          if (timeline && timeline.state === state) {
            timeline.advanceTo(timeline.currentTick + 1);
            if (activePlayerId && timeline.currentTick > 0 && timeline.currentTick % 60 === 0 && lastHashTickRef.current !== timeline.currentTick) {
              const hashTick = timeline.currentTick;
              const hashState = structuredClone(timeline.state);
              lastHashTickRef.current = hashTick;
              const coordinates: FloatHashCoordinates = {
                protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION,
                coreVersion: "8.1.0",
                simulationTick: hashTick,
                playerASequence: activePlayerId === "playerA" ? realtimeSequenceRef.current : realtimeInboxRef.current.playerA?.getThroughSequence() ?? 0,
                playerBSequence: activePlayerId === "playerB" ? realtimeSequenceRef.current : realtimeInboxRef.current.playerB?.getThroughSequence() ?? 0,
              };
              void hashMobileFloatState(coordinates, hashState).then((stateHash) => {
                const key = floatHashCoordinateKey(coordinates);
                stateHashesRef.current.set(key, stateHash);
                const remoteHash = remoteStateHashesRef.current.get(key);
                if (remoteHash && remoteHash !== stateHash && mismatchRecoveryTickRef.current !== hashTick) {
                  mismatchRecoveryTickRef.current = hashTick;
                  void recoverRealtime(match.id, activePlayerId);
                }
                const channel = realtimeChannelsRef.current[activePlayerId];
                if (channel) void channel.send({ type: "broadcast", event: "protocol_control", payload: { ...coordinates, type: "HASH_REPORT", actorPlayerId: activePlayerId, stateHash } satisfies FloatHashReport });
              });
            }
          } else updateFloatMatch(state, SIMULATION_STEP_SECONDS);
          accumulator -= SIMULATION_STEP_SECONDS;
        }
        if (now - lastPublish >= 100) {
          publishState(state);
          lastPublish = now;
        }
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activePlayerId, match?.id, match?.status, publishState, recoverRealtime]);

  useEffect(() => {
    if (!match?.id || activePlayerId !== "playerA" || match.status !== "active") return;
    let running = false;
    const write = async () => {
      if (running || !timelineRef.current) return;
      running = true;
      const checkpoint = timelineRef.current.exportCheckpoint();
      try {
        const playerASequence = realtimeSequenceRef.current;
        const playerBSequence = realtimeInboxRef.current.playerB?.getThroughSequence() ?? 0;
        const coordinates: FloatHashCoordinates = { protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION, coreVersion: "8.1.0", simulationTick: checkpoint.simulationTick, playerASequence, playerBSequence };
        const stateHash = await hashMobileFloatState(coordinates, checkpoint.state);
        const result = await checkpointFloatRealtimeMatch(match.id, {
          expectedRevision: checkpointRevisionRef.current,
          simulationTick: checkpoint.simulationTick,
          state: checkpoint.state,
          stateHash,
          playerASequence,
          playerBSequence,
        });
        checkpointRevisionRef.current = Number(result.match.checkpoint_revision ?? checkpointRevisionRef.current);
      } catch (error) { if (__DEV__) console.error("[FLOAT CHECKPOINT DELAYED]", error); }
      finally { running = false; }
    };
    const interval = setInterval(() => void write(), 2_000);
    return () => clearInterval(interval);
  }, [activePlayerId, match?.id, match?.status]);

  const schedulePersistence = (delayMs = 250) => {
    if (persistenceTimerRef.current) return;
    persistenceTimerRef.current = setTimeout(() => {
      persistenceTimerRef.current = null;
      const activeMatchId = matchRef.current?.id;
      const batch = persistenceQueueRef.current.splice(0, 100);
      if (!activeMatchId || batch.length === 0) return;
      void persistFloatRealtimeActions(activeMatchId, batch).then(() => {
        if (persistenceQueueRef.current.length > 0) schedulePersistence();
      }).catch((error) => {
        persistenceQueueRef.current.unshift(...batch);
        setMessage(error instanceof Error ? `Gameplay live; persistence delayed: ${error.message}` : "Gameplay live; persistence delayed.");
        schedulePersistence(1_000);
      });
    }, delayMs);
  };

  useEffect(() => () => {
    if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") return;
      const activeMatchId = matchRef.current?.id;
      const batch = persistenceQueueRef.current.splice(0, 100);
      if (activeMatchId && batch.length > 0) void persistFloatRealtimeActions(activeMatchId, batch).catch(() => persistenceQueueRef.current.unshift(...batch));
    });
    return () => subscription.remove();
  }, []);

  const handleIntent = (intent: FloatActionIntent) => {
    const activeMatch = matchRef.current;
    const timeline = timelineRef.current;
    if (!activeMatch || !timeline || !userId || activeMatch.status !== "active") return;
    const actorPlayerId = playerIdForUser(activeMatch, userId);
    if (!actorPlayerId) return;
    const actionNow = performance.now();
    recentActionTimesRef.current = recentActionTimesRef.current.filter((time) => actionNow - time < 1_000);
    if (recentActionTimesRef.current.length >= FLOAT_MAX_ACTIONS_PER_SECOND || realtimeJournalRef.current.size >= FLOAT_MAX_RESEND_ACTIONS) {
      setMessage("Realtime action rate exceeded; wait for peer acknowledgement.");
      return;
    }
    const channel = realtimeChannelsRef.current[actorPlayerId];
    if (!realtimeReadyRef.current || !channel) { setMessage("Realtime is reconnecting; action was not applied."); return; }
    const sequence = realtimeSequenceRef.current + 1;
    const action: FloatRealtimeAction = {
      protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION,
      matchId: activeMatch.id,
      actionId: Crypto.randomUUID(),
      actorPlayerId,
      clientSequence: sequence,
      simulationTick: timeline.currentTick,
      actionType: intent.actionType,
      payload: intent.payload,
    };
    try {
      const result = timeline.insert(action);
      if (result.status !== "applied") { setMessage(result.status === "rejected" ? result.result.message : `Action rejected (${result.status}).`); return; }
      realtimeSequenceRef.current = sequence;
      recentActionTimesRef.current.push(actionNow);
      realtimeJournalRef.current.set(sequence, action);
      persistenceQueueRef.current.push(action);
      schedulePersistence();
      setPendingCount(realtimeJournalRef.current.size);
      publishState(timeline.state);
      setMessage("Applied locally.");
      void channel.send({ type: "broadcast", event: "gameplay_action", payload: action });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Float action is unavailable.");
    }
  };

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
    if (balloon) handleIntent({ actionType: "POP_BALLOON", payload: { balloonId: balloon.id } });
  };
  const send = (balloonType: BalloonType) => handleIntent({ actionType: "SEND_BALLOON", payload: { balloonType, lane: 1 } });

  return <SafeAreaView style={styles.game}><View style={styles.header}><Text style={styles.gameTitle}>FLOAT · {match.match_code}</Text><Pressable onPress={() => router.back()}><Text style={styles.close}>×</Text></Pressable></View>
    <View style={styles.rooms}><View style={styles.room}><Text style={styles.roomTitle}>YOUR ROOM · HP {ownRoom.health}</Text><BalloonRoomField room={ownRoom} height={300} debugPaths={false} damageFlash={false} structuralEffects={[]} onPressPosition={pop} onLongPressPosition={() => undefined} /></View>
    <View style={styles.room}><Text style={styles.roomTitle}>OPPONENT · HP {opponentRoom.health}</Text><BalloonRoomField room={opponentRoom} height={300} debugPaths={false} damageFlash={false} structuralEffects={[]} onPressPosition={() => undefined} onLongPressPosition={() => undefined} /></View></View>
    <View style={styles.sendRow}>{(["basic", "speed", "heavy"] as BalloonType[]).map((type) => <Pressable key={type} style={styles.sendButton} onPress={() => send(type)}><Text style={styles.buttonText}>{type.toUpperCase()}</Text></Pressable>)}</View><Text style={styles.message}>{pendingCount > 0 ? `Applied locally · SYNCING ${pendingCount}` : message}</Text>
  </SafeAreaView>;
}

function Shell({ children, onClose }: { children: ReactNode; onClose: () => void }) { return <SafeAreaView style={styles.shell}><Pressable onPress={onClose} style={styles.topClose}><Text style={styles.close}>×</Text></Pressable><View style={styles.card}>{children}</View></SafeAreaView>; }
function Button({ label, sublabel, onPress, disabled, secondary }: { label: string; sublabel?: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text>{sublabel ? <Text style={styles.buttonSub}>{sublabel}</Text> : null}</Pressable>; }

const styles = StyleSheet.create({ shell: { flex: 1, backgroundColor: "#080510", justifyContent: "center", padding: 20 }, topClose: { position: "absolute", right: 20, top: 48, zIndex: 2 }, close: { color: "white", fontSize: 32, fontWeight: "900" }, card: { borderWidth: 1, borderColor: "#553276", backgroundColor: "#160d24", borderRadius: 20, padding: 22 }, eyebrow: { color: "#d8b4fe", fontSize: 12, fontWeight: "900", letterSpacing: 2, textAlign: "center" }, title: { color: "white", fontSize: 30, fontWeight: "900", textAlign: "center", marginBottom: 18 }, button: { minHeight: 58, borderRadius: 14, backgroundColor: "#9333ea", alignItems: "center", justifyContent: "center", marginTop: 12 }, secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#c084fc" }, disabled: { opacity: 0.35 }, buttonText: { color: "white", fontWeight: "900", fontSize: 14 }, buttonSub: { color: "#e9d5ff", fontSize: 9, fontWeight: "800", marginTop: 2 }, warning: { color: "#fcd34d", fontSize: 10, fontWeight: "900", textAlign: "center", marginTop: 8 }, message: { color: "#a1a1aa", fontSize: 11, fontWeight: "700", textAlign: "center", marginTop: 14 }, searching: { color: "white", fontWeight: "900", fontSize: 18, textAlign: "center", paddingVertical: 22 }, game: { flex: 1, backgroundColor: "#080510", padding: 8 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, gameTitle: { color: "white", fontSize: 18, fontWeight: "900" }, rooms: { flex: 1, flexDirection: "row", gap: 6 }, room: { flex: 1 }, roomTitle: { color: "#e9d5ff", fontSize: 9, fontWeight: "900", textAlign: "center", marginBottom: 4 }, sendRow: { flexDirection: "row", gap: 6 }, sendButton: { flex: 1, minHeight: 44, borderRadius: 8, backgroundColor: "#a21caf", alignItems: "center", justifyContent: "center" } });
