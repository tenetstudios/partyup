import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getHostDisplayName, getHostReputationProfile, type HostProfile } from "../../lib/hostProfile";
import {
  formatMemoryTimestamp,
  getMemoryPublicUrl,
  getRoomMemories,
  type RoomMemory,
} from "../../lib/memories";
import { supabase } from "../../lib/supabase";
import type { RoomIdleMedia } from "../lib/roomIdleMedia";
import IdleLoopMedia from "./IdleLoopMedia";
import RoomIdleLoopManager from "./RoomIdleLoopManager";

type EndedRoomArchiveProps = {
  idleMedia: RoomIdleMedia | null;
  hostId: string;
  isHost: boolean;
  onOpenMemories: () => void;
  onOpenRecap: () => void;
  onOpenSettings: () => void;
  roomId: string;
};

function ReplayViewer({ idleMedia }: { idleMedia: RoomIdleMedia | null }) {
  if (idleMedia?.enabled) {
    return (
      <View style={styles.replayFrame}>
        <IdleLoopMedia
          badgeLabel="EVENT ENDED · REPLAY"
          media={idleMedia}
          nativeControls
        />
      </View>
    );
  }

  return (
    <View style={[styles.replayFrame, styles.offlineFrame]}>
      <View style={styles.offlineIcon}>
        <Ionicons color="#8B849A" name="videocam-off-outline" size={34} />
      </View>
      <Text style={styles.offlineEyebrow}>BROADCAST OFFLINE</Text>
      <Text style={styles.offlineTitle}>Livestream ended</Text>
      <Text style={styles.offlineCopy}>This event is no longer broadcasting.</Text>
    </View>
  );
}

