import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_FRAME_DELTA_SECONDS, SIMULATION_STEP_SECONDS } from "@/lib/balloonRooms/constants";
import { createWallSegment } from "@/lib/balloonRooms/grid";
import {
  createBalloonRoom,
  createDevBalloonSpawner,
  updateDevBalloonSpawner,
  updateRoomSimulation,
  type DevBalloonSpawner,
} from "@/lib/balloonRooms/simulation";
import type { BalloonRoom } from "@/lib/balloonRooms/types";
import { placeWall } from "@/lib/balloonRooms/walls";

export type BalloonRoomKey = "yours" | "opponent";
export type BalloonRoomCollection = Record<BalloonRoomKey, BalloonRoom>;

export type BalloonRoomsSnapshot = {
  rooms: BalloonRoomCollection;
  damageFlash: Record<BalloonRoomKey, boolean>;
};

type SpawnerCollection = Record<BalloonRoomKey, DevBalloonSpawner>;

const roomKeys: BalloonRoomKey[] = ["yours", "opponent"];
const renderIntervalMs = 1000 / 30;

function createRooms(): BalloonRoomCollection {
  const yours = createBalloonRoom("mobile-your-room");
  const opponent = createBalloonRoom("mobile-opponent-room");
  placeWall(opponent, createWallSegment(opponent.id, "vertical", 3, 5));
  placeWall(opponent, createWallSegment(opponent.id, "horizontal", 2, 5));
  placeWall(opponent, createWallSegment(opponent.id, "horizontal", 3, 5));
  return { yours, opponent };
}

function createSpawners(): SpawnerCollection {
  return {
    yours: createDevBalloonSpawner(410),
    opponent: createDevBalloonSpawner(920),
  };
}

function cloneRoom(room: BalloonRoom): BalloonRoom {
  return {
    ...room,
    walls: room.walls.map((wall) => ({ ...wall })),
    balloons: room.balloons.map((balloon) => ({
      ...balloon,
      currentCell: { ...balloon.currentCell },
      targetCell: balloon.targetCell ? { ...balloon.targetCell } : null,
      path: balloon.path.map((cell) => ({ ...cell })),
    })),
  };
}

function createSnapshot(
  rooms: BalloonRoomCollection,
  damageUntil: Record<BalloonRoomKey, number>,
  now: number,
): BalloonRoomsSnapshot {
  return {
    rooms: {
      yours: cloneRoom(rooms.yours),
      opponent: cloneRoom(rooms.opponent),
    },
    damageFlash: {
      yours: damageUntil.yours > now,
      opponent: damageUntil.opponent > now,
    },
  };
}

export function useBalloonRoomsSimulation(): {
  snapshot: BalloonRoomsSnapshot;
  restart: () => void;
} {
  const [initialRooms] = useState(createRooms);
  const [initialSpawners] = useState(createSpawners);
  const [initialDamageUntil] = useState<Record<BalloonRoomKey, number>>({ yours: 0, opponent: 0 });
  const roomsRef = useRef(initialRooms);
  const spawnersRef = useRef<SpawnerCollection>(initialSpawners);
  const damageUntilRef = useRef<Record<BalloonRoomKey, number>>(initialDamageUntil);
  const [snapshot, setSnapshot] = useState<BalloonRoomsSnapshot>(() =>
    createSnapshot(initialRooms, initialDamageUntil, 0),
  );

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
          updateDevBalloonSpawner(room, spawnersRef.current[key], SIMULATION_STEP_SECONDS);
          const events = updateRoomSimulation(room, SIMULATION_STEP_SECONDS);
          if (events.some((event) => event.type === "balloon_escaped")) {
            damageUntilRef.current[key] = now + 420;
          }
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

  const restart = useCallback(() => {
    const rooms = createRooms();
    roomsRef.current = rooms;
    spawnersRef.current = createSpawners();
    damageUntilRef.current = { yours: 0, opponent: 0 };
    setSnapshot(createSnapshot(rooms, damageUntilRef.current, 0));
  }, []);

  return { snapshot, restart };
}
