import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Alert,
  FlatList,
  Image,
  ImageBackground,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import { supabase } from "../../../../lib/supabase";
import LiveKitRoomView from "../../../components/LiveKitRoomView";
import RoomMissionCard from "../../../components/RoomMissionCard";
import { getOrCreateEventMatchPool } from "../../../lib/matchmaking";
import { friendlyChatError } from "../../../../lib/chatModeration";
import {
  chatReportReasons,
  getMyRoomMessageReportIds,
  submitRoomMessageReport,
  type ChatReportReason,
} from "../../../../lib/chatReports";
import { useRoomStreamFrame } from "../../../hooks/useRoomStreamFrame";
import type { RoomIdleMedia } from "../../../lib/roomIdleMedia";

type RoomType = "party" | "concert" | "dj_set" | "popup" | "sports" | "watch_party";
type RoomMode = "irl" | "livestream" | "hybrid";
type RoomStatusType = "scheduled" | "live" | "ended";

type Room = {
  max_users: number;
  id: string;
  title: string;
  host_id: string;
  current_users: number;
  queue_count: number;
  type?: RoomType;
  mode?: RoomMode;
  status?: RoomStatusType;
  venue_name?: string;
  distance_km?: number;
  cover_image?: string | null;
};

type QueueUser = {
  id: string;
  event_room_id: string;
  user_id: string;
  username?: string | null;
  avatar_url?: string | null;
  bio?: string | null;

  can_stream?: boolean | null;
  stream_status?: string | null;
  room_role?: string | null;

  status: string;
  created_at: string;
  profile: Profile | null;
};

type Participant = QueueUser & {
  is_muted?: boolean | null;
};


type QueueRow = Omit<QueueUser, "profile">;

type Profile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
};

type Message = {
  id: string;
  room_id: string;
  user_id: string | null;
  display_name: string | null;
  message: string;
  created_at: string;
  removed_at?: string | null;
};

type RoomActivity = {
  id: string;
  room_id: string;
  user_id: string | null;
  actor_name: string | null;
  type: string;
  message: string;
  created_at: string;
};

type PresenceUser = {
  id: string;
  room_id: string;
  user_id: string;
  username: string | null;
  last_seen: string;
};

type TypingUser = {
  id: string;
  room_id: string;
  user_id: string;
  username: string | null;
  last_typed: string;
};

type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: string;
};

type FriendProfile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

const quickChatEmojis = ["😀", "😂", "❤️", "🔥", "👋", "🎉", "👍", "😭"];

function getGuestName(userId: string) {
  return `Guest ${userId.slice(0, 4)}`;
}

function getDisplayName(person: QueueUser) {
  return (
    person.profile?.username?.trim() ||
    person.username?.trim() ||
    getGuestName(person.user_id)
  );
}

function getAvatarUrl(person: QueueUser) {
  return person.profile?.avatar_url?.trim() || person.avatar_url?.trim() || "";
}

function getBio(person: QueueUser) {
  return person.profile?.bio?.trim() || person.bio?.trim() || "No bio yet.";
}

function getInitials(name: string) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "G";
}

function navigateToUser(userId: string | null) {
  if (!userId) return;
  router.push({
    pathname: "/user/[id]",
    params: { id: userId },
  });
}

function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function isLivestream(room: Room | null): boolean {
  if (!room) return false;
  return room.mode === "livestream" || room.mode === "hybrid";
}

function LivestreamPanel({
  room,
  isDesktop,
  userId,
  canPublish,
  fillParent = false,
  isFullscreen,
  onFullscreen,
  onExitFullscreen,
  onPublishingChange,
  publishSignal,
  stopSignal,
  shouldConnect,
  idleMedia,
  expectedLive,
}: {
  room: Room;
  isDesktop: boolean;
  userId: string;
  canPublish: boolean;
  fillParent?: boolean;
  isFullscreen?: boolean;
  onFullscreen?: () => void;
  onExitFullscreen?: () => void;
  onPublishingChange?: (publishing: boolean) => void;
  publishSignal?: number;
  stopSignal?: number;
  shouldConnect: boolean;
  idleMedia: RoomIdleMedia | null;
  expectedLive: boolean;
}) {
  const backgroundImage = room.cover_image
    ? { uri: room.cover_image }
    : require("../../../../assets/images/rooftop-dj-set.png");

  return (
    <View
      style={[
        styles.liveStreamCard,
        !isDesktop && styles.liveStreamCardMobile,
        fillParent && styles.liveStreamCardFill,
      ]}
    >
      <ImageBackground
  source={backgroundImage}
  style={[
    styles.liveStreamImage,
    isDesktop && styles.liveStreamImageDesktop,
    fillParent && styles.liveStreamImageFill,
  ]}
  imageStyle={styles.heroImageStyle}
>
        <View style={styles.liveStreamOverlay} />

        {isDesktop && (
        <View style={styles.liveStreamBadgeRow}>
          <View style={styles.viewerPill}>
            <Text style={styles.viewerPillText}>{room.current_users} viewers</Text>
          </View>
        </View>
        )}

        <View style={styles.livestreamPlaceholder}>
  <LiveKitRoomView
    roomId={room.id}
    userId={userId}
    canPublish={canPublish}
    fullscreen={Boolean(isFullscreen)}
    onExitFullscreen={onExitFullscreen}
    onPublishingChange={onPublishingChange}
    publishSignal={publishSignal}
    stopSignal={stopSignal}
    shouldConnect={shouldConnect}
    idleMedia={idleMedia}
    expectedLive={expectedLive}
  />

        </View>
      </ImageBackground>
    </View>
  );
}

function isUserOnline(userId: string, presenceUsers: PresenceUser[]): boolean {
  return presenceUsers.some((p) => p.user_id === userId);
}

export default function RoomScreen() {
  const { id } = useLocalSearchParams();
  const roomId = String(id);

  const [room, setRoom] = useState<Room | null>(null);
  const [queue, setQueue] = useState<QueueUser[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [myQueueStatus, setMyQueueStatus] = useState<string | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isFullscreenLive, setIsFullscreenLive] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [hostProfile, setHostProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "people" | "queue">("chat");
  const [showManageRoom, setShowManageRoom] = useState(false);
  const [activities, setActivities] =useState<RoomActivity[]>([]);
  const [eventMatchError, setEventMatchError] = useState<string | null>(null);
  const [eventMatchLoading, setEventMatchLoading] = useState(false);
  const [isLocalPublishing, setIsLocalPublishing] = useState(false);
  const [feedActionsVisible, setFeedActionsVisible] = useState(false);
  const [pendingLocalPublish, setPendingLocalPublish] = useState(false);
  const [publishSignal, setPublishSignal] = useState(0);
  const [stopPublishSignal, setStopPublishSignal] = useState(0);
  const [publisherIntent, setPublisherIntent] = useState(false);
  const [roomDeleted, setRoomDeleted] = useState(false);
  const [messageActionTarget, setMessageActionTarget] = useState<Message | null>(null);
  const [reportingMessage, setReportingMessage] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState<ChatReportReason | null>(null);
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportedMessageIds, setReportedMessageIds] = useState<Set<string>>(() => new Set());
  const chatListRef = useRef<FlatList<any> | null>(null);
  const feedActionsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { idleMedia, liveState } = useRoomStreamFrame(roomId);

  function scrollChatToLatest(animated = true) {
    requestAnimationFrame(() => {
      chatListRef.current?.scrollToEnd({ animated });
    });
  }

  useEffect(() => {
  loadAll();

  const channel = supabase.channel(`room-${roomId}-${Date.now()}`);

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "event_attendees",
      filter: `event_room_id=eq.${roomId}`,
    },
    async (payload) => {
      console.log("EVENT_ATTENDEES REALTIME FIRED:", payload);

      await loadQueue();
      await loadParticipants();
      await loadRoom();
      await loadPresence();
    }
  );

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "room_messages",
      filter: `room_id=eq.${roomId}`,
    },
    () => {
      loadMessages();
    }
  );

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "event_rooms",
      filter: `id=eq.${roomId}`,
    },
    () => {
      loadRoom();
    }
  );

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "room_typing",
      filter: `room_id=eq.${roomId}`,
    },
    () => {
      loadTypingUsers();
    }
  );

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "room_presence",
      filter: `room_id=eq.${roomId}`,
    },
    () => {
      loadPresence();
    }
  );

  channel.subscribe();

  const typingInterval = setInterval(() => {
    loadTypingUsers();
  }, 1000);

  const presenceInterval = setInterval(() => {
    updatePresence();
  }, 10000);

  const attendeeInterval = setInterval(() => {
  if (roomDeleted) return;

  loadQueue();
  loadParticipants();
  loadRoom();
}, 2000);

    return () => {
    clearInterval(typingInterval);
    clearInterval(presenceInterval);
    clearInterval(attendeeInterval);

    channel.unsubscribe();
    supabase.removeChannel(channel);
  };
}, [roomId, roomDeleted]);

  useEffect(() => {
    if (activeTab === "chat") {
      scrollChatToLatest();
    }
  }, [activeTab, messages.length, activities.length]);

  useEffect(
    () => () => {
      if (feedActionsTimeoutRef.current) {
        clearTimeout(feedActionsTimeoutRef.current);
      }
    },
    [],
  );

  async function loadAll() {
  await updatePresence();
  await loadRoom();
  await loadQueue();
  await loadParticipants();
  await loadMessages();
  await loadPresence();
  await loadTypingUsers();
  await loadActivities();
}

