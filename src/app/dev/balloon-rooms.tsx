import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  MAX_NAIL_STRIPS, MAX_WALL_SEGMENTS, ROOM_MAX_HEALTH, createWallSegment,
  findBalloonAtPoint, findClosestGridEdge, getUnsupportedHorizontalWalls, hasRequiredRoutes,
  type BalloonRoom, type GameAction,
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
  const [debugPaths, setDebugPaths] = useState(false);
  const [buildMode, setBuildMode] = useState<BuildMode>("wall");
  const [feedback, setFeedback] = useState<{ message: string; valid: boolean } | null>(null);
  const fieldHeight = Math.max(320, Math.min(500, windowHeight * 0.53));

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

  const restartGame = useCallback(() => { restart(); setFeedback(null); setBuildMode("wall"); }, [restart]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.titleBlock}><Text style={styles.eyebrow}>PHASE 3 · SHARED CORE</Text><Text style={styles.title}>BALLOON ROOMS</Text></View>
          <View style={styles.headerButtons}>
            <Pressable onPress={() => setDebugPaths((current) => !current)} style={[styles.smallButton, debugPaths && styles.smallButtonSelected]} accessibilityRole="button" accessibilityState={{ selected: debugPaths }}><Text style={styles.smallButtonText}>PATHS</Text></Pressable>
            <Pressable onPress={restartGame} style={styles.smallButton} accessibilityRole="button"><Text style={styles.smallButtonText}>RESTART</Text></Pressable>
          </View>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8}><Text style={styles.back}>← BACK</Text></Pressable>
        <Text style={styles.instructions}>Tap any balloon for 1 damage. Choose a build mode, then tap an edge in your room.</Text>

        <View style={styles.roomsRow}>
          <RoomColumn label="YOUR ROOM" room={snapshot.rooms.yours} height={fieldHeight} debugPaths={debugPaths} damageFlash={snapshot.damageFlash.yours} onPressPosition={(press) => handleFieldPress("yours", press)} />
          <RoomColumn label="OPPONENT ROOM" room={snapshot.rooms.opponent} height={fieldHeight} debugPaths={debugPaths} damageFlash={snapshot.damageFlash.opponent} onPressPosition={(press) => handleFieldPress("opponent", press)} />
        </View>

        <View style={styles.controls}>
          <View style={styles.modeRow}>
            {(["wall", "nails", "remove"] as BuildMode[]).map((mode) => <Pressable key={mode} onPress={() => { setBuildMode(mode); setFeedback(null); }} style={[styles.modeButton, buildMode === mode && styles.modeButtonSelected]} accessibilityRole="button" accessibilityState={{ selected: buildMode === mode }}><Text style={[styles.modeButtonText, buildMode === mode && styles.modeButtonTextSelected]}>{mode.toUpperCase()}</Text></Pressable>)}
          </View>
          <Text style={[styles.feedback, feedback ? (feedback.valid ? styles.feedbackValid : styles.feedbackInvalid) : null]}>{feedback?.message ?? `${MAX_WALL_SEGMENTS - snapshot.rooms.yours.walls.length} walls · ${MAX_NAIL_STRIPS - snapshot.rooms.yours.nailStrips.length} nails available`}</Text>
          <Text style={styles.removeHint}>REMOVE: first tap removes nails; second tap removes the wall.</Text>
        </View>

        <View style={styles.debugPanel}>
          <Text style={styles.debugText}>DEV · grid 6×10 · fixed 60 Hz simulation / 30 Hz visual snapshots</Text>
          <Text style={styles.debugText}>{describeRoom("yours", snapshot.rooms.yours)} · {describeRoom("opponent", snapshot.rooms.opponent)}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RoomColumn({ label, room, height, debugPaths, damageFlash, onPressPosition }: { label: string; room: BalloonRoom; height: number; debugPaths: boolean; damageFlash: boolean; onPressPosition: (press: FieldPress) => void }) {
  const brokenNails = room.nailStrips.filter((nail) => nail.status === "broken").length;
  return <View style={styles.roomColumn}>
    <Text numberOfLines={1} style={styles.roomLabel}>{label}</Text>
    <BalloonRoomField room={room} height={height} debugPaths={debugPaths} damageFlash={damageFlash} onPressPosition={onPressPosition} />
    <View style={styles.statusPanel}>
      {room.health > 0 ? <>
        <View style={styles.statusTop}><Text style={styles.statusLabel}>ROOM HP</Text><View><Text style={styles.wallCount}>WALLS {room.walls.length}/{MAX_WALL_SEGMENTS}</Text><Text style={styles.nailCount}>NAILS {room.nailStrips.length}/{MAX_NAIL_STRIPS}{brokenNails ? ` · ${brokenNails} BROKEN` : ""}</Text></View></View>
        <View style={styles.healthRow}><Text style={styles.health}>{room.health}<Text style={styles.healthMax}> / {ROOM_MAX_HEALTH}</Text></Text><Text style={styles.activeCount}>{room.balloons.length} ACTIVE</Text></View>
        <View style={styles.healthTrack}><View style={[styles.healthFill, { width: `${(room.health / ROOM_MAX_HEALTH) * 100}%` }]} /></View>
      </> : <View style={styles.brokenStatus}><Text style={styles.brokenText}>ROOM BROKEN</Text></View>}
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
  content: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 28 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  titleBlock: { flex: 1 }, eyebrow: { color: "#F0ABFC", fontSize: 9, fontWeight: "900", letterSpacing: 1.6 }, title: { color: "#FFFFFF", fontSize: 25, fontWeight: "900", marginTop: 2 },
  headerButtons: { flexDirection: "row", gap: 5 }, smallButton: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", borderRadius: 9, paddingHorizontal: 8, backgroundColor: "rgba(0,0,0,0.22)" }, smallButtonSelected: { borderColor: "#D8B4FE", backgroundColor: "rgba(139,61,255,0.3)" }, smallButtonText: { color: "#E4E4E7", fontSize: 9, fontWeight: "900" },
  back: { color: "#D8B4FE", fontSize: 11, fontWeight: "900", marginTop: 12 }, instructions: { color: "#A1A1AA", fontSize: 11, fontWeight: "700", marginVertical: 10 },
  roomsRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 }, roomColumn: { flex: 1 }, roomLabel: { color: "#E9D5FF", fontSize: 10, fontWeight: "900", letterSpacing: 1, textAlign: "center", marginBottom: 6 },
  statusPanel: { minHeight: 96, padding: 9, borderWidth: 1, borderTopWidth: 0, borderColor: "rgba(221,194,255,0.22)", borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: "rgba(23,16,32,0.96)" },
  statusTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 3 }, statusLabel: { color: "#A1A1AA", fontSize: 8, fontWeight: "900", letterSpacing: 1 }, wallCount: { color: "#D8B4FE", fontSize: 8, fontWeight: "900", textAlign: "right" }, nailCount: { color: "#A7F3D0", fontSize: 7, fontWeight: "900", textAlign: "right", marginTop: 2 },
  healthRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 3 }, health: { color: "#FFFFFF", fontSize: 27, fontWeight: "900" }, healthMax: { color: "#71717A", fontSize: 11 }, activeCount: { color: "#71717A", fontSize: 8, fontWeight: "900" }, healthTrack: { height: 5, overflow: "hidden", borderRadius: 4, backgroundColor: "rgba(0,0,0,0.55)", marginTop: 4 }, healthFill: { height: "100%", borderRadius: 4, backgroundColor: "#C026D3" },
  brokenStatus: { flex: 1, minHeight: 68, alignItems: "center", justifyContent: "center" }, brokenText: { color: "#FCA5A5", fontSize: 15, fontWeight: "900" },
  controls: { marginTop: 10, padding: 9, borderWidth: 1, borderColor: "rgba(221,194,255,0.18)", borderRadius: 11, backgroundColor: "rgba(23,16,32,0.96)" }, modeRow: { flexDirection: "row", gap: 6 }, modeButton: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 8, backgroundColor: "rgba(0,0,0,0.22)" }, modeButtonSelected: { borderColor: "#D8B4FE", backgroundColor: "rgba(139,61,255,0.36)" }, modeButtonText: { color: "#A1A1AA", fontSize: 10, fontWeight: "900" }, modeButtonTextSelected: { color: "#FFFFFF" }, feedback: { minHeight: 18, marginTop: 7, color: "#A1A1AA", fontSize: 10, fontWeight: "900", textAlign: "center" }, feedbackValid: { color: "#A7F3D0" }, feedbackInvalid: { color: "#FCA5A5" }, removeHint: { color: "#71717A", fontSize: 9, fontWeight: "700", textAlign: "center" },
  debugPanel: { marginTop: 12, padding: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 9, backgroundColor: "rgba(0,0,0,0.24)", gap: 3 }, debugText: { color: "#71717A", fontFamily: "monospace", fontSize: 9, lineHeight: 13 },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, unavailableTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", textAlign: "center" }, secondaryButton: { minHeight: 48, marginTop: 22, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", borderRadius: 10 }, secondaryButtonText: { color: "#D8B4FE", fontWeight: "900" },
});
