import assert from "node:assert/strict";
import {
  BASIC_BALLOON_COST,
  BASIC_BALLOON_INCOME_GAIN,
  BASIC_BALLOON_LAUNCH_INTERVAL_MS,
  INCOME_TICK_INTERVAL_MS,
  BASIC_BALLOON_HP,
  MAX_NAIL_STRIPS,
  NAIL_MAX_DURABILITY,
  applyGameAction,
  createBalloonRoom,
  createBasicBalloon,
  createSendBalloonAction,
  createWallSegment,
  findPathToCeiling,
  getLaneCell,
  placeWall,
  updateRoomSimulation,
} from "@partyup/balloon-core";

const sendRoom = createBalloonRoom("mobile-send");
const senderRoom = createBalloonRoom("mobile-sender");
const send = (lane, senderSequence) => createSendBalloonAction({
  matchId: "mobile-verification",
  senderId: "mobile-player",
  targetRoomId: sendRoom.id,
  lane,
  senderSequence,
  sentAt: senderSequence * 1000,
});
assert.equal(applyGameAction(senderRoom, send(4, 1), sendRoom).applied, true);
assert.equal(applyGameAction(senderRoom, send(4, 2), sendRoom).applied, true);
assert.equal(applyGameAction(senderRoom, send(2, 3), sendRoom).applied, true);
assert.equal(sendRoom.balloons.length, 0);
assert.deepEqual(senderRoom.attack.queue.map((queued) => queued.lane), [4, 4, 2]);
applyGameAction(senderRoom, { type: "APPLY_LAUNCH_QUEUE", simulationTimeMs: 0 }, sendRoom);
assert.equal(sendRoom.balloons.length, 1);
assert.equal(applyGameAction(senderRoom, { type: "APPLY_LAUNCH_QUEUE", simulationTimeMs: BASIC_BALLOON_LAUNCH_INTERVAL_MS - 1 }, sendRoom).launchedBalloon, undefined);
applyGameAction(senderRoom, { type: "APPLY_LAUNCH_QUEUE", simulationTimeMs: BASIC_BALLOON_LAUNCH_INTERVAL_MS }, sendRoom);
applyGameAction(senderRoom, { type: "APPLY_LAUNCH_QUEUE", simulationTimeMs: BASIC_BALLOON_LAUNCH_INTERVAL_MS * 2 }, sendRoom);
assert.deepEqual(sendRoom.balloons.map((balloon) => balloon.spawnLane), [4, 4, 2]);
assert.equal(senderRoom.economy.coins, 300 - 3 * BASIC_BALLOON_COST);
assert.equal(senderRoom.economy.income, 30 + 3 * BASIC_BALLOON_INCOME_GAIN);
applyGameAction(senderRoom, { type: "APPLY_INCOME_TICK", simulationTimeMs: INCOME_TICK_INTERVAL_MS });
assert.equal(senderRoom.economy.coins, 264);

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

const exhaustRoom = createBalloonRoom("mobile-exhaustion");
const exhaustWall = createWallSegment(exhaustRoom.id, "vertical", 3, 8);
placeWall(exhaustRoom, exhaustWall);
applyGameAction(exhaustRoom, { type: "PLACE_NAILS", wallSegmentId: exhaustWall.id });
exhaustRoom.nailStrips[0].durability = 1;
exhaustRoom.balloons.push(createBasicBalloon(exhaustRoom.id, "exhaustion-target", 2, "left"));
updateRoomSimulation(exhaustRoom, 1);
assert.equal(exhaustRoom.nailStrips.length, 0);
assert.equal(exhaustRoom.walls.length, 1);

const pathRoom = createBalloonRoom("mobile-path");
placeWall(pathRoom, createWallSegment(pathRoom.id, "vertical", 3, 5));
placeWall(pathRoom, createWallSegment(pathRoom.id, "horizontal", 2, 5));
assert.ok(findPathToCeiling(getLaneCell(2), pathRoom.walls, "left")?.some((cell) => cell.column === 1));
assert.equal(MAX_NAIL_STRIPS, 4);

console.log("Mobile Balloon Rooms Phase 5.1 passed against @partyup/balloon-core: slower shared economy, FIFO launch pacing, chosen lanes, walls, routes, automatic nail exhaustion, free manual popping, and no-refund removal.");
