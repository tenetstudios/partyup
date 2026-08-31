import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BalloonRoomField } from "@/components/balloonRooms/BalloonRoomField";
import { MAX_WALL_SEGMENTS, ROOM_MAX_HEALTH } from "@/lib/balloonRooms/constants";
import type { BalloonRoom } from "@/lib/balloonRooms/types";
import { getUnsupportedHorizontalWalls, hasRequiredRoutes } from "@/lib/balloonRooms/walls";
import { useBalloonRoomsSimulation } from "@/hooks/useBalloonRoomsSimulation";

export default function BalloonRoomsRoute() {
  if (!__DEV__) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.unavailable}>
          <Text style={styles.unavailableTitle}>DEVELOPMENT BUILD ONLY</Text>
          <Pressable onPress={() => router.back()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>GO BACK</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }
  return <BalloonRoomsDevScreen />;
}

function BalloonRoomsDevScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const { snapshot, restart } = useBalloonRoomsSimulation();
  const [debugPaths, setDebugPaths] = useState(false);
  const fieldHeight = Math.max(320, Math.min(500, windowHeight * 0.53));

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>PHASE 2 · LOCAL MOBILE TEST</Text>
            <Text style={styles.title}>BALLOON ROOMS</Text>
          </View>
          <View style={styles.headerButtons}>
            <Pressable onPress={() => setDebugPaths((current) => !current)} style={[styles.smallButton, debugPaths && styles.smallButtonSelected]} accessibilityRole="button" accessibilityState={{ selected: debugPaths }}><Text style={styles.smallButtonText}>PATHS</Text></Pressable>
            <Pressable onPress={restart} style={styles.smallButton} accessibilityRole="button"><Text style={styles.smallButtonText}>RESTART</Text></Pressable>
          </View>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8}><Text style={styles.back}>← BACK</Text></Pressable>
        <Text style={styles.instructions}>Rendering preview only. Balloon and wall touch controls arrive in Phase 3.</Text>

        <View style={styles.roomsRow}>
          <RoomColumn label="YOUR ROOM" room={snapshot.rooms.yours} height={fieldHeight} debugPaths={debugPaths} damageFlash={snapshot.damageFlash.yours} yours />
          <RoomColumn label="OPPONENT ROOM" room={snapshot.rooms.opponent} height={fieldHeight} debugPaths={debugPaths} damageFlash={snapshot.damageFlash.opponent} />
        </View>

        <View style={styles.debugPanel}>
          <Text style={styles.debugText}>DEV · grid 6×10 · fixed 60 Hz simulation / 30 Hz visual snapshots</Text>
          <Text style={styles.debugText}>{describeRoom("yours", snapshot.rooms.yours)} · {describeRoom("opponent", snapshot.rooms.opponent)}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RoomColumn({
  label,
  room,
  height,
  debugPaths,
  damageFlash,
  yours = false,
}: {
  label: string;
  room: BalloonRoom;
  height: number;
  debugPaths: boolean;
  damageFlash: boolean;
  yours?: boolean;
}) {
  return (
    <View style={styles.roomColumn}>
      <Text numberOfLines={1} style={styles.roomLabel}>{label}</Text>
      <BalloonRoomField room={room} height={height} debugPaths={debugPaths} damageFlash={damageFlash} />
      <View style={styles.statusPanel}>
        {room.health > 0 ? <>
          <View style={styles.statusTop}><Text style={styles.statusLabel}>ROOM HP</Text><Text style={styles.wallCount}>WALLS {room.walls.length}/{MAX_WALL_SEGMENTS}</Text></View>
          <View style={styles.healthRow}><Text style={styles.health}>{room.health}<Text style={styles.healthMax}> / {ROOM_MAX_HEALTH}</Text></Text><Text style={styles.activeCount}>{room.balloons.length} ACTIVE</Text></View>
          <View style={styles.healthTrack}><View style={[styles.healthFill, { width: `${(room.health / ROOM_MAX_HEALTH) * 100}%` }]} /></View>
        </> : <View style={styles.brokenStatus}><Text style={styles.brokenText}>ROOM BROKEN</Text></View>}
      </View>
      <View style={styles.controlsPlaceholder}><Text style={styles.controlsLabel}>{yours ? "POP / WALL CONTROLS · PHASE 3" : "LOCAL TEST STRUCTURE"}</Text></View>
    </View>
  );
}