async function loadHostProfile(hostId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, avatar_url, bio")
    .eq("id", hostId)
    .maybeSingle();

  if (error) return;

  setHostProfile(data || null);
}

 async function loadRoom() {
  if (roomDeleted) return;

  const { data, error } = await supabase
    .from("event_rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();

  if (roomDeleted) return;

  if (error) {
    console.log("ROOM LOAD ERROR:", error.message);
    return;
  }

  if (!data) {
    if (!roomDeleted) {
      setRoomDeleted(true);
      router.replace("/home");
    }

    return;
  }

  setRoom(data);

  if (
    data.is_private &&
    currentUserId &&
    data.host_id !== currentUserId
  ) {
    const { data: attendee } = await supabase
      .from("event_attendees")
      .select("status")
      .eq("event_room_id", data.id)
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (!attendee || attendee.status !== "accepted") {
      if (!roomDeleted) {
        setRoomDeleted(true);
        Alert.alert(
          "Private room",
          "You need to be accepted before viewing this room."
        );
        router.replace("/home");
      }

      return;
    }
  }

  if (data?.host_id) {
    loadHostProfile(data.host_id);
  }
}

  async function hydrateQueueProfiles(rows: QueueRow[]) {
    if (rows.length === 0) return [];

    const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, bio")
      .in("id", userIds);

    if (error) {
      window.alert(error.message);
      return rows.map((row) => ({ ...row, profile: null }));
    }

    const profilesByUserId = new Map(
      ((data || []) as Profile[]).map((profile) => [profile.id, profile])
    );

    return rows.map((row) => ({
      ...row,
      profile: profilesByUserId.get(row.user_id) || null,
    }));
  }

  async function loadQueue() {
    const { data: userData } = await supabase.auth.getUser();

    if (userData.user) {
      setCurrentUserId(userData.user.id);

      const reportedIds = await getMyRoomMessageReportIds(supabase, roomId).catch(() => []);
      setReportedMessageIds(new Set(reportedIds));

      const { data: myQueueRow } = await supabase
.from("event_attendees")
      .select("status")
      .eq("event_room_id", roomId)
        .eq("user_id", userData.user.id)
        .maybeSingle();

      setMyQueueStatus(myQueueRow?.status || null);
    }

    const { data, error } = await supabase
      .from("event_attendees")
      .select("*")
      .eq("event_room_id", roomId)
      .eq("status", "waiting")
      .order("queue_score", { ascending: false })
      .order("created_at", { ascending: true });

    if (error) {
      window.alert(error.message);
      return;
    }

    const hydratedQueue = await hydrateQueueProfiles((data || []) as QueueRow[]);

    setQueue(hydratedQueue);
  }

  async function loadParticipants() {
    const { data, error } = await supabase
      .from("event_attendees")
      .select("*")
      .eq("event_room_id", roomId)
      .eq("status", "accepted")
      .order("created_at", { ascending: true });

    if (error) {
      window.alert(error.message);
      return;
    }

    const hydratedParticipants = await hydrateQueueProfiles(
      (data || []) as QueueRow[]
    );

    setParticipants(hydratedParticipants);
  }

  async function syncRoomCounts(roomId: string) {
  const { count: acceptedCount } = await supabase
    .from("event_attendees")
    .select("*", { count: "exact", head: true })
    .eq("event_room_id", roomId)
    .eq("status", "accepted");

  const { count: waitingCount } = await supabase
    .from("event_attendees")
    .select("*", { count: "exact", head: true })
    .eq("event_room_id", roomId)
    .eq("status", "waiting");

  await supabase
    .from("event_rooms")
    .update({
      current_users: acceptedCount || 0,
      queue_count: waitingCount || 0,
      last_active_at: new Date().toISOString(),
    })
    .eq("id", roomId);
}

  async function loadMessages() {
    const { data, error } = await supabase
      .from("room_messages")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true });

    if (error) {
      window.alert(error.message);
      return;
    }

    setMessages(((data || []) as Message[]).filter((message) => !message.removed_at));
  }

  async function loadActivities() {
  const { data, error } = await supabase
    .from("room_activity")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  if (error) {
    console.log("ACTIVITY ERROR:", error.message);
    return;
  }

  setActivities(data || []);
}

async function createActivity(type: string, message: string) {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  await supabase.from("room_activity").insert({
    room_id: roomId,
    user_id: user?.id || null,
    actor_name: user?.id
      ? `Guest ${user.id.slice(0, 4)}`
      : null,
    type,
    message,
  });
}

  async function acceptUser(queueRow: QueueUser) {
    
    if (room && room.current_users >= room.max_users) {
  window.alert("Room is full.");
  return;
}

    const { data, error } = await supabase
      .from("event_attendees")
      .update({ status: "accepted" })
      .eq("id", queueRow.id)
      .eq("status", "waiting")
      .select();

    if (error) {
      window.alert(error.message);
      return;
    }

    if (!data || data.length === 0) return;

    if (room) {
  await syncRoomCounts(room.id);
}
    loadAll();
  }

  async function rejectUser(queueRow: QueueUser) {
    const { data, error } = await supabase
      .from("event_attendees")
      .update({ status: "rejected" })
      .eq("id", queueRow.id)
      .eq("status", "waiting")
      .select();

    if (error) {
      window.alert(error.message);
      return;
    }

    if (!data || data.length === 0) return;

    if (room) {
      await supabase
        .from("event_rooms")
        .update({
          queue_count: Math.max(room.queue_count - 1, 0),
        })
        .eq("id", room.id);
    }

    loadAll();
  }

  async function kickUser(person: Participant) {
    const { error } = await supabase
      .from("event_attendees")
      .update({ status: "kicked" })
      .eq("id", person.id);

    if (error) {
      window.alert(error.message);
      return;
    }

    if (room) {
      await supabase
        .from("event_rooms")
        .update({
          current_users: Math.max(room.current_users - 1, 0),
        })
        .eq("id", room.id);
    }

    loadAll();
  }

  async function toggleMuteUser(person: Participant) {
  await supabase
    .from("event_attendees")
    .update({
      is_muted: !person.is_muted,
    })
    .eq("id", person.id);
}

  async function deleteRoom() {
  if (!room) return;

  Alert.alert(
    "Delete room?",
    "This will permanently delete the room and OBS ingress.",
    [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {

          // DELETE OBS INGRESS
          try {
            await supabase.functions.invoke(
              "delete-ingress",
              {
                body: {
                  roomName: room.id,
                },
              }
            );
          } catch (e) {
            console.log(
              "DELETE INGRESS ERROR:",
              e
            );
          }

          // DELETE ROOM
          const { error } = await supabase
            .from("event_rooms")
            .delete()
            .eq("id", room.id);

          if (error) {
            Alert.alert(
              "Delete room error",
              error.message
            );
            return;
          }

          router.replace("/home");
        },
      },
    ]
  );
}

async function leaveRoom() {
  if (!room || !currentUserId) return;

  await supabase
    .from("event_attendees")
    .update({
      status: "left",
      can_stream: false,
      stream_status: "off",
    })
    .eq("event_room_id", room.id)
    .eq("user_id", currentUserId);

  const wasInside =
  myQueueStatus === "accepted";

await supabase
  .from("event_rooms")
  .update({
    current_users: wasInside
      ? Math.max(room.current_users - 1, 0)
      : room.current_users,

    last_active_at:
      new Date().toISOString(),
  })
  .eq("id", room.id);

  router.replace("/home");
}

async function startEventMatch() {
  if (!room || eventMatchLoading) {
    return;
  }

  setEventMatchLoading(true);
  setEventMatchError(null);

  try {
    const pool = await getOrCreateEventMatchPool(room.id);

    router.push({
      pathname: "/match",
      params: {
        pool: pool.poolId,
        roomId: room.id,
      },
    });
    setEventMatchLoading(false);
  } catch (reason) {
    setEventMatchError(reason instanceof Error ? reason.message : "Could not start event Match.");
    setEventMatchLoading(false);
  }
}

async function shareRoom() {
  if (!room) {
    return;
  }

  try {
    await Share.share({
      message: `Join me in ${room.title} on PartyUp.`,
    });
  } catch {
    Alert.alert("Share unavailable", "This room could not be shared right now.");
  }
}

  function openManageRoom() {
  if (!room) {
    return;
  }

  router.push({
    pathname: "/room/[id]/queue",
    params: { id: room.id },
  });
}

function openMemories() {
  if (!room) {
    return;
  }

  router.push({
    pathname: "/room/[id]/memories",
    params: { id: room.id },
  });
}

  async function sendMessage() {
    if (!messageText.trim()) return;

    // Validate room ID is a real UUID
    if (!isValidUUID(roomId)) {
      window.alert("Invalid room ID.");
      return;
    }

    // Ensure room exists
    if (!room) {
      window.alert("Room not found.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      window.alert("You need to sign in first.");
      return;
    }

const { error } = await supabase.rpc("send_room_message", {
  p_room_id: roomId,
  p_message: messageText.trim(),
});

    if (error) {
      window.alert(friendlyChatError(error.message));
      return;
    }

    setMessageText("");
    loadMessages();
  }

  function moderateMessage(message: Message, action: "remove" | "mute_5m") {
    setMessageActionTarget(null);
    const title = action === "remove" ? "Remove this message?" : "Mute this person for 5 minutes?";
    const body = action === "remove"
      ? "The message will disappear from this room."
      : "They will be unable to post in this room for 5 minutes.";

    Alert.alert(title, body, [
      { text: "Cancel", style: "cancel" },
      {
        text: action === "remove" ? "Remove" : "Mute",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.rpc("moderate_room_message", {
            p_message_id: message.id,
            p_action: action,
          });

          if (error) {
            Alert.alert("Moderation failed", error.message);
            return;
          }

          if (action === "remove") {
            setMessages((current) => current.filter((item) => item.id !== message.id));
          }
        },
      },
    ]);
  }

  function beginReport(message: Message) {
    setMessageActionTarget(null);
    setReportReason(null);
    setReportDetails("");
    setReportingMessage(message);
  }

  async function submitMessageReport() {
    if (!reportingMessage || !reportReason || reportSubmitting) return;
    setReportSubmitting(true);

    try {
      await submitRoomMessageReport(
        supabase,
        reportingMessage.id,
        reportReason,
        reportDetails,
      );
      setReportedMessageIds((current) => new Set(current).add(reportingMessage.id));
      setReportingMessage(null);
      Alert.alert("Report submitted", "The room host can now review this message.");
    } catch (reason) {
      Alert.alert("Report failed", reason instanceof Error ? reason.message : "Could not submit this report.");
    } finally {
      setReportSubmitting(false);
    }
  }

  function insertEmoji(emoji: string) {
    setMessageText((current) => `${current}${emoji}`);
    setEmojiPickerOpen(false);
  }

