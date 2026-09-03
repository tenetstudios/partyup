import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  BALLOON_TYPES, GLUE_COST, INCOME_TICK_INTERVAL_MS, NAIL_STRIP_COST,
  MAX_LAUNCH_QUEUE_SIZE, MAX_NAIL_STRIPS, MAX_WALL_SEGMENTS, ROOM_MAX_HEALTH, createSendBalloonAction, createWallSegment,
  VERTICAL_WALL_COST, getWaveRound,
  WALL_REPAIR_AMOUNT, WALL_REPAIR_COST, WALL_REPAIR_THRESHOLD,
  findBalloonAtPoint, findClosestGridEdge,
  type BalloonRoom, type BalloonType, type GameAction, type SpawnLane,
} from "@partyup/balloon-core";
import { BalloonRoomField, type FieldPress } from "@/components/balloonRooms/BalloonRoomField";
import { useBalloonRoomsSimulation, type BalloonRoomKey, type StructuralVisualEffect } from "@/hooks/useBalloonRoomsSimulation";

type BuildMode = "wall" | "nails" | "glue" | "remove";

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
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedAttackLane, setSelectedAttackLane] = useState<SpawnLane>(1);
  const [feedback, setFeedback] = useState<{ message: string; valid: boolean } | null>(null);
  const [sendFeedback, setSendFeedback] = useState("");
  const fieldHeight = Math.max(120, Math.min(520, windowHeight - 285));
  const launchQueue = snapshot.rooms.yours.attack.queue;
  const queueFull = launchQueue.length >= MAX_LAUNCH_QUEUE_SIZE;
  const currentRound = snapshot.wave.roundId ? getWaveRound(snapshot.wave.roundId) : null;
  const selectedWall = snapshot.rooms.yours.walls.find((wall) => wall.id === selectedWallId) ?? null;
  const selectedWallRepairable = selectedWall !== null
    && selectedWall.integrity > 0
    && selectedWall.integrity <= WALL_REPAIR_THRESHOLD;

  const handleFieldPress = useCallback((key: BalloonRoomKey, press: FieldPress) => {
    const room = snapshot.rooms[key];
    const balloon = findBalloonAtPoint(room, press.x, press.y, 24 / Math.min(press.width, press.height));
    if (balloon) {
      const result = dispatchAction(key, { type: "POP_BALLOON", balloonId: balloon.id });
      setFeedback({ message: result.message, valid: result.applied });
      return;
    }
    if (key !== "yours") return;
    const edge = findClosestGridEdge(press.x, press.y, press.width, press.height, 42);
    const candidateId = edge ? createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY).id : null;
    setSelectedWallId(candidateId && room.walls.some((wall) => wall.id === candidateId) ? candidateId : null);
    setFeedback(null);
  }, [dispatchAction, snapshot.rooms]);

  const handleFieldLongPress = useCallback((key: BalloonRoomKey, press: FieldPress) => {
    if (key !== "yours") return;
    const room = snapshot.rooms[key];
    if (findBalloonAtPoint(room, press.x, press.y, 24 / Math.min(press.width, press.height))) return;
    const edge = findClosestGridEdge(press.x, press.y, press.width, press.height, 30);
    if (!edge) { setFeedback({ message: "Hold directly on a grid edge", valid: false }); return; }
    const wall = createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY);
    let action: GameAction;
    if (buildMode === "wall") action = { type: "PLACE_WALL", wall };
    else if (buildMode === "nails") action = { type: "PLACE_NAILS", wallSegmentId: wall.id };
    else if (buildMode === "glue") action = { type: "PLACE_GLUE", wallSegmentId: wall.id };
    else action = { type: "REMOVE_WALL", wallSegmentId: wall.id };
    const result = dispatchAction("yours", action);
    setFeedback({ message: result.message, valid: result.applied });
  }, [buildMode, dispatchAction, snapshot.rooms]);

  const sendBalloon = useCallback((balloonType: BalloonType) => {
    sendSequenceRef.current += 1;
    const action = createSendBalloonAction({
      matchId: "local-phase-4",
      senderId: "mobile-local-player",
      targetRoomId: snapshot.rooms.opponent.id,
      lane: selectedAttackLane,
      senderSequence: sendSequenceRef.current,
      sentAt: Date.now(),
      balloonType,
    });
    const result = dispatchAction("yours", action, "opponent");
    if (!result.applied) {
      sendSequenceRef.current -= 1;
      setSendFeedback(result.message);
      return;
    }
    setSendFeedback(`${balloonType.toUpperCase()} sent to Lane ${selectedAttackLane}`);
  }, [dispatchAction, selectedAttackLane, snapshot.rooms.opponent.id]);

  const repairSelectedWall = useCallback(() => {
    if (!selectedWallId) return;
    const result = dispatchAction("yours", { type: "REPAIR_WALL", wallSegmentId: selectedWallId });
    setFeedback({ message: result.message, valid: result.applied });
  }, [dispatchAction, selectedWallId]);

  const restartGame = useCallback(() => {
    restart();
    sendSequenceRef.current = 0;
    setFeedback(null);
    setSendFeedback("");
    setBuildMode("wall");
    setSelectedWallId(null);
    setSelectedAttackLane(1);
  }, [restart]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.waveHeader}>
            <Text style={styles.waveTitle}>{snapshot.wave.status === "complete" ? "ALL WAVES COMPLETE" : snapshot.wave.status === "transition" ? `ROUND ${snapshot.wave.nextRoundId} STARTS IN ${snapshot.wave.nextRoundInSeconds}s` : `ROUND ${snapshot.wave.roundId}`}</Text>
            <Text numberOfLines={1} style={styles.waveMeta}>{snapshot.wave.status === "transition" ? "BUILD WINDOW · HOLD 0.5s ON A GRID EDGE" : currentRound ? `${currentRound.composition.map((entry) => `${entry.count} ${entry.balloonType[0].toUpperCase()}`).join(" · ")} · ${snapshot.wave.spawnedCount}/${snapshot.wave.totalCount}` : "PvP ACTIVE"}</Text>
            {snapshot.wave.notice ? <Text numberOfLines={1} style={styles.waveNotice}>{snapshot.wave.notice}</Text> : null}
          </View>
          <View style={styles.headerButtons}>
            <Pressable onPress={() => setDebugPaths((current) => !current)} style={[styles.smallButton, debugPaths && styles.smallButtonSelected]} accessibilityRole="button" accessibilityState={{ selected: debugPaths }}><Text style={styles.smallButtonText}>PATHS</Text></Pressable>
            <Pressable onPress={restartGame} style={styles.smallButton} accessibilityRole="button"><Text style={styles.smallButtonText}>RESTART</Text></Pressable>
          </View>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close Balloon Rooms"><Text style={styles.closeButtonText}>×</Text></Pressable>

        <View style={styles.roomsRow}>
          <RoomColumn label="YOUR ROOM" room={snapshot.rooms.yours} simulationTimeMs={snapshot.simulationTimeMs} height={fieldHeight} debugPaths={debugPaths} damageFlash={snapshot.damageFlash.yours} structuralEffects={snapshot.structuralEffects.yours} selectedWallId={selectedWallId} onPressPosition={(press) => handleFieldPress("yours", press)} onLongPressPosition={(press) => handleFieldLongPress("yours", press)} />
          <RoomColumn label="OPPONENT" room={snapshot.rooms.opponent} simulationTimeMs={snapshot.simulationTimeMs} height={fieldHeight} debugPaths={debugPaths} damageFlash={snapshot.damageFlash.opponent} structuralEffects={snapshot.structuralEffects.opponent} invulnerable selectedAttackLane={selectedAttackLane} onSelectAttackLane={setSelectedAttackLane} onPressPosition={(press) => handleFieldPress("opponent", press)} />
        </View>

        <View style={styles.controlPanelsRow}>
          <View style={styles.controlPanel}>
            <View style={styles.actionRow}>
              {(["wall", "nails", "glue", "remove"] as BuildMode[]).map((mode) => {
                const cost = mode === "wall" ? VERTICAL_WALL_COST : mode === "nails" ? NAIL_STRIP_COST : mode === "glue" ? GLUE_COST : null;
                const disabled = cost !== null && snapshot.rooms.yours.economy.coins < cost;
                return <Pressable key={mode} disabled={disabled} onPress={() => { setBuildMode(mode); setFeedback(null); }} style={[styles.modeButton, buildMode === mode && styles.modeButtonSelected, disabled && styles.actionDisabled]} accessibilityRole="button" accessibilityState={{ selected: buildMode === mode, disabled }}><Text style={[styles.modeButtonText, buildMode === mode && styles.modeButtonTextSelected]}>{mode === "remove" ? "REMOVE" : `${mode.toUpperCase()} ${cost}`}</Text></Pressable>;
              })}
            </View>
            {selectedWall ? <View style={styles.repairRow}>
              <View style={styles.repairInfo}><Text numberOfLines={1} style={styles.repairTitle}>WALL {selectedWall.integrity}/{selectedWall.maxIntegrity}</Text><Text numberOfLines={1} style={styles.repairMeta}>{selectedWallRepairable ? `Restore +${WALL_REPAIR_AMOUNT}` : `Repair at ${WALL_REPAIR_THRESHOLD} or less`}</Text></View>
              <Pressable onPress={repairSelectedWall} disabled={!selectedWallRepairable || snapshot.rooms.yours.economy.coins < WALL_REPAIR_COST} hitSlop={4} style={[styles.repairButton, (!selectedWallRepairable || snapshot.rooms.yours.economy.coins < WALL_REPAIR_COST) && styles.actionDisabled]} accessibilityRole="button" accessibilityLabel={`Repair selected wall for ${WALL_REPAIR_COST} coins`} accessibilityState={{ disabled: !selectedWallRepairable || snapshot.rooms.yours.economy.coins < WALL_REPAIR_COST }}><Text style={styles.repairButtonText}>{selectedWallRepairable && snapshot.rooms.yours.economy.coins < WALL_REPAIR_COST ? `NEED ${WALL_REPAIR_COST}` : `REPAIR +${WALL_REPAIR_AMOUNT} · ${WALL_REPAIR_COST}`}</Text></Pressable>
            </View> : null}
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.feedback, feedback ? (feedback.valid ? styles.feedbackValid : styles.feedbackInvalid) : null]}>{feedback?.message ?? `Hold 0.5s to ${buildMode} · W ${MAX_WALL_SEGMENTS - snapshot.rooms.yours.walls.length} · N ${MAX_NAIL_STRIPS - snapshot.rooms.yours.nailStrips.length} · G ${snapshot.rooms.yours.glueTraps.length}`}</Text>
          </View>
          <View style={styles.controlPanel}>
            <Text numberOfLines={1} style={styles.attackPrompt}>TAP TO SEND · LANE {selectedAttackLane}</Text>
            <View style={styles.balloonTypeRow}>
              {(["basic", "speed", "heavy"] as BalloonType[]).map((balloonType) => {
                const unlocked = snapshot.rooms.yours.unlockedBalloonTypes[balloonType];
                const config = BALLOON_TYPES[balloonType];
                const disabled = snapshot.rooms.opponent.health <= 0 || !unlocked || snapshot.rooms.yours.economy.coins < config.cost || queueFull;
                return <Pressable key={balloonType} disabled={disabled} onPress={() => sendBalloon(balloonType)} style={[styles.balloonTypeButton, !disabled && styles.balloonTypeButtonReady, disabled && styles.actionDisabled]} accessibilityRole="button" accessibilityLabel={`Send ${balloonType} balloon for ${config.cost} coins to Lane ${selectedAttackLane}`} accessibilityState={{ disabled }}><Text style={[styles.balloonTypeText, !disabled && styles.balloonTypeTextReady]}>{unlocked ? `${balloonType.toUpperCase()}\n${config.cost}` : `${balloonType.toUpperCase()}\nLOCKED`}</Text></Pressable>;
              })}
            </View>
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.sendFeedback, queueFull && styles.feedbackInvalid]}>{queueFull ? "QUEUE FULL" : sendFeedback || `Q ${launchQueue.length}/${MAX_LAUNCH_QUEUE_SIZE} ${launchQueue.map((queued) => `${queued.balloonType[0].toUpperCase()}${queued.lane}`).join("›") || "EMPTY"}`}</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function RoomColumn({ label, room, simulationTimeMs, height, debugPaths, damageFlash, structuralEffects, selectedWallId, selectedAttackLane, invulnerable = false, onPressPosition, onLongPressPosition, onSelectAttackLane }: { label: string; room: BalloonRoom; simulationTimeMs: number; height: number; debugPaths: boolean; damageFlash: boolean; structuralEffects: StructuralVisualEffect[]; selectedWallId?: string | null; selectedAttackLane?: SpawnLane; invulnerable?: boolean; onPressPosition: (press: FieldPress) => void; onLongPressPosition?: (press: FieldPress) => void; onSelectAttackLane?: (lane: SpawnLane) => void }) {
  const nextIncomeSeconds = Math.ceil(Math.max(0, room.economy.nextIncomeTickAt - simulationTimeMs) / 1000);
  return <View style={styles.roomColumn}>
    <Text numberOfLines={1} style={styles.roomLabel}>{label}</Text>
    <Text numberOfLines={1} style={styles.economyLine}>◉ {room.economy.coins} · +{room.economy.income}/{INCOME_TICK_INTERVAL_MS / 1000}s · {String(nextIncomeSeconds).padStart(2, "0")}s</Text>
    <View style={[styles.fieldWrap, { height }]}>
      <BalloonRoomField room={room} height={height} debugPaths={debugPaths} damageFlash={damageFlash} structuralEffects={structuralEffects} selectedWallId={selectedWallId} onPressPosition={onPressPosition} onLongPressPosition={onLongPressPosition} />
      {onSelectAttackLane && selectedAttackLane ? <View style={styles.fieldLanePicker} accessibilityRole="radiogroup">
        {([1, 2, 3, 4] as SpawnLane[]).map((lane) => <Pressable key={lane} onPress={() => onSelectAttackLane(lane)} style={[styles.fieldLaneButton, selectedAttackLane === lane && styles.fieldLaneButtonSelected]} accessibilityRole="radio" accessibilityLabel={`Target attack Lane ${lane}`} accessibilityState={{ selected: selectedAttackLane === lane }}><Text style={[styles.fieldLaneText, selectedAttackLane === lane && styles.fieldLaneTextSelected]}>L{lane}</Text></Pressable>)}
      </View> : null}
    </View>
    <View style={styles.statusPanel}>
      <View style={styles.healthRow}><Text style={room.health > 0 ? styles.health : styles.brokenText}>{invulnerable ? "HP ∞ · DEV" : room.health > 0 ? `HP ${room.health}/${ROOM_MAX_HEALTH}` : "BROKEN"}</Text><Text style={styles.activeCount}>{room.balloons.length} ACTIVE</Text></View>
      <View style={styles.healthTrack}><View style={[styles.healthFill, { width: `${(room.health / ROOM_MAX_HEALTH) * 100}%` }]} /></View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#07000F" },
  content: { flex: 1, overflow: "hidden", paddingHorizontal: 6, paddingTop: 3, paddingBottom: 4 },
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, paddingRight: 38 },
  waveHeader: { flex: 1, minWidth: 0 }, waveTitle: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" }, waveMeta: { color: "#D8B4FE", fontSize: 7, fontWeight: "800", marginTop: 1 }, waveNotice: { color: "#A7F3D0", fontSize: 7, fontWeight: "900", marginTop: 1 },
  headerButtons: { flexDirection: "row", gap: 4 }, smallButton: { minHeight: 32, justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", borderRadius: 7, paddingHorizontal: 10, backgroundColor: "rgba(0,0,0,0.22)" }, smallButtonSelected: { borderColor: "#D8B4FE", backgroundColor: "rgba(139,61,255,0.3)" }, smallButtonText: { color: "#E4E4E7", fontSize: 8, fontWeight: "900" },
  closeButton: { position: "absolute", zIndex: 10, top: 3, right: 5, width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: 16, backgroundColor: "rgba(0,0,0,0.45)" }, closeButtonText: { color: "#FFFFFF", fontSize: 22, fontWeight: "500", lineHeight: 24 },
  roomsRow: { flexDirection: "row", alignItems: "flex-start", gap: 5 }, roomColumn: { flex: 1, minWidth: 0 }, roomLabel: { height: 14, color: "#E9D5FF", fontSize: 8, fontWeight: "900", letterSpacing: 0.7, textAlign: "center" }, fieldWrap: { position: "relative" },
  economyLine: { height: 18, color: "#D4D4D8", fontSize: 8, fontWeight: "800", textAlign: "center" },
  statusPanel: { height: 32, paddingHorizontal: 5, paddingVertical: 4, borderWidth: 1, borderTopWidth: 0, borderColor: "rgba(221,194,255,0.22)", borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: "rgba(23,16,32,0.96)" },
  healthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, health: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" }, activeCount: { color: "#71717A", fontSize: 7, fontWeight: "900" }, healthTrack: { height: 3, overflow: "hidden", borderRadius: 2, backgroundColor: "rgba(0,0,0,0.55)", marginTop: 3 }, healthFill: { height: "100%", borderRadius: 2, backgroundColor: "#C026D3" }, brokenText: { color: "#FCA5A5", fontSize: 9, fontWeight: "900" },
  controlPanelsRow: { minHeight: 84, flexDirection: "row", alignItems: "stretch", gap: 5, marginTop: 5 }, controlPanel: { flex: 1, padding: 5, borderWidth: 1, borderColor: "rgba(221,194,255,0.18)", borderRadius: 8, backgroundColor: "rgba(23,16,32,0.96)" },
  actionRow: { flexDirection: "row", gap: 3 }, modeButton: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 6, backgroundColor: "rgba(0,0,0,0.22)" }, modeButtonSelected: { borderColor: "#D8B4FE", backgroundColor: "rgba(139,61,255,0.36)" }, modeButtonText: { color: "#A1A1AA", fontSize: 7, fontWeight: "900" }, modeButtonTextSelected: { color: "#FFFFFF" }, feedback: { minHeight: 15, marginTop: 4, color: "#71717A", fontSize: 7, fontWeight: "900", textAlign: "center" }, feedbackValid: { color: "#A7F3D0" }, feedbackInvalid: { color: "#FCA5A5" },
  actionDisabled: { opacity: 0.4 },
  repairRow: { minHeight: 40, marginTop: 4, paddingLeft: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4, borderWidth: 1, borderColor: "rgba(253,230,138,0.25)", borderRadius: 6, backgroundColor: "rgba(253,230,138,0.08)" }, repairInfo: { flex: 1, minWidth: 0 }, repairTitle: { color: "#FEF3C7", fontSize: 8, fontWeight: "900" }, repairMeta: { color: "#A1A1AA", fontSize: 6, fontWeight: "800" }, repairButton: { minHeight: 36, minWidth: 72, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(253,230,138,0.65)", borderRadius: 5, backgroundColor: "rgba(253,230,138,0.15)" }, repairButtonText: { color: "#FEF3C7", fontSize: 7, fontWeight: "900" },
  attackPrompt: { height: 12, color: "#FBCFE8", fontSize: 7, fontWeight: "900", textAlign: "center" }, balloonTypeRow: { flexDirection: "row", gap: 3 }, balloonTypeButton: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 6, backgroundColor: "rgba(0,0,0,0.22)" }, balloonTypeButtonReady: { borderColor: "rgba(249,168,212,0.5)", backgroundColor: "rgba(192,38,211,0.3)" }, balloonTypeText: { color: "#A1A1AA", fontSize: 7, lineHeight: 11, fontWeight: "900", textAlign: "center" }, balloonTypeTextReady: { color: "#FFFFFF" }, sendFeedback: { minHeight: 12, marginTop: 2, color: "#A1A1AA", fontSize: 7, fontWeight: "800", textAlign: "center" },
  fieldLanePicker: { position: "absolute", left: 4, right: 4, bottom: 4, flexDirection: "row", gap: 3, padding: 3, borderWidth: 1, borderColor: "rgba(249,168,212,0.25)", borderRadius: 7, backgroundColor: "rgba(7,0,15,0.82)" }, fieldLaneButton: { flex: 1, minHeight: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", borderRadius: 5 }, fieldLaneButtonSelected: { borderColor: "#F9A8D4", backgroundColor: "rgba(219,39,119,0.48)" }, fieldLaneText: { color: "#A1A1AA", fontSize: 9, fontWeight: "900" }, fieldLaneTextSelected: { color: "#FFFFFF" },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, unavailableTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", textAlign: "center" }, secondaryButton: { minHeight: 48, marginTop: 22, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", borderRadius: 10 }, secondaryButtonText: { color: "#D8B4FE", fontWeight: "900" },
});