function describeRoom(label: string, room: BalloonRoom): string {
  const vertical = room.walls.filter((wall) => wall.orientation === "vertical").length;
  const horizontal = room.walls.length - vertical;
  const supported = horizontal - getUnsupportedHorizontalWalls(room.walls).length;
  return `${label} HP${room.health} B${room.balloons.length} V${vertical}/H${horizontal} (${supported} supported) routes ${hasRequiredRoutes(room, room.walls) ? "valid" : "invalid"}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#07000F" },
  content: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 28 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  titleBlock: { flex: 1 },
  eyebrow: { color: "#F0ABFC", fontSize: 9, fontWeight: "900", letterSpacing: 1.6 },
  title: { color: "#FFFFFF", fontSize: 25, fontWeight: "900", marginTop: 2 },
  headerButtons: { flexDirection: "row", gap: 5 },
  smallButton: { minHeight: 42, justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", borderRadius: 9, paddingHorizontal: 8, backgroundColor: "rgba(0,0,0,0.22)" },
  smallButtonSelected: { borderColor: "#D8B4FE", backgroundColor: "rgba(139,61,255,0.3)" },
  smallButtonText: { color: "#E4E4E7", fontSize: 9, fontWeight: "900" },
  back: { color: "#D8B4FE", fontSize: 11, fontWeight: "900", marginTop: 12 },
  instructions: { color: "#A1A1AA", fontSize: 11, fontWeight: "700", marginVertical: 10 },
  roomsRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  roomColumn: { flex: 1 },
  roomLabel: { color: "#E9D5FF", fontSize: 10, fontWeight: "900", letterSpacing: 1, textAlign: "center", marginBottom: 6 },
  statusPanel: { minHeight: 91, padding: 10, borderWidth: 1, borderTopWidth: 0, borderColor: "rgba(221,194,255,0.22)", borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: "rgba(23,16,32,0.96)" },
  statusTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 3 },
  statusLabel: { color: "#A1A1AA", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  wallCount: { color: "#D8B4FE", fontSize: 8, fontWeight: "900" },
  healthRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 },
  health: { color: "#FFFFFF", fontSize: 27, fontWeight: "900" },
  healthMax: { color: "#71717A", fontSize: 11 },
  activeCount: { color: "#71717A", fontSize: 8, fontWeight: "900" },
  healthTrack: { height: 5, overflow: "hidden", borderRadius: 4, backgroundColor: "rgba(0,0,0,0.55)", marginTop: 5 },
  healthFill: { height: "100%", borderRadius: 4, backgroundColor: "#C026D3" },
  brokenStatus: { flex: 1, minHeight: 68, alignItems: "center", justifyContent: "center" },
  brokenText: { color: "#FCA5A5", fontSize: 15, fontWeight: "900" },
  controlsPlaceholder: { minHeight: 61, marginTop: 7, alignItems: "center", justifyContent: "center", padding: 6, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(221,194,255,0.13)", borderRadius: 10, backgroundColor: "rgba(255,255,255,0.015)" },
  controlsLabel: { color: "#52525B", fontSize: 8, fontWeight: "900", letterSpacing: 0.7, textAlign: "center" },
  debugPanel: { marginTop: 12, padding: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 9, backgroundColor: "rgba(0,0,0,0.24)", gap: 3 },
  debugText: { color: "#71717A", fontFamily: "monospace", fontSize: 9, lineHeight: 13 },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  unavailableTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", textAlign: "center" },
  secondaryButton: { minHeight: 48, marginTop: 22, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", borderRadius: 10 },
  secondaryButtonText: { color: "#D8B4FE", fontWeight: "900" },
});
