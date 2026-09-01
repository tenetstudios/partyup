import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  BALLOON_TYPES, INCOME_TICK_INTERVAL_MS, NAIL_STRIP_COST,
  MAX_LAUNCH_QUEUE_SIZE, MAX_NAIL_STRIPS, MAX_WALL_SEGMENTS, ROOM_MAX_HEALTH, createSendBalloonAction, createWallSegment,
  VERTICAL_WALL_COST, WAVE_ROUNDS,
  findBalloonAtPoint, findClosestGridEdge, getUnsupportedHorizontalWalls, hasRequiredRoutes,
  type BalloonRoom, type BalloonType, type GameAction, type SpawnLane,
} from "@partyup/balloon-core";
import { BalloonRoomField, type FieldPress } from "@/components/balloonRooms/BalloonRoomField";
import { useBalloonRoomsSimulation, type BalloonRoomKey } from "@/hooks/useBalloonRoomsSimulation";

type BuildMode = "wall" | "nails" | "remove";

export default function BalloonRoomsRoute() {
  if (!__DEV__) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.unavailable}><Text style={styles.unavailableTitle}>DEVELOPMENT BUILD ONLY</Text><Pressable onPress={() => router.back()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>GO BACK</Text></Pressable></View></SafeAreaView>;
  }
  return <BalloonRoomsDevScreen />;
}

function BalloonRoomsDevScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const { snapshot, dispatchAction, restart } = useBalloonRoomsSimulation();
  const sendSequenceRef = useRef(0);
  const [debugPaths, setDebugPaths] = useState(false);
  const [buildMode, setBuildMode] = useState<BuildMode>("wall");
  const [selectedAttackLane, setSelectedAttackLane] = useState<SpawnLane>(1);
  const [selectedBalloonType, setSelectedBalloonType] = useState<BalloonType>("basic");
  const [feedback, setFeedback] = useState<{ message: string; valid: boolean } | null>(null);
  const [sendFeedback, setSendFeedback] = useState("");
  const fieldHeight = Math.max(120, Math.min(430, windowHeight - 370));
  const launchQueue = snapshot.rooms.yours.attack.queue;
  const queueFull = launchQueue.length >= MAX_LAUNCH_QUEUE_SIZE;
  const selectedBalloonConfig = BALLOON_TYPES[selectedBalloonType];
  const insufficientSendCoins = snapshot.rooms.yours.economy.coins < selectedBalloonConfig.cost;
  const selectedBalloonLocked = !snapshot.rooms.yours.unlockedBalloonTypes[selectedBalloonType];
  const currentRound = snapshot.wave.roundId ? WAVE_ROUNDS[snapshot.wave.roundId - 1] : null;

  const handleFieldPress = useCallback((key: BalloonRoomKey, press: FieldPress) => {
    const room = snapshot.rooms[key];
    const balloon = findBalloonAtPoint(room, press.x, press.y, 24 / Math.min(press.width, press.height));
    if (balloon) {
      const result = dispatchAction(key, { type: "POP_BALLOON", balloonId: balloon.id });
      setFeedback({ message: result.message, valid: result.applied });
      return;
    }
    if (key !== "yours") return;
    const edge = findClosestGridEdge(press.x, press.y, press.width, press.height, 30);
    if (!edge) { setFeedback({ message: "Tap a grid edge", valid: false }); return; }
    const wall = createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY);
    let action: GameAction;
    if (buildMode === "wall") action = { type: "PLACE_WALL", wall };
    else if (buildMode === "nails") action = { type: "PLACE_NAILS", wallSegmentId: wall.id };
    else action = { type: "REMOVE_WALL", wallSegmentId: wall.id };
    const result = dispatchAction("yours", action);
    setFeedback({ message: result.message, valid: result.applied });
  }, [buildMode, dispatchAction, snapshot.rooms]);

  const sendBalloon = useCallback(() => {
    sendSequenceRef.current += 1;
    const action = createSendBalloonAction({
      matchId: "local-phase-4",
      senderId: "mobile-local-player",
      targetRoomId: snapshot.rooms.opponent.id,
      lane: selectedAttackLane,
      senderSequence: sendSequenceRef.current,
      sentAt: Date.now(),
      balloonType: selectedBalloonType,
    });
    const result = dispatchAction("yours", action, "opponent");
    if (!result.applied) {
      sendSequenceRef.current -= 1;
      setSendFeedback(result.message);
      return;
    }
    setSendFeedback("");
  }, [dispatchAction, selectedAttackLane, selectedBalloonType, snapshot.rooms.opponent.id]);

  const restartGame = useCallback(() => {
    restart();
    sendSequenceRef.current = 0;
    setFeedback(null);
    setSendFeedback("");
    setBuildMode("wall");
    setSelectedAttackLane(1);
    setSelectedBalloonType("basic");
  }, [restart]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.waveHeader}>
            <Text style={styles.waveTitle}>{snapshot.wave.status === "complete" ? "ALL WAVES COMPLETE" : snapshot.wave.status === "transition" ? `ROUND ${snapshot.wave.roundId} COMPLETE` : `ROUND ${snapshot.wave.roundId}`}</Text>
            <Text numberOfLines={1} style={styles.waveMeta}>{snapshot.wave.status === "transition" ? `NEXT IN ${snapshot.wave.nextRoundInSeconds}s` : currentRound ? `${currentRound.composition.map((entry) => `${entry.count} ${entry.balloonType[0].toUpperCase()}`).join(" · ")} · ${snapshot.wave.spawnedCount}/${snapshot.wave.totalCount}` : "PvP ACTIVE"}</Text>
            {snapshot.wave.notice ? <Text numberOfLines={1} style={styles.waveNotice}>{snapshot.wave.notice}</Text> : null}
          </View>
          <View style={styles.headerButtons}>
            <Pressable onPress={() => setDebugPaths((current) => !current)} style={[styles.smallButton, debugPaths && styles.smallButtonSelected]} accessibilityRole="button" accessibilityState={{ selected: debugPaths }}><Text style={styles.smallButtonText}>PATHS</Text></Pressable>
            <Pressable onPress={restartGame} style={styles.smallButton} accessibilityRole="button"><Text style={styles.smallButtonText}>RESTART</Text></Pressable>
          </View>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close Balloon Rooms"><Text style={styles.closeButtonText}>×</Text></Pressable>

        <View style={styles.roomsRow}>
          <RoomColumn label="YOUR ROOM" room={snapshot.rooms.yours} simulationTimeMs={snapshot.simulationTimeMs} height={fieldHeight} debugPaths={debugPaths} damageFlash={snapshot.damageFlash.yours} onPressPosition={(press) => handleFieldPress("yours", press)} />
          <RoomColumn label="OPPONENT" room={snapshot.rooms.opponent} simulationTimeMs={snapshot.simulationTimeMs} height={fieldHeight} debugPaths={debugPaths} damageFlash={snapshot.damageFlash.opponent} onPressPosition={(press) => handleFieldPress("opponent", press)} />
        </View>

        <View style={styles.controlPanelsRow}>
          <View style={styles.controlPanel}>
            <View style={styles.actionRow}>
              {(["wall", "nails", "remove"] as BuildMode[]).map((mode) => {
                const cost = mode === "wall" ? VERTICAL_WALL_COST : mode === "nails" ? NAIL_STRIP_COST : null;
                const disabled = cost !== null && snapshot.rooms.yours.economy.coins < cost;
                return <Pressable key={mode} disabled={disabled} onPress={() => { setBuildMode(mode); setFeedback(null); }} style={[styles.modeButton, buildMode === mode && styles.modeButtonSelected, disabled && styles.actionDisabled]} accessibilityRole="button" accessibilityState={{ selected: buildMode === mode, disabled }}><Text style={[styles.modeButtonText, buildMode === mode && styles.modeButtonTextSelected]}>{mode === "remove" ? "REMOVE" : `${mode.toUpperCase()} ${cost}`}</Text></Pressable>;
              })}
            </View>
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.feedback, feedback ? (feedback.valid ? styles.feedbackValid : styles.feedbackInvalid) : null]}>{feedback?.message ?? `W ${MAX_WALL_SEGMENTS - snapshot.rooms.yours.walls.length} · N ${MAX_NAIL_STRIPS - snapshot.rooms.yours.nailStrips.length}`}</Text>
          </View>
          <View style={styles.controlPanel}>
            <View style={styles.balloonTypeRow}>
              {(["basic", "speed", "heavy"] as BalloonType[]).map((balloonType) => {
                const unlocked = snapshot.rooms.yours.unlockedBalloonTypes[balloonType];
                return <Pressable key={balloonType} disabled={!unlocked} onPress={() => setSelectedBalloonType(balloonType)} style={[styles.balloonTypeButton, selectedBalloonType === balloonType && styles.balloonTypeButtonSelected, !unlocked && styles.actionDisabled]} accessibilityRole="button" accessibilityState={{ selected: selectedBalloonType === balloonType, disabled: !unlocked }}><Text style={[styles.balloonTypeText, selectedBalloonType === balloonType && styles.balloonTypeTextSelected]}>{unlocked ? `${balloonType[0].toUpperCase()} ${BALLOON_TYPES[balloonType].cost}` : `${balloonType[0].toUpperCase()} 🔒`}</Text></Pressable>;
              })}
            </View>
            <View style={styles.laneRow}>
              {([1, 2, 3, 4] as SpawnLane[]).map((lane) => <Pressable key={lane} onPress={() => setSelectedAttackLane(lane)} style={[styles.laneButton, selectedAttackLane === lane && styles.laneButtonSelected]} accessibilityRole="button" accessibilityLabel={`Select attack Lane ${lane}`} accessibilityState={{ selected: selectedAttackLane === lane }}><Text style={[styles.laneButtonText, selectedAttackLane === lane && styles.laneButtonTextSelected]}>L{lane}</Text></Pressable>)}
            </View>
            <Pressable onPress={sendBalloon} disabled={snapshot.rooms.opponent.health <= 0 || insufficientSendCoins || queueFull || selectedBalloonLocked} style={[styles.sendButton, (snapshot.rooms.opponent.health <= 0 || insufficientSendCoins || queueFull || selectedBalloonLocked) && styles.sendButtonDisabled]} accessibilityRole="button"><Text style={styles.sendButtonText}>SEND {selectedBalloonType.toUpperCase()} {selectedBalloonConfig.cost}</Text></Pressable>
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.sendFeedback, (queueFull || insufficientSendCoins || selectedBalloonLocked) && styles.feedbackInvalid]}>{queueFull ? "QUEUE FULL" : selectedBalloonLocked ? "LOCKED" : insufficientSendCoins ? `NEED ${selectedBalloonConfig.cost}` : sendFeedback || `+${selectedBalloonConfig.incomeGain} · Q ${launchQueue.length}/${MAX_LAUNCH_QUEUE_SIZE} ${launchQueue.map((queued) => `${queued.balloonType[0].toUpperCase()}${queued.lane}`).join("›")}`}</Text>
          </View>
        </View>

        <View style={styles.debugPanel}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.debugText}>DEV · 60/30 Hz · {describeRoom("Y", snapshot.rooms.yours)} · {describeRoom("O", snapshot.rooms.opponent)}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function RoomColumn({ label, room, simulationTimeMs, height, debugPaths, damageFlash, onPressPosition }: { label: string; room: BalloonRoom; simulationTimeMs: number; height: number; debugPaths: boolean; damageFlash: boolean; onPressPosition: (press: FieldPress) => void }) {
  const nextIncomeSeconds = Math.ceil(Math.max(0, room.economy.nextIncomeTickAt - simulationTimeMs) / 1000);
  return <View style={styles.roomColumn}>
    <Text numberOfLines={1} style={styles.roomLabel}>{label}</Text>
    <Text numberOfLines={1} style={styles.economyLine}>◉ {room.economy.coins} · +{room.economy.income}/{INCOME_TICK_INTERVAL_MS / 1000}s · {String(nextIncomeSeconds).padStart(2, "0")}s</Text>
    <BalloonRoomField room={room} height={height} debugPaths={debugPaths} damageFlash={damageFlash} onPressPosition={onPressPosition} />
    <View style={styles.statusPanel}>
      <View style={styles.healthRow}><Text style={room.health > 0 ? styles.health : styles.brokenText}>{room.health > 0 ? `HP ${room.health}/${ROOM_MAX_HEALTH}` : "BROKEN"}</Text><Text style={styles.activeCount}>{room.balloons.length} ACTIVE</Text></View>
      <View style={styles.healthTrack}><View style={[styles.healthFill, { width: `${(room.health / ROOM_MAX_HEALTH) * 100}%` }]} /></View>
    </View>
  </View>;
}

