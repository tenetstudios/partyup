import { supabase } from "../../lib/supabase";

export type RoomIdleMedia = {
  room_id: string;
  media_path: string;
  media_type: "video" | "gif";
  mime_type: "video/mp4" | "image/gif";
  file_size_bytes: number;
  enabled: boolean;
  updated_at: string;
  signed_url: string;
};

export type RoomLiveState = {
  room_id: string;
  is_live: boolean;
  active_publisher_count: number;
  signal_authoritative: boolean;
  signal_source: string | null;
  updated_at: string;
};

export async function getRoomIdleMedia(roomId: string): Promise<RoomIdleMedia | null> {
  const { data, error } = await supabase
    .from("room_idle_media")
    .select("room_id,media_path,media_type,mime_type,file_size_bytes,enabled,updated_at")
    .eq("room_id", roomId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { data: signed, error: signedError } = await supabase.storage
    .from("room-idle-media")
    .createSignedUrl(data.media_path, 60 * 60);

  if (signedError) throw signedError;

  return {
    ...data,
    media_type: data.media_type as RoomIdleMedia["media_type"],
    mime_type: data.mime_type as RoomIdleMedia["mime_type"],
    signed_url: signed.signedUrl,
  } as RoomIdleMedia;
}

export async function getRoomLiveState(roomId: string): Promise<RoomLiveState | null> {
  const { data, error } = await supabase
    .from("room_live_state")
    .select("room_id,is_live,active_publisher_count,signal_authoritative,signal_source,updated_at")
    .eq("room_id", roomId)
    .maybeSingle();

  if (error) throw error;
  return data as RoomLiveState | null;
}
