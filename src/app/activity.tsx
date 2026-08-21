import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  type Notification,
  markNotificationAsRead,
} from "../../lib/notifications";
import { resolveMyEventRecaps } from "../../lib/recaps";
import { supabase } from "../../lib/supabase";

type FollowingRoom = {
  id: string;
  title: string;
  type: string | null;
  mode: string | null;
  current_users: number | null;
  max_users: number | null;
  queue_count: number | null;
};

type RoomInviteRow = {
  id: string;
  room_id: string;
  sender_id: string;
  recipient_id: string;
  status: string;
  created_at: string | null;
};

type InviteDetails = RoomInviteRow & {
  room_title: string;
  room_type: string | null;
  room_mode: string | null;
  sender_name: string;
};

export default function ActivityScreen() {
  const [followingRooms, setFollowingRooms] = useState<FollowingRoom[]>([]);
  const [invites, setInvites] = useState<InviteDetails[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    const initializeActivity = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user || !mounted) return;
      setCurrentUserId(user.id);
      
      await loadFollowingFeed();
      await loadInviteFeed();
      try {
        await resolveMyEventRecaps();
      } catch (error) {
        console.error("Failed to resolve event recaps:", error);
      }
      await loadNotifications();

      // Subscribe to realtime notifications
      const subscription = supabase
        .channel(`notifications:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (!mounted) return;
            if (payload.eventType === "INSERT") {
              const newNotification = payload.new as Notification;
              setNotifications((prev) => [newNotification, ...prev]);
            }
          }
        )
        .subscribe();

      unsubscribe = () => {
        supabase.removeChannel(subscription);
      };
    };

    initializeActivity();

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  async function loadNotifications() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      setNotifications([]);
      return;
    }

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Failed to load notifications:", error.message);
      setNotifications([]);
      return;
    }

    setNotifications((data || []) as Notification[]);
  }

  async function handleNotificationTap(notification: Notification) {
    // Mark as read
    if (!notification.is_read) {
      await markNotificationAsRead(notification.id);
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id ? { ...n, is_read: true } : n
        )
      );
    }

    // Navigate based on type
    const roomTypes = [
      "room_invite",
      "room_join",
      "friend_created_room",
      "friend_live",
      "host_live",
      "room_approved",
    ];

    if (notification.recap_room_id || (notification.type === "event_recap" && notification.room_id)) {
      router.push(`/recap/${notification.recap_room_id || notification.room_id}` as never);
    } else if (roomTypes.includes(notification.type) && notification.room_id) {
      router.push(`/room/${notification.room_id}`);
    } else if (notification.type === "follow" && notification.actor_id) {
      router.push(`/user/${notification.actor_id}`);
    }
  }

  async function loadFollowingFeed() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      setFollowingRooms([]);
      return;
    }

    const { data: follows, error: followError } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", user.id);

    if (followError) {
      console.error("Failed to load followed users:", followError.message);
      setFollowingRooms([]);
      return;
    }

    const followingIds = (follows || []).map((row) => row.following_id).filter(Boolean);

    if (followingIds.length === 0) {
      setFollowingRooms([]);
      return;
    }

    const { data: rooms, error: roomsError } = await supabase
      .from("event_rooms")
      .select("id,title,type,mode,current_users,max_users,queue_count")
      .in("host_id", followingIds)
      .eq("status", "live")
      .order("created_at", { ascending: false });

    if (roomsError) {
      console.error("Failed to load live followed rooms:", roomsError.message);
      setFollowingRooms([]);
      return;
    }

    setFollowingRooms((rooms || []) as FollowingRoom[]);
  }

  async function loadInviteFeed() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      setInvites([]);
      return;
    }

    const { data: inviteData, error: inviteError } = await supabase
      .from("room_invites")
      .select("id, room_id, sender_id, recipient_id, status, created_at")
      .eq("recipient_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (inviteError) {
      console.error("Failed to load room invites:", inviteError.message);
      setInvites([]);
      return;
    }

    const inviteRows = (inviteData || []) as RoomInviteRow[];
    const roomIds = Array.from(new Set(inviteRows.map((invite) => invite.room_id))).filter(Boolean);
    const senderIds = Array.from(new Set(inviteRows.map((invite) => invite.sender_id))).filter(Boolean);

    const roomMap: Record<string, { title: string; type: string | null; mode: string | null }> = {};
    const senderMap: Record<string, string> = {};

    if (roomIds.length > 0) {
      const { data: rooms, error: roomError } = await supabase
        .from("event_rooms")
        .select("id, title, type, mode")
        .in("id", roomIds);

      if (!roomError) {
        (rooms || []).forEach((room) => {
          roomMap[room.id] = {
            title: room.title || "Untitled room",
            type: room.type || null,
            mode: room.mode || null,
          };
        });
      }
    }

    if (senderIds.length > 0) {
      const { data: senders, error: senderError } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", senderIds);

      if (!senderError) {
        (senders || []).forEach((sender) => {
          senderMap[sender.id] = sender.username || `Guest ${sender.id.slice(0, 4)}`;
        });
      }
    }

    setInvites(
      inviteRows.map((invite) => ({
        ...invite,
        room_title: roomMap[invite.room_id]?.title || "Untitled room",
        room_type: roomMap[invite.room_id]?.type || null,
        room_mode: roomMap[invite.room_id]?.mode || null,
        sender_name: senderMap[invite.sender_id] || `Guest ${invite.sender_id.slice(0, 4)}`,
      }))
    );
  }

  async function acceptInvite(invite: InviteDetails) {
    const { error } = await supabase
      .from("room_invites")
      .update({ status: "accepted" })
      .eq("id", invite.id);

    if (error) {
      window.alert(error.message);
      return;
    }

    setInvites((current) => current.filter((item) => item.id !== invite.id));
    router.push(`/room/${invite.room_id}`);
  }

  async function ignoreInvite(invite: InviteDetails) {
    const { error } = await supabase
      .from("room_invites")
      .update({ status: "ignored" })
      .eq("id", invite.id);

    if (error) {
      window.alert(error.message);
      return;
    }

    setInvites((current) => current.filter((item) => item.id !== invite.id));
  }

  function formatInviteDate(dateString: string | null) {
    if (!dateString) return "Unknown";
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  function formatNotificationDate(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  function getNotificationBadgeLabel(type: string): string {
    const labels: Record<string, string> = {
      follow: "FOLLOW",
      room_invite: "INVITE",
      room_join: "JOIN",
      host_live: "LIVE",
      friend_live: "LIVE",
      friend_created_room: "NEW ROOM",
      room_approved: "APPROVED",
      event_recap: "RECAP",
      verification_approved: "VERIFIED",
    };
    return labels[type] || "NOTIFICATION";
  }

  function getNotificationBadgeStyle(type: string) {
    const badgeStyles: Record<string, { backgroundColor: string }> = {
      follow: { backgroundColor: "rgba(236, 72, 153, 0.22)" },
      room_invite: { backgroundColor: "rgba(96, 165, 250, 0.18)" },
      room_join: { backgroundColor: "rgba(34, 197, 94, 0.18)" },
      host_live: { backgroundColor: "rgba(255, 82, 146, 0.22)" },
      friend_live: { backgroundColor: "rgba(255, 82, 146, 0.22)" },
      friend_created_room: { backgroundColor: "rgba(168, 85, 247, 0.18)" },
      room_approved: { backgroundColor: "rgba(34, 197, 94, 0.18)" },
      event_recap: { backgroundColor: "rgba(168, 85, 247, 0.28)" },
      verification_approved: { backgroundColor: "rgba(34, 197, 94, 0.18)" },
    };
    return badgeStyles[type] || { backgroundColor: "rgba(124, 58, 237, 0.18)" };
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push("/home")}>
          <Text style={styles.back}>← Home</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Activity</Text>
        <Text style={styles.subtitle}>
          Invites, rooms, livestreams, and friend updates.
        </Text>
      </View>

      <View style={styles.livePanel}>
        <Text style={styles.liveEyebrow}>HAPPENING NOW</Text>
        <Text style={styles.liveTitle}>
          {followingRooms.length > 0
            ? `${followingRooms.length} followed room${followingRooms.length === 1 ? "" : "s"} live now`
            : "No followed rooms live yet"}
        </Text>
        <Text style={styles.liveCopy}>
          Follow people to see their live rooms here as soon as they go live.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Following Live Now</Text>

      {followingRooms.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nobody you follow is live</Text>
          <Text style={styles.emptyText}>
            Follow people to see their live rooms here.
          </Text>
        </View>
      ) : (
        followingRooms.map((room) => (
          <TouchableOpacity
            key={room.id}
            style={styles.card}
            onPress={() => router.push(`/room/${room.id}`)}
          >
            <View style={styles.cardTop}>
              <View style={[styles.badge, styles.liveBadge]}>
                <Text style={styles.badgeText}>LIVE</Text>
              </View>

              <Text style={styles.time}>
                {room.current_users}/{room.max_users}
              </Text>
            </View>

            <Text style={styles.cardTitle}>{room.title}</Text>

            <Text style={styles.cardBody}>
              {room.type?.replace("_", " ") || "Room"} • {room.mode || "Live"}
            </Text>
            <Text style={[styles.cardBody, styles.queueText]}>
              {room.current_users ?? 0}/{room.max_users ?? 0} users • {room.queue_count ?? 0} in queue
            </Text>
          </TouchableOpacity>
        ))
      )}

      <Text style={styles.sectionTitle}>Notifications</Text>

      {notifications.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptyText}>
            Follow people, join rooms, and activity will appear here.
          </Text>
        </View>
      ) : (
        notifications.map((notification) => (
          <TouchableOpacity
            key={notification.id}
            onPress={() => handleNotificationTap(notification)}
            style={[
              styles.card,
              !notification.is_read && styles.cardUnread,
            ]}
            activeOpacity={0.7}
          >
            <View style={styles.cardTop}>
              <View
                style={[
                  styles.badge,
                  getNotificationBadgeStyle(notification.recap_room_id ? "event_recap" : notification.type),
                ]}
              >
                <Text style={styles.badgeText}>
                  {getNotificationBadgeLabel(notification.recap_room_id ? "event_recap" : notification.type)}
                </Text>
              </View>

              <Text style={styles.time}>
                {formatNotificationDate(notification.created_at)}
              </Text>
            </View>

            <Text style={styles.cardTitle}>{notification.title}</Text>

            <Text style={styles.cardBody}>{notification.body}</Text>
          </TouchableOpacity>
        ))
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
    padding: 22,
    paddingTop: 54,
    paddingBottom: 120,
  },
  header: {
    marginBottom: 24,
  },
  back: {
    color: "#A78BFA",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 18,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  subtitle: {
    color: "#A0A0AA",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 320,
  },
  livePanel: {
    backgroundColor: "#170D2E",
    borderColor: "#3B1C73",
    borderWidth: 1,
    borderRadius: 26,
    padding: 20,
    marginBottom: 28,
  },
  liveEyebrow: {
    color: "#F472B6",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 10,
  },
  liveTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  liveCopy: {
    color: "#C4B5FD",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 14,
  },
  card: {
    backgroundColor: "#10101A",
    borderColor: "#242033",
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
  },
  cardUnread: {
    backgroundColor: "#1a1527",
    borderColor: "#3B1C73",
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  badge: {
    backgroundColor: "rgba(124, 58, 237, 0.18)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  liveBadge: {
    backgroundColor: "rgba(255, 82, 146, 0.22)",
  },
  inviteBadge: {
    backgroundColor: "rgba(96, 165, 250, 0.18)",
  },
  badgeText: {
    color: "#E9D5FF",
    fontSize: 11,
    fontWeight: "900",
  },
  time: {
    color: "#7C7A86",
    fontSize: 12,
    fontWeight: "700",
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 6,
  },
  cardBody: {
    color: "#B8B2C8",
    fontSize: 14,
    lineHeight: 20,
  },
  senderText: {
    marginTop: 8,
    color: "#9CA3AF",
  },
  queueText: {
    marginTop: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  primaryButton: {
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  secondaryButton: {
    backgroundColor: "#242033",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  secondaryButtonText: {
    color: "#D8B4FE",
    fontWeight: "900",
  },
  emptyCard: {
    backgroundColor: "#0D0D16",
    borderColor: "#202034",
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
  },
  emptyText: {
    color: "#8F8A9F",
    fontSize: 14,
    lineHeight: 20,
  },
});
