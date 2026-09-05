import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  BALLOON_TYPES, GLUE_COST, MAX_LAUNCH_QUEUE_SIZE, MAX_NAIL_STRIPS, MAX_WALL_SEGMENTS,
  NAIL_STRIP_COST, ROOM_MAX_HEALTH, VERTICAL_WALL_COST, WALL_REPAIR_AMOUNT, WALL_REPAIR_COST,
  WALL_REPAIR_THRESHOLD, createSendBalloonAction, createWallSegment, findBalloonAtPoint,
  findClosestGridEdge, getWaveRound,
  type BalloonType, type GameAction, type SpawnLane,
} from "@partyup/balloon-core";
import { BalloonRoomField, type FieldPress } from "@/components/balloonRooms/BalloonRoomField";
import {
  FloatArenaHeader, FloatArenaTransition, FloatBackdrop, FloatHud, FloatLaneOverlay,
  FloatModeSwitch, FloatResultOverlay, FloatToolbar, type FloatMode, type FloatTool,
} from "@/components/balloonRooms/FloatMobileUi";
import { useBalloonRoomsSimulation, type BalloonRoomKey } from "@/hooks/useBalloonRoomsSimulation";

type BuildMode = "wall" | "nails" | "glue" | "remove";

export default function BalloonRoomsRoute() {
  if (!__DEV__) {
    return <FloatBackdrop><View style={styles.unavailable}><Text style={styles.unavailableTitle}>DEVELOPMENT BUILD ONLY</Text><Pressable onPress={() => router.back()} style={styles.devButton}><Text style={styles.devButtonText}>GO BACK</Text></Pressable></View></FloatBackdrop>;
  }
  return <BalloonRoomsDevScreen />;
}