function describeRoom(label: string, room: BalloonRoom): string {
  const vertical = room.walls.filter((wall) => wall.orientation === "vertical").length;
  const horizontal = room.walls.length - vertical;
  const supported = horizontal - getUnsupportedHorizontalWalls(room.walls).length;
  return `${label} HP${room.health} B${room.balloons.length} V${vertical}/H${horizontal} (${supported} supported) N${room.nailStrips.length} routes ${hasRequiredRoutes(room, room.walls) ? "valid" : "invalid"}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#07000F" },
  content: { flex: 1, overflow: "hidden", paddingHorizontal: 6, paddingTop: 3, paddingBottom: 4 },
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, paddingRight: 38 },
  waveHeader: { flex: 1, minWidth: 0 }, waveTitle: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" }, waveMeta: { color: "#D8B4FE", fontSize: 7, fontWeight: "800", marginTop: 1 }, waveNotice: { color: "#A7F3D0", fontSize: 7, fontWeight: "900", marginTop: 1 },
  headerButtons: { flexDirection: "row", gap: 4 }, smallButton: { minHeight: 32, justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", borderRadius: 7, paddingHorizontal: 10, backgroundColor: "rgba(0,0,0,0.22)" }, smallButtonSelected: { borderColor: "#D8B4FE", backgroundColor: "rgba(139,61,255,0.3)" }, smallButtonText: { color: "#E4E4E7", fontSize: 8, fontWeight: "900" },
  closeButton: { position: "absolute", zIndex: 10, top: 3, right: 5, width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: 16, backgroundColor: "rgba(0,0,0,0.45)" }, closeButtonText: { color: "#FFFFFF", fontSize: 22, fontWeight: "500", lineHeight: 24 },
  roomsRow: { flexDirection: "row", alignItems: "flex-start", gap: 5 }, roomColumn: { flex: 1, minWidth: 0 }, roomLabel: { height: 14, color: "#E9D5FF", fontSize: 8, fontWeight: "900", letterSpacing: 0.7, textAlign: "center" },
  economyLine: { height: 18, color: "#D4D4D8", fontSize: 8, fontWeight: "800", textAlign: "center" },
  statusPanel: { height: 32, paddingHorizontal: 5, paddingVertical: 4, borderWidth: 1, borderTopWidth: 0, borderColor: "rgba(221,194,255,0.22)", borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: "rgba(23,16,32,0.96)" },
  healthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, health: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" }, activeCount: { color: "#71717A", fontSize: 7, fontWeight: "900" }, healthTrack: { height: 3, overflow: "hidden", borderRadius: 2, backgroundColor: "rgba(0,0,0,0.55)", marginTop: 3 }, healthFill: { height: "100%", borderRadius: 2, backgroundColor: "#C026D3" }, brokenText: { color: "#FCA5A5", fontSize: 9, fontWeight: "900" },
  controlPanelsRow: { minHeight: 112, flexDirection: "row", alignItems: "stretch", gap: 5, marginTop: 5 }, controlPanel: { flex: 1, padding: 5, borderWidth: 1, borderColor: "rgba(221,194,255,0.18)", borderRadius: 8, backgroundColor: "rgba(23,16,32,0.96)" },
  actionRow: { flexDirection: "row", gap: 3 }, modeButton: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 6, backgroundColor: "rgba(0,0,0,0.22)" }, modeButtonSelected: { borderColor: "#D8B4FE", backgroundColor: "rgba(139,61,255,0.36)" }, modeButtonText: { color: "#A1A1AA", fontSize: 7, fontWeight: "900" }, modeButtonTextSelected: { color: "#FFFFFF" }, feedback: { minHeight: 15, marginTop: 4, color: "#71717A", fontSize: 7, fontWeight: "900", textAlign: "center" }, feedbackValid: { color: "#A7F3D0" }, feedbackInvalid: { color: "#FCA5A5" },
  actionDisabled: { opacity: 0.4 },
  balloonTypeRow: { flexDirection: "row", gap: 3, marginBottom: 4 }, balloonTypeButton: { flex: 1, minHeight: 26, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 6, backgroundColor: "rgba(0,0,0,0.22)" }, balloonTypeButtonSelected: { borderColor: "#FDE68A", backgroundColor: "rgba(245,158,11,0.22)" }, balloonTypeText: { color: "#A1A1AA", fontSize: 7, fontWeight: "900" }, balloonTypeTextSelected: { color: "#FFFFFF" },
  laneRow: { flexDirection: "row", gap: 3 }, laneButton: { flex: 1, minHeight: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 6, backgroundColor: "rgba(0,0,0,0.22)" }, laneButtonSelected: { borderColor: "#F9A8D4", backgroundColor: "rgba(219,39,119,0.36)" }, laneButtonText: { color: "#A1A1AA", fontSize: 9, fontWeight: "900" }, laneButtonTextSelected: { color: "#FFFFFF" }, sendButton: { minHeight: 34, marginTop: 4, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#F9A8D4", borderRadius: 6, backgroundColor: "#C026D3" }, sendButtonDisabled: { opacity: 0.4 }, sendButtonText: { color: "#FFFFFF", fontSize: 8, fontWeight: "900", letterSpacing: 0.5 }, sendFeedback: { minHeight: 14, marginTop: 3, color: "#A1A1AA", fontSize: 7, fontWeight: "800", textAlign: "center" },
  debugPanel: { height: 20, marginTop: 4, paddingHorizontal: 5, justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 6, backgroundColor: "rgba(0,0,0,0.2)" }, debugText: { color: "#52525B", fontFamily: "monospace", fontSize: 7 },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, unavailableTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", textAlign: "center" }, secondaryButton: { minHeight: 48, marginTop: 22, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", borderRadius: 10 }, secondaryButtonText: { color: "#D8B4FE", fontWeight: "900" },
});
