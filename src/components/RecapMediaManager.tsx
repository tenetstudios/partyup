import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getRoomRecapMedia, type RoomRecapMedia } from "../../lib/recapMedia";
import { supabase } from "../../lib/supabase";
import RecapMediaView from "./RecapMediaView";

const IMAGE_LIMIT = 10 * 1024 * 1024;
const VIDEO_LIMIT = 20 * 1024 * 1024;

const supportedMedia: Record<string, { extension: string; mediaType: "image" | "video" }> = {
  "image/jpeg": { extension: "jpg", mediaType: "image" },
  "image/png": { extension: "png", mediaType: "image" },
  "image/webp": { extension: "webp", mediaType: "image" },
  "image/gif": { extension: "gif", mediaType: "image" },
  "video/mp4": { extension: "mp4", mediaType: "video" },
  "video/webm": { extension: "webm", mediaType: "video" },
  "video/quicktime": { extension: "mov", mediaType: "video" },
};

function inferMimeType(asset: ImagePicker.ImagePickerAsset) {
  if (asset.mimeType && supportedMedia[asset.mimeType.toLowerCase()]) return asset.mimeType.toLowerCase();
  const extension = asset.fileName?.split(".").pop()?.toLowerCase() || asset.uri.split(".").pop()?.split("?")[0]?.toLowerCase();
  return Object.entries(supportedMedia).find(([, value]) => value.extension === extension)?.[0] ?? null;
}

export default function RecapMediaManager({ embedded = false, roomId }: { embedded?: boolean; roomId: string }) {
  const [media, setMedia] = useState<RoomRecapMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMedia(await getRoomRecapMedia(roomId));
    } catch (error) {
      console.log("RECAP MEDIA LOAD ERROR:", error);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { void load(); }, [load]);

  async function openPicker(mediaTypes: ["images"] | ["videos"]) {
    if (busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission required", "Allow photo-library access to add media to the recap message.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      allowsEditing: mediaTypes[0] === "images",
      quality: 0.9,
      videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const mimeType = inferMimeType(asset);
    const config = mimeType ? supportedMedia[mimeType] : null;
    if (!mimeType || !config) {
      Alert.alert("Unsupported file", "Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV file.");
      return;
    }

    setBusy(true);
    const mediaPath = `${roomId}/recap-media.${config.extension}`;
    const previousPath = media?.media_path ?? null;
    try {
      const bytes = await (await fetch(asset.uri)).arrayBuffer();
      const fileSize = asset.fileSize ?? bytes.byteLength;
      const sizeLimit = config.mediaType === "image" ? IMAGE_LIMIT : VIDEO_LIMIT;
      if (fileSize <= 0 || fileSize > sizeLimit) {
        throw new Error(config.mediaType === "image" ? "Images must be 10 MB or smaller." : "Videos must be 20 MB or smaller.");
      }

      const { error: uploadError } = await supabase.storage
        .from("room-recap-media")
        .upload(mediaPath, bytes, { contentType: mimeType, upsert: true });
      if (uploadError) throw uploadError;

      const { error: saveError } = await supabase.rpc("set_room_recap_media", {
        p_file_size_bytes: fileSize,
        p_media_path: mediaPath,
        p_media_type: config.mediaType,
        p_mime_type: mimeType,
        p_room_id: roomId,
      });
      if (saveError) {
        if (previousPath !== mediaPath) await supabase.storage.from("room-recap-media").remove([mediaPath]);
        throw saveError;
      }

      if (previousPath && previousPath !== mediaPath) {
        await supabase.storage.from("room-recap-media").remove([previousPath]);
      }
      await load();
    } catch (error) {
      Alert.alert("Could not save recap media", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function chooseMedia() {
    Alert.alert("Add media", "Choose what to attach to the host message.", [
      { text: "Photo", onPress: () => void openPicker(["images"]) },
      { text: "Video", onPress: () => void openPicker(["videos"]) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function confirmRemove() {
    if (!media || busy) return;
    Alert.alert("Remove recap media?", "The host message will remain, but this attachment will be deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          const path = media.media_path;
          const { error } = await supabase.rpc("remove_room_recap_media", { p_room_id: roomId });
          if (!error) await supabase.storage.from("room-recap-media").remove([path]);
          setBusy(false);
          if (error) Alert.alert("Could not remove recap media", error.message);
          else setMedia(null);
        },
      },
    ]);
  }

  return (
    <View style={[styles.card, embedded && styles.embedded]}>
      <Text style={styles.label}>Message media <Text style={styles.optional}>(optional)</Text></Text>
      <Text style={styles.meta}>Add one image up to 10 MB or one video up to 20 MB.</Text>
      {loading ? <ActivityIndicator color="#A78BFA" style={styles.loader} /> : null}
      {media ? <View style={styles.preview}><RecapMediaView media={media} /></View> : null}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.primary} disabled={busy} onPress={chooseMedia}>
          <Text style={styles.primaryText}>{busy ? "Working..." : media ? "Replace Media" : "Add Media"}</Text>
        </TouchableOpacity>
        {media ? <TouchableOpacity style={styles.secondary} disabled={busy} onPress={confirmRemove}><Text style={styles.secondaryText}>Remove</Text></TouchableOpacity> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#111118", borderColor: "#292936", borderRadius: 18, borderWidth: 1, gap: 9, marginTop: 14, padding: 16 },
  embedded: { backgroundColor: "rgba(0,0,0,0.2)", borderColor: "rgba(255,255,255,0.1)" },
  label: { color: "#DDD6FE", fontSize: 14, fontWeight: "900" },
  optional: { color: "#71717A", fontWeight: "700" },
  meta: { color: "#A1A1AA", fontSize: 12, lineHeight: 18 },
  loader: { marginVertical: 14 },
  preview: { borderColor: "rgba(255,255,255,0.1)", borderRadius: 12, borderWidth: 1, marginTop: 5, overflow: "hidden" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 4 },
  primary: { alignItems: "center", backgroundColor: "#7C3AED", borderRadius: 999, flexGrow: 1, justifyContent: "center", minHeight: 44, minWidth: 120, paddingHorizontal: 16 },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
  secondary: { alignItems: "center", borderColor: "rgba(248,113,113,0.45)", borderRadius: 999, borderWidth: 1, flexGrow: 1, justifyContent: "center", minHeight: 44, minWidth: 100, paddingHorizontal: 16 },
  secondaryText: { color: "#FCA5A5", fontWeight: "900" },
});
