import { router } from "expo-router";
import { supabase } from "../../lib/supabase";

type PushData = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function notificationDestination(data: PushData) {
  const type = text(data.type);
  const roomId = text(data.roomId) ?? text(data.room_id);
  const missionId = text(data.missionId) ?? text(data.mission_id);

  if (type === "recap_ready" && roomId) return `/recap/${roomId}`;
  if (type === "wild_result" && roomId) return `/room/${roomId}/wild`;
  if (type === "mission_started" && roomId) {
    return missionId ? `/room/${roomId}?missionId=${encodeURIComponent(missionId)}` : `/room/${roomId}`;
  }
  if (type === "announcement" && roomId) return `/room/${roomId}`;
  if (roomId) return `/room/${roomId}`;
  return "/activity";
}

export async function openNotification(data: PushData) {
  await supabase.auth.getSession();
  const roomId = text(data.roomId) ?? text(data.room_id);
  if (roomId) {
    const { data: room } = await supabase.from("event_rooms").select("id").eq("id", roomId).maybeSingle();
    if (!room) {
      router.push("/activity" as never);
      return;
    }
  }
  router.push(notificationDestination(data) as never);
}
