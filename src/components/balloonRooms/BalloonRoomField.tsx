import { memo, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import Svg, { Defs, Ellipse, G, Line, Path, Polyline, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import {
  GRID_COLUMNS, GRID_ROWS, SPAWN_LANES, getCellCenter, getLaneCell,
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

function NailVisual({ nail, wall }: { nail: NailStrip; wall: WallSegment }) {
  const coordinates = wallCoordinates(wall);
  const ratio = nail.durability / nail.maxDurability;
  const color = nail.status === "broken" ? "#71717A" : ratio <= 0.2 ? "#F87171" : ratio <= 0.6 ? "#FBBF24" : "#A7F3D0";
  const spikes = Array.from({ length: 4 }, (_, index) => {
    const progress = (index + 0.5) / 4;
    const x = coordinates.x1 + (coordinates.x2 - coordinates.x1) * progress;
    const y = coordinates.y1 + (coordinates.y2 - coordinates.y1) * progress;
    return wall.orientation === "vertical"
      ? `M ${x} ${y - 15} L ${x + (index % 2 ? -27 : 27)} ${y} L ${x} ${y + 15} Z`
      : `M ${x - 15} ${y} L ${x} ${y + (index % 2 ? -27 : 27)} L ${x + 15} ${y} Z`;
  });
  const labelX = wall.orientation === "vertical" ? coordinates.x1 + 58 : (coordinates.x1 + coordinates.x2) / 2;
  const labelY = wall.orientation === "vertical" ? (coordinates.y1 + coordinates.y2) / 2 : coordinates.y1 - 30;
  return (
    <G>
      <Line {...coordinates} stroke={color} strokeWidth={8} strokeDasharray={nail.status === "broken" ? "14 12" : undefined} />
      {spikes.map((path, index) => <Path key={`${nail.id}-spike-${index}`} d={path} fill={color} opacity={nail.status === "broken" ? 0.55 : 1} />)}
      <SvgText x={labelX} y={labelY} fill={color} fontSize={25} fontWeight="900" textAnchor="middle">{nail.durability}/{nail.maxDurability}</SvgText>
    </G>
  );
}

function BalloonRoomFieldComponent({ room, height, debugPaths, damageFlash, onPressPosition, onLongPressPosition }: BalloonRoomFieldProps) {
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
      delayLongPress={1000}
      accessible
      accessibilityRole={onPressPosition || onLongPressPosition ? "button" : undefined}
      accessibilityLabel={`${room.id} playfield. Tap balloons to pop. Hold one second on a grid edge to build.`}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`} preserveAspectRatio="none" pointerEvents="none">
        <Defs>
          <RadialGradient id={gradientIds.basic} cx="35%" cy="28%" rx="70%" ry="70%"><Stop offset="0%" stopColor="#F9A8D4" /><Stop offset="38%" stopColor="#EC2994" /><Stop offset="100%" stopColor="#8B3DFF" /></RadialGradient>
          <RadialGradient id={gradientIds.speed} cx="35%" cy="28%" rx="70%" ry="70%"><Stop offset="0%" stopColor="#CFFAFE" /><Stop offset="38%" stopColor="#22D3EE" /><Stop offset="100%" stopColor="#2563EB" /></RadialGradient>
          <RadialGradient id={gradientIds.heavy} cx="35%" cy="28%" rx="70%" ry="70%"><Stop offset="0%" stopColor="#FDE68A" /><Stop offset="38%" stopColor="#F97316" /><Stop offset="100%" stopColor="#7C2D12" /></RadialGradient>
        </Defs>
        {columns.map((column) => <Line key={`column-${column}`} x1={(column / GRID_COLUMNS) * viewBoxSize} y1={0} x2={(column / GRID_COLUMNS) * viewBoxSize} y2={viewBoxSize} stroke="rgba(221,194,255,0.09)" strokeWidth={2} />)}
        {rows.map((row) => <Line key={`row-${row}`} x1={0} y1={(row / GRID_ROWS) * viewBoxSize} x2={viewBoxSize} y2={(row / GRID_ROWS) * viewBoxSize} stroke="rgba(221,194,255,0.09)" strokeWidth={2} />)}
        <Line x1={0} y1={3} x2={viewBoxSize} y2={3} stroke="#EC2994" strokeWidth={8} />
        {SPAWN_LANES.map((lane) => { const center = getCellCenter(getLaneCell(lane)); return <SvgText key={`lane-${lane}`} x={center.x * viewBoxSize} y={974} fill="rgba(216,180,254,0.7)" fontSize={28} fontWeight="900" textAnchor="middle">↑ {lane}</SvgText>; })}
        {debugPaths ? room.balloons.map((balloon) => {
          const start = toPoint(balloon.x, balloon.y);
          const points = [start, ...balloon.path.slice(1).map((cell) => { const center = getCellCenter(cell); return toPoint(center.x, center.y); })].map((point) => `${point.x},${point.y}`).join(" ");
          return points ? <Polyline key={`path-${balloon.id}`} points={points} fill="none" stroke={balloon.pathBias === "left" ? "rgba(125,211,252,0.48)" : "rgba(253,164,175,0.48)"} strokeWidth={5} strokeDasharray="10 12" /> : null;
        }) : null}
        {room.walls.map((wall) => <Line key={wall.id} {...wallCoordinates(wall)} stroke="#C35DFF" strokeWidth={16} strokeLinecap="round" />)}
        {room.nailStrips.map((nail) => { const wall = room.walls.find((candidate) => candidate.id === nail.wallSegmentId); return wall ? <NailVisual key={nail.id} nail={nail} wall={wall} /> : null; })}
        {room.balloons.map((balloon) => {
          const center = toPoint(balloon.x, balloon.y);
          const rx = balloon.balloonType === "speed" ? 34 : balloon.balloonType === "heavy" ? 64 : 48;
          const ry = balloon.balloonType === "speed" ? 25 : balloon.balloonType === "heavy" ? 38 : 27;
          return <G key={balloon.id}>
            <Ellipse cx={center.x} cy={center.y} rx={rx} ry={ry} fill={`url(#${gradientIds[balloon.balloonType]})`} />
            <Ellipse cx={center.x - 17} cy={center.y - 10} rx={7} ry={6} fill="rgba(255,255,255,0.7)" />
            <Path d={`M ${center.x} ${center.y + ry - 3} L ${center.x - 10} ${center.y + ry + 10} L ${center.x + 10} ${center.y + ry + 10} Z`} fill={balloon.balloonType === "speed" ? "#2563EB" : balloon.balloonType === "heavy" ? "#7C2D12" : "#8B3DFF"} />
            <SvgText x={center.x} y={center.y + 10} fill="#FFFFFF" fontSize={22} fontWeight="900" textAnchor="middle">{balloon.health}</SvgText>
            {debugPaths ? <SvgText x={center.x} y={center.y - 39} fill="rgba(255,255,255,0.86)" fontSize={22} fontWeight="700" textAnchor="middle">L{balloon.spawnLane} {balloon.currentCell.column},{balloon.currentCell.row} p{Math.max(0, balloon.path.length - 1)}</SvgText> : null}
          </G>;
        })}
        {damageFlash ? <><Rect x={0} y={0} width={viewBoxSize} height={viewBoxSize} fill="rgba(248,113,113,0.2)" /><SvgText x={500} y={70} fill="#FECACA" fontSize={34} fontWeight="900" textAnchor="middle">ROOM HIT</SvgText></> : null}
        {room.health <= 0 ? <><Rect x={0} y={0} width={viewBoxSize} height={viewBoxSize} fill="rgba(7,0,15,0.78)" /><SvgText x={500} y={510} fill="#FCA5A5" fontSize={58} fontWeight="900" textAnchor="middle">ROOM BROKEN</SvgText></> : null}
      </Svg>
    </Pressable>
  );
}

export const BalloonRoomField = memo(BalloonRoomFieldComponent);

const styles = StyleSheet.create({
  frame: { width: "100%", overflow: "hidden", borderWidth: 1, borderColor: "rgba(221,194,255,0.22)", borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: "rgba(18,14,40,0.92)" },
});
