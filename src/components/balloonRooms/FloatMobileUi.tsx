import { Image } from "expo-image";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Ellipse, Path, Rect } from "react-native-svg";
import type { SpawnLane } from "@partyup/balloon-core";

export type FloatMode = "defend" | "attack";
export type FloatTool = {
  key: string;
  label: string;
  kind: "wall" | "nails" | "glue" | "remove" | "basic" | "speed" | "heavy";
  cost?: number;
  disabled?: boolean;
  selected?: boolean;
};

export function FloatBackdrop({ children }: { children: ReactNode }) {
  return <View style={styles.backdrop}>
    <Image source={require("../../../assets/images/float-sky.webp")} contentFit="cover" style={styles.skyImage} />
    <View style={styles.skyTint} />
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>{children}</SafeAreaView>
  </View>;
}

export function FloatHud({ round, status, connection, onClose, onSettings }: { round: string; status: string; connection: string; onClose: () => void; onSettings?: () => void }) {
  return <View style={styles.hud}>
    <View style={styles.brandWrap}><Text style={styles.brand}>FLOAT</Text><Text style={styles.brandTag}>BUILD · DEFEND · OUTLAST</Text></View>
    <View style={styles.roundWrap}><Text numberOfLines={1} style={styles.round}>{round}</Text><Text numberOfLines={1} style={styles.roundStatus}>{status}</Text></View>
    <View style={[styles.hudActions, onSettings && styles.hudActionsWithSettings]}>
      <View style={styles.connection}><View style={styles.connectionDot} /><Text numberOfLines={1} style={styles.connectionText}>{connection}</Text></View>
      {onSettings ? <Pressable onPress={onSettings} hitSlop={8} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Float development settings"><Text style={styles.settingsText}>⚙</Text></Pressable> : null}
      <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close Float"><Text style={styles.closeText}>×</Text></Pressable>
    </View>
  </View>;
}

export function FloatModeSwitch({ mode, onChange }: { mode: FloatMode; onChange: (mode: FloatMode) => void }) {
  return <View style={styles.modeSwitch} accessibilityRole="tablist">
    {(["defend", "attack"] as FloatMode[]).map(item => {
      const active = mode === item;
      return <Pressable key={item} onPress={() => onChange(item)} style={[styles.modeTab, active && styles.modeTabActive]} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={`${item}, ${active ? "selected" : "not selected"}`}>
        <Text style={[styles.modeIcon, active && styles.modeTextActive]}>{item === "defend" ? "🛡" : "🎈"}</Text>
        <View><Text style={[styles.modeText, active && styles.modeTextActive]}>{item.toUpperCase()}</Text><Text style={[styles.modeHint, active && styles.modeHintActive]}>{item === "defend" ? "BUILD & PROTECT" : "PICK LANE & SEND"}</Text></View>
      </Pressable>;
    })}
  </View>;
}

export function FloatArenaTransition({ mode, children }: { mode: FloatMode; children: ReactNode }) {
  const progress = useRef(new Animated.Value(1)).current;
  const previous = useRef(mode);
  useEffect(() => {
    if (previous.current === mode) return;
    previous.current = mode;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [mode, progress]);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [mode === "attack" ? 24 : -24, 0] });
  return <Animated.View style={[styles.arenaTransition, { opacity: progress, transform: [{ translateX }] }]}>{children}</Animated.View>;
}

export function FloatArenaHeader({ label, coins, income, health, maxHealth }: { label: string; coins: number; income: number; health: number; maxHealth: number }) {
  return <View style={styles.arenaHeader}>
    <View style={styles.arenaIdentity}><Text numberOfLines={1} style={styles.arenaLabel}>{label}</Text><View style={styles.economyRow}><Text style={styles.coins}>● {coins}</Text><Text style={styles.income}>+{income}/8s</Text></View></View>
    <View style={styles.healthWrap}><Text style={styles.heart}>♥</Text><Text style={styles.health}>{health} / {maxHealth}</Text></View>
  </View>;
}

