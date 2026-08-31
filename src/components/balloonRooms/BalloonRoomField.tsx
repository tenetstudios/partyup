import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  Path,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { GRID_COLUMNS, GRID_ROWS } from "@/lib/balloonRooms/constants";
import { getCellCenter, getLaneCell, SPAWN_LANES } from "@/lib/balloonRooms/grid";
import type { BalloonRoom, WallSegment } from "@/lib/balloonRooms/types";

const viewBoxSize = 1000;
const columns = Array.from({ length: GRID_COLUMNS - 1 }, (_, index) => index + 1);
const rows = Array.from({ length: GRID_ROWS - 1 }, (_, index) => index + 1);

type BalloonRoomFieldProps = {
  room: BalloonRoom;
  height: number;
  debugPaths: boolean;
  damageFlash: boolean;
};

function toPoint(x: number, y: number): { x: number; y: number } {
  return { x: x * viewBoxSize, y: y * viewBoxSize };
}

function wallCoordinates(wall: WallSegment): { x1: number; y1: number; x2: number; y2: number } {
  if (wall.orientation === "vertical") {
    const x = (wall.gridX / GRID_COLUMNS) * viewBoxSize;
    return {
      x1: x,
      y1: (wall.gridY / GRID_ROWS) * viewBoxSize,
      x2: x,
      y2: ((wall.gridY + 1) / GRID_ROWS) * viewBoxSize,
    };
  }
  const y = (wall.gridY / GRID_ROWS) * viewBoxSize;
  return {
    x1: (wall.gridX / GRID_COLUMNS) * viewBoxSize,
    y1: y,
    x2: ((wall.gridX + 1) / GRID_COLUMNS) * viewBoxSize,
    y2: y,
  };
}

function BalloonRoomFieldComponent({ room, height, debugPaths, damageFlash }: BalloonRoomFieldProps) {
  const gradientId = `balloon-${room.id}`;
  return (
    <View style={[styles.frame, { height }]} accessible accessibilityLabel={`${room.id} playfield`}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`} preserveAspectRatio="none" pointerEvents="none">
        <Defs>
          <RadialGradient id={gradientId} cx="35%" cy="28%" rx="70%" ry="70%">
            <Stop offset="0%" stopColor="#F9A8D4" />
            <Stop offset="38%" stopColor="#EC2994" />
            <Stop offset="100%" stopColor="#8B3DFF" />
          </RadialGradient>
        </Defs>

        {columns.map((column) => <Line key={`column-${column}`} x1={(column / GRID_COLUMNS) * viewBoxSize} y1={0} x2={(column / GRID_COLUMNS) * viewBoxSize} y2={viewBoxSize} stroke="rgba(221,194,255,0.09)" strokeWidth={2} />)}
        {rows.map((row) => <Line key={`row-${row}`} x1={0} y1={(row / GRID_ROWS) * viewBoxSize} x2={viewBoxSize} y2={(row / GRID_ROWS) * viewBoxSize} stroke="rgba(221,194,255,0.09)" strokeWidth={2} />)}
        <Line x1={0} y1={3} x2={viewBoxSize} y2={3} stroke="#EC2994" strokeWidth={8} />

        {SPAWN_LANES.map((lane) => {
          const center = getCellCenter(getLaneCell(lane));
          return <SvgText key={`lane-${lane}`} x={center.x * viewBoxSize} y={974} fill="rgba(216,180,254,0.7)" fontSize={28} fontWeight="900" textAnchor="middle">↑ {lane}</SvgText>;
        })}

        {debugPaths ? room.balloons.map((balloon) => {
          const start = toPoint(balloon.x, balloon.y);
          const pathPoints = balloon.path.slice(1).map((cell) => {
            const center = getCellCenter(cell);
            return toPoint(center.x, center.y);
          });
          const points = [start, ...pathPoints].map((point) => `${point.x},${point.y}`).join(" ");
          return points ? <Polyline key={`path-${balloon.id}`} points={points} fill="none" stroke={balloon.pathBias === "left" ? "rgba(125,211,252,0.48)" : "rgba(253,164,175,0.48)"} strokeWidth={5} strokeDasharray="10 12" /> : null;
        }) : null}

        {room.walls.map((wall) => {
          const coordinates = wallCoordinates(wall);
          return <Line key={wall.id} {...coordinates} stroke="#C35DFF" strokeWidth={16} strokeLinecap="round" />;
        })}

        {room.balloons.map((balloon) => {
          const center = toPoint(balloon.x, balloon.y);
          return (
            <G key={balloon.id}>
              <Ellipse cx={center.x} cy={center.y} rx={48} ry={27} fill={`url(#${gradientId})`} />
              <Ellipse cx={center.x - 17} cy={center.y - 10} rx={7} ry={6} fill="rgba(255,255,255,0.7)" />
              <Path d={`M ${center.x} ${center.y + 24} L ${center.x - 10} ${center.y + 37} L ${center.x + 10} ${center.y + 37} Z`} fill="#8B3DFF" />
              {Array.from({ length: balloon.maxHealth }, (_, index) => (
                <Circle key={`${balloon.id}-hp-${index}`} cx={center.x + (index - 1) * 16} cy={center.y + 10} r={4.5} fill={index < balloon.health ? "#FFFFFF" : "rgba(0,0,0,0.28)"} />
              ))}
              {debugPaths ? <SvgText x={center.x} y={center.y - 39} fill="rgba(255,255,255,0.86)" fontSize={22} fontWeight="700" textAnchor="middle">L{balloon.spawnLane} {balloon.currentCell.column},{balloon.currentCell.row} p{Math.max(0, balloon.path.length - 1)}</SvgText> : null}
            </G>
          );
        })}

        {damageFlash ? <><Rect x={0} y={0} width={viewBoxSize} height={viewBoxSize} fill="rgba(248,113,113,0.2)" /><SvgText x={500} y={70} fill="#FECACA" fontSize={34} fontWeight="900" textAnchor="middle">-1 ROOM HP</SvgText></> : null}
        {room.health <= 0 ? <><Rect x={0} y={0} width={viewBoxSize} height={viewBoxSize} fill="rgba(7,0,15,0.78)" /><SvgText x={500} y={510} fill="#FCA5A5" fontSize={58} fontWeight="900" textAnchor="middle">ROOM BROKEN</SvgText></> : null}
      </Svg>
    </View>
  );
}

export const BalloonRoomField = memo(BalloonRoomFieldComponent);

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(221,194,255,0.22)",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: "rgba(18,14,40,0.92)",
  },
});
