const assert = require("node:assert/strict");
const fs = require("node:fs");
const babel = require("@babel/core");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const result = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [[require.resolve("@babel/preset-typescript"), { allExtensions: true }]],
    plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")],
  });
  module._compile(result.code, filename);
};

const { MAX_WALL_SEGMENTS } = require("../src/lib/balloonRooms/constants.ts");
const { createWallSegment, getLaneCell, SPAWN_LANES } = require("../src/lib/balloonRooms/grid.ts");
const { findPathToCeiling } = require("../src/lib/balloonRooms/pathfinding.ts");
const {
  createBalloonRoom,
  createBasicBalloon,
  createDevBalloonSpawner,
  damageBalloon,
  recalculateBalloonPath,
  updateDevBalloonSpawner,
  updateRoomSimulation,
} = require("../src/lib/balloonRooms/simulation.ts");
const {
  getUnsupportedHorizontalWalls,
  hasRequiredRoutes,
  placeWall,
  removeWall,
  validateWallPlacement,
} = require("../src/lib/balloonRooms/walls.ts");

const wall = (room, orientation, gridX, gridY) => createWallSegment(room.id, orientation, gridX, gridY);

const popRoom = createBalloonRoom("pop");
const popped = createBasicBalloon(popRoom.id, "basic", 2, "left");
popRoom.balloons.push(popped);
assert.equal(damageBalloon(popRoom, popped.id).remainingHealth, 2);
assert.equal(damageBalloon(popRoom, popped.id).remainingHealth, 1);
assert.equal(damageBalloon(popRoom, popped.id).popped, true);
assert.equal(popRoom.balloons.length, 0);

const structureRoom = createBalloonRoom("structure");
assert.equal(placeWall(structureRoom, wall(structureRoom, "vertical", 3, 5)).valid, true);
assert.equal(placeWall(structureRoom, wall(structureRoom, "horizontal", 2, 5)).valid, true);
assert.equal(placeWall(structureRoom, wall(structureRoom, "horizontal", 3, 5)).valid, true);
assert.equal(getUnsupportedHorizontalWalls(structureRoom.walls).length, 0);
const deflected = findPathToCeiling(getLaneCell(2), structureRoom.walls, "left");
assert.ok(deflected.some((cell) => cell.column === 1));
assert.equal(removeWall(structureRoom, wall(structureRoom, "vertical", 3, 5).id).code, "supporting_span");

const unsupportedRoom = createBalloonRoom("unsupported");
placeWall(unsupportedRoom, wall(unsupportedRoom, "vertical", 1, 5));
placeWall(unsupportedRoom, wall(unsupportedRoom, "horizontal", 1, 5));
placeWall(unsupportedRoom, wall(unsupportedRoom, "horizontal", 2, 5));
assert.equal(validateWallPlacement(unsupportedRoom, wall(unsupportedRoom, "horizontal", 3, 5)).code, "needs_support");

const sealRoom = createBalloonRoom("seal");
placeWall(sealRoom, wall(sealRoom, "vertical", 1, 4));
placeWall(sealRoom, wall(sealRoom, "vertical", 5, 4));
for (const gridX of [0, 1, 2, 5, 4]) assert.equal(placeWall(sealRoom, wall(sealRoom, "horizontal", gridX, 5)).valid, true);
assert.equal(validateWallPlacement(sealRoom, wall(sealRoom, "horizontal", 3, 5)).code, "path_required");
assert.equal(hasRequiredRoutes(sealRoom, sealRoom.walls), true);

const budgetRoom = createBalloonRoom("budget");
for (let row = 0; row < MAX_WALL_SEGMENTS; row += 1) placeWall(budgetRoom, wall(budgetRoom, "vertical", 1, row));
assert.equal(validateWallPlacement(budgetRoom, wall(budgetRoom, "vertical", 2, 0)).code, "budget_reached");

const liveRoom = createBalloonRoom("live");
const liveBalloon = createBasicBalloon(liveRoom.id, "live", 2, "left");
liveRoom.balloons.push(liveBalloon);
recalculateBalloonPath(liveRoom, liveBalloon);
updateRoomSimulation(liveRoom, 1);
const beforeWall = { x: liveBalloon.x, y: liveBalloon.y };
placeWall(liveRoom, wall(liveRoom, "vertical", 3, 5));
placeWall(liveRoom, wall(liveRoom, "horizontal", 2, 5));
assert.deepEqual({ x: liveBalloon.x, y: liveBalloon.y }, beforeWall);
updateRoomSimulation(liveRoom, 5);
assert.ok(liveBalloon.x < beforeWall.x);

const spawnRoom = createBalloonRoom("spawn");
updateDevBalloonSpawner(spawnRoom, createDevBalloonSpawner(2), 40);
assert.deepEqual([...new Set(spawnRoom.balloons.map((balloon) => balloon.spawnLane))].sort(), SPAWN_LANES);

for (const roomId of ["crowded-left", "crowded-right"]) {
  const room = createBalloonRoom(roomId);
  for (let index = 0; index < 50; index += 1) {
    room.balloons.push(createBasicBalloon(room.id, `${roomId}-${index}`, SPAWN_LANES[index % 4], index % 2 ? "left" : "right"));
  }
  updateRoomSimulation(room, 0.1);
  assert.equal(room.balloons.length, 50);
}

console.log("Mobile Balloon Rooms core passed: popping, walls, support rules, BFS routes, live rerouting, four lanes, route safety, budget, and 50 balloons per room.");
