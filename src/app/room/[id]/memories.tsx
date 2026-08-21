import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../../../lib/supabase";
import {
  getMemoryPublicUrl,
  getRoomMemories,
  saveRoomMemory,
  unsaveRoomMemory,
  type RoomMemory,
} from "../../../../lib/memories";
import { ensurePartyUpIdentity } from "../../../lib/matchmaking";

type Room = {
  id: string;
  title: string;
  host_id: string;
  status: string;
};

type MemoryMediaType = "image" | "video";

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
  const [savingMemoryId, setSavingMemoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<RoomMemory | null>(null);

  const loadMemories = useCallback(async () => {
    setMemories(await getRoomMemories(roomId));
  }, [roomId]);

  const resolveCurrentIdentity = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;

    if (!user) {
      setCurrentUserId("");
      setCurrentIdentityId("");
      return;
    }

    setCurrentUserId(user.id);

    try {
      const identity = await ensurePartyUpIdentity();
      setCurrentIdentityId(identity.id);
    } catch {
      setCurrentIdentityId("");
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (user?.id) {
        setCurrentUserId(user.id);
      } else {
        setCurrentUserId("");
        setCurrentIdentityId("");
      }

      const { data: roomData, error: roomError } = await supabase
        .from("event_rooms")
        .select("id, title, host_id, status")
        .eq("id", roomId)
        .maybeSingle();

      if (roomError) {
        throw new Error(roomError.message);
      }

      setRoom(roomData as Room | null);
      await loadMemories();

      if (user?.id) {
        void resolveCurrentIdentity();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load Memories.");
    } finally {
      setLoading(false);
    }
  }, [loadMemories, resolveCurrentIdentity, roomId]);

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

      if (!response.ok) {
        throw new Error("Could not read the selected media file.");
      }

      const arrayBuffer = await response.arrayBuffer();
      const contentType = getContentType(asset, mediaType);

      const { error: uploadError } = await supabase.storage
        .from("room-memories")
        .upload(mediaPath, arrayBuffer, {
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
          const { error: deleteError } = await supabase.rpc("delete_room_memory", {
            p_memory_id: memory.id,
          });

          if (deleteError) {
            Alert.alert("Delete failed", deleteError.message);
            return;
          }

          setMemories((current) => current.filter((item) => item.id !== memory.id));
          await supabase.storage.from("room-memories").remove([memory.media_path]);
          await loadMemories().catch(() => undefined);
        },
      },
    ]);
  }

  async function toggleSaved(memory: RoomMemory) {
    if (savingMemoryId) {
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();

    if (!sessionData.session?.user) {
      Alert.alert("Sign in required", "Sign in to save Memories to your profile.");
      return;
    }

    const nextSaved = !memory.is_saved;
    setSavingMemoryId(memory.id);
    setMemories((current) =>
      current.map((item) => (item.id === memory.id ? { ...item, is_saved: nextSaved } : item)),
    );
    setSelectedMemory((current) =>
      current?.id === memory.id ? { ...current, is_saved: nextSaved } : current,
    );

    try {
      if (nextSaved) {
        await saveRoomMemory(memory.id);
      } else {
        await unsaveRoomMemory(memory.id);
      }
    } catch (reason) {
      setMemories((current) =>
        current.map((item) => (item.id === memory.id ? { ...item, is_saved: !nextSaved } : item)),
      );
      setSelectedMemory((current) =>
        current?.id === memory.id ? { ...current, is_saved: !nextSaved } : current,
      );
      Alert.alert(
        "Save failed",
        reason instanceof Error ? reason.message : "Could not update this saved Memory.",
      );
    } finally {
      setSavingMemoryId(null);
    }
  }

  const isHost = !!room && room.host_id === currentUserId;
  const ended = room?.status === "ended";
  const canUpload = !!currentIdentityId && !ended;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          router.push({
            pathname: "/room/[id]",
            params: { id: roomId },
          });
        }}
      >
        <Ionicons name="chevron-back" size={20} color="#D9D5E8" />
        <Text style={styles.backText}>Back to room</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Memories</Text>
        <Text style={styles.subtitle}>Photos and clips from this room.</Text>
      </View>

      {!ended ? <View style={styles.addPanel}>
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
      </View> : <View style={styles.addPanel}><Text style={styles.addTitle}>Past event Memories</Text><Text style={styles.addCopy}>These Memories are retained. New uploads are closed because the event has ended.</Text></View>}

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
            {ended ? "No Memories were posted before this event ended." : "Be the first to add a photo or clip from this room."}
          </Text>
          {!ended && <TouchableOpacity
            style={[styles.postButton, !canUpload && styles.buttonDisabled]}
            onPress={() => pickMemory("image")}
            disabled={!canUpload}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.postButtonText}>Add Memory</Text>
          </TouchableOpacity>}
        </View>
      ) : (
        <View style={styles.grid}>
          {memories.map((memory) => {
            const publicUrl = getMemoryPublicUrl(memory.media_path);
            const uploaderName = memory.uploader_name || "Guest";
            const canDelete = isHost || memory.uploader_identity_id === currentIdentityId;

            return (
              <View key={memory.id} style={styles.memoryCard}>
                {memory.media_type === "image" ? (
                  <TouchableOpacity
                    activeOpacity={0.88}
                    onPress={() => setSelectedMemory(memory)}
                  >
                    <Image source={{ uri: publicUrl }} style={styles.memoryImage} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.videoTile}
                    onPress={() => setSelectedMemory(memory)}
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

      <Modal
        animationType="fade"
        transparent
        visible={!!selectedMemory}
        onRequestClose={() => setSelectedMemory(null)}
      >
        <View style={styles.imageViewerBackdrop}>
          <TouchableOpacity
            accessibilityLabel="Close Memory"
            style={styles.imageViewerClose}
            onPress={() => setSelectedMemory(null)}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>

          {selectedMemory && (
            <>
              {selectedMemory.media_type === "image" ? (
                <Image
                  source={{ uri: getMemoryPublicUrl(selectedMemory.media_path) }}
                  style={styles.imageViewerImage}
                  resizeMode="contain"
                />
              ) : (
                <TouchableOpacity
                  style={styles.videoViewerPanel}
                  onPress={() => Linking.openURL(getMemoryPublicUrl(selectedMemory.media_path))}
                >
                  <Ionicons name="play-circle" size={62} color="#FFFFFF" />
                  <Text style={styles.videoViewerTitle}>Play clip</Text>
                </TouchableOpacity>
              )}

              <View style={styles.viewerMetaCard}>
                <View style={styles.viewerMetaText}>
                  <Text style={styles.viewerUploader} numberOfLines={1}>
                    {selectedMemory.uploader_name || "Guest"}
                  </Text>
                  <Text style={styles.viewerTime}>{formatMemoryTime(selectedMemory.created_at)}</Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    selectedMemory.is_saved && styles.saveButtonActive,
                    savingMemoryId === selectedMemory.id && styles.buttonDisabled,
                  ]}
                  onPress={() => toggleSaved(selectedMemory)}
                  disabled={savingMemoryId === selectedMemory.id}
                >
                  <Ionicons
                    name={selectedMemory.is_saved ? "bookmark" : "bookmark-outline"}
                    size={17}
                    color="#FFFFFF"
                  />
                  <Text style={styles.saveButtonText}>
                    {selectedMemory.is_saved ? "Saved" : "Save"}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>
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
    paddingTop: 30,
  },
  backButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#7C3AED",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginBottom: 18,
    minHeight: 46,
    paddingHorizontal: 16,
  },
  backText: {
    color: "#FFFFFF",
    fontWeight: "900",
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
  imageViewerBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.94)",
    flex: 1,
    justifyContent: "center",
    padding: 16,
    paddingTop: 56,
  },
  imageViewerClose: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 18,
    top: 46,
    width: 44,
    zIndex: 10,
  },
  imageViewerImage: {
    height: "86%",
    width: "100%",
  },
  videoViewerPanel: {
    alignItems: "center",
    backgroundColor: "#11101B",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    justifyContent: "center",
    minHeight: 280,
    width: "100%",
  },
  videoViewerTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  viewerMetaCard: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "rgba(17,16,27,0.96)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    marginTop: 14,
    padding: 12,
  },
  viewerMetaText: {
    flex: 1,
    minWidth: 0,
  },
  viewerUploader: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  viewerTime: {
    color: "#B8B2C8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: "rgba(124,58,237,0.34)",
    borderColor: "rgba(196,181,253,0.28)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  saveButtonActive: {
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
});
