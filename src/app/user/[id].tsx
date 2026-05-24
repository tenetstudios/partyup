import { useEffect, useState } from "react";
import { Image } from "expo-image";
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../../lib/supabase";

type ProfileView = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
};

export default function UserProfile() {
  const { id } = useLocalSearchParams();
  const profileId = String(id);

  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [roomsHosted, setRoomsHosted] = useState(0);
  const [isLiveNow, setIsLiveNow] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadProfilePage();
  }, [profileId]);

  async function loadProfilePage() {
    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id || "";
    setCurrentUserId(userId);

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, bio")
      .eq("id", profileId)
      .maybeSingle();

    if (profileError) {
      window.alert(profileError.message);
      setLoading(false);
      return;
    }

    if (!profileData) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setProfile(profileData as ProfileView);

    const followersQuery = supabase
      .from("follows")
      .select("id")
      .eq("following_id", profileId);
    const followingQuery = supabase
      .from("follows")
      .select("id")
      .eq("follower_id", profileId);
    const roomsQuery = supabase
      .from("event_rooms")
      .select("id")
      .eq("host_id", profileId);
    const liveQuery = supabase
      .from("event_rooms")
      .select("id")
      .eq("host_id", profileId)
      .eq("status", "live");

    const [followersRes, followingRes, roomsRes, liveRes] = await Promise.all([
      followersQuery,
      followingQuery,
      roomsQuery,
      liveQuery,
    ]);

    if (
      followersRes.error ||
      followingRes.error ||
      roomsRes.error ||
      liveRes.error
    ) {
      window.alert("Failed to load profile stats.");
      setLoading(false);
      return;
    }

    setFollowers((followersRes.data || []).length);
    setFollowing((followingRes.data || []).length);
    setRoomsHosted((roomsRes.data || []).length);
    setIsLiveNow((liveRes.data || []).length > 0);

    if (userId) {
      const { data: followData, error: followError } = await supabase
        .from("follows")
        .select("id")
        .eq("follower_id", userId)
        .eq("following_id", profileId)
        .maybeSingle();

      if (!followError) {
        setIsFollowing(!!followData);
      }
    }

    setLoading(false);
  }

  async function toggleFollow() {
    if (!profile || processing || !currentUserId) return;
    if (currentUserId === profile.id) return;

    setProcessing(true);

    if (isFollowing) {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", currentUserId)
        .eq("following_id", profile.id);

      if (error) {
        window.alert(error.message);
        setProcessing(false);
        return;
      }

      setIsFollowing(false);
      setFollowers((prev) => Math.max(prev - 1, 0));
    } else {
      const { error } = await supabase.from("follows").insert({
        follower_id: currentUserId,
        following_id: profile.id,
      });

      if (error) {
        window.alert(error.message);
        setProcessing(false);
        return;
      }

      setIsFollowing(true);
      setFollowers((prev) => prev + 1);
    }

    setProcessing(false);
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => router.replace("/home")}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      {loading ? (
        <Text style={styles.loading}>Loading profile…</Text>
      ) : profile ? (
        <View style={styles.card}>
          <View style={styles.headerRow}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>
                  {profile.username?.slice(0, 2).toUpperCase() || "U"}
                </Text>
              </View>
            )}

            <View style={styles.titleBlock}>
              <Text style={styles.username} numberOfLines={1}>
                {profile.username || `Guest ${profile.id.slice(0, 4)}`}
              </Text>
              <View style={styles.badgeRow}>
                {isLiveNow && (
                  <View style={styles.liveBadge}>
                    <Text style={styles.liveBadgeText}>LIVE NOW</Text>
                  </View>
                )}
                <View style={styles.trustBadge}>
                  <Text style={styles.trustBadgeText}>Trusted Host</Text>
                </View>
              </View>
            </View>
          </View>

          <Text style={styles.bio}>{profile.bio || "This user has no bio yet."}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{followers}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{following}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{roomsHosted}</Text>
              <Text style={styles.statLabel}>Rooms hosted</Text>
            </View>
          </View>

          <View style={styles.profileFooter}>
            {currentUserId === profile.id ? (
              <Text style={styles.selfNotice}>This is your public profile.</Text>
            ) : (
              <TouchableOpacity
                style={[
                  styles.followButton,
                  (!currentUserId || processing) && styles.followButtonDisabled,
                ]}
                onPress={toggleFollow}
                disabled={!currentUserId || processing}
              >
                <Text style={styles.followButtonText}>
                  {isFollowing ? "Unfollow" : "Follow"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <Text style={styles.empty}>Profile not found.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#050509",
  },
  container: {
    minHeight: "100%",
    padding: 24,
    paddingTop: 40,
    paddingBottom: 60,
  },
  backButton: {
    marginBottom: 18,
  },
  backButtonText: {
    color: "#C8B5FF",
    fontWeight: "700",
  },
  loading: {
    marginTop: 80,
    color: "white",
    fontSize: 16,
    textAlign: "center",
  },
  empty: {
    marginTop: 80,
    color: "#A78BFA",
    fontSize: 16,
    textAlign: "center",
  },
  card: {
    backgroundColor: "#11111A",
    borderColor: "#2A2140",
    borderWidth: 1,
    borderRadius: 24,
    padding: 22,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 20,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: "#221F3E",
  },
  avatarFallback: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: "#221F3E",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
  },
  titleBlock: {
    flex: 1,
  },
  username: {
    color: "white",
    fontSize: 30,
    fontWeight: "900",
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  liveBadge: {
    backgroundColor: "#EF4444",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  liveBadgeText: {
    color: "white",
    fontWeight: "800",
    fontSize: 12,
  },
  trustBadge: {
    backgroundColor: "rgba(124, 58, 237, 0.18)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  trustBadgeText: {
    color: "#E9D5FF",
    fontSize: 12,
    fontWeight: "800",
  },
  bio: {
    color: "#C2B7ED",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 18,
    padding: 14,
    alignItems: "center",
  },
  statValue: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
  },
  statLabel: {
    color: "#A78BFA",
    marginTop: 6,
    fontSize: 12,
    fontWeight: "700",
  },
  profileFooter: {
    alignItems: "center",
  },
  followButton: {
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  followButtonDisabled: {
    backgroundColor: "#4C1D95",
  },
  followButtonText: {
    color: "white",
    fontWeight: "800",
    fontSize: 15,
  },
  selfNotice: {
    color: "#A78BFA",
    fontSize: 14,
  },
});
