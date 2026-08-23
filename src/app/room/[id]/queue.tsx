import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { Image } from "expo-image";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { supabase } from "../../../../lib/supabase";
import RoomMissionManager from "../../../components/RoomMissionManager";
import RoomChatModerationSettings from "../../../components/RoomChatModerationSettings";
import ClearRoomParticipantsCard from "../../../components/ClearRoomParticipantsCard";
import RoomIdleLoopManager from "../../../components/RoomIdleLoopManager";

type Tab = "queue" | "inside" | "streams" | "bouncers" | "settings";
type SettingsGroupKey = "experience" | "engagement" | "moderation" | "closeout";

const posterSource = require("../../../../assets/images/partyup-room-poster.png");
const posterWidthPx = 1054;
const posterHeightPx = 1492;
const posterQrX = 377;
const posterQrY = 821;
const posterQrSizePx = 300;

type Room = {
  id: string;
  title: string;
  host_id: string;
  current_users: number;
  queue_count: number;
  max_users: number;
  is_private: boolean;
  status?: string;
};

type UserRow = {
  id: string;
  event_room_id: string;
  user_id: string;
  username?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  status: string;
  room_role?: string | null;
  stream_status?: string | null;
  can_stream?: boolean | null;
  is_muted?: boolean | null;
  queue_score?: number | null;
  created_at?: string;
};

type ActiveAnnouncement = {
  id: string;
  title: string;
  message: string | null;
};

function SettingsGroup({
  children,
  expanded,
  onToggle,
  subtitle,
  title,
}: {
  children: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <View style={[styles.settingsGroup, expanded && styles.settingsGroupExpanded]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={styles.settingsGroupHeader}
      >
        <View style={styles.settingsGroupCopy}>
          <Text style={styles.settingsGroupTitle}>{title}</Text>
          <Text style={styles.settingsGroupSubtitle}>{subtitle}</Text>
        </View>
        <Text style={styles.settingsGroupIcon}>{expanded ? "−" : "+"}</Text>
      </TouchableOpacity>
      {expanded ? <View style={styles.settingsGroupBody}>{children}</View> : null}
    </View>
  );
}

function RoomDescriptionEditor({ roomId, embedded = false }: { roomId: string; embedded?: boolean }) {
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void supabase
      .from("event_rooms")
      .select("description")
      .eq("id", roomId)
      .single()
      .then(({ data }) => setDescription(data?.description || ""));
  }, [roomId]);

  async function saveDescription() {
    if (saving) return;
    setSaving(true);
    const { error } = await supabase
      .from("event_rooms")
      .update({ description: description.trim() || null })
      .eq("id", roomId);
    setSaving(false);
    Alert.alert(error ? "Could not save description" : "Room description saved", error?.message);
  }

  return (
    <View style={[styles.setupCard, embedded && styles.embeddedSection]}>
      <Text style={styles.name}>Room description</Text>
      <Text style={styles.meta}>Shown to guests before and after they enter the room.</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        maxLength={1000}
        multiline
        numberOfLines={4}
        placeholder="Describe this room..."
        placeholderTextColor="#71717A"
        style={styles.descriptionInput}
      />
      <TouchableOpacity style={styles.purplePillButton} onPress={() => void saveDescription()} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? "Saving..." : "Save Description"}</Text>
      </TouchableOpacity>
    </View>
  );
}

function RoomEntryQrCard({ roomId, roomTitle, embedded = false }: { roomId: string; roomTitle: string; embedded?: boolean }) {
  const entryUrl = Linking.createURL(`/room/${roomId}`);
  const [posterWidth, setPosterWidth] = useState(0);
  const posterScale = posterWidth / posterWidthPx;
  const qrSize = Math.round(posterQrSizePx * posterScale);

  async function shareEntry() {
    try {
      await Share.share({ message: `Join ${roomTitle} on PartyUp: ${entryUrl}`, url: entryUrl });
    } catch {
      Alert.alert("Share unavailable", "The room link could not be shared right now.");
    }
  }

  return (
    <View style={[styles.setupCard, embedded && styles.embeddedSection]}>
      <Text style={styles.name}>Room QR code</Text>
      <Text style={styles.meta}>Guests can scan the event poster to open this room.</Text>
      <View
        onLayout={(event) => setPosterWidth(event.nativeEvent.layout.width)}
        style={styles.posterPreview}
      >
        <Image
          accessibilityLabel="PartyUp event poster"
          contentFit="contain"
          source={posterSource}
          style={StyleSheet.absoluteFillObject}
        />
        {qrSize > 0 ? (
          <View
            pointerEvents="none"
            style={[
              styles.posterQr,
              {
                height: qrSize,
                left: posterQrX * posterScale,
                top: posterQrY * posterScale,
                width: qrSize,
              },
            ]}
          >
            <QRCode
              backgroundColor="#FFFFFF"
              color="#090611"
              size={qrSize}
              value={entryUrl}
            />
          </View>
        ) : null}
      </View>
      <TouchableOpacity style={styles.purplePillButton} onPress={() => void shareEntry()}>
        <Text style={styles.buttonText}>Share Room Link</Text>
      </TouchableOpacity>
    </View>
  );
}