function BalloonRoomsDevScreen() {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const { snapshot, dispatchAction, restart } = useBalloonRoomsSimulation();
  const sendSequenceRef = useRef(0);
  const [mode, setMode] = useState<FloatMode>("defend");
  const [debugPaths, setDebugPaths] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [buildMode, setBuildMode] = useState<BuildMode>("wall");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedAttackLane, setSelectedAttackLane] = useState<SpawnLane>(1);
  const [feedback, setFeedback] = useState<{ message: string; valid: boolean } | null>(null);
  const [sendFeedback, setSendFeedback] = useState("");
  const fieldHeight = Math.max(windowWidth > windowHeight ? 80 : 240, Math.min(610, windowHeight - (windowWidth > windowHeight ? 285 : 345)));
  const launchQueue = snapshot.rooms.yours.attack.queue;
  const queueFull = launchQueue.length >= MAX_LAUNCH_QUEUE_SIZE;
  const currentRound = snapshot.wave.roundId ? getWaveRound(snapshot.wave.roundId) : null;
  const selectedWall = snapshot.rooms.yours.walls.find(wall => wall.id === selectedWallId) ?? null;
  const selectedWallRepairable = selectedWall !== null && selectedWall.integrity > 0 && selectedWall.integrity <= WALL_REPAIR_THRESHOLD;

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
    setSelectedWallId(candidateId && room.walls.some(wall => wall.id === candidateId) ? candidateId : null);
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
    const action = createSendBalloonAction({ matchId: "local-phase-4", senderId: "mobile-local-player", targetRoomId: snapshot.rooms.opponent.id, lane: selectedAttackLane, senderSequence: sendSequenceRef.current, sentAt: Date.now(), balloonType });
    const result = dispatchAction("yours", action, "opponent");
    if (!result.applied) { sendSequenceRef.current -= 1; setSendFeedback(result.message); return; }
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
    setMode("defend");
    setDevOpen(false);
  }, [restart]);

  const viewedRoom = mode === "defend" ? snapshot.rooms.yours : snapshot.rooms.opponent;
  const round = snapshot.wave.status === "transition" ? snapshot.wave.nextRoundId : snapshot.wave.roundId;
  const roundStatus = snapshot.wave.status === "transition"
    ? `Build your defense · ${snapshot.wave.nextRoundInSeconds}s`
    : currentRound
      ? `Keep them from reaching the top · ${snapshot.wave.spawnedCount}/${snapshot.wave.totalCount}`
      : "Keep them from reaching the top";
  const defenseTools: FloatTool[] = (["wall", "nails", "glue", "remove"] as BuildMode[]).map(item => {
    const cost = item === "wall" ? VERTICAL_WALL_COST : item === "nails" ? NAIL_STRIP_COST : item === "glue" ? GLUE_COST : undefined;
    return { key: item, label: item.toUpperCase(), kind: item, cost, selected: buildMode === item, disabled: cost !== undefined && snapshot.rooms.yours.economy.coins < cost };
  });
  const attackTools: FloatTool[] = (["basic", "speed", "heavy"] as BalloonType[]).map(item => {
    const config = BALLOON_TYPES[item];
    const unlocked = snapshot.rooms.yours.unlockedBalloonTypes[item];
    return { key: item, label: item.toUpperCase(), kind: item, cost: unlocked ? config.cost : undefined, disabled: snapshot.rooms.opponent.health <= 0 || !unlocked || snapshot.rooms.yours.economy.coins < config.cost || queueFull };
  });

  return <FloatBackdrop>
    <View style={styles.content}>
      <FloatHud round={`ROUND ${round ?? 1} / 20`} status={roundStatus} connection="LOCAL" onClose={() => router.back()} onSettings={() => setDevOpen(value => !value)} />
      {devOpen ? <View style={styles.devMenu}><Pressable onPress={() => setDebugPaths(value => !value)} style={[styles.devButton, debugPaths && styles.devButtonActive]}><Text style={styles.devButtonText}>{debugPaths ? "HIDE PATHS" : "SHOW PATHS"}</Text></Pressable><Pressable onPress={restartGame} style={styles.devButton}><Text style={styles.devButtonText}>RESTART</Text></Pressable></View> : null}
      <FloatModeSwitch mode={mode} onChange={next => { setMode(next); setFeedback(null); setSendFeedback(""); }} />
      <FloatArenaTransition mode={mode}>
        <View style={styles.arenaCard}>
          <FloatArenaHeader label={mode === "defend" ? "YOUR ROOM" : "OPPONENT"} coins={viewedRoom.economy.coins} income={viewedRoom.economy.income} health={viewedRoom.health} maxHealth={ROOM_MAX_HEALTH} />
          <View style={[styles.fieldWrap, { height: fieldHeight }]}>
            <BalloonRoomField room={viewedRoom} height={fieldHeight} debugPaths={debugPaths} showGrid={mode === "defend" && buildMode === "wall"} damageFlash={snapshot.damageFlash[mode === "defend" ? "yours" : "opponent"]} structuralEffects={snapshot.structuralEffects[mode === "defend" ? "yours" : "opponent"]} selectedWallId={mode === "defend" ? selectedWallId : null} onPressPosition={mode === "defend" ? press => handleFieldPress("yours", press) : undefined} onLongPressPosition={mode === "defend" ? press => handleFieldLongPress("yours", press) : undefined} />
            {mode === "attack" ? <FloatLaneOverlay lane={selectedAttackLane} onSelect={setSelectedAttackLane} /> : null}
            {mode === "defend" && selectedWall ? <View style={styles.repairBar}><View><Text style={styles.repairTitle}>WALL {selectedWall.integrity}/{selectedWall.maxIntegrity}</Text><Text style={styles.repairMeta}>{selectedWallRepairable ? `Restore +${WALL_REPAIR_AMOUNT}` : `Repair at ${WALL_REPAIR_THRESHOLD} or less`}</Text></View><Pressable onPress={repairSelectedWall} disabled={!selectedWallRepairable || snapshot.rooms.yours.economy.coins < WALL_REPAIR_COST} style={[styles.repairButton, (!selectedWallRepairable || snapshot.rooms.yours.economy.coins < WALL_REPAIR_COST) && styles.disabled]}><Text style={styles.repairButtonText}>REPAIR · ● {WALL_REPAIR_COST}</Text></Pressable></View> : null}
            <FloatResultOverlay label={viewedRoom.health <= 0 ? "ROOM BROKEN" : null} />
          </View>
        </View>
      </FloatArenaTransition>
      {mode === "defend"
        ? <FloatToolbar mode="defend" tools={defenseTools} feedback={feedback?.message ?? `Hold 0.5s · W ${MAX_WALL_SEGMENTS - snapshot.rooms.yours.walls.length} · N ${MAX_NAIL_STRIPS - snapshot.rooms.yours.nailStrips.length}`} onPress={key => { setBuildMode(key as BuildMode); setFeedback(null); }} />
        : <FloatToolbar mode="attack" tools={attackTools} prompt={`TAP TO SEND TO LANE ${selectedAttackLane}`} feedback={queueFull ? "QUEUE FULL" : sendFeedback || `${launchQueue.length}/${MAX_LAUNCH_QUEUE_SIZE} queued`} onPress={key => sendBalloon(key as BalloonType)} />}
    </View>
  </FloatBackdrop>;
}

const styles = StyleSheet.create({
  content: { flex: 1, minHeight: 0 }, arenaCard: { flex: 1, minHeight: 0 }, fieldWrap: { position: "relative" },
  repairBar: { position: "absolute", zIndex: 12, left: 9, right: 9, bottom: 9, minHeight: 48, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "rgba(255,239,182,.72)", borderRadius: 11, backgroundColor: "rgba(35,83,126,.92)" },
  repairTitle: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" }, repairMeta: { color: "rgba(255,255,255,.72)", fontSize: 7, fontWeight: "700", marginTop: 2 }, repairButton: { minHeight: 36, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderColor: "#FFE797", borderRadius: 8, backgroundColor: "rgba(254,216,95,.16)" }, repairButtonText: { color: "#FFF0AC", fontSize: 8, fontWeight: "900" }, disabled: { opacity: .4 },
  devMenu: { position: "absolute", zIndex: 30, right: 4, top: 48, width: 130, gap: 5, padding: 7, borderWidth: 1, borderColor: "rgba(225,248,255,.72)", borderRadius: 12, backgroundColor: "rgba(29,82,128,.94)" }, devButton: { minHeight: 38, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(225,248,255,.45)", borderRadius: 8, backgroundColor: "rgba(31,91,143,.60)" }, devButtonActive: { borderColor: "#FFFFFF", backgroundColor: "rgba(93,118,212,.7)" }, devButtonText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, unavailableTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginBottom: 16 },
});
