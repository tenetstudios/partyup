import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  getRoomIdleMedia,
  getRoomLiveState,
  type RoomIdleMedia,
  type RoomLiveState,
} from "../lib/roomIdleMedia";

export function useRoomStreamFrame(roomId: string) {
  const [idleMedia, setIdleMedia] = useState<RoomIdleMedia | null>(null);
  const [liveState, setLiveState] = useState<RoomLiveState | null>(null);

  const loadIdle = useCallback(async () => {
    try {
      setIdleMedia(await getRoomIdleMedia(roomId));
    } catch (error) {
      console.log("IDLE LOOP LOAD ERROR:", error);
    }
  }, [roomId]);

  const loadLive = useCallback(async () => {
    try {
      setLiveState(await getRoomLiveState(roomId));
    } catch (error) {
      console.log("ROOM LIVE STATE LOAD ERROR:", error);
    }
  }, [roomId]);

  useEffect(() => {
    void Promise.all([loadIdle(), loadLive()]);
    const channel = supabase
      .channel(`room-stream-frame-${roomId}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_idle_media", filter: `room_id=eq.${roomId}` }, () => void loadIdle())
      .on("postgres_changes", { event: "*", schema: "public", table: "room_live_state", filter: `room_id=eq.${roomId}` }, () => void loadLive())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadIdle, loadLive, roomId]);

  return { idleMedia, liveState };
}
