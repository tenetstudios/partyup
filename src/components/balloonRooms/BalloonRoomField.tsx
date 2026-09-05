import { memo, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import Svg, { Defs, Ellipse, G, Line, LinearGradient, Path, Polyline, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import {
  GRID_COLUMNS, GRID_ROWS, getCellCenter,
  type BalloonRoom, type NailStrip, type WallSegment,
} from "@partyup/balloon-core";

const viewBoxSize = 1000;
const columns = Array.from({ length: GRID_COLUMNS - 1 }, (_, index) => index + 1);
const rows = Array.from({ length: GRID_ROWS - 1 }, (_, index) => index + 1);

export type FieldPress = { x: number; y: number; width: number; height: number };
type BalloonRoomFieldProps = {
  room: BalloonRoom;
  height: number;
  debugPaths: boolean;
  damageFlash: boolean;
  structuralEffects: { id: string; wall: WallSegment; kind: "impact" | "collapse" }[];
  showGrid?: boolean;
  selectedWallId?: string | null;
  onPressPosition?: (press: FieldPress) => void;
  onLongPressPosition?: (press: FieldPress) => void;
};

function toPoint(x: number, y: number): { x: number; y: number } { return { x: x * viewBoxSize, y: y * viewBoxSize }; }

function wallCoordinates(wall: WallSegment): { x1: number; y1: number; x2: number; y2: number } {
  if (wall.orientation === "vertical") {
    const x = (wall.gridX / GRID_COLUMNS) * viewBoxSize;
    return { x1: x, y1: (wall.gridY / GRID_ROWS) * viewBoxSize, x2: x, y2: ((wall.gridY + 1) / GRID_ROWS) * viewBoxSize };
  }
  const y = (wall.gridY / GRID_ROWS) * viewBoxSize;
  return { x1: (wall.gridX / GRID_COLUMNS) * viewBoxSize, y1: y, x2: ((wall.gridX + 1) / GRID_COLUMNS) * viewBoxSize, y2: y };
}

function NailVisual({ nails, wall }: { nails: NailStrip[]; wall: WallSegment }) {
  const coordinates = wallCoordinates(wall);
  const totalDurability = nails.reduce((sum, nail) => sum + nail.durability, 0);
  const totalMaximum = nails.reduce((sum, nail) => sum + nail.maxDurability, 0);
  const ratio = totalDurability / totalMaximum;
  const color = ratio <= 0.2 ? "#8A96A5" : ratio <= 0.6 ? "#AFBBC7" : "#D7E4ED";
  const spikes = Array.from({ length: 4 }, (_, index) => {
    const progress = (index + 0.5) / 4;
    const x = coordinates.x1 + (coordinates.x2 - coordinates.x1) * progress;
    const y = coordinates.y1 + (coordinates.y2 - coordinates.y1) * progress;
    return wall.orientation === "vertical"
      ? `M ${x + 4} ${y - 14} L ${x + 34} ${y} L ${x + 4} ${y + 14} Z`
      : `M ${x - 14} ${y + 5} L ${x} ${y + 42} L ${x + 14} ${y + 5} Z`;
  });
  return (
    <G>
      {spikes.map((path, index) => <Path key={`${wall.id}-spike-${index}`} d={path} fill={color} fillOpacity={0.65 + ratio * 0.35} stroke="#4B5E73" strokeWidth={2} />)}
    </G>
  );
}

function WallVisual({ wall, selected }: { wall: WallSegment; selected: boolean }) {
  const coordinates = wallCoordinates(wall);
  const ratio = wall.integrity / wall.maxIntegrity;
  const vertical = wall.orientation === "vertical";
  const thickness = 34;
  const x = Math.min(coordinates.x1, coordinates.x2) - (vertical ? thickness / 2 : 0);
  const y = Math.min(coordinates.y1, coordinates.y2) - (vertical ? 0 : thickness / 2);
  const width = vertical ? thickness : Math.abs(coordinates.x2 - coordinates.x1);
  const height = vertical ? Math.abs(coordinates.y2 - coordinates.y1) : thickness;
  const crack = ratio <= 0.65
    ? vertical
      ? `M ${x + width * .65} ${y + height * .2} L ${x + width * .35} ${y + height * .45} L ${x + width * .7} ${y + height * .62}${ratio <= .3 ? ` L ${x + width * .25} ${y + height * .86}` : ""}`
      : `M ${x + width * .25} ${y + height * .15} L ${x + width * .43} ${y + height * .56} L ${x + width * .62} ${y + height * .35}${ratio <= .3 ? ` L ${x + width * .8} ${y + height * .82}` : ""}`
    : null;
  return <G>
    {selected ? <Rect x={x - 6} y={y - 6} width={width + 12} height={height + 12} rx={8} fill="#A8DBFF" fillOpacity={0.55} stroke="#FFFFFF" strokeWidth={3} /> : null}
    <Rect x={x} y={y} width={width} height={height} rx={5} fill="url(#wall-face)" stroke="#AEB7BF" strokeWidth={2} />
    <Line x1={x + 5} y1={y + 5} x2={vertical ? x + width - 5 : x + width - 5} y2={vertical ? y + 5 : y + 5} stroke="#FFFFFF" strokeOpacity={0.88} strokeWidth={3} />
    {crack ? <Path d={crack} fill="none" stroke="#7A7B79" strokeWidth={ratio <= .3 ? 5 : 3} strokeLinecap="round" /> : null}
  </G>;
}

function BalloonRoomFieldComponent({ room, height, debugPaths, damageFlash, structuralEffects, showGrid = false, selectedWallId, onPressPosition, onLongPressPosition }: BalloonRoomFieldProps) {
  const gradientIds = {
    basic: `balloon-basic-${room.id}`,
    speed: `balloon-speed-${room.id}`,
    heavy: `balloon-heavy-${room.id}`,
  } as const;
  const [width, setWidth] = useState(0);
  return (
    <Pressable
      style={[styles.frame, { height }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onPress={(event) => {
        if (!onPressPosition || width <= 0 || height <= 0) return;
        onPressPosition({ x: event.nativeEvent.locationX / width, y: event.nativeEvent.locationY / height, width, height });
      }}
      onLongPress={(event) => {
        if (!onLongPressPosition || width <= 0 || height <= 0) return;
        onLongPressPosition({ x: event.nativeEvent.locationX / width, y: event.nativeEvent.locationY / height, width, height });
      }}
      delayLongPress={500}
      accessible
      accessibilityRole={onPressPosition || onLongPressPosition ? "button" : undefined}
      accessibilityLabel={`${room.id} playfield. Tap balloons to pop. Tap your walls to select repair options. Hold half a second on a grid edge to build.`}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`} preserveAspectRatio="none" pointerEvents="none">
        <Defs>
          <RadialGradient id={gradientIds.basic} cx="70%" cy="22%" rx="78%" ry="78%"><Stop offset="0%" stopColor="#FFCDD5" /><Stop offset="32%" stopColor="#FF294D" /><Stop offset="100%" stopColor="#BE0030" /></RadialGradient>
          <RadialGradient id={gradientIds.speed} cx="70%" cy="22%" rx="78%" ry="78%"><Stop offset="0%" stopColor="#C9F4FF" /><Stop offset="32%" stopColor="#2389FF" /><Stop offset="100%" stopColor="#1439C8" /></RadialGradient>
          <RadialGradient id={gradientIds.heavy} cx="70%" cy="22%" rx="78%" ry="78%"><Stop offset="0%" stopColor="#C7B6D2" /><Stop offset="35%" stopColor="#574467" /><Stop offset="100%" stopColor="#211B35" /></RadialGradient>
          <LinearGradient id="wall-face" x1="0" y1="0" x2="0.25" y2="1"><Stop offset="0%" stopColor="#FFFFF8" /><Stop offset="48%" stopColor="#EEEAE2" /><Stop offset="100%" stopColor="#C4C1BC" /></LinearGradient>
        </Defs>
        {showGrid ? columns.map((column) => <Line key={`column-${column}`} x1={(column / GRID_COLUMNS) * viewBoxSize} y1={0} x2={(column / GRID_COLUMNS) * viewBoxSize} y2={viewBoxSize} stroke="rgba(235,249,255,0.20)" strokeWidth={2} />) : null}
        {showGrid ? rows.map((row) => <Line key={`row-${row}`} x1={0} y1={(row / GRID_ROWS) * viewBoxSize} x2={viewBoxSize} y2={(row / GRID_ROWS) * viewBoxSize} stroke="rgba(235,249,255,0.20)" strokeWidth={2} />) : null}
        <Line x1={0} y1={8} x2={viewBoxSize} y2={8} stroke="#72E7FF" strokeOpacity={0.72} strokeWidth={16} />
        <Line x1={0} y1={4} x2={viewBoxSize} y2={4} stroke="#EFFFFF" strokeWidth={7} />
        {debugPaths ? room.balloons.map((balloon) => {
          const start = toPoint(balloon.x, balloon.y);
          const points = [start, ...balloon.path.slice(1).map((cell) => { const center = getCellCenter(cell); return toPoint(center.x, center.y); })].map((point) => `${point.x},${point.y}`).join(" ");
          return points ? <Polyline key={`path-${balloon.id}`} points={points} fill="none" stroke={balloon.pathBias === "left" ? "rgba(125,211,252,0.48)" : "rgba(253,164,175,0.48)"} strokeWidth={5} strokeDasharray="10 12" /> : null;
        }) : null}
        {room.walls.map((wall) => <WallVisual key={wall.id} wall={wall} selected={wall.id === selectedWallId} />)}
        {room.glueTraps.map((glue) => { const wall = room.walls.find((candidate) => candidate.id === glue.wallSegmentId); return wall ? <G key={glue.id}><Line {...wallCoordinates(wall)} stroke="#83E4FF" strokeWidth={30} strokeOpacity={0.68} strokeLinecap="round" /><Line {...wallCoordinates(wall)} stroke="#E9FCFF" strokeWidth={8} strokeOpacity={0.82} strokeLinecap="round" /></G> : null; })}
        {room.walls.map((wall) => { const nails = room.nailStrips.filter((nail) => nail.wallSegmentId === wall.id); return nails.length > 0 ? <NailVisual key={`nails-${wall.id}`} nails={nails} wall={wall} /> : null; })}
        {structuralEffects.map((effect) => <Line key={effect.id} {...wallCoordinates(effect.wall)} stroke={effect.kind === "collapse" ? "#FB7185" : "#FDE68A"} strokeWidth={effect.kind === "collapse" ? 28 : 24} strokeOpacity={0.72} strokeDasharray={effect.kind === "collapse" ? "32 18" : undefined} strokeLinecap="round" />)}
        {room.balloons.map((balloon) => {
          const center = toPoint(balloon.x, balloon.y);
          const rx = balloon.balloonType === "speed" ? 40 : balloon.balloonType === "heavy" ? 64 : 49;
          const ry = balloon.balloonType === "speed" ? 56 : balloon.balloonType === "heavy" ? 84 : 68;
          const shape = `M ${center.x} ${center.y + ry} C ${center.x - rx * 1.35} ${center.y + ry * .2}, ${center.x - rx * 1.05} ${center.y - ry}, ${center.x} ${center.y - ry} C ${center.x + rx * 1.05} ${center.y - ry}, ${center.x + rx * 1.35} ${center.y + ry * .2}, ${center.x} ${center.y + ry} Z`;
          return <G key={balloon.id}>
            <Path d={shape} fill={`url(#${gradientIds[balloon.balloonType]})`} stroke={balloon.glued ? "#C4F4FF" : "rgba(255,255,255,.20)"} strokeWidth={balloon.glued ? 8 : 2} />
            <Ellipse cx={center.x + rx * .34} cy={center.y - ry * .48} rx={rx * .13} ry={ry * .2} fill="rgba(255,255,255,0.76)" />
            <Path d={`M ${center.x} ${center.y + ry - 3} L ${center.x - 11} ${center.y + ry + 14} L ${center.x + 11} ${center.y + ry + 14} Z`} fill={balloon.balloonType === "speed" ? "#1439C8" : balloon.balloonType === "heavy" ? "#211B35" : "#BE0030"} />
            <Path d={`M ${center.x} ${center.y + ry + 14} C ${center.x - 14} ${center.y + ry + 38}, ${center.x + 15} ${center.y + ry + 44}, ${center.x - 6} ${center.y + ry + 66}`} fill="none" stroke="rgba(255,255,255,.65)" strokeWidth={2} />
            <SvgText x={center.x} y={center.y + 10} fill="#FFFFFF" fontSize={22} fontWeight="900" textAnchor="middle">{balloon.health}</SvgText>
            {debugPaths ? <SvgText x={center.x} y={center.y - 39} fill="rgba(255,255,255,0.86)" fontSize={22} fontWeight="700" textAnchor="middle">L{balloon.spawnLane} {balloon.currentCell.column},{balloon.currentCell.row} p{Math.max(0, balloon.path.length - 1)}</SvgText> : null}
          </G>;
        })}
        {damageFlash ? <><Rect x={0} y={0} width={viewBoxSize} height={viewBoxSize} fill="rgba(248,113,113,0.2)" /><SvgText x={500} y={70} fill="#FECACA" fontSize={34} fontWeight="900" textAnchor="middle">ROOM HIT</SvgText></> : null}
        {room.health <= 0 ? <><Rect x={0} y={0} width={viewBoxSize} height={viewBoxSize} fill="rgba(34,84,128,0.58)" /><SvgText x={500} y={510} fill="#FFB3BD" fontSize={58} fontWeight="900" textAnchor="middle">ROOM BROKEN</SvgText></> : null}
      </Svg>
    </Pressable>
  );
}

export const BalloonRoomField = memo(BalloonRoomFieldComponent);

const styles = StyleSheet.create({
  frame: { width: "100%", overflow: "hidden", borderWidth: 1, borderColor: "rgba(231,249,255,0.80)", borderBottomLeftRadius: 14, borderBottomRightRadius: 14, backgroundColor: "rgba(83,174,232,0.12)" },
});