export function FloatLaneOverlay({ lane, onSelect }: { lane: SpawnLane; onSelect: (lane: SpawnLane) => void }) {
  return <View style={styles.laneOverlay} accessibilityRole="radiogroup">
    {([1, 2, 3, 4] as SpawnLane[]).map(item => {
      const selected = lane === item;
      return <Pressable key={item} onPress={() => onSelect(item)} style={[styles.lane, selected && styles.laneSelected]} accessibilityRole="radio" accessibilityLabel={`Target Lane ${item}`} accessibilityState={{ selected }}>
        {selected ? <><Text style={styles.laneLabel}>LANE {item}</Text><View style={styles.chevrons}>{Array.from({ length: 7 }, (_, index) => <Text key={index} style={[styles.chevron, index === 0 && styles.chevronFirst]}>⌃</Text>)}</View></> : null}
      </Pressable>;
    })}
  </View>;
}

export function FloatToolbar({ mode, tools, prompt, feedback, onPress }: { mode: FloatMode; tools: FloatTool[]; prompt?: string; feedback?: string; onPress: (key: string) => void }) {
  return <View style={[styles.toolbar, mode === "attack" && styles.attackToolbar]}>
    {prompt ? <Text numberOfLines={1} style={styles.toolbarPrompt}>{prompt}</Text> : null}
    <View style={styles.toolRow}>{tools.map((tool, index) => <Pressable key={tool.key} disabled={tool.disabled} onPress={() => onPress(tool.key)} style={[styles.toolButton, mode === "attack" && styles.attackToolButton, tool.selected && styles.toolButtonSelected, tool.disabled && styles.toolDisabled]} accessibilityRole="button" accessibilityLabel={`${tool.label}${tool.cost !== undefined ? `, ${tool.cost} coins` : ""}`} accessibilityState={{ disabled: tool.disabled, selected: tool.selected }}>
      {mode === "defend" ? <Text style={styles.toolNumber}>{index + 1}</Text> : null}
      <FloatToolIcon kind={tool.kind} />
      <Text style={styles.toolLabel}>{tool.label}</Text>
      <Text style={styles.toolCost}>{tool.cost !== undefined ? `● ${tool.cost}` : tool.kind === "remove" ? "FREE" : "LOCKED"}</Text>
    </Pressable>)}</View>
    {feedback ? <Text numberOfLines={1} style={styles.feedback}>{feedback}</Text> : null}
  </View>;
}

export function FloatResultOverlay({ label }: { label: "YOU WIN" | "ROOM BROKEN" | "DRAW" | "RECONNECTING" | null }) {
  if (!label) return null;
  return <View style={styles.resultOverlay} accessibilityRole="alert"><Text style={[styles.resultText, label === "YOU WIN" && styles.winText]}>{label}</Text></View>;
}

