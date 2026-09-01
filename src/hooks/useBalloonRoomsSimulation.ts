import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_FRAME_DELTA_SECONDS, SIMULATION_STEP_SECONDS, applyGameAction, createBalloonRoom,
  createWallSegment, placeNailStrip, placeWall, updateRoomSimulation, type BalloonRoom,
  type GameAction, type GameActionResult,
} from "@partyup/balloon-core";

export type BalloonRoomKey = "yours" | "opponent";
export type BalloonRoomCollection = Record<BalloonRoomKey, BalloonRoom>;
export type BalloonRoomsSnapshot = {
  rooms: BalloonRoomCollection;
  damageFlash: Record<BalloonRoomKey, boolean>;
};

const roomKeys: BalloonRoomKey[] = ["yours", "opponent"];
const renderIntervalMs = 1000 / 30;

function createRooms(): BalloonRoomCollection {
  const yours = createBalloonRoom("mobile-your-room");
  const opponent = createBalloonRoom("mobile-opponent-room");
  placeWall(opponent, createWallSegment(opponent.id, "vertical", 3, 5));
  placeWall(opponent, createWallSegment(opponent.id, "horizontal", 2, 5));
  placeWall(opponent, createWallSegment(opponent.id, "horizontal", 3, 5));
  placeNailStrip(opponent, opponent.walls[1]!.id);
  return { yours, opponent };
}

function cloneRoom(room: BalloonRoom): BalloonRoom {
  return {
    ...room,
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

function createSnapshot(rooms: BalloonRoomCollection, damageUntil: Record<BalloonRoomKey, number>, now: number): BalloonRoomsSnapshot {
  return {
    rooms: { yours: cloneRoom(rooms.yours), opponent: cloneRoom(rooms.opponent) },
    damageFlash: { yours: damageUntil.yours > now, opponent: damageUntil.opponent > now },
  };
}

export function useBalloonRoomsSimulation(): {
  snapshot: BalloonRoomsSnapshot;
  dispatchAction: (roomKey: BalloonRoomKey, action: GameAction) => GameActionResult;
  restart: () => void;
} {
  const [initialRooms] = useState(createRooms);
  const [initialDamageUntil] = useState<Record<BalloonRoomKey, number>>({ yours: 0, opponent: 0 });
  const roomsRef = useRef(initialRooms);
  const damageUntilRef = useRef<Record<BalloonRoomKey, number>>(initialDamageUntil);
  const [snapshot, setSnapshot] = useState<BalloonRoomsSnapshot>(() => createSnapshot(initialRooms, initialDamageUntil, 0));

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
        for (const key of roomKeys) {
          const room = roomsRef.current[key];
          const events = updateRoomSimulation(room, SIMULATION_STEP_SECONDS);
          if (events.some((event) => event.type === "balloon_escaped")) damageUntilRef.current[key] = now + 420;
        }
        accumulator -= SIMULATION_STEP_SECONDS;
      }
      if (now - previousRenderTime >= renderIntervalMs) {
        previousRenderTime = now;
        setSnapshot(createSnapshot(roomsRef.current, damageUntilRef.current, now));
      }
      frameHandle = requestAnimationFrame(frame);
    };
    frameHandle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameHandle);
  }, []);

  const dispatchAction = useCallback((roomKey: BalloonRoomKey, action: GameAction): GameActionResult => {
    const result = applyGameAction(roomsRef.current[roomKey], action);
    if (result.applied) setSnapshot(createSnapshot(roomsRef.current, damageUntilRef.current, performance.now()));
    return result;
  }, []);

  const restart = useCallback(() => {
    const rooms = createRooms();
    roomsRef.current = rooms;
    damageUntilRef.current = { yours: 0, opponent: 0 };
    setSnapshot(createSnapshot(rooms, damageUntilRef.current, 0));
  }, []);

  return { snapshot, dispatchAction, restart };
}