async function updatePresence() {
  if (room?.status === "ended") return;
  // Validate room ID is a real UUID
  if (!isValidUUID(roomId)) {
    return;
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  await supabase.from("room_presence").upsert(
  {
    room_id: roomId,
    user_id: user.id,
    username: profile?.username || `Guest ${user.id.slice(0, 4)}`,
    last_seen: new Date().toISOString(),
  },
  {
    onConflict: "room_id,user_id",
  }
);
}

async function loadPresence() {
  const cutoff = new Date(Date.now() - 30000).toISOString();

  const { data, error } = await supabase
    .from("room_presence")
    .select("*")
    .eq("room_id", roomId)
    .gte("last_seen", cutoff)
    .order("last_seen", { ascending: false });

  if (error) {
    window.alert(error.message);
    return;
  }

  setPresenceUsers(data || []);

  if (!room) return;

  const onlineUserIds = new Set(
    (data || []).map((p) => p.user_id)
  );

  const { data: acceptedRows } = await supabase
    .from("event_attendees")
    .select("*")
    .eq("event_room_id", room.id)
    .eq("status", "accepted");

  const staleParticipants = (acceptedRows || []).filter(
    (p) => !onlineUserIds.has(p.user_id)
  );

  if (staleParticipants.length === 0) return;

  await supabase
    .from("event_attendees")
    .update({
      status: "left",
      can_stream: false,
      stream_status: "off",
    })
    .in(
      "id",
      staleParticipants.map((p) => p.id)
    );

  await supabase
    .from("event_rooms")
    .update({
      current_users: Math.max(
        (acceptedRows || []).length - staleParticipants.length,
        0
      ),
      last_active_at: new Date().toISOString(),
    })
    .eq("id", room.id);
}

async function updateTyping() {
  // Validate room ID is a real UUID
  if (!isValidUUID(roomId)) {
    return;
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("room_typing")
    .upsert(
      {
        room_id: roomId,
        user_id: user.id,
        username: profile?.username || `Guest ${user.id.slice(0, 4)}`,
        last_typed: new Date().toISOString(),
      },
      {
        onConflict: "room_id,user_id",
      }
    );

  if (error) {
    console.log("TYPING ERROR:", error);
  }
}

async function loadTypingUsers() {
  const cutoff = new Date(Date.now() - 3000).toISOString();

  const { data, error } = await supabase
    .from("room_typing")
    .select("*")
    .eq("room_id", roomId)
    .gte("last_typed", cutoff);

  if (error) {
    return;
  }

  const filtered =
    data?.filter((u) => u.user_id !== currentUserId) || [];

  setTypingUsers(filtered);
}

async function requestToStream() {
  const participant = participants.find(
    (p) => p.user_id === currentUserId
  );

  if (participant?.is_muted) {
    window.alert("You are muted by the host.");
    return;
  }

  const { error } = await supabase
    .from("event_attendees")
    .update({
      stream_status: "requested",
    })
    .eq("event_room_id", roomId)
    .eq("user_id", currentUserId);

  if (error) {
    window.alert(error.message);
    return;
  }

  await createActivity(
    "requested_stream",
    "Requested to go live"
  );

  loadAll();
}

async function approveStreamer(person: Participant) {
  const { error } = await supabase
    .from("event_attendees")
    .update({
      can_stream: true,
      stream_status: "live",
    })
    .eq("id", person.id);

  if (error) {
    window.alert(error.message);
    return false;
  }
await createActivity(
  "approved_stream",
  "Approved a streamer"
);
  loadAll();
  return true;
}

async function stopStreamer(person: Participant) {
  const { error } = await supabase
    .from("event_attendees")
    .update({
      can_stream: false,
      stream_status: "off",
    })
    .eq("id", person.id);

  if (error) {
    window.alert(error.message);
    return false;
  }

  await createActivity(
    "stopped_stream",
    "Stopped a livestream"
  );

  loadAll();
  return true;
}

async function loadFriends() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) return;

  const { data, error } = await supabase
    .from("friendships")
    .select("*")
    .eq("status", "accepted")
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

  if (error) {
    window.alert(error.message);
    return;
  }

  const rows = (data || []) as FriendshipRow[];

  const friendIds = rows.map((row) =>
    row.requester_id === user.id ? row.addressee_id : row.requester_id
  );

  if (friendIds.length === 0) {
    setFriends([]);
    return;
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, avatar_url")
    .in("id", friendIds);

  if (profileError) {
    window.alert(profileError.message);
    return;
  }

  setFriends((profiles || []) as FriendProfile[]);
}

async function sendRoomInvite(friendId: string) {
  if (!room || !currentUserId) return;

  const { error } = await supabase.from("room_invites").upsert(
    {
      room_id: room.id,
      sender_id: currentUserId,
      recipient_id: friendId,
      status: "pending",
    },
    {
      onConflict: "room_id,sender_id,recipient_id",
    }
  );

  if (error) {
    window.alert(error.message);
    return;
  }

  const { error: notificationError } = await supabase.from("notifications").insert({
    user_id: friendId,
    type: "room_invite",
    actor_id: currentUserId,
    room_id: room.id,
    title: "Room invite",
    body: "You were invited to join a room.",
  });

  if (notificationError) {
    window.alert("Invite sent, but failed to create notification: " + notificationError.message);
  }

  window.alert("Invite sent.");
}

async function makeBouncer(person: Participant) {
  const nextRole =
    person.room_role === "bouncer"
      ? "guest"
      : "bouncer";

  const { error } = await supabase
    .from("event_attendees")
    .update({
      room_role: nextRole,
    })
    .eq("id", person.id);

  if (error) {
    window.alert(error.message);
    return;
  }

  loadParticipants();
}


  const { height, width } = useWindowDimensions();
  const isDesktop = width >= 960;
  const myParticipant = participants.find(
    (p) => p.user_id === currentUserId
  );
  const prioritizedParticipants = currentUserId
    ? [
        ...participants.filter((person) => person.user_id === currentUserId),
        ...participants.filter((person) => person.user_id !== currentUserId),
      ]
    : participants;

  useEffect(() => {
    if (!pendingLocalPublish || !myParticipant?.can_stream) {
      return;
    }

    setPendingLocalPublish(false);
    setPublishSignal((current) => current + 1);
  }, [myParticipant?.can_stream, pendingLocalPublish]);

  if (!room) {
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.container}>
        <Text style={styles.loading}>Loading room...</Text>
      </ScrollView>
    );
  }

  const isHost = currentUserId === room.host_id;
const isBouncer =
  myParticipant?.room_role === "bouncer" ||
  myParticipant?.room_role === "admin";

const canManageQueue = isHost || isBouncer;
  const activeStreamers = participants.filter(
  (p: any) => p.can_stream
);

const hostParticipant = participants.find(
  (p) => p.user_id === room.host_id
);

const hostIsLive = hostParticipant?.user_id === currentUserId && isLocalPublishing;

