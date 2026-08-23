import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { getRoomIdleMedia, type RoomIdleMedia } from "../lib/roomIdleMedia";
import IdleLoopMedia from "./IdleLoopMedia";

const VIDEO_LIMIT = 20 * 1024 * 1024;
const GIF_LIMIT = 10 * 1024 * 1024;

export default function RoomIdleLoopManager({ roomId }: { roomId: string }) {
  const [media, setMedia] = useState<RoomIdleMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMedia(await getRoomIdleMedia(roomId));
    } catch (error) {
      console.log("IDLE LOOP LOAD ERROR:", error);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function chooseMedia() {
    if (busy) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      quality: 1,
      videoMaxDuration: 30,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const mime = asset.mimeType?.toLowerCase();
    const isGif = mime === "image/gif" || asset.fileName?.toLowerCase().endsWith(".gif");
    const isMp4 = mime === "video/mp4" || asset.fileName?.toLowerCase().endsWith(".mp4");
    if (!isGif && !isMp4) {
      Alert.alert("Unsupported file", "Choose an MP4 video or GIF.");
      return;
    }
    if (isMp4 && typeof asset.duration === "number" && asset.duration > 30_000) {
      Alert.alert("Video too long", "Idle Loop videos must be 30 seconds or shorter.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(asset.uri);
      const bytes = await response.arrayBuffer();
      const size = asset.fileSize ?? bytes.byteLength;
      const limit = isGif ? GIF_LIMIT : VIDEO_LIMIT;
      if (size <= 0 || size > limit) {
        throw new Error(isGif ? "GIFs must be 10 MB or smaller." : "MP4 videos must be 20 MB or smaller.");
      }

      const path = `${roomId}/idle-loop.${isGif ? "gif" : "mp4"}`;
      const previousPath = media?.media_path;
      const contentType = isGif ? "image/gif" : "video/mp4";
      const { error: uploadError } = await supabase.storage
        .from("room-idle-media")
        .upload(path, bytes, { contentType, upsert: true });
      if (uploadError) throw uploadError;

      const { error: saveError } = await supabase.rpc("set_room_idle_media", {
        p_room_id: roomId,
        p_media_path: path,
        p_media_type: isGif ? "gif" : "video",
        p_mime_type: contentType,
        p_file_size_bytes: size,
        p_enabled: true,
      });
      if (saveError) throw saveError;

      if (previousPath && previousPath !== path) {
        await supabase.storage.from("room-idle-media").remove([previousPath]);
      }
      await load();
    } catch (error) {
      Alert.alert("Could not save Idle Loop", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function setEnabled(enabled: boolean) {
    if (!media || busy) return;
    setMedia({ ...media, enabled });
    const { error } = await supabase.rpc("set_room_idle_media_enabled", { p_room_id: roomId, p_enabled: enabled });
    if (error) {
      setMedia({ ...media, enabled: !enabled });
      Alert.alert("Could not update Idle Loop", error.message);
    }
  }

  function confirmRemove() {
    if (!media || busy) return;
    Alert.alert("Remove Idle Loop?", "Guests will see the standard waiting screen when nobody is live.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          const path = media.media_path;
          const { error } = await supabase.rpc("remove_room_idle_media", { p_room_id: roomId });
          if (!error) await supabase.storage.from("room-idle-media").remove([path]);
          setBusy(false);
          if (error) Alert.alert("Could not remove Idle Loop", error.message);
          else setMedia(null);
        },
      },
    ]);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>HOST IDLE LOOP</Text>
      <Text style={styles.title}>Keep the room warm between streams</Text>
      <Text style={styles.meta}>Upload a muted, looping MP4 (up to 30 seconds / 20 MB) or GIF (up to 10 MB). Live video always takes priority.</Text>
      {loading ? <ActivityIndicator color="#A78BFA" style={styles.loader} /> : null}
      {media ? (
        <>
          <View style={styles.preview}><IdleLoopMedia media={media} /></View>
          <View style={styles.toggleRow}>
            <View style={styles.toggleCopy}><Text style={styles.label}>Show while idle</Text><Text style={styles.meta}>{media.enabled ? "Enabled" : "Disabled"}</Text></View>
            <Switch value={media.enabled} onValueChange={(value) => void setEnabled(value)} disabled={busy} trackColor={{ false: "#3F3F46", true: "#7C3AED" }} />
          </View>
        </>
      ) : null}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.primary} onPress={() => void chooseMedia()} disabled={busy}>
          <Text style={styles.primaryText}>{busy ? "Saving..." : media ? "Replace Media" : "Upload Media"}</Text>
        </TouchableOpacity>
        {media ? <TouchableOpacity style={styles.secondary} onPress={confirmRemove} disabled={busy}><Text style={styles.secondaryText}>Remove</Text></TouchableOpacity> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#111118", borderColor: "#292936", borderRadius: 22, borderWidth: 1, gap: 12, marginBottom: 16, padding: 18 },
  eyebrow: { color: "#A78BFA", fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  title: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  label: { color: "#FFFFFF", fontWeight: "800" },
  meta: { color: "#A1A1AA", lineHeight: 20 },
  loader: { marginVertical: 18 },
  preview: { borderRadius: 18, height: 180, overflow: "hidden" },
  toggleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  toggleCopy: { flex: 1 },
  actions: { flexDirection: "row", gap: 10 },
  primary: { alignItems: "center", backgroundColor: "#7C3AED", borderRadius: 999, flex: 1, padding: 13 },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
  secondary: { alignItems: "center", borderColor: "#52525B", borderRadius: 999, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 13 },
  secondaryText: { color: "#FCA5A5", fontWeight: "900" },
});
