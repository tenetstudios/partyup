import { supabase } from "./supabase";

export type RecapMediaType = "image" | "video";

export type RoomRecapMedia = {
  media_path: string;
  media_type: RecapMediaType;
  mime_type: string;
  file_size_bytes: number;
  signed_url: string;
};

export async function createRecapMediaSignedUrl(
  media: Omit<RoomRecapMedia, "signed_url">,
): Promise<RoomRecapMedia> {
  const { data, error } = await supabase.storage
    .from("room-recap-media")
    .createSignedUrl(media.media_path, 60 * 60);

  if (error) throw new Error(error.message);
  return { ...media, signed_url: data.signedUrl };
}

export async function getRoomRecapMedia(roomId: string): Promise<RoomRecapMedia | null> {
  const { data, error } = await supabase
    .from("room_recap_media")
    .select("media_path,media_type,mime_type,file_size_bytes")
    .eq("room_id", roomId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return createRecapMediaSignedUrl({
    media_path: data.media_path,
    media_type: data.media_type as RecapMediaType,
    mime_type: data.mime_type,
    file_size_bytes: data.file_size_bytes,
  });
}