const requestedStreamers = [
  ...participants,
  ...queue,
].filter(
  (p: any) => p.stream_status === "requested"
);
  const startedLabel = room.status === "live" ? "Live now" : room.status === "scheduled" ? "Scheduled" : "Ended";
  const hostName =
  hostProfile?.username?.trim() ||
  (room.host_id ? `Host ${room.host_id.slice(0, 4)}` : "Host");

  async function toggleMyLivestream() {
    if (!myParticipant) {
      window.alert("You need to be inside the room before going live.");
      return;
    }

    if (myParticipant.is_muted) {
      window.alert("You are muted by the host.");
      return;
    }

    if (isLocalPublishing) {
      setPublisherIntent(false);
      const stopped = await stopStreamer(myParticipant);

      if (stopped) {
        setStopPublishSignal((current) => current + 1);
        setIsLocalPublishing(false);
      }

      return;
    }

    if (myParticipant.can_stream) {
      setPublisherIntent(true);
      setPublishSignal((current) => current + 1);
      return;
    }

    if (isHost) {
      setPublisherIntent(true);
      const approved = await approveStreamer(myParticipant);

      if (approved) {
        setPendingLocalPublish(true);
      } else {
        setPublisherIntent(false);
      }

      return;
    }

    await requestToStream();
  }

  if (room.status === "ended") {
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.container}>
        <TouchableOpacity onPress={() => router.replace("/home")}>
          <Text style={styles.mobileTopBack}>Back to Home</Text>
        </TouchableOpacity>
        <View style={styles.endedEventCard}>
          <Text style={styles.endedEventEyebrow}>PAST EVENT</Text>
          <Text style={styles.endedEventTitle}>{room.title}</Text>
          <Text style={styles.endedEventCopy}>The live room is closed. Its Memories, recap, attendance, and Event Series history remain available.</Text>
          <TouchableOpacity style={styles.endedEventPrimary} onPress={openMemories}>
            <Text style={styles.endedEventPrimaryText}>View Memories</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.endedEventSecondary} onPress={() => router.push(`/recap/${room.id}` as never)}>
            <Text style={styles.endedEventSecondaryText}>Open Recap</Text>
          </TouchableOpacity>
          {currentUserId === room.host_id && (
            <TouchableOpacity style={styles.endedEventSecondary} onPress={openManageRoom}>
              <Text style={styles.endedEventSecondaryText}>Event Settings</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    );
  }

  const streamActionLabel = isLocalPublishing
    ? "Stop Live"
    : myParticipant?.can_stream || isHost
      ? "Go Live"
      : myParticipant?.stream_status === "requested"
        ? "Needs Approval"
        : "Request Live";

  const shouldConnectLiveKit =
    !liveState?.signal_authoritative || Boolean(liveState.is_live) || publisherIntent;

  async function handlePublishingChange(publishing: boolean) {
    setIsLocalPublishing(publishing);
    if (!publishing) setPublisherIntent(false);
    const { error } = await supabase.rpc("report_room_live_publisher", {
      p_room_id: roomId,
      p_is_live: publishing,
    });
    if (error) console.log("ROOM LIVE PUBLISHER REPORT ERROR:", error.message);
  }

  function revealFeedActions() {
    setFeedActionsVisible(true);

    if (feedActionsTimeoutRef.current) {
      clearTimeout(feedActionsTimeoutRef.current);
    }

    feedActionsTimeoutRef.current = setTimeout(() => {
      setFeedActionsVisible(false);
      feedActionsTimeoutRef.current = null;
    }, 3200);
  }

  const eventMatchAction = (
    <View style={styles.eventMatchCard}>
      <View style={styles.eventMatchIntroRow}>
        <View style={styles.eventMatchIcon}>
          <Ionicons name="sparkles" size={28} color="#FF2D93" />
        </View>
        <View style={styles.eventMatchTextBlock}>
          <Text style={styles.eventMatchTitle}>Match with people here</Text>
          <Text style={styles.eventMatchSubtitle}>Meet someone else in this event.</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.eventMatchButton, eventMatchLoading && styles.disabledButton]}
        onPress={startEventMatch}
        disabled={eventMatchLoading}
      >
        <Text style={styles.eventMatchButtonText}>
          {eventMatchLoading ? "Opening Match..." : "Match with people here"}
        </Text>
        <Ionicons name="chevron-forward" size={24} color="#FFFFFF" />
      </TouchableOpacity>

      {eventMatchError && (
        <Text style={styles.eventMatchError}>{eventMatchError}</Text>
      )}
    </View>
  );

  const roomTabs = (
    <View style={styles.roomTabsRow}>
      {[
        { key: "chat", label: "Chat", icon: "chatbubble-outline" },
        { key: "people", label: "People", icon: "people-outline" },
        { key: "memories", label: "Memories", icon: "images-outline" },
      ].map((tab) => {
        const isActive = activeTab === tab.key;

        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.roomTabPill}
            onPress={() => {
              if (tab.key === "memories") {
                openMemories();
                return;
              }

              setActiveTab(tab.key as "chat" | "people" | "queue");
            }}
          >
            <View style={styles.roomTabContent}>
              <Ionicons
                name={tab.icon as keyof typeof Ionicons.glyphMap}
                size={24}
                color={isActive ? "#A855F7" : "#7F788E"}
              />
              <Text
                style={[
                  styles.roomTabPillText,
                  isActive && styles.roomTabPillTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </View>
            {isActive && <View style={styles.roomTabIndicator} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const mobileRoomOverview = (
    <View style={styles.mobileRoomOverview}>
      {eventMatchAction}
      {roomTabs}
    </View>
  );

  const chatSection = (
    <View style={[styles.chatPane, !isDesktop && styles.chatPaneMobile]}>
      <FlatList
        ref={chatListRef}
        data={[
  ...activities.map((activity) => ({
    ...activity,
    isActivity: true,
  })),
  ...messages.map((message) => ({
    ...message,
    isActivity: false,
  })),
].sort(
  (a, b) =>
    new Date(a.created_at).getTime() -
    new Date(b.created_at).getTime()
)}
        keyExtractor={(item) => item.id}
        style={styles.chatList}
        contentContainerStyle={styles.chatListContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        onContentSizeChange={() => scrollChatToLatest(false)}
        onLayout={() => scrollChatToLatest(false)}
        scrollEnabled
        showsVerticalScrollIndicator
        renderItem={({ item }: { item: any }) => {
  if (item.isActivity) {
    return (
      <View style={styles.activityCard}>
        <Text style={styles.activityText}>
          {item.message}
        </Text>
      </View>
    );
  }

  const displayName =
    item.display_name || (item.user_id ? `Guest ${item.user_id.slice(0, 4)}` : "Deleted user");

  const timestamp = item.created_at
    ? new Date(item.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--:--";
  const messageParticipant = participants.find(
    (person) => person.user_id === item.user_id
  );
  const isMessageHost = room.host_id === item.user_id;
  const isMessageBouncer = messageParticipant?.room_role === "bouncer";

  return (
    <View style={[styles.messageCard, !isDesktop && styles.messageCardMobile]}>
      <View style={styles.messageHeader}>
        <TouchableOpacity
          style={styles.messageUserRow}
          onPress={() => navigateToUser(item.user_id)}
        >
          <View style={styles.messageAvatar}>
            <Text style={styles.messageAvatarText}>
              {getInitials(displayName)}
            </Text>
          </View>

          <Text style={styles.messageUser}>
            {displayName}
          </Text>

          {isMessageHost && (
            <Text style={styles.hostBadge}>Host</Text>
          )}

          {!isMessageHost && isMessageBouncer && (
            <Text style={styles.hostBadge}>Bouncer</Text>
          )}
        </TouchableOpacity>

        <View style={styles.messageHeaderActions}>
          <Text style={styles.messageTime}>{timestamp}</Text>
          {(canManageQueue || (currentUserId && item.user_id && item.user_id !== currentUserId && !reportedMessageIds.has(item.id))) && (
            <TouchableOpacity
              accessibilityLabel={`Actions for ${displayName}'s message`}
              accessibilityRole="button"
              style={styles.messageMenuButton}
              onPress={() => setMessageActionTarget(item as Message)}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color="#AAA4B8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Text style={[styles.messageText, !isDesktop && styles.messageTextMobile]}>
        {item.message}
      </Text>
    </View>
  );

}}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet.</Text>}
      />

      {typingUsers.length > 0 && (
        <View style={styles.typingPill}>
          <Text style={styles.typingPillText}>{typingUsers.length === 1 ? `${typingUsers[0].username || "Someone"} is typing...` : `${typingUsers.length} people are typing...`}</Text>
        </View>
      )}

      <View style={[styles.chatInputContainer, !isDesktop && styles.chatInputContainerMobile]}>
        <View style={styles.chatInputShell}>
          <TextInput
            value={messageText}
            onChangeText={(text) => {
              setMessageText(text);
              if (text.trim()) {
                updateTyping();
              }
            }}
            placeholder="Type a message"
            placeholderTextColor="#999"
            style={styles.chatInput}
          />
          <TouchableOpacity
            accessibilityLabel="Open emoji picker"
            style={styles.emojiButton}
            onPress={() => setEmojiPickerOpen(true)}
          >
            <Ionicons name="happy-outline" size={22} color="#E9D5FF" />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Ionicons name="send" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={emojiPickerOpen}
        onRequestClose={() => setEmojiPickerOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.emojiModalBackdrop}
          onPress={() => setEmojiPickerOpen(false)}
        >
          <View style={styles.emojiPicker}>
            {quickChatEmojis.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.emojiOption}
                onPress={() => insertEmoji(emoji)}
              >
                <Text style={styles.emojiOptionText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(messageActionTarget)}
        onRequestClose={() => setMessageActionTarget(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.messageActionBackdrop}
          onPress={() => setMessageActionTarget(null)}
        >
          <View style={styles.messageActionSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.messageActionHandle} />
            <Text style={styles.messageActionTitle} numberOfLines={1}>
              {messageActionTarget?.display_name || "Message actions"}
            </Text>

            {canManageQueue && messageActionTarget && (
              <TouchableOpacity style={styles.messageActionRow} onPress={() => moderateMessage(messageActionTarget, "remove")}>
                <Ionicons name="trash-outline" size={21} color="#FCA5A5" />
                <Text style={[styles.messageActionText, styles.messageActionDangerText]}>Remove message</Text>
              </TouchableOpacity>
            )}

            {isHost && messageActionTarget?.user_id && messageActionTarget.user_id !== currentUserId && messageActionTarget.user_id !== room.host_id && (
              <TouchableOpacity style={styles.messageActionRow} onPress={() => moderateMessage(messageActionTarget, "mute_5m")}>
                <Ionicons name="volume-mute-outline" size={22} color="#DDD6FE" />
                <Text style={styles.messageActionText}>Mute for 5 minutes</Text>
              </TouchableOpacity>
            )}

            {messageActionTarget?.user_id && messageActionTarget.user_id !== currentUserId && !reportedMessageIds.has(messageActionTarget.id) && (
              <TouchableOpacity style={styles.messageActionRow} onPress={() => beginReport(messageActionTarget)}>
                <Ionicons name="flag-outline" size={21} color="#FDE68A" />
                <Text style={[styles.messageActionText, styles.messageActionReportText]}>Report message</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={[styles.messageActionRow, styles.messageActionCancel]} onPress={() => setMessageActionTarget(null)}>
              <Ionicons name="close" size={22} color="#AAA4B8" />
              <Text style={styles.messageActionCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={Boolean(reportingMessage)}
        onRequestClose={() => {
          if (!reportSubmitting) setReportingMessage(null);
        }}
      >
        <View style={styles.messageActionBackdrop}>
          <View style={styles.messageReportSheet}>
            <View style={styles.messageReportHeader}>
              <View style={styles.messageReportHeaderCopy}>
                <Text style={styles.messageReportEyebrow}>ROOM SAFETY</Text>
                <Text style={styles.messageReportTitle}>Report message</Text>
              </View>
              <TouchableOpacity accessibilityLabel="Close report" style={styles.messageReportClose} disabled={reportSubmitting} onPress={() => setReportingMessage(null)}>
                <Ionicons name="close" size={23} color="#D9D5E8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.messageReportAuthor}>{reportingMessage?.display_name || "PartyUp user"}</Text>
            <Text style={styles.messageReportSnapshot} numberOfLines={3}>{reportingMessage?.message}</Text>

            <ScrollView style={styles.messageReportBody} contentContainerStyle={styles.messageReportBodyContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.messageReportLabel}>Reason</Text>
              <View style={styles.messageReportReasons}>
                {chatReportReasons.map((option) => {
                  const selected = reportReason === option.value;
                  return (
                    <TouchableOpacity key={option.value} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.messageReportReason, selected && styles.messageReportReasonSelected]} onPress={() => setReportReason(option.value)}>
                      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? "#C4B5FD" : "#777085"} />
                      <Text style={[styles.messageReportReasonText, selected && styles.messageReportReasonTextSelected]}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.messageReportLabel}>Additional details (optional)</Text>
              <TextInput
                value={reportDetails}
                onChangeText={setReportDetails}
                maxLength={500}
                multiline
                numberOfLines={4}
                placeholder="Add context for the room host"
                placeholderTextColor="#777085"
                style={styles.messageReportInput}
              />
              <Text style={styles.messageReportCount}>{reportDetails.length}/500</Text>
            </ScrollView>

            <View style={styles.messageReportActions}>
              <TouchableOpacity style={styles.messageReportCancel} disabled={reportSubmitting} onPress={() => setReportingMessage(null)}>
                <Text style={styles.messageReportCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.messageReportSubmit, (!reportReason || reportSubmitting) && styles.messageReportSubmitDisabled]} disabled={!reportReason || reportSubmitting} onPress={submitMessageReport}>
                <Text style={styles.messageReportSubmitText}>{reportSubmitting ? "Submitting..." : "Submit report"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
        {isDesktop && (
          <View style={styles.sidebar}>
            <Text style={styles.sidebarTitle}>Room Navigator</Text>
            <TouchableOpacity style={styles.sidebarLink} onPress={leaveRoom}>
              <Text style={styles.sidebarLinkText}>← Back to lobby</Text>
            </TouchableOpacity>
            <View style={styles.sidebarCard}>
              <Text style={styles.sidebarCardTitle}>Live room dashboard</Text>
              <Text style={styles.sidebarCardText}>Manage attendees, chat, and keep the energy high.</Text>
            </View>
          </View>
        )}

        <View style={styles.mainContent}>
          {isDesktop && (
          <View style={styles.heroCard}>
            {!isDesktop && (
              <View style={styles.mobileTopBar}>
                <TouchableOpacity onPress={leaveRoom}>
                  <Text style={styles.mobileTopBack}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.mobileTopTitle} numberOfLines={1}>{room.title}</Text>
                <View style={styles.mobileTopRight}>
                  <View style={styles.liveBadgeMobile}>
                    <Text style={styles.liveBadgeText}>LIVE</Text>
                  </View>
                  <Text style={styles.viewerCountText}>{room.current_users}</Text>
                </View>
              </View>
            )}
            <View style={[styles.liveStreamCard, !isDesktop && styles.liveStreamCardMobile]}>
              {isLivestream(room) ? (
                <LivestreamPanel
  room={room}
  isDesktop={isDesktop}
  userId={currentUserId}
  canPublish={!!myParticipant?.can_stream}
  isFullscreen={isFullscreenLive}
  onFullscreen={() => setIsFullscreenLive(true)}
  onExitFullscreen={() => setIsFullscreenLive(false)}
  onPublishingChange={(publishing) => void handlePublishingChange(publishing)}
  publishSignal={publishSignal}
  stopSignal={stopPublishSignal}
  shouldConnect={shouldConnectLiveKit}
  idleMedia={idleMedia}
  expectedLive={Boolean(liveState?.is_live)}
/>
              ) : (
                <ImageBackground
                  source={require("../../../../assets/images/rooftop-dj-set.png")}
                  style={[
                    styles.liveStreamImage,
                    isDesktop && styles.liveStreamImageDesktop,
                  ]}
                  imageStyle={styles.heroImageStyle}
                >
                  <View style={styles.liveStreamOverlay} />

                  <View style={styles.liveStreamBadgeRow}>
                    <View style={styles.liveBadgeMobile}>
                      <Text style={styles.liveBadgeText}>LIVE</Text>
                    </View>
                    <View style={styles.viewerPill}>
                      <Text style={styles.viewerPillText}>{room.current_users} viewers</Text>
                    </View>
                  </View>
                </ImageBackground>
              )}
            </View>
          </View>
          )}

          {!isDesktop && isLivestream(room) && (
            <View
              style={[styles.mobileLiveDock, { height: Math.max(360, Math.round(height * 0.5)) }]}
              onTouchStart={revealFeedActions}
            >
              <LivestreamPanel
                room={room}
                isDesktop={isDesktop}
                userId={currentUserId}
                canPublish={!!myParticipant?.can_stream}
                fillParent
                isFullscreen={isFullscreenLive}
                onFullscreen={() => setIsFullscreenLive(true)}
                onExitFullscreen={() => setIsFullscreenLive(false)}
                onPublishingChange={(publishing) => void handlePublishingChange(publishing)}
                publishSignal={publishSignal}
                stopSignal={stopPublishSignal}
                shouldConnect={shouldConnectLiveKit}
                idleMedia={idleMedia}
                expectedLive={Boolean(liveState?.is_live)}
              />
              <View style={styles.feedAlwaysOverlay}>
                <View style={styles.viewerPill}>
                  <Text style={styles.viewerPillText}>{room.current_users} viewers</Text>
                </View>
              </View>

              {feedActionsVisible && (
              <View style={styles.feedChromeOverlay}>
                <TouchableOpacity style={styles.feedCircleButton} onPress={leaveRoom}>
                  <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
                </TouchableOpacity>

                <View style={styles.feedIdentityBlock}>
                  <View style={styles.feedTitleRow}>
                    <Text style={styles.feedRoomTitle} numberOfLines={1}>
                      {room.title}
                    </Text>
                    <View style={styles.feedVerifiedDot}>
                      <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                    </View>
                  </View>
                  <View style={styles.feedOnlineRow}>
                    <View style={styles.onlineDot} />
                    <Text style={styles.feedOnlineText}>{presenceUsers.length} online now</Text>
                  </View>
                </View>

                <TouchableOpacity style={styles.feedCircleButton} onPress={shareRoom}>
                  <Ionicons name="share-outline" size={22} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
              )}

              {feedActionsVisible && (
                <TouchableOpacity
                  style={styles.feedFullscreenButton}
                  onPress={() => {
                    revealFeedActions();
                    setIsFullscreenLive(true);
                  }}
                >
                  <Ionicons name="expand-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.feedLiveButtonText}>Fullscreen</Text>
                </TouchableOpacity>
              )}

              {feedActionsVisible && myParticipant && (
                <TouchableOpacity
                  style={styles.feedLiveButton}
                  onPress={() => {
                    revealFeedActions();
                    void toggleMyLivestream();
                  }}
                  disabled={myParticipant.stream_status === "requested" && !myParticipant.can_stream}
                >
                  <Ionicons
                    name={isLocalPublishing ? "stop-circle-outline" : "radio-outline"}
                    size={18}
                    color="#FFFFFF"
                  />
                  <Text style={styles.feedLiveButtonText}>{streamActionLabel}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <RoomMissionCard roomId={room.id} />

          {!isDesktop && mobileRoomOverview}

          {isDesktop && eventMatchAction}

          {isDesktop && (
          <View style={styles.streamGrid}>
  <Text style={styles.streamGridTitle}>Approved Cameras</Text>

  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.streamGridRow}
  >

{activeStreamers
  .filter((person: any) => person.user_id !== room.host_id)
  .map((person: any) => {
    const displayName = getDisplayName(person);

    return (
      <View key={person.id} style={styles.streamTile}>
        <ImageBackground
          source={
            room.cover_image
              ? { uri: room.cover_image }
              : require("../../../../assets/images/rooftop-dj-set.png")
          }
          style={styles.streamTileImage}
          imageStyle={styles.streamTileImageStyle}
        >
          <View style={styles.streamTileOverlay} />

          <View style={styles.liveBadgeMobile}>
            <Text style={styles.liveBadgeText}>APPROVED</Text>
          </View>

          <TouchableOpacity onPress={() => navigateToUser(person.user_id)}>
            <Text style={styles.streamTileName}>{displayName}</Text>
          </TouchableOpacity>
            {(canManageQueue || person.user_id === currentUserId) && (
  <TouchableOpacity
    style={styles.removeStreamerButton}
    onPress={async () => {
      const stopped = await stopStreamer(person);

      if (stopped && person.user_id === currentUserId) {
        setStopPublishSignal((current) => current + 1);
        setIsLocalPublishing(false);
      }
    }}
  >
    <Text style={styles.removeStreamerText}>
      {person.user_id === currentUserId ? "Stop Live" : "Remove"}
    </Text>
  </TouchableOpacity>
)}
          </ImageBackground>
        </View>
      );
    })}

<View style={styles.streamActionRow}>

  {isHost && (
    <TouchableOpacity
      style={styles.streamActionTile}
      onPress={async () => {
        if (!hostParticipant) {
          window.alert("Host is not inside the room yet.");
          return;
        }

        if (hostIsLive) {
          const stopped = await stopStreamer(hostParticipant);

          if (stopped && hostParticipant.user_id === currentUserId) {
            setStopPublishSignal((current) => current + 1);
            setIsLocalPublishing(false);
          }

          return;
        }

        if (hostParticipant.can_stream) {
          setPublisherIntent(true);
          setPublishSignal((current) => current + 1);
          return;
        }

        const approved = await approveStreamer(hostParticipant);

        if (approved && hostParticipant.user_id === currentUserId) {
          setPublisherIntent(true);
          setPublishSignal((current) => current + 1);
        }
      }}
    >
      <Text style={styles.streamActionEmoji}>
        {hostIsLive ? "×" : "+"}
      </Text>

      <Text style={styles.streamActionText}>
        {hostIsLive ? "Stop" : "Go Live"}
      </Text>
    </TouchableOpacity>
  )}
</View>

  </ScrollView>

  {!isDesktop && (
              <View style={styles.roomMetaMobile}>
                <View style={styles.heroTitleRowMobile}>
                  <Text style={[styles.heroTitle, styles.heroTitleMobile]} numberOfLines={2}>{room.title}</Text>
                  <View style={styles.verifiedBadge}>
                    <Text style={styles.verifiedLabel}>Verified</Text>
                  </View>
                </View>
                <View style={[styles.heroTagRow, styles.heroTagRowMobile]}>
                  {room.type && <View style={styles.heroTag}><Text style={styles.heroTagText}>{room.type.replace("_", " ")}</Text></View>}
                  {room.mode && <View style={styles.heroTag}><Text style={styles.heroTagText}>{room.mode.toUpperCase()}</Text></View>}
                  {room.status && <View style={styles.heroTagLive}><Text style={styles.heroTagText}>{room.status}</Text></View>}
                </View>
                {eventMatchAction}

                <View style={styles.roomTabsRow}>
  <TouchableOpacity
    style={[
      styles.roomTabPill,
      activeTab === "chat" && styles.roomTabPillActive,
    ]}
    onPress={() => setActiveTab("chat")}
  >
    <Text
      style={[
        styles.roomTabPillText,
        activeTab === "chat" &&
          styles.roomTabPillTextActive,
      ]}
    >
      Chat
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      styles.roomTabPill,
      activeTab === "people" && styles.roomTabPillActive,
    ]}
    onPress={() => setActiveTab("people")}
  >
    <Text
      style={[
        styles.roomTabPillText,
        activeTab === "people" &&
          styles.roomTabPillTextActive,
      ]}
    >
      People
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={styles.roomTabPill}
    onPress={openMemories}
  >
    <Text style={styles.roomTabPillText}>
      Memories
    </Text>
  </TouchableOpacity>
</View>

</View>
            )}

</View>
          )}

{activeTab === "chat" && chatSection}

<View style={styles.bodyGrid}>
  <View style={styles.leftPane}>
              {activeTab === "people" && (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <View>

                    {activeTab === "people" && (
                      <>
                        <Text style={styles.sectionTitle}>Inside the Room</Text>
                        <Text style={styles.sectionMeta}>{participants.length} present</Text>
                      </>
                    )}
                  </View>
                  <Text style={styles.sectionPill}>{participants.length} / {room.max_users}</Text>
                </View>
                {participants.length === 0 ? (
                  <Text style={styles.empty}>No one inside yet.</Text>
                ) : (
                  prioritizedParticipants.map((person) => {
                    const participantName = getDisplayName(person);
                    const isOnline = isUserOnline(person.user_id, presenceUsers);
                    return (
                      <View key={person.id} style={styles.attendeeCard}>
                        <View style={styles.attendeeInfo}>
                          <View style={styles.attendeeAvatarContainer}>
                            <View style={styles.attendeeAvatar}>
                              <Text style={styles.attendeeInitial}>{getInitials(participantName)}</Text>
                            </View>
                            {isOnline && <View style={styles.onlineIndicator} />}
                          </View>
                          <View style={styles.attendeeText}>
                            <TouchableOpacity onPress={() => navigateToUser(person.user_id)}>
                              <Text style={styles.attendeeName} numberOfLines={1}>{participantName}</Text>
                            </TouchableOpacity>
                            <View style={styles.roleRow}>
  <Text style={styles.attendeeRole}>
    {isOnline ? "Online now" : "In room"}
  </Text>

  {person.room_role === "bouncer" && (
    <View style={styles.bouncerBadge}>
      <Text style={styles.bouncerBadgeText}>BOUNCER</Text>
    </View>
  )}

  {person.room_role === "admin" && (
    <View style={styles.adminBadge}>
      <Text style={styles.adminBadgeText}>ADMIN</Text>
    </View>
  )}

  {room.host_id === person.user_id && (
    <View style={styles.hostRoleBadge}>
      <Text style={styles.hostRoleBadgeText}>HOST</Text>
    </View>
  )}
</View>
                          </View>
                        </View>
            {canManageQueue &&
  person.user_id !== room.host_id &&
  person.user_id !== currentUserId && (
  <View style={{ gap: 8 }}>
   {person.user_id !== currentUserId && (
  <>
    <TouchableOpacity
      style={styles.muteButton}
      onPress={() => toggleMuteUser(person)}
    >
      <Text style={styles.kickText}>
        {person.is_muted ? "Unmute" : "Mute Mic"}
      </Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={styles.kickButton}
      onPress={() => kickUser(person)}
    >
      <Text style={styles.kickText}>Kick</Text>
    </TouchableOpacity>
  </>
)}

    {isHost && person.user_id !== currentUserId && (
      <TouchableOpacity
        style={styles.makeBouncerButton}
        onPress={() => makeBouncer(person)}
      >
        <Text style={styles.makeBouncerText}>
          {person.room_role === "bouncer"
            ? "Remove Bouncer"
            : "Make Bouncer"}
        </Text>
      </TouchableOpacity>
    )}
  </View>
)}
                      </View>
                    );
                  })
                )}
              </View>
              )}

              {activeTab === "queue" && (
  <View style={styles.sectionCard}>
    <View style={styles.sectionHeader}>
      <View>
        <Text style={styles.sectionTitle}>Waiting in Queue</Text>
        <Text style={styles.sectionMeta}>{queue.length} waiting</Text>
      </View>

      <Text style={styles.sectionPill}>{queue.length}</Text>
    </View>

    {queue.length === 0 ? (
      <Text style={styles.empty}>No one is waiting yet.</Text>
    ) : (
      <FlatList
        data={queue}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const displayName = getDisplayName(item);
          const avatarUrl = getAvatarUrl(item);

          return (
            <View style={styles.queueCard}>
              <View style={styles.profileRow}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarInitial}>
                      {getInitials(displayName)}
                    </Text>
                  </View>
                )}

                <View style={styles.profileText}>
                  <Text style={styles.queueName} numberOfLines={1}>
                    {displayName}
                  </Text>

                  <Text style={styles.bioText} numberOfLines={2}>
                    {getBio(item)}
                  </Text>
                </View>
              </View>

              {canManageQueue && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => acceptUser(item)}
                  >
                    <Text style={styles.actionText}>Accept</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.rejectButton}
                    onPress={() => rejectUser(item)}
                  >
                    <Text style={styles.actionText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
      />
    )}
  </View>
)}
  {activeTab !== "chat" && (
  <View style={styles.mobileStatPillRow}>
  <View style={styles.mobileStatPill}>
    <Text style={styles.mobileStatLabel}>Inside now</Text>
    <Text style={styles.mobileStatValue}>
      {participants.length}
    </Text>
  </View>

  <View style={styles.mobileStatPill}>
    <Text style={styles.mobileStatLabel}>Waiting</Text>
    <Text style={styles.mobileStatValue}>
      {room.queue_count}
    </Text>
  </View>

  <View style={styles.mobileStatPill}>
    <Text style={styles.mobileStatLabel}>Capacity</Text>
    <Text style={styles.mobileStatValue}>
      {`${room.current_users}/${room.max_users}`}
    </Text>
  </View>
</View>
)}
              {isDesktop && (
              <View style={styles.reactionRow}>
                <View style={styles.reactionBubble}><Text style={styles.reactionEmoji}>❤️</Text></View>
                <View style={styles.reactionBubble}><Text style={styles.reactionEmoji}>🔥</Text></View>
                <View style={styles.reactionBubble}><Text style={styles.reactionEmoji}>🎉</Text></View>
                <Text style={styles.reactionHint}>Quick reactions available in chat.</Text>
              </View>
              )}

{canManageQueue && isDesktop && (
  <TouchableOpacity
    style={styles.manageRoomButton}
    onPress={openManageRoom}
  >
    <Text style={styles.manageRoomButtonText}>
      Manage Room
    </Text>
  </TouchableOpacity>
)}

{canManageQueue && !isDesktop && (
  <TouchableOpacity
    style={styles.bottomRoomSettingsButton}
    onPress={openManageRoom}
  >
    <Ionicons name="settings-outline" size={20} color="#D9D5E8" />
    <Text style={styles.roomSettingsText}>Room Settings</Text>
  </TouchableOpacity>
)}
                   </View>
        </View>
      </View>
    </View>
<Modal transparent visible={showInviteModal} animationType="fade">
  <View style={styles.inviteModalBackdrop}>
    <View style={styles.inviteModal}>
      <View style={styles.inviteModalHeader}>
        <Text style={styles.inviteModalTitle}>Invite Friends</Text>

        <TouchableOpacity onPress={() => setShowInviteModal(false)}>
          <Text style={styles.inviteClose}>Close</Text>
        </TouchableOpacity>
      </View>

      {friends.length === 0 ? (
        <Text style={styles.empty}>No friends yet.</Text>
      ) : (
        friends.map((friend) => (
          <View key={friend.id} style={styles.inviteFriendRow}>
            <Text style={styles.inviteFriendName}>
              {friend.username || `Guest ${friend.id.slice(0, 4)}`}
            </Text>

            <TouchableOpacity
              style={styles.inviteSendButton}
              onPress={() => sendRoomInvite(friend.id)}
            >
              <Text style={styles.inviteSendText}>Invite</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  </View>
</Modal>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  endedEventCard: {
    alignItems: "center",
    backgroundColor: "#120B1A",
    borderColor: "rgba(196, 154, 255, 0.24)",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 34,
    padding: 26,
  },
  endedEventEyebrow: { color: "#FF83B8", fontSize: 11, fontWeight: "900" },
  endedEventTitle: { color: "#FFFFFF", fontSize: 30, fontWeight: "900", marginTop: 8, textAlign: "center" },
  endedEventCopy: { color: "#AAA4B8", fontSize: 15, lineHeight: 23, marginTop: 12, textAlign: "center" },
  endedEventPrimary: { alignItems: "center", alignSelf: "stretch", backgroundColor: "#7C3AED", borderRadius: 8, marginTop: 24, paddingVertical: 14 },
  endedEventPrimaryText: { color: "#FFFFFF", fontWeight: "900" },
  endedEventSecondary: { alignItems: "center", alignSelf: "stretch", borderColor: "rgba(255,255,255,0.16)", borderRadius: 8, borderWidth: 1, marginTop: 10, paddingVertical: 14 },
  endedEventSecondaryText: { color: "#FFFFFF", fontWeight: "900" },
  page: {
    flex: 1,
    backgroundColor: "#050509",
  },
  container: {
    minHeight: "100%",
    backgroundColor: "#050509",
    padding: 16,
    paddingTop: 18,
  },
  loading: {
    color: "white",
    fontSize: 16,
    textAlign: "center",
    marginTop: 80,
  },
  layout: {
    width: "100%",
  },
  layoutDesktop: {
    flexDirection: "row",
    gap: 20,
  },
  sidebar: {
    width: 280,
    backgroundColor: "rgba(18, 16, 35, 0.92)",
    borderColor: "rgba(124, 58, 237, 0.22)",
    borderWidth: 1,
    borderRadius: 30,
    padding: 20,
    marginBottom: 24,
  },
  sidebarTitle: {
    color: "#E9D5FF",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 18,
  },
  sidebarLink: {
    marginBottom: 16,
  },
  sidebarLinkText: {
    color: "#A78BFA",
    fontWeight: "700",
  },
  sidebarCard: {
    backgroundColor: "rgba(17, 17, 26, 0.95)",
    borderRadius: 24,
    padding: 16,
    marginBottom: 16,
  },
  sidebarCardTitle: {
    color: "white",
    fontWeight: "900",
    marginBottom: 8,
  },
  sidebarCardText: {
    color: "#BFB6E5",
    fontSize: 13,
    lineHeight: 20,
  },
  sidebarButton: {
  backgroundColor: "#7C3AED",
  borderRadius: 999,
  paddingVertical: 18,
  alignItems: "center",
  marginTop: 16,
},
  sidebarButtonText: {
    color: "white",
    fontWeight: "800",
  },
  mainContent: {
    flex: 1,
  },
  heroCard: {
    borderRadius: 32,
    overflow: "hidden",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.22)",
    backgroundColor: "#08080D",
  },
  heroImage: {
    minHeight: 260,
    justifyContent: "space-between",
  },
  heroImageMobile: {
    minHeight: 220,
  },
  heroImageStyle: {
    resizeMode: "cover",
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(4, 4, 10, 0.56)",
  },
  heroHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 24,
  },
  heroBack: {
    color: "#C8B5FF",
    fontWeight: "700",
  },
  heroStatusPill: {
    backgroundColor: "rgba(124, 58, 237, 0.92)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  heroStatusText: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
  },
  heroDetails: {
    padding: 24,
  },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heroTitle: {
    color: "white",
    fontSize: 36,
    fontWeight: "900",
    lineHeight: 42,
    flex: 1,
  },
  verifiedBadge: {
    borderColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  verifiedLabel: {
    color: "#E9D5FF",
    fontWeight: "800",
    fontSize: 12,
  },
  heroTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },
  heroTag: {
    backgroundColor: "rgba(124,58,237,0.18)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  heroTagLive: {
    backgroundColor: "rgba(255, 82, 146, 0.16)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  heroTagText: {
    color: "#E9D5FF",
    fontWeight: "700",
    fontSize: 12,
  },
  heroSubtitle: {
    color: "#C2B7ED",
    marginTop: 16,
    fontSize: 14,
    lineHeight: 20,
    maxWidth: "82%",
  },
  mobileTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "rgba(10, 9, 21, 0.95)",
    borderRadius: 28,
    marginBottom: 16,
  },
  mobileTopBack: {
    color: "#C8B5FF",
    fontWeight: "700",
  },
  mobileTopTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    flex: 1,
    marginHorizontal: 12,
  },
  mobileTopRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveBadgeMobile: {
    backgroundColor: "rgba(255, 82, 146, 0.96)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  liveBadgeText: {
    color: "white",
    fontWeight: "800",
    fontSize: 11,
  },
  viewerCountText: {
    color: "#D8B4FE",
    fontSize: 12,
    fontWeight: "700",
  },
  liveStreamCard: {
    backgroundColor: "#09090F",
    borderRadius: 28,
    overflow: "hidden",
    marginBottom: 16,
    minHeight: 220,
  },
  liveStreamCardMobile: {
    borderRadius: 22,
    minHeight: 160,
    marginBottom: 0,
  },
  liveStreamCardFill: {
    flex: 1,
    height: "100%",
    minHeight: 0,
    width: "100%",
  },
  liveStreamImage: {
  width: "100%",
  height: 180,
  justifyContent: "space-between",
},
  liveStreamImageFill: {
    flex: 1,
    height: "100%",
  },

  liveStreamOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0, 0, 0, 0.36)",
  zIndex: 1,
},
  liveStreamBadgeRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  padding: 16,
  zIndex: 30,
  elevation: 30,
},
  viewerPill: {
    backgroundColor: "rgba(124,58,237,0.2)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  viewerPillText: {
    color: "#E9D5FF",
    fontSize: 12,
    fontWeight: "700",
  },
  livestreamPlaceholder: {
  ...StyleSheet.absoluteFillObject,
  zIndex: 20,
  elevation: 20,
  alignItems: "stretch",
  justifyContent: "center",
},

  livestreamPlaceholderText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  roomMetaMobile: {
    paddingHorizontal: 4,
    marginBottom: 20,
  },
  mobileRoomOverview: {
    gap: 12,
    marginBottom: 14,
  },
  onlineDot: {
    backgroundColor: "#22C55E",
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  bottomRoomSettingsButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(28, 26, 42, 0.94)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  roomSettingsText: {
    color: "#E5E1ED",
    fontSize: 15,
    fontWeight: "900",
  },
  mobileLiveDock: {
    borderColor: "rgba(124,58,237,0.22)",
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
    position: "relative",
  },
  feedAlwaysOverlay: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    left: 14,
    position: "absolute",
    right: 14,
    top: 14,
    zIndex: 70,
    elevation: 70,
  },
  feedChromeOverlay: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    left: 12,
    position: "absolute",
    right: 12,
    top: 12,
    zIndex: 80,
    elevation: 80,
  },
  feedCircleButton: {
    alignItems: "center",
    backgroundColor: "rgba(12, 10, 22, 0.72)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  feedIdentityBlock: {
    flex: 1,
    minWidth: 0,
  },
  feedTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  feedRoomTitle: {
    color: "white",
    flexShrink: 1,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29,
  },
  feedVerifiedDot: {
    alignItems: "center",
    backgroundColor: "#8B3DFF",
    borderRadius: 12,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  feedOnlineRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  feedOnlineText: {
    color: "#C4B5FD",
    fontSize: 15,
    fontWeight: "800",
  },
  feedLiveButton: {
    alignItems: "center",
    backgroundColor: "rgba(124,58,237,0.88)",
    borderRadius: 999,
    bottom: 14,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    position: "absolute",
    right: 14,
    zIndex: 80,
    elevation: 80,
  },
  feedFullscreenButton: {
    alignItems: "center",
    backgroundColor: "rgba(124,58,237,0.88)",
    borderRadius: 999,
    bottom: 14,
    flexDirection: "row",
    gap: 8,
    left: 14,
    minHeight: 44,
    paddingHorizontal: 16,
    position: "absolute",
    zIndex: 80,
    elevation: 80,
  },
  feedLiveButtonText: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
  },
  mobileStatPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },
  mobileStatPill: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 110,
  },
  mobileStatLabel: {
    color: "#A78BFA",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  mobileStatValue: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 4,
  },
  heroMetaMobile: {
    padding: 20,
  },
  heroTitleRowMobile: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  heroTitleMobile: {
    fontSize: 28,
    lineHeight: 34,
  },
  heroTagRowMobile: {
    marginTop: 14,
  },
  chatPaneMobile: {
    padding: 0,
    minHeight: 260,
  },
  messageCardMobile: {
    padding: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
  },
  messageTextMobile: {
    fontSize: 14,
    lineHeight: 19,
  },
  chatInputContainerMobile: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    padding: 24,
    backgroundColor: "rgba(7, 7, 16, 0.92)",
  },
  statsRowMobile: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 10,
  },
  statCard: {
    minWidth: 120,
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 24,
    padding: 18,
  },
  statPillCard: {
    flex: 0,
    minWidth: undefined,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.14)",
  },
  statLabel: {
    color: "#8B86A1",
    fontSize: 12,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statValue: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
  },
  bodyGrid: {
    flexDirection: "column",
    gap: 20,
  },
  leftPane: {
    flex: 1,
  },
  sectionCard: {
    backgroundColor: "rgba(14, 12, 26, 0.82)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.15)",
    padding: 18,
    marginBottom: 18,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "900",
  },
  sectionMeta: {
    color: "#A78BFA",
    fontSize: 13,
  },
  sectionPill: {
    color: "white",
    backgroundColor: "rgba(124,58,237,0.14)",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    fontWeight: "700",
    fontSize: 12,
  },
  eventMatchCard: {
    backgroundColor: "rgba(10, 9, 21, 0.94)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(236,72,153,0.55)",
    padding: 16,
    gap: 14,
    shadowColor: "#EC4899",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
  },
  eventMatchIntroRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  eventMatchIcon: {
    alignItems: "center",
    backgroundColor: "rgba(12, 8, 24, 0.92)",
    borderColor: "rgba(168,85,247,0.38)",
    borderRadius: 30,
    borderWidth: 1,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  eventMatchTextBlock: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  eventMatchTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 24,
  },
  eventMatchSubtitle: {
    color: "#C2B7ED",
    fontSize: 14,
    lineHeight: 19,
  },
  eventMatchButton: {
    alignItems: "center",
    backgroundColor: "#EC4899",
    borderRadius: 999,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 18,
  },
  eventMatchButtonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  eventMatchError: {
    color: "#FCA5A5",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  disabledButton: {
    opacity: 0.55,
  },
  attendeeCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#08101F",
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.12)",
  },
  attendeeInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flex: 1,
  },
  attendeeAvatarContainer: {
    position: "relative",
  },
  attendeeAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#2D2547",
    alignItems: "center",
    justifyContent: "center",
  },
  onlineIndicator: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#10B981",
    borderWidth: 2,
    borderColor: "#050509",
    bottom: 0,
    right: 0,
  },
  attendeeInitial: {
    color: "white",
    fontWeight: "900",
    fontSize: 18,
  },
  attendeeText: {
    flex: 1,
    minWidth: 0,
  },
  attendeeName: {
    color: "white",
    fontWeight: "800",
    fontSize: 16,
  },
  attendeeRole: {
    color: "#A78BFA",
    fontSize: 12,
    marginTop: 2,
  },
  kickButton: {
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  kickText: {
    color: "#F4B6FF",
    fontWeight: "800",
  },
  queueCard: {
    backgroundColor: "#11111A",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.16)",
    padding: 18,
    marginBottom: 14,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#08080D",
    borderColor: "#3A3157",
    borderWidth: 1,
  },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#2D2547",
    borderColor: "#4C3A77",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: "white",
    fontWeight: "900",
    fontSize: 21,
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  queueName: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 6,
  },
  bioText: {
    color: "#B8B2C8",
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: "#7C3AED",
    minHeight: 46,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  rejectButton: {
    flex: 1,
    backgroundColor: "#2A2A35",
    minHeight: 46,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    color: "white",
    fontWeight: "800",
    textAlign: "center",
  },
  empty: {
    color: "#777",
    marginTop: 10,
  },
  sendButton: {
    backgroundColor: "#5B21B6",
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    width: 56,
  },
  reactionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
    marginBottom: 20,
  },
  reactionBubble: {
    backgroundColor: "rgba(124,58,237,0.18)",
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  reactionEmoji: {
    fontSize: 22,
  },
  reactionHint: {
    color: "#A78BFA",
    fontSize: 13,
    flex: 1,
    minWidth: 140,
  },
  hostStatusCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 24,
    padding: 18,
  },
  hostStatusTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 8,
  },
  hostStatusText: {
    color: "#B8B2C8",
    fontSize: 14,
    lineHeight: 20,
  },
  chatPane: {
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    padding: 0,
    minHeight: 360,
  },
  chatList: {
    height: 150,
    marginBottom: 8,
  },
  chatListContent: {
    paddingBottom: 6,
  },
  messageCard: {
    backgroundColor: "transparent",
    borderRadius: 0,
    padding: 0,
    marginBottom: 8,
    borderWidth: 0,
  },
  messageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
    gap: 8,
  },
  messageUserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flex: 1,
    minWidth: 0,
  },
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#7C3AED",
    alignItems: "center",
    justifyContent: "center",
  },
  messageAvatarText: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
  },
  messageUser: {
    color: "#C4B5FD",
    fontWeight: "800",
    fontSize: 14,
    flexShrink: 1,
  },
  hostBadge: {
    color: "#D8B4FE",
    fontSize: 11,
    fontWeight: "800",
    backgroundColor: "rgba(124,58,237,0.16)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  messageTime: {
    color: "#8888AA",
    fontSize: 11,
    flexShrink: 0,
  },
  messageHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    flexShrink: 0,
  },
  messageMenuButton: {
    alignItems: "center",
    borderRadius: 6,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  messageText: {
    color: "#D9D5E8",
    fontSize: 14,
    lineHeight: 19,
    marginLeft: 39,
  },
  messageActionBackdrop: {
    backgroundColor: "rgba(0,0,0,0.66)",
    flex: 1,
    justifyContent: "flex-end",
  },
  messageActionSheet: {
    backgroundColor: "#120C1C",
    borderColor: "rgba(255,255,255,0.14)",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    paddingBottom: 18,
    paddingHorizontal: 14,
    paddingTop: 9,
  },
  messageActionHandle: {
    alignSelf: "center",
    backgroundColor: "#5D5668",
    borderRadius: 2,
    height: 4,
    marginBottom: 12,
    width: 42,
  },
  messageActionTitle: {
    color: "#AAA4B8",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 5,
    paddingHorizontal: 12,
  },
  messageActionRow: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  messageActionText: {
    color: "#E9E4F2",
    fontSize: 15,
    fontWeight: "800",
  },
  messageActionDangerText: {
    color: "#FCA5A5",
  },
  messageActionReportText: {
    color: "#FDE68A",
  },
  messageActionCancel: {
    borderTopColor: "rgba(255,255,255,0.08)",
    borderTopWidth: 1,
    marginTop: 5,
  },
  messageActionCancelText: {
    color: "#AAA4B8",
    fontSize: 15,
    fontWeight: "800",
  },
  messageReportSheet: {
    backgroundColor: "#120C1C",
    borderColor: "rgba(255,255,255,0.14)",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    maxHeight: "90%",
    paddingBottom: 16,
  },
  messageReportHeader: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.08)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
  },
  messageReportHeaderCopy: {
    flex: 1,
  },
  messageReportEyebrow: {
    color: "#FDE68A",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  messageReportTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 3,
  },
  messageReportClose: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 7,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  messageReportAuthor: {
    color: "#C4B5FD",
    fontSize: 12,
    fontWeight: "900",
    marginHorizontal: 16,
    marginTop: 14,
  },
  messageReportSnapshot: {
    borderLeftColor: "rgba(167,139,250,0.6)",
    borderLeftWidth: 2,
    color: "#D9D5E8",
    fontSize: 14,
    lineHeight: 20,
    marginHorizontal: 16,
    marginTop: 7,
    paddingLeft: 10,
  },
  messageReportBody: {
    marginTop: 14,
  },
  messageReportBodyContent: {
    paddingHorizontal: 16,
  },
  messageReportLabel: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
    marginTop: 10,
  },
  messageReportReasons: {
    gap: 4,
  },
  messageReportReason: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 42,
    paddingHorizontal: 10,
  },
  messageReportReasonSelected: {
    backgroundColor: "rgba(124,58,237,0.16)",
    borderColor: "rgba(196,181,253,0.35)",
  },
  messageReportReasonText: {
    color: "#B8B2C8",
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  messageReportReasonTextSelected: {
    color: "#F3E8FF",
  },
  messageReportInput: {
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 8,
    borderWidth: 1,
    color: "#FFFFFF",
    fontSize: 14,
    minHeight: 92,
    padding: 12,
    textAlignVertical: "top",
  },
  messageReportCount: {
    color: "#777085",
    fontSize: 11,
    marginTop: 5,
    textAlign: "right",
  },
  messageReportActions: {
    borderTopColor: "rgba(255,255,255,0.08)",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  messageReportCancel: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  messageReportCancelText: {
    color: "#D9D5E8",
    fontSize: 14,
    fontWeight: "900",
  },
  messageReportSubmit: {
    alignItems: "center",
    backgroundColor: "#DC2626",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  messageReportSubmitDisabled: {
    opacity: 0.45,
  },
  messageReportSubmitText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  typingPill: {
    backgroundColor: "rgba(124,58,237,0.18)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    alignSelf: "flex-start",
    marginBottom: 14,
  },
  typingPillText: {
    color: "#E9D5FF",
    fontWeight: "700",
    fontSize: 12,
  },
  chatInputContainer: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: "rgba(14, 12, 26, 0.92)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 36,
    borderWidth: 1,
    padding: 7,
  },
  chatInputShell: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 26,
    paddingLeft: 14,
    paddingRight: 6,
  },
  chatInput: {
    flex: 1,
    color: "white",
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingVertical: 10,
    fontSize: 15,
  },
  emojiButton: {
    alignItems: "center",
    borderRadius: 20,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  emojiModalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 18,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  emojiPicker: {
    alignSelf: "center",
    backgroundColor: "rgba(14, 12, 26, 0.98)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    maxWidth: 320,
    padding: 10,
  },
  emojiOption: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 18,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  emojiOptionText: {
    fontSize: 24,
  },
fullscreenLivePage: {
  flex: 1,
  backgroundColor: "#000",
},

fullscreenLiveImage: {
  flex: 1,
  justifyContent: "space-between",
},

fullscreenLiveImageStyle: {
  resizeMode: "cover",
},

fullscreenLiveOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0,0,0,0.35)",
},