function FloatToolIcon({ kind }: { kind: FloatTool["kind"] }) {
  const id = useId();
  const balloon = kind === "basic" || kind === "speed" || kind === "heavy";
  const color = kind === "speed" ? "#267EFF" : kind === "heavy" ? "#3A304D" : "#F51D46";
  return <Svg width={44} height={42} viewBox="0 0 64 60" accessibilityLabel={`${kind} icon`}>
    {balloon ? <>
      <Path d="M32 46 C11 37 12 7 32 5 C53 7 54 37 32 46Z" fill={color} stroke="#DDF7FF" strokeOpacity={0.55} />
      <Ellipse cx={39} cy={14} rx={3.5} ry={7} fill="#FFFFFF" opacity={0.72} />
      <Path d="M32 44 L27 52 L37 52 Z M32 52 C28 56 35 56 31 60" fill={color} stroke="#FFFFFF" strokeOpacity={0.55} />
    </> : kind === "wall" ? <>
      {[0, 1].flatMap(row => [0, 1, 2].map(column => <Rect key={`${id}-${row}-${column}`} x={4 + column * 19} y={10 + row * 18} width={18} height={17} rx={2} fill={row === 0 ? "#FFFDF4" : "#DEDAD2"} stroke="#AEB8C2" />))}
    </> : kind === "nails" ? <>{[15, 32, 49].map(x => <Path key={x} d={`M${x - 5} 10 H${x + 5} L${x} 50Z`} fill="#C9D8E6" stroke="#53667B" />)}</> : kind === "glue" ? <>
      <Rect x={17} y={16} width={30} height={38} rx={7} fill="#BFEFFF" fillOpacity={0.88} stroke="#FFFFFF" /><Rect x={20} y={7} width={24} height={11} rx={3} fill="#F9FBFD" /><Path d="M20 36 Q32 42 44 35 V50 H20Z" fill="#70D9FA" opacity={0.7} />
    </> : <Path d="M16 14 L48 46 M48 14 L16 46" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" />}
  </Svg>;
}

const glass = "rgba(26, 83, 133, 0.66)";
const border = "rgba(225, 248, 255, 0.74)";

const styles = StyleSheet.create({
  backdrop: { flex: 1, width: "100%", overflow: "hidden", backgroundColor: "#55A9EB" },
  skyImage: { ...StyleSheet.absoluteFillObject },
  skyTint: { ...StyleSheet.absoluteFillObject, pointerEvents: "none", backgroundColor: "rgba(45, 134, 207, 0.08)" },
  safeArea: { flex: 1, width: "100%", maxWidth: "100%", overflow: "hidden", paddingHorizontal: 10, paddingBottom: 5 },
  hud: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  brandWrap: { width: 108 }, brand: { color: "#FFFFFF", fontSize: 23, fontWeight: "900", letterSpacing: 2.7 }, brandTag: { color: "#FFFFFF", fontSize: 4.5, fontWeight: "800", letterSpacing: .65, marginTop: 1 },
  roundWrap: { flex: 1, alignItems: "center", minWidth: 0 }, round: { color: "#FFFFFF", fontSize: 13, fontWeight: "900", letterSpacing: 1 }, roundStatus: { color: "rgba(255,255,255,.88)", fontSize: 6, fontWeight: "700", marginTop: 2 },
  hudActions: { width: 90, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 }, hudActionsWithSettings: { width: 126 }, connection: { height: 31, maxWidth: 54, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, borderWidth: 1, borderColor: "rgba(208,242,255,.38)", borderRadius: 10, backgroundColor: "rgba(24,76,124,.64)" }, connectionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#5AF0D1" }, connectionText: { color: "#FFFFFF", fontSize: 6.5, fontWeight: "900", letterSpacing: .2 }, closeButton: { width: 32, height: 32, borderWidth: 1, borderColor: "rgba(224,247,255,.52)", borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(25,76,124,.66)" }, closeText: { color: "#FFFFFF", fontSize: 24, lineHeight: 26 }, settingsText: { color: "#FFFFFF", fontSize: 16 },
  modeSwitch: { height: 66, flexDirection: "row", gap: 7, padding: 5, borderWidth: 1, borderColor: border, borderRadius: 17, backgroundColor: "rgba(27,79,128,.52)", marginBottom: 7 },
  modeTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderWidth: 1, borderColor: "rgba(215,242,255,.20)", borderRadius: 12, backgroundColor: "rgba(23,66,107,.38)" }, modeTabActive: { borderColor: "#FFFFFF", backgroundColor: "rgba(91,130,224,.70)", boxShadow: "0px 0px 9px rgba(214,237,255,.8)" }, modeIcon: { color: "rgba(255,255,255,.65)", fontSize: 23 }, modeText: { color: "rgba(255,255,255,.68)", fontSize: 16, fontWeight: "900", letterSpacing: 1 }, modeTextActive: { color: "#FFFFFF" }, modeHint: { color: "rgba(255,255,255,.48)", fontSize: 6, fontWeight: "800", marginTop: 1, letterSpacing: .4 }, modeHintActive: { color: "rgba(255,255,255,.86)" },
  arenaTransition: { flex: 1, minHeight: 0 },
  arenaHeader: { height: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 13, borderWidth: 1, borderBottomWidth: 0, borderColor: border, borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: glass }, arenaIdentity: { flex: 1 }, arenaLabel: { color: "#FFFFFF", fontSize: 13, fontWeight: "900", letterSpacing: 1.1 }, economyRow: { flexDirection: "row", alignItems: "center", gap: 15, marginTop: 3 }, coins: { color: "#FFE67A", fontSize: 16, fontWeight: "900" }, income: { color: "#65F2D3", fontSize: 10, fontWeight: "900" }, healthWrap: { flexDirection: "row", alignItems: "center", gap: 5 }, heart: { color: "#FF5871", fontSize: 27 }, health: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  laneOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 5, flexDirection: "row", overflow: "hidden", borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }, lane: { flex: 1, borderRightWidth: 1, borderStyle: "dashed", borderColor: "rgba(237,250,255,.20)", alignItems: "center" }, laneSelected: { backgroundColor: "rgba(119,118,245,.27)", borderLeftWidth: 1, borderLeftColor: "rgba(239,245,255,.62)", borderRightColor: "rgba(239,245,255,.62)" }, laneLabel: { marginTop: 7, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden", borderWidth: 1, borderColor: "#FFFFFF", borderRadius: 13, color: "#FFFFFF", backgroundColor: "rgba(104,83,242,.86)", fontSize: 9, fontWeight: "900" }, chevrons: { flex: 1, pointerEvents: "none", alignItems: "center", justifyContent: "space-around", paddingVertical: 15 }, chevron: { color: "rgba(255,255,255,.43)", fontSize: 23, fontWeight: "900" }, chevronFirst: { color: "#FFFFFF" },
  toolbar: { minHeight: 91, marginTop: 7, padding: 6, borderWidth: 1, borderColor: "rgba(223,246,255,.56)", borderRadius: 14, backgroundColor: "rgba(32,88,137,.54)" }, attackToolbar: { backgroundColor: "rgba(30,83,132,.34)" }, toolbarPrompt: { height: 14, color: "#FFFFFF", fontSize: 8, fontWeight: "900", letterSpacing: .7, textAlign: "center" }, toolRow: { flexDirection: "row", justifyContent: "center", gap: 5 }, toolButton: { flex: 1, minHeight: 72, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(200,236,255,.50)", borderRadius: 11, backgroundColor: "rgba(29,73,113,.66)" }, attackToolButton: { flexGrow: 0, flexShrink: 1, flexBasis: 88, width: 88, minHeight: 76, borderRadius: 29, backgroundColor: "rgba(35,100,151,.62)" }, toolButtonSelected: { borderColor: "#FFFFFF", backgroundColor: "rgba(83,119,207,.72)", boxShadow: "0px 0px 6px rgba(218,238,255,.72)" }, toolDisabled: { opacity: .42 }, toolNumber: { position: "absolute", top: 3, right: 5, width: 17, height: 17, borderRadius: 9, overflow: "hidden", textAlign: "center", color: "#FFFFFF", backgroundColor: "rgba(17,55,88,.75)", fontSize: 9, lineHeight: 17, fontWeight: "900" }, toolLabel: { color: "#FFFFFF", fontSize: 8, fontWeight: "900", letterSpacing: .5 }, toolCost: { color: "#FFE77C", fontSize: 10, fontWeight: "900", marginTop: 1 }, feedback: { height: 14, color: "rgba(255,255,255,.86)", fontSize: 7, fontWeight: "800", textAlign: "center", marginTop: 3 },
  resultOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, pointerEvents: "none", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(27,76,119,.28)" }, resultText: { paddingHorizontal: 28, paddingVertical: 18, overflow: "hidden", borderWidth: 1, borderColor: "#FFFFFF", borderRadius: 18, color: "#FFB0B9", backgroundColor: "rgba(38,91,139,.91)", fontSize: 28, fontWeight: "900", letterSpacing: 1.5, textAlign: "center" }, winText: { color: "#FFFFFF", backgroundColor: "rgba(78,102,207,.92)" },
});
