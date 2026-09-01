import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_FRAME_DELTA_SECONDS, SIMULATION_STEP_SECONDS, applyGameAction, createBalloonRoom,
  createWallSegment, updateRoomSimulation, type BalloonRoom,
  type GameAction, type GameActionResult,
} from "@partyup/balloon-core";

export type BalloonRoomKey = "yours" | "opponent";
export type BalloonRoomCollection = Record<BalloonRoomKey, BalloonRoom>;
export type BalloonRoomsSnapshot = {
  rooms: BalloonRoomCollection;
  damageFlash: Record<BalloonRoomKey, boolean>;
  simulationTimeMs: number;
};

const roomKeys: BalloonRoomKey[] = ["yours", "opponent"];
const renderIntervalMs = 1000 / 30;

function createRooms(): BalloonRoomCollection {
  const yours = createBalloonRoom("mobile-your-room");
  const opponent = createBalloonRoom("mobile-opponent-room");
  applyGameAction(opponent, { type: "PLACE_WALL", wall: createWallSegment(opponent.id, "vertical", 3, 5) });
  applyGameAction(opponent, { type: "PLACE_WALL", wall: createWallSegment(opponent.id, "horizontal", 2, 5) });
  applyGameAction(opponent, { type: "PLACE_WALL", wall: createWallSegment(opponent.id, "horizontal", 3, 5) });
  applyGameAction(opponent, { type: "PLACE_NAILS", wallSegmentId: opponent.walls[1]!.id });
  return { yours, opponent };
}

function cloneRoom(room: BalloonRoom): BalloonRoom {
  return {
    ...room,
    economy: { ...room.economy },
    attack: { ...room.attack, queue: room.attack.queue.map((queued) => ({ ...queued })) },
    processedSendIds: [...room.processedSendIds],
    walls: room.walls.map((wall) => ({ ...wall })),
    nailStrips: room.nailStrips.map((nail) => ({ ...nail })),
    balloons: room.balloons.map((balloon) => ({
      ...balloon,
      currentCell: { ...balloon.currentCell },
      targetCell: balloon.targetCell ? { ...balloon.targetCell } : null,
      path: balloon.path.map((cell) => ({ ...cell })),
      contactingNailIds: [...balloon.contactingNailIds],
    })),
  };
}

function createSnapshot(rooms: BalloonRoomCollection, damageUntil: Record<BalloonRoomKey, number>, now: number, simulationTimeMs: number): BalloonRoomsSnapshot {
  return {
    rooms: { yours: cloneRoom(rooms.yours), opponent: cloneRoom(rooms.opponent) },
    damageFlash: { yours: damageUntil.yours > now, opponent: damageUntil.opponent > now },
    simulationTimeMs,
  };
}

export function useBalloonRoomsSimulation(): {
  snapshot: BalloonRoomsSnapshot;
  dispatchAction: (roomKey: BalloonRoomKey, action: GameAction, targetRoomKey?: BalloonRoomKey) => GameActionResult;
  restart: () => void;
} {
  const [initialRooms] = useState(createRooms);
  const [initialDamageUntil] = useState<Record<BalloonRoomKey, number>>({ yours: 0, opponent: 0 });
  const roomsRef = useRef(initialRooms);
  const simulationTimeMsRef = useRef(0);
  const damageUntilRef = useRef<Record<BalloonRoomKey, number>>(initialDamageUntil);
  const [snapshot, setSnapshot] = useState<BalloonRoomsSnapshot>(() => createSnapshot(initialRooms, initialDamageUntil, 0, 0));

  useEffect(() => {
    let frameHandle = 0;
    let previousTime = 0;
    let previousRenderTime = 0;
    let accumulator = 0;
    const frame = (now: number) => {
      if (previousTime === 0) previousTime = now;
      accumulator += Math.min(MAX_FRAME_DELTA_SECONDS, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      while (accumulator >= SIMULATION_STEP_SECONDS) {
        simulationTimeMsRef.current += SIMULATION_STEP_SECONDS * 1000;
        for (const key of roomKeys) {
          const room = roomsRef.current[key];
          applyGameAction(room, { type: "APPLY_INCOME_TICK", simulationTimeMs: simulationTimeMsRef.current });
          const targetRoom = roomsRef.current[key === "yours" ? "opponent" : "yours"];
          applyGameAction(room, { type: "APPLY_LAUNCH_QUEUE", simulationTimeMs: simulationTimeMsRef.current }, targetRoom);
          const events = updateRoomSimulation(room, SIMULATION_STEP_SECONDS);
          if (events.some((event) => event.type === "balloon_escaped")) damageUntilRef.current[key] = now + 420;
        }
        accumulator -= SIMULATION_STEP_SECONDS;
      }
      if (now - previousRenderTime >= renderIntervalMs) {
        previousRenderTime = now;
        setSnapshot(createSnapshot(roomsRef.current, damageUntilRef.current, now, simulationTimeMsRef.current));
      }
      frameHandle = requestAnimationFrame(frame);
    };
    frameHandle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameHandle);
  }, []);

  const dispatchAction = useCallback((roomKey: BalloonRoomKey, action: GameAction, targetRoomKey?: BalloonRoomKey): GameActionResult => {
    const targetRoom = targetRoomKey ? roomsRef.current[targetRoomKey] : undefined;
    const result = applyGameAction(roomsRef.current[roomKey], action, targetRoom);
    if (result.applied) setSnapshot(createSnapshot(roomsRef.current, damageUntilRef.current, performance.now(), simulationTimeMsRef.current));
    return result;
  }, []);

  const restart = useCallback(() => {
    const rooms = createRooms();
    roomsRef.current = rooms;
    simulationTimeMsRef.current = 0;
    damageUntilRef.current = { yours: 0, opponent: 0 };
    setSnapshot(createSnapshot(rooms, damageUntilRef.current, 0, 0));
  }, []);

  return { snapshot, dispatchAction, restart };
}