fullscreenLiveTop: {
  padding: 20,
  paddingTop: 48,
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  zIndex: 50,
  elevation: 50,
},

fullscreenCloseButton: {
  backgroundColor: "rgba(0,0,0,0.75)",
  paddingHorizontal: 16,
  paddingVertical: 10,
  borderRadius: 999,
  zIndex: 60,
  elevation: 60,
},

fullscreenCloseText: {
  color: "white",
  fontWeight: "900",
},

fullscreenLiveBottom: {
  padding: 20,
  gap: 10,
},

fullscreenRoomTitle: {
  color: "white",
  fontSize: 30,
  fontWeight: "900",
},

fullscreenViewerText: {
  color: "#E9D5FF",
  fontWeight: "700",
  marginBottom: 8,
},
fullscreenMessagesOverlay: {
  gap: 8,
  marginBottom: 14,
  maxWidth: "86%",
},

fullscreenMessageBubble: {
  backgroundColor: "rgba(0,0,0,0.48)",
  borderRadius: 18,
  paddingHorizontal: 12,
  paddingVertical: 8,
  alignSelf: "flex-start",
},

fullscreenMessageName: {
  color: "#C4B5FD",
  fontSize: 12,
  fontWeight: "900",
  marginBottom: 2,
},

fullscreenMessageText: {
  color: "white",
  fontSize: 14,
  fontWeight: "700",
},
streamGrid: {
  marginBottom: 24,
},

