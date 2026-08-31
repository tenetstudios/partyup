import assert from "node:assert/strict";
import {
  BASIC_BALLOON_HP,
  MAX_NAIL_STRIPS,
  NAIL_MAX_DURABILITY,
  applyGameAction,
  createBalloonRoom,
  createBasicBalloon,
  createWallSegment,
  findPathToCeiling,
  getLaneCell,
  placeWall,
  updateRoomSimulation,
} from "@partyup/balloon-core";

const room = createBalloonRoom("mobile-smoke");
const wall = createWallSegment(room.id, "vertical", 3, 8);
assert.equal(applyGameAction(room, { type: "PLACE_WALL", wall }).applied, true);
assert.equal(applyGameAction(room, { type: "PLACE_NAILS", wallSegmentId: wall.id }).applied, true);
assert.equal(room.nailStrips[0].durability, NAIL_MAX_DURABILITY);

const balloon = createBasicBalloon(room.id, "mobile-balloon", 2, "left");
room.balloons.push(balloon);
const events = updateRoomSimulation(room, 1);
assert.equal(events.filter((event) => event.type === "nail_contact").length, 1);
assert.equal(balloon.health, BASIC_BALLOON_HP - 1);
assert.equal(room.nailStrips[0].durability, NAIL_MAX_DURABILITY - 1);

assert.equal(applyGameAction(room, { type: "POP_BALLOON", balloonId: balloon.id }).damage?.remainingHealth, 1);
assert.equal(applyGameAction(room, { type: "POP_BALLOON", balloonId: balloon.id }).damage?.popped, true);
assert.equal(room.balloons.length, 0);

assert.equal(applyGameAction(room, { type: "REMOVE_WALL", wallSegmentId: wall.id }).message, "Nails removed; wall remains");
assert.equal(room.walls.length, 1);
assert.equal(applyGameAction(room, { type: "REMOVE_WALL", wallSegmentId: wall.id }).applied, true);
assert.equal(room.walls.length, 0);

const pathRoom = createBalloonRoom("mobile-path");
placeWall(pathRoom, createWallSegment(pathRoom.id, "vertical", 3, 5));
placeWall(pathRoom, createWallSegment(pathRoom.id, "horizontal", 2, 5));
assert.ok(findPathToCeiling(getLaneCell(2), pathRoom.walls, "left")?.some((cell) => cell.column === 1));
assert.equal(MAX_NAIL_STRIPS, 4);

console.log("Mobile Balloon Rooms passed against @partyup/balloon-core: walls, routes, nails, durability, manual popping, and remove-first behavior.");
