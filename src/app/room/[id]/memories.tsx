import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../../../lib/supabase";
import { ensurePartyUpIdentity } from "../../../lib/matchmaking";

type Room = {
  id: string;
  title: string;
  host_id: string;
};

type MemoryMediaType = "image" | "video";

type RoomMemory = {
  id: string;
  room_id: string;
  uploader_identity_id: string;
  media_type: MemoryMediaType;
  media_path: string;
  thumbnail_path: string | null;
  created_at: string;
  uploader_name: string | null;
  uploader_avatar_url: string | null;
};

type PendingMemory = {
  asset: ImagePicker.ImagePickerAsset;
  mediaType: MemoryMediaType;
};

const imageSizeLimit = 12 * 1024 * 1024;
const videoSizeLimit = 50 * 1024 * 1024;
const videoDurationLimitMs = 60 * 1000;

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatMemoryTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getAssetName(asset: ImagePicker.ImagePickerAsset, mediaType: MemoryMediaType) {
  const fallbackExtension = mediaType === "image" ? "jpg" : "mp4";
  const fileName = asset.fileName || `${mediaType}.${fallbackExtension}`;
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function getContentType(asset: ImagePicker.ImagePickerAsset, mediaType: MemoryMediaType) {
  if (asset.mimeType) {
    return asset.mimeType;
  }

  return mediaType === "image" ? "image/jpeg" : "video/mp4";
}

export default function RoomMemoriesScreen() {
  const { id } = useLocalSearchParams();
  const roomId = String(id);

  const [room, setRoom] = useState<Room | null>(null);
  const [memories, setMemories] = useState<RoomMemory[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentIdentityId, setCurrentIdentityId] = useState("");
  const [pendingMemory, setPendingMemory] = useState<PendingMemory | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMemories = useCallback(async () => {
    const { data, error: memoriesError } = await supabase.rpc("get_room_memories", {
      p_room_id: roomId,
    });

    if (memoriesError) {
      throw new Error(memoriesError.message);
    }

    setMemories((data || []) as RoomMemory[]);
  }, [roomId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      if (user) {
        setCurrentUserId(user.id);
        const identity = await ensurePartyUpIdentity();
        setCurrentIdentityId(identity.id);
      }

      const { data: roomData, error: roomError } = await supabase
        .from("event_rooms")
        .select("id, title, host_id")
        .eq("id", roomId)
        .maybeSingle();

      if (roomError) {
        throw new Error(roomError.message);
      }

      setRoom(roomData as Room | null);
      await loadMemories();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load Memories.");
    } finally {
      setLoading(false);
    }
  }, [loadMemories, roomId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function pickMemory(mediaType: MemoryMediaType) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to add a Memory.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: mediaType === "image",
      mediaTypes: mediaType === "image" ? ["images"] : ["videos"],
      quality: 0.85,
      videoMaxDuration: 60,
    });

    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    const sizeLimit = mediaType === "image" ? imageSizeLimit : videoSizeLimit;

    if (asset.fileSize && asset.fileSize > sizeLimit) {
      Alert.alert(
        "File too large",
        mediaType === "image"
          ? "Photos must be 12 MB or smaller."
          : "Videos must be 50 MB or smaller."
      );
      return;
    }

    if (mediaType === "video" && asset.duration && asset.duration > videoDurationLimitMs) {
      Alert.alert("Video too long", "Memories supports short clips up to 60 seconds.");
      return;
    }

    setPendingMemory({ asset, mediaType });
  }

  async function postMemory() {
    if (!pendingMemory || !currentIdentityId || uploading) {
      return;
    }

    setUploading(true);

    const { asset, mediaType } = pendingMemory;
    const fileName = getAssetName(asset, mediaType);
    const mediaPath = `${roomId}/${currentIdentityId}/${Date.now()}-${fileName}`;

    try {
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const contentType = getContentType(asset, mediaType);

      const { error: uploadError } = await supabase.storage
        .from("room-memories")
        .upload(mediaPath, blob, {
          contentType,
          upsert: false,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { error: insertError } = await supabase.from("room_memories").insert({
        room_id: roomId,
        uploader_identity_id: currentIdentityId,
        media_type: mediaType,
        media_path: mediaPath,
      });

      if (insertError) {
        await supabase.storage.from("room-memories").remove([mediaPath]);
        throw new Error(insertError.message);
      }

      setPendingMemory(null);
      await loadMemories();
    } catch (reason) {
      Alert.alert(
        "Upload failed",
        reason instanceof Error ? reason.message : "Could not post this Memory."
      );
    } finally {
      setUploading(false);
    }
  }

  async function deleteMemory(memory: RoomMemory) {
    Alert.alert("Delete Memory?", "This will remove it from the room Memories feed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error: deleteError } = await supabase
            .from("room_memories")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", memory.id);

          if (deleteError) {
            Alert.alert("Delete failed", deleteError.message);
            return;
          }

          await supabase.storage.from("room-memories").remove([memory.media_path]);
          await loadMemories();
        },
      },
    ]);
  }

  function getPublicUrl(path: string) {
    return supabase.storage.from("room-memories").getPublicUrl(path).data.publicUrl;
  }

  const isHost = !!room && room.host_id === currentUserId;
  const canUpload = !!currentIdentityId;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={20} color="#D9D5E8" />
        <Text style={styles.backText}>Back to room</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Memories</Text>
        <Text style={styles.subtitle}>Photos and clips from this room.</Text>
      </View>

      <View style={styles.addPanel}>
        <View>
          <Text style={styles.addTitle}>Add Memory</Text>
          <Text style={styles.addCopy}>Post a photo or short clip from the event.</Text>
        </View>

        <View style={styles.addActions}>
          <TouchableOpacity
            style={[styles.addButton, !canUpload && styles.buttonDisabled]}
            onPress={() => pickMemory("image")}
            disabled={!canUpload || uploading}
          >
            <Ionicons name="image-outline" size={18} color="#FFFFFF" />
            <Text style={styles.addButtonText}>Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.addButton, !canUpload && styles.buttonDisabled]}
            onPress={() => pickMemory("video")}
            disabled={!canUpload || uploading}
          >
            <Ionicons name="videocam-outline" size={18} color="#FFFFFF" />
            <Text style={styles.addButtonText}>Video</Text>
          </TouchableOpacity>
        </View>

        {!canUpload && (
          <Text style={styles.helperText}>Sign in and join the room to add Memories.</Text>
        )}
      </View>

      {pendingMemory && (
        <View style={styles.previewPanel}>
          <Text style={styles.previewTitle}>Preview</Text>
          {pendingMemory.mediaType === "image" ? (
            <Image source={{ uri: pendingMemory.asset.uri }} style={styles.previewImage} />
          ) : (
            <View style={styles.videoPreview}>
              <Ionicons name="play-circle-outline" size={44} color="#FFFFFF" />
              <Text style={styles.videoPreviewText}>Video selected</Text>
            </View>
          )}

          <View style={styles.previewActions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setPendingMemory(null)}
              disabled={uploading}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.postButton, uploading && styles.buttonDisabled]}
              onPress={postMemory}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.postButtonText}>Post</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {uploading && <Text style={styles.uploadingText}>Uploading...</Text>}
        </View>
      )}

      {loading ? (
        <View style={styles.loadingPanel}>
          <ActivityIndicator color="#A855F7" />
          <Text style={styles.loadingText}>Loading Memories...</Text>
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : memories.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>No memories yet.</Text>
          <Text style={styles.emptyCopy}>
            Be the first to add a photo or clip from this room.
          </Text>
          <TouchableOpacity
            style={[styles.postButton, !canUpload && styles.buttonDisabled]}
            onPress={() => pickMemory("image")}
            disabled={!canUpload}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.postButtonText}>Add Memory</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.grid}>
          {memories.map((memory) => {
            const publicUrl = getPublicUrl(memory.media_path);
            const uploaderName = memory.uploader_name || "Guest";
            const canDelete = isHost || memory.uploader_identity_id === currentIdentityId;

            return (
              <View key={memory.id} style={styles.memoryCard}>
                {memory.media_type === "image" ? (
                  <Image source={{ uri: publicUrl }} style={styles.memoryImage} />
                ) : (
                  <TouchableOpacity
                    style={styles.videoTile}
                    onPress={() => Linking.openURL(publicUrl)}
                  >
                    <Ionicons name="play-circle" size={42} color="#FFFFFF" />
                    <Text style={styles.videoTileText}>Play clip</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.memoryMeta}>
                  {memory.uploader_avatar_url ? (
                    <Image
                      source={{ uri: memory.uploader_avatar_url }}
                      style={styles.uploaderAvatar}
                    />
                  ) : (
                    <View style={styles.uploaderFallback}>
                      <Text style={styles.uploaderInitial}>{getInitials(uploaderName)}</Text>
                    </View>
                  )}

                  <View style={styles.uploaderText}>
                    <Text style={styles.uploaderName} numberOfLines={1}>
                      {uploaderName}
                    </Text>
                    <Text style={styles.memoryTime}>{formatMemoryTime(memory.created_at)}</Text>
                  </View>

                  {canDelete && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => deleteMemory(memory)}
                    >
                      <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#070710",
  },
  container: {
    padding: 18,
    paddingBottom: 36,
  },
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    marginBottom: 18,
  },
  backText: {
    color: "#D9D5E8",
    fontWeight: "800",
  },
  header: {
    marginBottom: 18,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 40,
  },
  subtitle: {
    color: "#B8B2C8",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 4,
  },
  addPanel: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.09)",
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    marginBottom: 16,
    padding: 16,
  },
  addTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  addCopy: {
    color: "#B8B2C8",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3,
  },
  addActions: {
    flexDirection: "row",
    gap: 10,
  },
  addButton: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 44,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  helperText: {
    color: "#FBBF24",
    fontSize: 12,
    fontWeight: "800",
  },
  previewPanel: {
    backgroundColor: "#11101B",
    borderRadius: 22,
    gap: 12,
    marginBottom: 18,
    padding: 14,
  },
  previewTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  previewImage: {
    aspectRatio: 1,
    borderRadius: 16,
    width: "100%",
  },
  videoPreview: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: "#171322",
    borderRadius: 16,
    justifyContent: "center",
  },
  videoPreviewText: {
    color: "#FFFFFF",
    fontWeight: "900",
    marginTop: 8,
  },
  previewActions: {
    flexDirection: "row",
    gap: 10,
  },
  cancelButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  cancelButtonText: {
    color: "#E5E1ED",
    fontWeight: "900",
  },
  postButton: {
    alignItems: "center",
    backgroundColor: "#FF2D93",
    borderRadius: 999,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  postButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  uploadingText: {
    color: "#D8B4FE",
    fontWeight: "800",
    textAlign: "center",
  },
  loadingPanel: {
    alignItems: "center",
    gap: 10,
    padding: 24,
  },
  loadingText: {
    color: "#B8B2C8",
    fontWeight: "800",
  },
  errorText: {
    color: "#FCA5A5",
    fontWeight: "800",
  },
  emptyPanel: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 22,
    gap: 10,
    padding: 22,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  emptyCopy: {
    color: "#B8B2C8",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  memoryCard: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    width: "48%",
  },
  memoryImage: {
    aspectRatio: 1,
    backgroundColor: "#11101B",
    width: "100%",
  },
  videoTile: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: "#171322",
    justifyContent: "center",
  },
  videoTileText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 6,
  },
  memoryMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    padding: 8,
  },
  uploaderAvatar: {
    borderRadius: 13,
    height: 26,
    width: 26,
  },
  uploaderFallback: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderRadius: 13,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  uploaderInitial: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
  },
  uploaderText: {
    flex: 1,
    minWidth: 0,
  },
  uploaderName: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  memoryTime: {
    color: "#9CA3AF",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 1,
  },
  deleteButton: {
    alignItems: "center",
    backgroundColor: "rgba(239,68,68,0.82)",
    borderRadius: 15,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
});