function RoomAnnouncementEditor({ roomId }: { roomId: string }) {
  const [announcement, setAnnouncement] = useState<ActiveAnnouncement | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadAnnouncement = useCallback(async () => {
    const { data } = await supabase.rpc("get_active_room_announcement", { p_room_id: roomId });
    const row = Array.isArray(data) ? data[0] : data;
    setAnnouncement((row as ActiveAnnouncement | null) || null);
  }, [roomId]);

  useEffect(() => {
    void loadAnnouncement();
  }, [loadAnnouncement]);

  async function publishAnnouncement() {
    if (!title.trim() || busy) {
      if (!title.trim()) Alert.alert("Announcement title required");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("publish_room_announcement", {
      p_room_id: roomId,
      p_title: title.trim(),
      p_message: message.trim() || null,
      p_cta_label: null,
      p_cta_url: null,
      p_expires_at: null,
    });
    setBusy(false);
    if (error) {
      Alert.alert("Could not publish announcement", error.message);
      return;
    }
    setCreating(false);
    setTitle("");
    setMessage("");
    await loadAnnouncement();
  }

  function confirmEndAnnouncement() {
    if (!announcement || busy) return;
    Alert.alert("End announcement?", "It will disappear from the live room.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          const { error } = await supabase.rpc("end_room_announcement", { p_announcement_id: announcement.id });
          setBusy(false);
          if (error) {
            Alert.alert("Could not end announcement", error.message);
            return;
          }
          setAnnouncement(null);
        },
      },
    ]);
  }

  return (
    <View style={styles.setupCard}>
      <Text style={styles.name}>Announcement</Text>
      <Text style={styles.meta}>Share a timely update with everyone viewing the room.</Text>
      {announcement ? (
        <View style={styles.announcementPreview}>
          <Text style={styles.announcementBadge}>ACTIVE</Text>
          <Text style={styles.announcementTitle}>{announcement.title}</Text>
          {announcement.message ? <Text style={styles.meta}>{announcement.message}</Text> : null}
          <TouchableOpacity style={styles.secondaryPillButton} onPress={confirmEndAnnouncement} disabled={busy}>
            <Text style={styles.secondaryPillText}>{busy ? "Ending..." : "End Announcement"}</Text>
          </TouchableOpacity>
        </View>
      ) : creating ? (
        <View>
          <TextInput
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            placeholder="DJ starts in 10 minutes"
            placeholderTextColor="#71717A"
            style={styles.singleLineInput}
          />
          <TextInput
            value={message}
            onChangeText={setMessage}
            maxLength={500}
            multiline
            numberOfLines={3}
            placeholder="Main stage — stay close."
            placeholderTextColor="#71717A"
            style={styles.descriptionInput}
          />
          <View style={styles.inlineActions}>
            <TouchableOpacity style={styles.purplePillButton} onPress={() => void publishAnnouncement()} disabled={busy}>
              <Text style={styles.buttonText}>{busy ? "Publishing..." : "Publish Announcement"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryPillButton} onPress={() => setCreating(false)} disabled={busy}>
              <Text style={styles.secondaryPillText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.purplePillButton} onPress={() => setCreating(true)}>
          <Text style={styles.buttonText}>Create Announcement</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function ManageRoomPage() {
  const { id } = useLocalSearchParams();
  const roomId = String(id);

  const [activeTab, setActiveTab] = useState<Tab>("queue");
  const [room, setRoom] = useState<Room | null>(null);
  const [queue, setQueue] = useState<UserRow[]>([]);
  const [participants, setParticipants] = useState<UserRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [myRole, setMyRole] = useState<string | null>(null);
  const [roomDeleted, setRoomDeleted] = useState(false);
  const [afterEventMessage, setAfterEventMessage] = useState("");
  const [closeoutBusy, setCloseoutBusy] = useState(false);
  const [openSettingsGroup, setOpenSettingsGroup] = useState<SettingsGroupKey | null>("experience");

  const toggleSettingsGroup = (group: SettingsGroupKey) => {
    setOpenSettingsGroup((current) => (current === group ? null : group));
  };

  useEffect(() => {
  if (roomDeleted) return;

  loadAll();

  const channel = supabase.channel(
    `manage-room-${roomId}-${Date.now()}`
  );

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "event_attendees",
      filter: `event_room_id=eq.${roomId}`,
    },
    () => {
      if (roomDeleted) return;
      loadAll();
    }
  );

  channel.subscribe();

  const interval = setInterval(() => {
    if (roomDeleted) return;
    loadAll();
  }, 3000);

  return () => {
    clearInterval(interval);
    supabase.removeChannel(channel);
  };
}, [roomId, roomDeleted]);

  useEffect(() => {
    void supabase
      .from("room_recap_messages")
      .select("message")
      .eq("room_id", roomId)
      .maybeSingle()
      .then(({ data }) => setAfterEventMessage(data?.message || ""));
  }, [roomId]);

  async function loadAll() {
    await loadCurrentUser();
    await loadRoom();
    await loadQueue();
    await loadParticipants();
  }

  async function loadCurrentUser() {
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) return;

    setCurrentUserId(user.id);

    const { data: attendee } = await supabase
      .from("event_attendees")
      .select("room_role")
      .eq("event_room_id", roomId)
      .eq("user_id", user.id)
      .maybeSingle();

    setMyRole(attendee?.room_role || null);
  }

  async function loadRoom() {
  const { data, error } = await supabase
    .from("event_rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();

  if (error) {
    console.log(
      "ROOM LOAD ERROR:",
      error.message
    );
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
}

  async function loadQueue() {
    const { data } = await supabase
      .from("event_attendees")
      .select("*")
      .eq("event_room_id", roomId)
      .eq("status", "waiting")
      .order("queue_score", { ascending: false })
      .order("created_at", { ascending: true });

    setQueue(data || []);
  }

  async function loadParticipants() {
    const { data } = await supabase
      .from("event_attendees")
      .select("*")
      .eq("event_room_id", roomId)
      .eq("status", "accepted")
      .order("created_at", { ascending: true });

    setParticipants(data || []);
  }

  const isHost = room?.host_id === currentUserId;
  const isBouncer = myRole === "bouncer" || myRole === "admin";
  const canManage = isHost || isBouncer;

  async function acceptUser(user: UserRow) {
    if (!room) return;

    if (room.current_users >= room.max_users) {
      Alert.alert("PartyUp", "Room is full.");
      return;
    }

    await supabase
      .from("event_attendees")
      .update({ status: "accepted" })
      .eq("id", user.id);

    await supabase
      .from("event_rooms")
      .update({
        current_users: room.current_users + 1,
        queue_count: Math.max(room.queue_count - 1, 0),
      })
      .eq("id", room.id);

    loadAll();
  }

  async function rejectUser(user: UserRow) {
    if (!room) return;

    await supabase
      .from("event_attendees")
      .update({ status: "rejected" })
      .eq("id", user.id);

    await supabase
      .from("event_rooms")
      .update({
        queue_count: Math.max(room.queue_count - 1, 0),
      })
      .eq("id", room.id);

    loadAll();
  }

  async function kickUser(user: UserRow) {
    if (!room) return;

    if (user.user_id === currentUserId) {
      Alert.alert("PartyUp", "You cannot kick yourself.");
      return;
    }

    if (user.user_id === room.host_id) {
      Alert.alert("PartyUp", "You cannot kick the host.");
      return;
    }

    await supabase
      .from("event_attendees")
      .update({ status: "kicked" })
      .eq("id", user.id);

    await supabase
      .from("event_rooms")
      .update({
        current_users: Math.max(room.current_users - 1, 0),
      })
      .eq("id", room.id);

    loadAll();
  }

  async function toggleMute(user: UserRow) {
    await supabase
      .from("event_attendees")
      .update({ is_muted: !user.is_muted })
      .eq("id", user.id);

    loadAll();
  }

  async function toggleBouncer(user: UserRow) {
    if (!isHost) return;

    await supabase
      .from("event_attendees")
      .update({
        room_role: user.room_role === "bouncer" ? "guest" : "bouncer",
      })
      .eq("id", user.id);

    loadAll();
  }

  async function approveStreamer(user: UserRow) {
    await supabase
      .from("event_attendees")
      .update({
        can_stream: true,
        stream_status: "live",
      })
      .eq("id", user.id);

    loadAll();
  }

  async function stopStreamer(user: UserRow) {
  Alert.alert(
    "Stop stream?",
    "Stop this livestream?",
    [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Stop",
        style: "destructive",
        onPress: async () => {
          await supabase
            .from("event_attendees")
            .update({
              can_stream: false,
              stream_status: "off",
            })
            .eq("id", user.id);

          loadAll();
        },
      },
    ]
  );
}

async function giveReputation(userId: string) {
  if (!room) return;

  const { data: attendee } = await supabase
    .from("event_attendees")
    .select("reputation_given")
    .eq("event_room_id", room.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (attendee?.reputation_given) {
    Alert.alert(
      "Already rated",
      "You already gave reputation to this guest."
    );
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("reputation_score, host_likes")
    .eq("id", userId)
    .maybeSingle();

  const currentRep =
    profile?.reputation_score ?? 50;

  const currentLikes =
    profile?.host_likes ?? 0;

  await supabase
    .from("profiles")
    .update({
      reputation_score: currentRep + 2,
      host_likes: currentLikes + 1,
    })
    .eq("id", userId);

  await supabase
    .from("event_attendees")
    .update({
      reputation_given: true,
    })
    .eq("event_room_id", room.id)
    .eq("user_id", userId);

  Alert.alert(
    "Reputation given",
    "+2 reputation awarded."
  );

  loadAll();
}

async function toggleRoomPrivacy() {
  if (!room || !isHost) return;

  const nextPrivacy = !room.is_private;

  await supabase
    .from("event_rooms")
    .update({
      is_private: nextPrivacy,
    })
    .eq("id", room.id);

  setRoom({
    ...room,
    is_private: nextPrivacy,
  });
}

async function startOBSStream() {
  try {
    if (!room || !isHost) {
      Alert.alert("Only the host can use OBS streaming.");
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", currentUserId)
      .maybeSingle();

    const response = await fetch(
      "https://sgfbbytnmodbjxqesgxq.supabase.co/functions/v1/create-ingress",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomName: room.id,
          userId: currentUserId,
          participantName: profile?.username || `Guest ${currentUserId.slice(0, 4)}`,
        }),
      }
    );

    const data = await response.json();

    Alert.alert(
      "OBS Stream Info",
      `Server:\n${data.url}\n\nKey:\n${data.streamKey}`
    );

    console.log(data);
  } catch (err) {
    console.log(err);
  }
}

async function deleteRoom() {
  if (!room || !isHost) return;

  Alert.alert(
    "Delete room?",
    "This permanently removes the room, its Memory records, saved Memories, attendance, and event history. Use End Event for completed events.",
    [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {

          await supabase.functions.invoke(
            "delete-ingress",
            {
              body: {
                roomName: room.id,
              },
            }
          );

          await supabase
            .from("event_rooms")
            .delete()
            .eq("id", room.id);

         setRoomDeleted(true);

setTimeout(() => {
  router.replace("/home");
}, 50);
        },
      },
    ]
  );
}

async function endEvent() {
  if (!room || !isHost || room.status === "ended" || closeoutBusy) return;

  Alert.alert(
    "Save message and end this event?",
    "Your optional after-event message will be saved first. The room will then become read-only while Memories, recaps, attendance, and Event Series history are kept.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "End Event",
        style: "destructive",
        onPress: async () => {
          setCloseoutBusy(true);
          const { error: messageError } = await supabase.rpc("set_room_recap_message", {
            p_room_id: room.id,
            p_message: afterEventMessage,
          });
          if (messageError) {
            setCloseoutBusy(false);
            Alert.alert("Could not save after-event message", messageError.message);
            return;
          }
          await supabase.functions.invoke("delete-ingress", { body: { roomName: room.id } }).catch(() => undefined);
          const { error } = await supabase.functions.invoke("end-event-room", { body: { roomId: room.id } });
          if (error) {
            setCloseoutBusy(false);
            Alert.alert("Could not end event", error.message);
            return;
          }
          router.replace(`/room/${room.id}`);
        },
      },
    ],
  );
}

  if (!room) {
    return (
      <View style={styles.page}>
        <Text style={styles.loading}>Loading management tools...</Text>
      </View>
    );
  }

  if (!canManage) {
    return (
      <View style={styles.page}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>No Access</Text>
        <Text style={styles.empty}>Only hosts and bouncers can manage this room.</Text>
      </View>
    );
  }

  if (room.status === "ended") {
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.container}>
        <Text style={styles.heading}>Event Ended</Text>
        <Text style={styles.subheading}>{room.title} is read-only. Memories, recaps, attendance, and series history are retained.</Text>
        <RoomMissionManager roomId={room.id} isHost={isHost} roomEnded />
        <TouchableOpacity style={styles.privacyButton} onPress={() => router.replace(`/room/${room.id}`)}>
          <Text style={styles.buttonText}>Back to Past Event</Text>
        </TouchableOpacity>
        {isHost && <TouchableOpacity style={styles.deleteButton} onPress={deleteRoom}><Text style={styles.buttonText}>Delete Exceptional/Test Room</Text></TouchableOpacity>}
      </ScrollView>
    );
  }

  const streamRequests = [...queue, ...participants].filter(
    (user) => user.stream_status === "requested"
  );

  const bouncers = participants.filter(
    (user) => user.room_role === "bouncer" || user.room_role === "admin"
  );

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>

      <Text style={styles.heading}>Room Settings</Text>
      <Text style={styles.subheading}>Queue / Stream Requests for {room.title}</Text>

      <View style={styles.statsRow}>
  <View style={styles.statCard}>
    <Text style={styles.statValue}>
      {participants.length}
    </Text>
    <Text style={styles.statLabel}>Inside</Text>
  </View>

  <View style={styles.statCard}>
    <Text style={styles.statValue}>
      {queue.length}
    </Text>
    <Text style={styles.statLabel}>Queue</Text>
  </View>

  <View style={styles.statCard}>
    <Text style={styles.statValue}>
      {
        participants.filter((u) => u.can_stream)
          .length
      }
    </Text>
    <Text style={styles.statLabel}>Live</Text>
  </View>

  <View style={styles.statCard}>
    <Text style={styles.statValue}>
      {streamRequests.length}
    </Text>
    <Text style={styles.statLabel}>Requests</Text>
  </View>