export default function EndedRoomArchive({
  idleMedia,
  hostId,
  isHost,
  onOpenMemories,
  onOpenRecap,
  onOpenSettings,
  roomId,
}: EndedRoomArchiveProps) {
  const [hostMessage, setHostMessage] = useState<string | null>(null);
  const [hostProfile, setHostProfile] = useState<HostProfile | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [memories, setMemories] = useState<RoomMemory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [userResult, messageResult, memoryResult, hostResult] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("room_recap_messages").select("message").eq("room_id", roomId).maybeSingle(),
      getRoomMemories(roomId).catch(() => []),
      getHostReputationProfile(hostId).catch(() => null),
    ]);
    setCurrentUserId(userResult.data.user?.id || "");
    setHostMessage(messageResult.data?.message?.trim() || null);
    setMemories(memoryResult.slice(0, 6));
    setHostProfile(hostResult?.profile ?? null);
    setIsFollowing(hostResult?.social.is_following ?? false);
    setLoading(false);
  }, [hostId, roomId]);

  async function toggleFollow() {
    if (!currentUserId || currentUserId === hostId || followBusy) return;
    const nextFollowing = !isFollowing;
    setFollowBusy(true);
    setIsFollowing(nextFollowing);

    const { error } = nextFollowing
      ? await supabase.from("follows").insert({ follower_id: currentUserId, following_id: hostId })
      : await supabase.from("follows").delete().eq("follower_id", currentUserId).eq("following_id", hostId);

    if (error) {
      setIsFollowing(!nextFollowing);
      Alert.alert("Could not update Follow", error.message);
    }
    setFollowBusy(false);
  }

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`mobile-ended-room-archive-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_recap_messages", filter: `room_id=eq.${roomId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_memories", filter: `room_id=eq.${roomId}` },
        () => void load(),
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [load, roomId]);

  return (
    <View style={styles.archive}>
      <View style={styles.hostMessageCard}>
        <View style={styles.hostRow}>
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/user/[id]", params: { id: hostId } })}
            style={styles.hostIdentity}
          >
            <View style={styles.hostAvatar}>
              {hostProfile?.avatar_url ? (
                <Image contentFit="cover" source={{ uri: hostProfile.avatar_url }} style={styles.hostAvatarImage} />
              ) : (
                <Text style={styles.hostAvatarFallback}>
                  {(hostProfile ? getHostDisplayName(hostProfile) : "Host").slice(0, 2).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={styles.hostCopy}>
              <Text style={styles.hostMessageEyebrow}>A MESSAGE FROM THE HOST</Text>
              <Text numberOfLines={1} style={styles.hostName}>
                {hostProfile ? getHostDisplayName(hostProfile) : "Event host"}
              </Text>
            </View>
          </TouchableOpacity>
          {currentUserId && currentUserId !== hostId ? (
            <TouchableOpacity
              disabled={followBusy}
              onPress={() => void toggleFollow()}
              style={[styles.followButton, isFollowing && styles.followingButton]}
            >
              <Text style={styles.followButtonText}>{followBusy ? "Saving..." : isFollowing ? "Following" : "Follow"}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.hostMessageText}>
          {loading ? "Opening the event archive..." : hostMessage || "Thanks for joining. This event has ended."}
        </Text>
      </View>

      {isHost ? (
        <RoomIdleLoopManager embedded presentation="event-replay" roomId={roomId} />
      ) : (
        <ReplayViewer idleMedia={idleMedia} />
      )}

      <View style={styles.memoriesCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderCopy}>
            <Text style={styles.sectionEyebrow}>FROM THE EVENT</Text>
            <Text style={styles.sectionTitle}>Memories</Text>
          </View>
          <TouchableOpacity onPress={onOpenMemories} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>View all</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#A78BFA" style={styles.loader} />
        ) : memories.length === 0 ? (
          <Text style={styles.emptyText}>No Memories were posted before this event ended.</Text>
        ) : (
          <View style={styles.memoryGrid}>
            {memories.map((memory) => {
              const url = getMemoryPublicUrl(memory.media_path);
              return (
                <View key={memory.id} style={styles.memoryCard}>
                  <TouchableOpacity
                    activeOpacity={memory.media_type === "video" ? 0.75 : 1}
                    disabled={memory.media_type !== "video"}
                    onPress={() => void Linking.openURL(url)}
                    style={styles.memoryMedia}
                  >
                    {memory.media_type === "image" ? (
                      <Image contentFit="cover" source={{ uri: url }} style={styles.memoryImage} transition={150} />
                    ) : (
                      <View style={styles.videoMemory}>
                        <Ionicons color="#FFFFFF" name="play" size={26} />
                        <Text style={styles.videoMemoryText}>Open video</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  <View style={styles.memoryMeta}>
                    <Text numberOfLines={1} style={styles.memoryUploader}>{memory.uploader_name || "Guest"}</Text>
                    <Text numberOfLines={1} style={styles.memoryDate}>{formatMemoryTimestamp(memory.created_at)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.linksCard}>
        <Text style={styles.sectionEyebrow}>KEEP THE NIGHT</Text>
        <Text style={styles.linksTitle}>The event lives on here.</Text>
        <Text style={styles.linksCopy}>Browse every Memory or revisit your personalized event recap.</Text>
        <TouchableOpacity onPress={onOpenMemories} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>View Memories</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenRecap} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Open Recap</Text>
        </TouchableOpacity>
        {isHost ? (
          <TouchableOpacity onPress={onOpenSettings} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Event Settings</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  archive: { gap: 16 },
  emptyText: { color: "#8B849A", fontSize: 14, fontWeight: "700", lineHeight: 21, paddingVertical: 20, textAlign: "center" },
  hostMessageCard: { backgroundColor: "rgba(90,26,74,0.28)", borderColor: "rgba(255,131,184,0.24)", borderRadius: 18, borderWidth: 1, padding: 20 },
  hostAvatar: { alignItems: "center", backgroundColor: "#7C3AED", borderColor: "rgba(255,255,255,0.2)", borderRadius: 999, borderWidth: 1, height: 48, justifyContent: "center", overflow: "hidden", width: 48 },
  hostAvatarFallback: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  hostAvatarImage: { height: "100%", width: "100%" },
  hostCopy: { flex: 1 },
  hostIdentity: { alignItems: "center", flex: 1, flexDirection: "row", gap: 11, minWidth: 180 },
  hostMessageEyebrow: { color: "#FF83B8", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  hostMessageText: { color: "#FFFFFF", fontSize: 19, fontWeight: "800", lineHeight: 28, marginTop: 10 },
  hostName: { color: "#FFFFFF", fontSize: 13, fontWeight: "900", marginTop: 4 },
  hostRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 12 },
  followButton: { backgroundColor: "#EF2F91", borderRadius: 999, minWidth: 82, paddingHorizontal: 14, paddingVertical: 10 },
  followButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900", textAlign: "center" },
  followingButton: { backgroundColor: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.16)", borderWidth: 1 },
  linksCard: { backgroundColor: "#120B1A", borderColor: "rgba(196,154,255,0.22)", borderRadius: 18, borderWidth: 1, padding: 20 },
  linksCopy: { color: "#A1A1AA", fontSize: 14, fontWeight: "700", lineHeight: 21, marginBottom: 16, marginTop: 7 },
  linksTitle: { color: "#FFFFFF", fontSize: 23, fontWeight: "900", marginTop: 7 },
  loader: { marginVertical: 28 },
  memoriesCard: { backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(255,255,255,0.1)", borderRadius: 18, borderWidth: 1, padding: 16 },
  memoryCard: { backgroundColor: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.09)", borderRadius: 12, borderWidth: 1, overflow: "hidden", width: "48%" },
  memoryDate: { color: "#777180", fontSize: 10, fontWeight: "700", marginTop: 3 },
  memoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  memoryImage: { height: "100%", width: "100%" },
  memoryMedia: { aspectRatio: 1, backgroundColor: "#050509" },
  memoryMeta: { padding: 10 },
  memoryUploader: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  offlineCopy: { color: "#777180", fontSize: 13, fontWeight: "700", marginTop: 8 },
  offlineEyebrow: { color: "#777180", fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginTop: 14 },
  offlineFrame: { alignItems: "center", justifyContent: "center", padding: 24 },
  offlineIcon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.045)", borderColor: "rgba(255,255,255,0.12)", borderRadius: 999, borderWidth: 1, height: 64, justifyContent: "center", width: 64 },
  offlineTitle: { color: "#FFFFFF", fontSize: 27, fontWeight: "900", marginTop: 7 },
  primaryButton: { alignItems: "center", backgroundColor: "#7C3AED", borderRadius: 10, minHeight: 50, justifyContent: "center", marginTop: 2 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "900" },
  replayFrame: { backgroundColor: "#000000", borderColor: "rgba(196,154,255,0.24)", borderRadius: 18, borderWidth: 1, height: 230, overflow: "hidden" },
  secondaryButton: { alignItems: "center", borderColor: "rgba(255,255,255,0.16)", borderRadius: 10, borderWidth: 1, justifyContent: "center", marginTop: 10, minHeight: 50 },
  secondaryButtonText: { color: "#FFFFFF", fontWeight: "900" },
  sectionEyebrow: { color: "#B587FF", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionHeaderCopy: { flex: 1 },
  sectionTitle: { color: "#FFFFFF", fontSize: 26, fontWeight: "900", marginTop: 5 },
  smallButton: { backgroundColor: "rgba(239,47,145,0.11)", borderColor: "rgba(249,168,212,0.3)", borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  smallButtonText: { color: "#FCE7F3", fontSize: 12, fontWeight: "900" },
  videoMemory: { alignItems: "center", flex: 1, justifyContent: "center" },
  videoMemoryText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900", marginTop: 7 },
});
