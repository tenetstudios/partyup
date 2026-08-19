import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
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
import { supabase } from "../../lib/supabase";

type SocialTab = "connections" | "following" | "followers";

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
  const [following, setFollowing] = useState<ProfileRow[]>([]);
  const [followers, setFollowers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      connections: connections.length,
      followers: followers.length,
      following: following.length,
    }),
    [connections.length, followers.length, following.length],
  );

  const loadSocialData = useCallback(async () => {
    setMessage(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      setCurrentUserId(user?.id ?? null);

      if (!user) {
        setConnections([]);
        setFollowers([]);
        setFollowing([]);
        return;
      }

      const [connectionRows, followingRows, followerRows] = await Promise.all([
        getMyConnections(),
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
              When you and someone you meet through Match both choose Keep in Touch, they will appear here.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.push("/match")}>
              <Text style={styles.primaryButtonText}>Find a Match</Text>
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

      <Text style={styles.title}>Connections</Text>
      <Text style={styles.subtitle}>
        Connections are mutual Keep in Touch moments from Match. Following stays separate.
      </Text>

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