streamGridTitle: {
  color: "white",
  fontSize: 20,
  fontWeight: "900",
  marginBottom: 14,
},

streamGridRow: {
  gap: 14,
},

streamTile: {
  width: 190,
  height: 300,
  borderRadius: 24,
  overflow: "hidden",
  backgroundColor: "#111",
},

streamTileImage: {
  flex: 1,
  justifyContent: "space-between",
  padding: 14,
},

streamTileImageStyle: {
  resizeMode: "cover",
},

streamTileOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0,0,0,0.28)",
},

streamTileName: {
  color: "white",
  fontSize: 18,
  fontWeight: "900",
},

requestStreamTile: {
  width: 190,
  height: 300,
  borderRadius: 24,
  backgroundColor: "#181425",
  borderWidth: 1,
  borderColor: "rgba(124,58,237,0.3)",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
},

requestStreamPlus: {
  color: "#A855F7",
  fontSize: 48,
  fontWeight: "900",
},

requestStreamText: {
  color: "white",
  textAlign: "center",
  marginTop: 12,
  fontWeight: "700",
},

removeStreamerButton: {
  backgroundColor: "rgba(0,0,0,0.55)",
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  alignSelf: "flex-start",
},

removeStreamerText: {
  color: "white",
  fontWeight: "700",
},

