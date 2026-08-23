import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  formatConnectionDate,
  getConnectionContextText,
  getConnectionInitial,
  getConnectionName,
  getMyConnections,
  removePartyUpConnection,
  type PartyUpConnection,
} from "../../lib/connections";
import {
  formatMemoryDate,
  formatMemoryTimestamp,
  getMemoryPublicUrl,
  getMySavedMemoryGroups,
  unsaveRoomMemory,
  type SavedMemory,
  type SavedMemoryGroup,
} from "../../lib/memories";
import { supabase } from "../../lib/supabase";

type SocialTab = "connections" | "memories" | "following" | "followers";

type ProfileRow = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

type FollowRow = {
  follower_id: string;
  following_id: string;
};

const tabs: { key: SocialTab; label: string }[] = [
  { key: "connections", label: "Connections" },
  { key: "memories", label: "Memories" },
  { key: "following", label: "Following" },
  { key: "followers", label: "Followers" },
];

function getProfileName(profile: ProfileRow) {
  return profile.username?.trim() || `Guest ${profile.id.slice(0, 4)}`;
}

function getInitial(name: string) {
  return name.slice(0, 1).toUpperCase();
}

export default function ConnectionsScreen() {
  const [activeTab, setActiveTab] = useState<SocialTab>("connections");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [connections, setConnections] = useState<PartyUpConnection[]>([]);
  const [memoryGroups, setMemoryGroups] = useState<SavedMemoryGroup[]>([]);
  const [selectedMemoryGroup, setSelectedMemoryGroup] = useState<SavedMemoryGroup | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<SavedMemory | null>(null);
  const [following, setFollowing] = useState<ProfileRow[]>([]);
  const [followers, setFollowers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [unsavingId, setUnsavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      connections: connections.length,
      memories: memoryGroups.reduce((sum, group) => sum + group.memory_count, 0),
      followers: followers.length,
      following: following.length,
    }),
    [connections.length, followers.length, following.length, memoryGroups],
  );

  const loadSocialData = useCallback(async () => {
    setMessage(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      setCurrentUserId(user?.id ?? null);

      if (!user) {
        setConnections([]);
        setMemoryGroups([]);
        setSelectedMemoryGroup(null);
        setSelectedMemory(null);
        setFollowers([]);
        setFollowing([]);
        return;
      }

      const [connectionRows, memoryRows, followingRows, followerRows] = await Promise.all([
        getMyConnections(),
        getMySavedMemoryGroups(),
        supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", user.id)
          .returns<FollowRow[]>(),
        supabase
          .from("follows")
          .select("follower_id")
          .eq("following_id", user.id)
          .returns<FollowRow[]>(),
      ]);

      if (followingRows.error) {
        throw new Error(followingRows.error.message);
      }

      if (followerRows.error) {
        throw new Error(followerRows.error.message);
      }

      const followingIds = (followingRows.data ?? [])
        .map((row) => row.following_id)
        .filter(Boolean);
      const followerIds = (followerRows.data ?? [])
        .map((row) => row.follower_id)
        .filter(Boolean);
      const profileIds = Array.from(new Set([...followingIds, ...followerIds]));
      const profileMap = new Map<string, ProfileRow>();

      if (profileIds.length > 0) {
        const { data: profiles, error } = await supabase
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", profileIds)
          .returns<ProfileRow[]>();

        if (error) {
          throw new Error(error.message);
        }

        for (const profile of profiles ?? []) {
          profileMap.set(profile.id, profile);
        }
      }

      setConnections(connectionRows);
      setMemoryGroups(memoryRows);
      setSelectedMemoryGroup((current) =>
        current ? memoryRows.find((group) => group.room_id === current.room_id) ?? null : null,
      );
      setFollowing(
        followingIds
          .map((id) => profileMap.get(id))
          .filter((profile): profile is ProfileRow => Boolean(profile)),
      );
      setFollowers(
        followerIds
          .map((id) => profileMap.get(id))
          .filter((profile): profile is ProfileRow => Boolean(profile)),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load your social history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadOnFocus() {
        setLoading(true);
        await loadSocialData();
        if (!active) return;
        setLoading(false);
      }

      void loadOnFocus();

      return () => {
        active = false;
      };
    }, [loadSocialData]),
  );

  async function refresh() {
    setRefreshing(true);
    await loadSocialData();
    setRefreshing(false);
  }

  async function removeConnection(connection: PartyUpConnection) {
    Alert.alert(
      "Remove Connection?",
      `Remove ${getConnectionName(connection)} from your Connections? Following will not change.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setRemovingId(connection.id);
            setMessage(null);

            try {
              await removePartyUpConnection(connection.id);
              setConnections((current) => current.filter((row) => row.id !== connection.id));
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "Could not remove this Connection.",
              );
            } finally {
              setRemovingId(null);
            }
          },
        },
      ],
    );
  }

  async function removeSavedMemory(memory: SavedMemory) {
    if (unsavingId) {
      return;
    }

    setUnsavingId(memory.id);
    setMessage(null);

    try {
      await unsaveRoomMemory(memory.id);
      const nextGroups = memoryGroups
        .map((group) => {
          const memories = group.memories.filter((item) => item.id !== memory.id);

          return {
            ...group,
            memories,
            memory_count: memories.length,
          };
        })
        .filter((group) => group.memories.length > 0);

      setMemoryGroups(nextGroups);
      setSelectedMemoryGroup((selected) =>
        selected ? nextGroups.find((group) => group.room_id === selected.room_id) ?? null : null,
      );
      setSelectedMemory(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not unsave this Memory.");
    } finally {
      setUnsavingId(null);
    }
  }

  function renderActiveTab() {
    if (!currentUserId && !loading) {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Sign in to see your Connections.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.push("/")}>
            <Text style={styles.primaryButtonText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (loading) {
      return <Text style={styles.loading}>Loading...</Text>;
    }

    if (activeTab === "connections") {
      if (connections.length === 0) {
        return (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No connections yet.</Text>
            <Text style={styles.emptyText}>
              Tap with someone you meet or both choose Keep in Touch after a Match. They will appear here.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.push("/connect" as never)}>
              <Text style={styles.primaryButtonText}>Make a Connection</Text>
            </TouchableOpacity>
          </View>
        );
      }

      return connections.map((connection) => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          removing={removingId === connection.id}
          onRemove={removeConnection}
        />
      ));
    }

    if (activeTab === "memories") {
      return (
        <ProfileMemories
          groups={memoryGroups}
          selectedGroup={selectedMemoryGroup}
          selectedMemory={selectedMemory}
          unsavingId={unsavingId}
          onSelectGroup={setSelectedMemoryGroup}
          onBackToGroups={() => setSelectedMemoryGroup(null)}
          onSelectMemory={setSelectedMemory}
          onCloseMemory={() => setSelectedMemory(null)}
          onUnsave={(memory) => void removeSavedMemory(memory)}
        />
      );
    }

    return (
      <ProfileList
        empty={activeTab === "following" ? "You are not following anyone yet." : "No followers yet."}
        profiles={activeTab === "following" ? following : followers}
      />
    );
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          tintColor="#A78BFA"
          refreshing={refreshing}
          onRefresh={refresh}
        />
      }
    >
      <TouchableOpacity onPress={() => router.push("/home")}>
        <Text style={styles.back}>Back Home</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Your Circle</Text>
      <Text style={styles.subtitle}>
        People you kept through Match or met and Tapped in real life.
      </Text>

      <TouchableOpacity style={styles.connectHeroButton} onPress={() => router.push("/connect" as never)}>
        <Ionicons name="flash" size={20} color="#FFFFFF" />
        <Text style={styles.connectHeroText}>Connect on PartyUp</Text>
      </TouchableOpacity>

      <View style={styles.tabRow}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
            <Text style={[styles.tabCount, activeTab === tab.key && styles.tabTextActive]}>
              {counts[tab.key]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {message && (
        <View style={styles.messageCard}>
          <Text style={styles.messageText}>{message}</Text>
        </View>
      )}

      <View style={styles.list}>{renderActiveTab()}</View>
    </ScrollView>
  );
}

function ConnectionCard({
  connection,
  removing,
  onRemove,
}: {
  connection: PartyUpConnection;
  removing: boolean;
  onRemove: (connection: PartyUpConnection) => void;
}) {
  const name = getConnectionName(connection);
  const profileUserId = connection.person.profile_user_id;

  return (
    <View style={styles.connectionCard}>
      <TouchableOpacity
        style={styles.connectionMain}
        disabled={!profileUserId}
        onPress={() => profileUserId && router.push(`/user/${profileUserId}`)}
      >
        {connection.person.avatar_url ? (
          <Image source={{ uri: connection.person.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarFallbackText}>{getConnectionInitial(connection)}</Text>
          </View>
        )}

        <View style={styles.connectionText}>
          <Text style={styles.connectionName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.connectionMeta} numberOfLines={1}>
            {getConnectionContextText(connection)}
          </Text>
          <Text style={styles.connectionDate}>
            {formatConnectionDate(connection.connected_at)}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.cardActions}>
        {profileUserId && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push(`/user/${profileUserId}`)}
          >
            <Text style={styles.secondaryButtonText}>View Profile</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.removeButton, removing && styles.disabledButton]}
          onPress={() => onRemove(connection)}
          disabled={removing}
        >
          <Text style={styles.removeButtonText}>
            {removing ? "Removing..." : "Remove Connection"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ProfileMemories({
  groups,
  selectedGroup,
  selectedMemory,
  unsavingId,
  onSelectGroup,
  onBackToGroups,
  onSelectMemory,
  onCloseMemory,
  onUnsave,
}: {
  groups: SavedMemoryGroup[];
  selectedGroup: SavedMemoryGroup | null;
  selectedMemory: SavedMemory | null;
  unsavingId: string | null;
  onSelectGroup: (group: SavedMemoryGroup) => void;
  onBackToGroups: () => void;
  onSelectMemory: (memory: SavedMemory) => void;
  onCloseMemory: () => void;
  onUnsave: (memory: SavedMemory) => void;
}) {
  if (groups.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>No saved memories yet.</Text>
        <Text style={styles.emptyText}>
          Save photos and clips from event rooms and they will appear here.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.push("/rooms")}>
          <Text style={styles.primaryButtonText}>Explore Rooms</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (selectedGroup) {
    return (
      <>
        <View style={styles.memoryDetailHeader}>
          <TouchableOpacity onPress={onBackToGroups}>
            <Text style={styles.back}>Back to Memories</Text>
          </TouchableOpacity>
          <Text style={styles.memoryGroupTitle}>{selectedGroup.room_title}</Text>
          <Text style={styles.memoryGroupDate}>{formatMemoryDate(selectedGroup.room_date)}</Text>
        </View>

        <View style={styles.memoryGrid}>
          {selectedGroup.memories.map((memory) => (
            <SavedMemoryTile
              key={memory.id}
              memory={memory}
              unsaving={unsavingId === memory.id}
              onSelect={onSelectMemory}
              onUnsave={onUnsave}
            />
          ))}
        </View>

        <SavedMemoryModal
          memory={selectedMemory}
          unsaving={selectedMemory ? unsavingId === selectedMemory.id : false}
          onClose={onCloseMemory}
          onUnsave={onUnsave}
        />
      </>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <TouchableOpacity
          key={group.room_id}
          style={styles.memoryGroupCard}
          activeOpacity={0.86}
          onPress={() => onSelectGroup(group)}
        >
          <View style={styles.memoryGroupHeader}>
            <View style={styles.memoryGroupText}>
              <Text style={styles.memoryGroupTitle} numberOfLines={1}>
                {group.room_title}
              </Text>
              <Text style={styles.memoryGroupDate}>{formatMemoryDate(group.room_date)}</Text>
            </View>
            <View style={styles.memoryCountPill}>
              <Text style={styles.memoryCountText}>{group.memory_count}</Text>
            </View>
          </View>

          <View style={styles.memoryPreviewRow}>
            {group.memories.slice(0, 4).map((memory) => (
              <MemoryPreview key={memory.id} memory={memory} />
            ))}
          </View>
        </TouchableOpacity>
      ))}
    </>
  );
}

function MemoryPreview({ memory }: { memory: SavedMemory }) {
  const url = getMemoryPublicUrl(memory.thumbnail_path || memory.media_path);

  if (memory.media_type === "image") {
    return <Image source={{ uri: url }} style={styles.memoryPreviewImage} />;
  }

  return (
    <View style={styles.memoryPreviewVideo}>
      <Ionicons name="play" size={18} color="#FFFFFF" />
    </View>
  );
}

function SavedMemoryTile({
  memory,
  unsaving,
  onSelect,
  onUnsave,
}: {
  memory: SavedMemory;
  unsaving: boolean;
  onSelect: (memory: SavedMemory) => void;
  onUnsave: (memory: SavedMemory) => void;
}) {
  return (
    <View style={styles.savedMemoryTile}>
      <TouchableOpacity
        activeOpacity={0.88}
        onPress={() => onSelect(memory)}
        style={styles.savedMemoryMediaButton}
      >
        <MemoryPreview memory={memory} />
      </TouchableOpacity>

      <Text style={styles.savedMemoryTime} numberOfLines={1}>
        {formatMemoryTimestamp(memory.created_at)}
      </Text>
      <TouchableOpacity
        style={[styles.savedUnsaveButton, unsaving && styles.disabledButton]}
        onPress={() => onUnsave(memory)}
        disabled={unsaving}
      >
        <Text style={styles.savedUnsaveText}>{unsaving ? "Unsaving..." : "Unsave"}</Text>
      </TouchableOpacity>
    </View>
  );
}

function SavedMemoryModal({
  memory,
  unsaving,
  onClose,
  onUnsave,
}: {
  memory: SavedMemory | null;
  unsaving: boolean;
  onClose: () => void;
  onUnsave: (memory: SavedMemory) => void;
}) {
  if (!memory) {
    return null;
  }

  const publicUrl = getMemoryPublicUrl(memory.media_path);

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View style={styles.savedViewerBackdrop}>
        <TouchableOpacity
          accessibilityLabel="Close Memory"
          style={styles.savedViewerClose}
          onPress={onClose}
        >
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </TouchableOpacity>

        {memory.media_type === "image" ? (
          <Image source={{ uri: publicUrl }} style={styles.savedViewerImage} contentFit="contain" />
        ) : (
          <TouchableOpacity
            style={styles.savedViewerVideo}
            onPress={() => Linking.openURL(publicUrl)}
          >
            <Ionicons name="play-circle" size={62} color="#FFFFFF" />
            <Text style={styles.savedViewerVideoText}>Play clip</Text>
          </TouchableOpacity>
        )}

        <View style={styles.savedViewerMeta}>
          <View style={styles.viewerMetaText}>
            <Text style={styles.viewerUploader} numberOfLines={1}>
              {memory.uploader_name || "Guest"}
            </Text>
            <Text style={styles.viewerTime} numberOfLines={1}>
              {memory.room_title} / {formatMemoryTimestamp(memory.created_at)}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.savedUnsaveButton, unsaving && styles.disabledButton]}
            onPress={() => onUnsave(memory)}
            disabled={unsaving}
          >
            <Text style={styles.savedUnsaveText}>{unsaving ? "Unsaving..." : "Unsave"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function ProfileList({ empty, profiles }: { empty: string; profiles: ProfileRow[] }) {
  if (profiles.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>{empty}</Text>
      </View>
    );
  }

  return profiles.map((profile) => {
    const name = getProfileName(profile);

    return (
      <TouchableOpacity
        key={profile.id}
        style={styles.profileCard}
        onPress={() => router.push(`/user/${profile.id}`)}
      >
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.smallAvatar} />
        ) : (
          <View style={styles.smallAvatarFallback}>
            <Text style={styles.smallAvatarFallbackText}>{getInitial(name)}</Text>
          </View>
        )}

        <View style={styles.profileText}>
          <Text style={styles.profileName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.profileMeta}>PartyUp profile</Text>
        </View>
      </TouchableOpacity>
    );
  });
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#050509",
  },
  container: {
    padding: 22,
    paddingTop: 54,
    paddingBottom: 120,
  },
  back: {
    color: "#A78BFA",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 18,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: -1,
  },
  subtitle: {
    color: "#A0A0AA",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 22,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18,
  },
  connectHeroButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    flexDirection: "row",
    gap: 9,
    marginBottom: 20,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  connectHeroText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  tab: {
    alignItems: "center",
    backgroundColor: "#10101A",
    borderColor: "#242033",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minHeight: 62,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  tabActive: {
    backgroundColor: "rgba(124, 58, 237, 0.22)",
    borderColor: "#7C3AED",
  },
  tabText: {
    color: "#A0A0AA",
    fontSize: 12,
    fontWeight: "900",
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  tabCount: {
    color: "#7C7A86",
    fontSize: 16,
    fontWeight: "900",
  },
  list: {
    gap: 14,
  },
  loading: {
    color: "#A78BFA",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 40,
    textAlign: "center",
  },
  messageCard: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderColor: "rgba(245, 158, 11, 0.25)",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  messageText: {
    color: "#FDE68A",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
  },
  connectionCard: {
    backgroundColor: "#10101A",
    borderColor: "#242033",
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  connectionMain: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  avatar: {
    backgroundColor: "#221F3E",
    borderRadius: 26,
    height: 62,
    width: 62,
  },
  avatarFallback: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderRadius: 26,
    height: 62,
    justifyContent: "center",
    width: 62,
  },
  avatarFallbackText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  connectionText: {
    flex: 1,
    minWidth: 0,
  },
  connectionName: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  connectionMeta: {
    color: "#C4B5FD",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  connectionDate: {
    color: "#7C7A86",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 5,
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 15,
  },
  primaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  secondaryButton: {
    backgroundColor: "#242033",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: "#D8B4FE",
    fontSize: 12,
    fontWeight: "900",
  },
  removeButton: {
    backgroundColor: "rgba(239, 68, 68, 0.14)",
    borderColor: "rgba(248, 113, 113, 0.24)",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  removeButtonText: {
    color: "#FECACA",
    fontSize: 12,
    fontWeight: "900",
  },
  disabledButton: {
    opacity: 0.6,
  },
  profileCard: {
    alignItems: "center",
    backgroundColor: "#10101A",
    borderColor: "#242033",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 14,
  },
  smallAvatar: {
    backgroundColor: "#221F3E",
    borderRadius: 22,
    height: 50,
    width: 50,
  },
  smallAvatarFallback: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderRadius: 22,
    height: 50,
    justifyContent: "center",
    width: 50,
  },
  smallAvatarFallbackText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  profileMeta: {
    color: "#8F8A9F",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  memoryGroupCard: {
    backgroundColor: "#10101A",
    borderColor: "#242033",
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  memoryGroupHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  memoryGroupText: {
    flex: 1,
    minWidth: 0,
  },
  memoryGroupTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  memoryGroupDate: {
    color: "#A78BFA",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  memoryCountPill: {
    alignItems: "center",
    backgroundColor: "rgba(124, 58, 237, 0.28)",
    borderColor: "rgba(167, 139, 250, 0.28)",
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 38,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  memoryCountText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  memoryPreviewRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  memoryPreviewImage: {
    aspectRatio: 1,
    backgroundColor: "#171322",
    borderRadius: 12,
    flex: 1,
    minHeight: 70,
  },
  memoryPreviewVideo: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: "#171322",
    borderRadius: 12,
    flex: 1,
    justifyContent: "center",
    minHeight: 70,
  },
  memoryDetailHeader: {
    backgroundColor: "#10101A",
    borderColor: "#242033",
    borderRadius: 22,
    borderWidth: 1,
    gap: 4,
    padding: 16,
  },
  memoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  savedMemoryTile: {
    backgroundColor: "#10101A",
    borderColor: "#242033",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    padding: 8,
    width: "48%",
  },
  savedMemoryMediaButton: {
    aspectRatio: 1,
    overflow: "hidden",
  },
  savedMemoryTime: {
    color: "#8F8A9F",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 8,
  },
  savedUnsaveButton: {
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.14)",
    borderColor: "rgba(248, 113, 113, 0.24)",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  savedUnsaveText: {
    color: "#FECACA",
    fontSize: 12,
    fontWeight: "900",
  },
  savedViewerBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.94)",
    flex: 1,
    justifyContent: "center",
    padding: 16,
    paddingTop: 56,
  },
  savedViewerClose: {
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
  savedViewerImage: {
    height: "72%",
    width: "100%",
  },
  savedViewerVideo: {
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
  savedViewerVideoText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  savedViewerMeta: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#10101A",
    borderColor: "#242033",
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
  emptyCard: {
    backgroundColor: "#0D0D16",
    borderColor: "#202034",
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  emptyText: {
    color: "#8F8A9F",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
});