</View>

      <View style={styles.tabs}>
        {(["queue", "inside", "streams", "bouncers", "settings"] as Tab[]).map(
          (tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab && styles.tabTextActive,
                ]}
              >
                {tab === "queue"
                  ? "Queue"
                  : tab === "inside"
                  ? "Inside"
                  : tab === "streams"
                  ? "Requests"
                  : tab === "bouncers"
                  ? "Bouncers"
                  : "Settings"}
              </Text>
            </TouchableOpacity>
          )
        )}
      </View>

      {activeTab === "queue" && (
        <View>
          <Text style={styles.sectionTitle}>Queue / Stream Requests</Text>

          {queue.length === 0 ? (
            <Text style={styles.empty}>No one is waiting.</Text>
          ) : (
            queue.map((user, index) => (
              <View key={user.id} style={styles.card}>
                <Text style={styles.rank}>#{index + 1}</Text>
                <Text style={styles.name}>{user.username || "Guest"}</Text>
                <Text style={styles.meta}>Score: {user.queue_score ?? 50}</Text>

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => acceptUser(user)}
                  >
                    <Text style={styles.buttonText}>Accept</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.rejectButton}
                    onPress={() => rejectUser(user)}
                  >
                    <Text style={styles.buttonText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {activeTab === "inside" && (
  <View>
    <Text style={styles.sectionTitle}>Inside Room</Text>

    {participants.length === 0 ? (
      <Text style={styles.empty}>No one inside yet.</Text>
    ) : (
      participants.map((user) => (
        <View key={user.id} style={styles.card}>
          <Text style={styles.name}>{user.username || "Guest"}</Text>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 5 }}>
            <Text style={styles.meta}>
              {user.user_id === room.host_id
                ? "Host"
                : user.room_role === "bouncer"
                ? "Bouncer"
                : "Guest"}
            </Text>

            {user.can_stream && (
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            )}

            {user.is_muted && (
              <View style={styles.mutedBadge}>
                <Text style={styles.liveBadgeText}>MUTED</Text>
              </View>
            )}
          </View>

          {user.stream_status && (
  <Text style={styles.meta}>
    Stream: {user.stream_status}
  </Text>
)}

          {user.user_id !== room.host_id &&
            user.user_id !== currentUserId && (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.rejectButton}
                  onPress={() => toggleMute(user)}
                >
                  <Text style={styles.buttonText}>
                    {user.is_muted ? "Unmute" : "Mute"}
                  </Text>
                </TouchableOpacity>

                {user.stream_status === "requested" && (
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => approveStreamer(user)}
                  >
                    <Text style={styles.buttonText}>Approve Live</Text>
                  </TouchableOpacity>
                )}

                {user.can_stream && (
                  <TouchableOpacity
                    style={styles.rejectButton}
                    onPress={() => stopStreamer(user)}
                  >
                    <Text style={styles.buttonText}>Stop Live</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
  style={styles.repButton}
  onPress={() => giveReputation(user.user_id)}
>
  <Text style={styles.buttonText}>👍 Rep</Text>
</TouchableOpacity>

                <TouchableOpacity
                  style={styles.kickButton}
                  onPress={() => kickUser(user)}
                >
                  <Text style={styles.buttonText}>Kick</Text>
                </TouchableOpacity>
              </View>
            )}
        </View>
      ))
    )}
  </View>
)}

      {activeTab === "streams" && (
        <View>
          <Text style={styles.sectionTitle}>Stream Requests</Text>

          {streamRequests.length === 0 ? (
            <Text style={styles.empty}>No stream requests.</Text>
          ) : (
            streamRequests.map((user) => (
              <View key={user.id} style={styles.card}>
                <Text style={styles.name}>{user.username || "Guest"}</Text>
                <Text style={styles.meta}>Requested to go live</Text>

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => approveStreamer(user)}
                  >
                    <Text style={styles.buttonText}>Approve</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.rejectButton}
                    onPress={() => stopStreamer(user)}
                  >
                    <Text style={styles.buttonText}>Deny</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          <Text style={styles.sectionTitle}>Currently Live</Text>

          {participants
            .filter((user) => user.can_stream)
            .map((user) => (
              <View key={user.id} style={styles.card}>
                <Text style={styles.name}>{user.username || "Guest"}</Text>

                <TouchableOpacity
                  style={styles.rejectButton}
                  onPress={() => stopStreamer(user)}
                >
                  <Text style={styles.buttonText}>Stop Stream</Text>
                </TouchableOpacity>
              </View>
            ))}
        </View>
      )}

      {activeTab === "bouncers" && (
        <View>
          <Text style={styles.sectionTitle}>Bouncers</Text>

          {bouncers.length === 0 ? (
            <Text style={styles.empty}>No bouncers yet.</Text>
          ) : (
            bouncers.map((user) => (
              <View key={user.id} style={styles.card}>
                <Text style={styles.name}>{user.username || "Guest"}</Text>
                <Text style={styles.meta}>{user.room_role}</Text>
              </View>
            ))
          )}

          {isHost && (
            <>
              <Text style={styles.sectionTitle}>Make Bouncer</Text>

              {participants
                .filter((user) => user.user_id !== room.host_id)
                .map((user) => (
                  <View key={user.id} style={styles.card}>
                    <Text style={styles.name}>{user.username || "Guest"}</Text>

                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={() => toggleBouncer(user)}
                    >
                      <Text style={styles.buttonText}>
                        {user.room_role === "bouncer"
                          ? "Remove Bouncer"
                          : "Make Bouncer"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
            </>
          )}
        </View>
      )}

      {activeTab === "settings" && (
        <View>
          <Text style={styles.sectionTitle}>Room Settings</Text>

          {isHost ? (
            <>
              <SettingsGroup
                title="Room & broadcast"
                subtitle="Room details, guest access, and what plays between live streams."
                expanded={openSettingsGroup === "experience"}
                onToggle={() => toggleSettingsGroup("experience")}
              >
                <RoomDescriptionEditor roomId={room.id} embedded />
                <View style={styles.settingsDivider} />
                <View style={styles.settingsSubsection}>
                  <Text style={styles.name}>Guest access</Text>
                  <Text style={styles.meta}>
                    This room is currently {room.is_private ? "private" : "public"}.
                  </Text>
                  <TouchableOpacity style={styles.privacyButton} onPress={toggleRoomPrivacy}>
                    <Text style={styles.buttonText}>
                      {room.is_private ? "Make Room Public" : "Make Room Private"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.settingsDivider} />
                <RoomEntryQrCard roomId={room.id} roomTitle={room.title} embedded />
                <View style={styles.settingsDivider} />
                <RoomIdleLoopManager roomId={room.id} embedded />
                <View style={styles.settingsDivider} />
                <View style={styles.settingsSubsection}>
                  <Text style={styles.settingsEyebrow}>EXTERNAL STREAMING</Text>
                  <Text style={styles.name}>Broadcast with OBS</Text>
                  <Text style={styles.meta}>
                    Create or view the server URL and stream key for this room.
                  </Text>
                  <TouchableOpacity style={styles.obsButton} onPress={startOBSStream}>
                    <Text style={styles.buttonText}>Get OBS Credentials</Text>
                  </TouchableOpacity>
                </View>
              </SettingsGroup>

              <SettingsGroup
                title="Engagement"
                subtitle="Announcements and activities for everyone in the room."
                expanded={openSettingsGroup === "engagement"}
                onToggle={() => toggleSettingsGroup("engagement")}
              >
                <RoomAnnouncementEditor roomId={room.id} />
                <RoomMissionManager roomId={room.id} isHost={isHost} />
              </SettingsGroup>

              <SettingsGroup
                title="Safety & access"
                subtitle="Chat controls and participant cleanup."
                expanded={openSettingsGroup === "moderation"}
                onToggle={() => toggleSettingsGroup("moderation")}
              >
                <RoomChatModerationSettings roomId={room.id} />
                <ClearRoomParticipantsCard
                  hostId={room.host_id}
                  onCleared={loadAll}
                  roomId={room.id}
                />
              </SettingsGroup>

              <SettingsGroup
                title="Event lifecycle"
                subtitle="End the event, leave a recap note, or permanently delete it."
                expanded={openSettingsGroup === "closeout"}
                onToggle={() => toggleSettingsGroup("closeout")}
              >
                {room.status !== "ended" ? (
                  <View style={styles.closeoutSection}>
                    <Text style={styles.closeoutEyebrow}>FINAL STEP</Text>
                    <Text style={styles.name}>Event closeout</Text>
                    <Text style={styles.meta}>Leave guests an optional note in their recap, then end the event.</Text>
                    <TextInput
                      value={afterEventMessage}
                      onChangeText={setAfterEventMessage}
                      maxLength={500}
                      multiline
                      numberOfLines={4}
                      placeholder="Thanks for coming. See you next time."
                      placeholderTextColor="#71717A"
                      style={styles.descriptionInput}
                    />
                    <TouchableOpacity style={styles.endEventButton} onPress={endEvent}>
                      <Text style={styles.buttonText}>{closeoutBusy ? "Saving & ending..." : afterEventMessage.trim() ? "Save Message & End Event" : "End Event"}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.settingsSubsection}>
                    <Text style={styles.name}>Event ended</Text>
                    <Text style={styles.meta}>History and Memories are retained.</Text>
                  </View>
                )}
                <TouchableOpacity style={styles.deleteButton} onPress={deleteRoom}>
                  <Text style={styles.buttonText}>Delete Room</Text>
                </TouchableOpacity>
              </SettingsGroup>
            </>
          ) : (
            <SettingsGroup
              title="Room activity"
              subtitle="View the activities configured by the host."
              expanded={openSettingsGroup === "engagement"}
              onToggle={() => toggleSettingsGroup("engagement")}
            >
              <RoomMissionManager roomId={room.id} isHost={false} />
            </SettingsGroup>
          )}
        </View>
      )}
      
       <TouchableOpacity onPress={() => router.push(`/room/${room.id}`)}>
        <Text style={styles.back}>← Back to Room</Text>
      </TouchableOpacity>

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
    paddingBottom: 80,
  },

  loading: {
    color: "white",
    padding: 24,
    fontSize: 18,
    fontWeight: "800",
  },

  back: {
    color: "#A78BFA",
    fontWeight: "900",
    marginBottom: 18,
  },

  heading: {
    color: "white",
    fontSize: 34,
    fontWeight: "900",
  },

  subheading: {
    color: "#A1A1AA",
    fontSize: 15,
    marginTop: 6,
    marginBottom: 22,
  },

  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },

  tab: {
    backgroundColor: "#151220",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },

  tabActive: {
    backgroundColor: "#7C3AED",
    borderColor: "#A855F7",
  },

  tabText: {
    color: "#A1A1AA",
    fontWeight: "900",
  },

  tabTextActive: {
    color: "white",
  },

  sectionTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 14,
    marginTop: 8,
  },

  settingsGroup: {
    backgroundColor: "rgba(17, 16, 27, 0.92)",
    borderColor: "rgba(168,85,247,0.18)",
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  settingsGroupExpanded: {
    borderColor: "rgba(168,85,247,0.42)",
  },
  settingsGroupHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    minHeight: 76,
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  settingsGroupCopy: {
    flex: 1,
  },
  settingsGroupTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  settingsGroupSubtitle: {
    color: "#A1A1AA",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: 4,
  },
  settingsGroupIcon: {
    color: "#C4B5FD",
    fontSize: 26,
    fontWeight: "500",
    textAlign: "center",
    width: 24,
  },
  settingsGroupBody: {
    borderTopColor: "rgba(255,255,255,0.08)",
    borderTopWidth: 1,
    padding: 18,
  },
  settingsSubsection: {
    paddingVertical: 2,
  },
  settingsDivider: {
    backgroundColor: "rgba(255,255,255,0.08)",
    height: 1,
    marginVertical: 20,
  },
  settingsEyebrow: {
    color: "#A78BFA",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 7,
  },
  embeddedSection: {
    backgroundColor: "transparent",
    borderWidth: 0,
    marginBottom: 0,
    padding: 0,
  },
  closeoutSection: {
    paddingVertical: 2,
  },

  card: {
    backgroundColor: "#11101B",
    borderRadius: 24,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.18)",
  },
  setupCard: {
    backgroundColor: "rgba(17, 16, 27, 0.96)",
    borderColor: "rgba(168,85,247,0.3)",
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 14,
    padding: 18,
  },
  descriptionInput: {
    backgroundColor: "#08080D",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    borderWidth: 1,
    color: "#FFFFFF",
    marginTop: 14,
    minHeight: 104,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: "top",
  },
  singleLineInput: {
    backgroundColor: "#08080D",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    borderWidth: 1,
    color: "#FFFFFF",
    marginTop: 14,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  purplePillButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 14,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  secondaryPillButton: {
    alignItems: "center",
    borderColor: "rgba(196,181,253,0.45)",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 14,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  secondaryPillText: {
    color: "#E9D5FF",
    fontWeight: "900",
  },
  inlineActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  announcementPreview: {
    backgroundColor: "#08080D",
    borderRadius: 14,
    marginTop: 14,
    padding: 14,
  },
  announcementBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#047857",
    borderRadius: 999,
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  announcementTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 10,
  },
  posterPreview: {
    aspectRatio: posterWidthPx / posterHeightPx,
    alignSelf: "center",
    backgroundColor: "#050509",
    borderColor: "rgba(255,62,154,0.35)",
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    maxWidth: 420,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  posterQr: {
    backgroundColor: "#FFFFFF",
    position: "absolute",
  },
  closeoutEyebrow: {
    color: "#C4B5FD",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginBottom: 7,
  },
  endEventButton: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 14,
    paddingVertical: 13,
  },

  rank: {
    color: "#A78BFA",
    fontWeight: "900",
    marginBottom: 6,
  },

  name: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
  },

  meta: {
    color: "#A1A1AA",
    marginTop: 5,
    fontWeight: "700",
  },

  empty: {
    color: "#777",
    fontWeight: "700",
    marginBottom: 20,
  },

  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },

  acceptButton: {
    flex: 1,
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: "center",
  },

  rejectButton: {
    flex: 1,
    backgroundColor: "#2A2A35",
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: "center",
  },

  kickButton: {
    flex: 1,
    backgroundColor: "#7F1D1D",
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: "center",
  },

  privacyButton: {
  backgroundColor: "#7C3AED",
  borderColor: "#A78BFA",
  borderWidth: 1,
  borderRadius: 999,
  paddingVertical: 16,
  alignItems: "center",
  marginTop: 20,
},
  obsButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  
  deleteButton: {
    backgroundColor: "#7F1D1D",
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },

  buttonText: {
    color: "white",
    fontWeight: "900",
  },
  statsRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 12,
  marginBottom: 24,
},

statCard: {
  flex: 1,
  minWidth: 120,
  backgroundColor: "#11101B",
  borderRadius: 22,
  padding: 18,
  borderWidth: 1,
  borderColor: "rgba(124,58,237,0.18)",
},

statValue: {
  color: "white",
  fontSize: 28,
  fontWeight: "900",
},

statLabel: {
  color: "#A78BFA",
  fontWeight: "700",
  marginTop: 6,
},
liveBadge: {
  backgroundColor: "#DC2626",
  borderRadius: 999,
  paddingHorizontal: 10,
  paddingVertical: 4,
},

mutedBadge: {
  backgroundColor: "#52525B",
  borderRadius: 999,
  paddingHorizontal: 10,
  paddingVertical: 4,
},

liveBadgeText: {
  color: "white",
  fontSize: 10,
  fontWeight: "900",
},
repButton: {
  backgroundColor: "#22C55E",
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
},

repButtonText: {
  color: "white",
  fontWeight: "900",
},
});