streamRequestsCard: {
  marginTop: 18,
  backgroundColor: "#11101B",
  borderRadius: 24,
  padding: 18,
},

streamRequestsTitle: {
  color: "white",
  fontSize: 18,
  fontWeight: "900",
  marginBottom: 12,
},

streamRequestRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
},

streamRequestName: {
  color: "white",
  fontWeight: "700",
},
inviteButton: {
  backgroundColor: "rgba(124,58,237,0.18)",
  borderColor: "rgba(124,58,237,0.3)",
  borderWidth: 1,
  borderRadius: 999,
  paddingHorizontal: 16,
  paddingVertical: 10,
  alignSelf: "flex-start",
  marginTop: 14,
},

inviteButtonText: {
  color: "#E9D5FF",
  fontWeight: "900",
},

inviteModalBackdrop: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.72)",
  justifyContent: "flex-end",
  padding: 18,
},

inviteModal: {
  backgroundColor: "#11101B",
  borderColor: "#332855",
  borderWidth: 1,
  borderRadius: 24,
  padding: 18,
  maxHeight: "80%",
},

inviteModalHeader: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
},

inviteModalTitle: {
  color: "white",
  fontSize: 22,
  fontWeight: "900",
},

inviteClose: {
  color: "#A78BFA",
  fontWeight: "900",
},

inviteFriendRow: {
  backgroundColor: "#08080D",
  borderRadius: 18,
  padding: 14,
  marginBottom: 10,
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
},

inviteFriendName: {
  color: "white",
  fontWeight: "800",
},

inviteSendButton: {
  backgroundColor: "#7C3AED",
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 9,
},

inviteSendText: {
  color: "white",
  fontWeight: "900",
},
makeBouncerButton: {
  backgroundColor: "#312244",
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 10,
  alignItems: "center",
},

makeBouncerText: {
  color: "#E9D5FF",
  fontWeight: "800",
},
roleRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 6,
  marginTop: 4,
},

bouncerBadge: {
  backgroundColor: "rgba(168,85,247,0.18)",
  borderRadius: 999,
  paddingHorizontal: 8,
  paddingVertical: 4,
},

bouncerBadgeText: {
  color: "#D8B4FE",
  fontSize: 10,
  fontWeight: "900",
},

adminBadge: {
  backgroundColor: "rgba(255,82,146,0.18)",
  borderRadius: 999,
  paddingHorizontal: 8,
  paddingVertical: 4,
},

adminBadgeText: {
  color: "#FDB4D4",
  fontSize: 10,
  fontWeight: "900",
},

hostRoleBadge: {
  backgroundColor: "rgba(59,130,246,0.18)",
  borderRadius: 999,
  paddingHorizontal: 8,
  paddingVertical: 4,
},

hostRoleBadgeText: {
  color: "#BFDBFE",
  fontSize: 10,
  fontWeight: "900",
},
liveStreamImageDesktop: {
  height: 560,
},
muteButton: {
  backgroundColor: "#1E40AF",
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 8,
  alignItems: "center",
},
manageRoomButton: {
  backgroundColor: "#181425",
  borderRadius: 999,
  paddingVertical: 14,
  alignItems: "center",
  marginBottom: 18,
  borderWidth: 1,
  borderColor: "rgba(124,58,237,0.22)",
},

manageRoomButtonText: {
  color: "#E9D5FF",
  fontWeight: "900",
  fontSize: 14,
},

manageRoomPanel: {
  marginBottom: 20,
},

roomTabsRow: {
  flexDirection: "row",
  gap: 0,
  marginTop: 8,
  marginBottom: 12,
},

roomTabPill: {
  flex: 1,
  backgroundColor: "transparent",
  borderRadius: 0,
  paddingVertical: 12,
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 0,
},

roomTabPillActive: {
  backgroundColor: "transparent",
},

roomTabContent: {
  alignItems: "center",
  flexDirection: "row",
  gap: 8,
  justifyContent: "center",
  minHeight: 38,
},

roomTabIndicator: {
  backgroundColor: "#A855F7",
  borderRadius: 999,
  height: 3,
  marginTop: 10,
  width: "100%",
},

roomTabPillText: {
  color: "#8B849A",
  fontWeight: "900",
  fontSize: 17,
},

roomTabPillTextActive: {
  color: "#A855F7",
},
activityCard: {
  alignSelf: "center",
  backgroundColor: "rgba(124,58,237,0.14)",
  borderRadius: 999,
  paddingHorizontal: 12,
  paddingVertical: 5,
  marginBottom: 8,
},

activityText: {
  color: "#D8B4FE",
  fontSize: 12,
  fontWeight: "800",
},
fullscreenLiveStream: {
  ...StyleSheet.absoluteFillObject,
  zIndex: 5,
  elevation: 5,
},
streamActionRow: {
  flexDirection: "row",
  gap: 12,
  marginTop: 14,
  marginBottom: 10,
},

streamActionTile: {
  flex: 1,
  backgroundColor: "#141120",
  borderRadius: 24,
  borderWidth: 1,
  borderColor: "rgba(124,58,237,0.22)",
  paddingVertical: 18,
  alignItems: "center",
  justifyContent: "center",
},

streamActionEmoji: {
  fontSize: 28,
  marginBottom: 8,
  color: "#A855F7",
},

streamActionText: {
  color: "white",
  fontWeight: "800",
  fontSize: 15,
},
});
