import { router, useLocalSearchParams } from "expo-router";
import * as MediaLibrary from "expo-media-library";
import { Image } from "expo-image";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  PixelRatio,
  ScrollView,
  Share,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { captureRef } from "react-native-view-shot";
import { supabase } from "../../../../lib/supabase";
import RoomMissionManager from "../../../components/RoomMissionManager";
import WildHostManager from "../../../components/WildHostManager";
import RoomChatModerationSettings from "../../../components/RoomChatModerationSettings";
import ClearRoomParticipantsCard from "../../../components/ClearRoomParticipantsCard";
import RoomIdleLoopManager from "../../../components/RoomIdleLoopManager";
import LightningTriviaManager from "../../../components/LightningTriviaManager";
import RecapMediaManager from "../../../components/RecapMediaManager";

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
  reputation_given?: boolean | null;
  created_at?: string;
};

type StreamQueueEntry = {
  id: string;
  room_id: string;
  user_id: string;
  status: "waiting" | "live" | "ended" | "removed";
  priority: number;
  approved_at: string;
  started_at: string | null;
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
  const entryUrl = `https://partyup.io/join/${encodeURIComponent(roomId)}`;
  const posterRef = useRef<View>(null);
  const [posterWidth, setPosterWidth] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const posterScale = posterWidth / posterWidthPx;
  const qrSize = Math.round(posterQrSizePx * posterScale);

  async function shareEntry() {
    try {
      await Share.share({ message: `Join ${roomTitle} on PartyUp: ${entryUrl}`, url: entryUrl });
    } catch {
      Alert.alert("Share unavailable", "The room link could not be shared right now.");
    }
  }

  async function downloadPoster() {
    if (!posterRef.current || downloading) return;
    setDownloading(true);

    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert(
          "Photo access needed",
          "Allow PartyUp to add photos so the room poster can be saved to your device.",
        );
        return;
      }

      const pixelRatio = PixelRatio.get();
      const posterUri = await captureRef(posterRef, {
        format: "png",
        height: posterHeightPx / pixelRatio,
        quality: 1,
        result: "tmpfile",
        width: posterWidthPx / pixelRatio,
      });

      await MediaLibrary.saveToLibraryAsync(posterUri);
      Alert.alert("Poster downloaded", "The room QR poster was saved to your photo library.");
    } catch {
      Alert.alert("Download unavailable", "The room poster could not be saved right now.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <View style={[styles.setupCard, embedded && styles.embeddedSection]}>
      <Text style={styles.name}>Room QR code</Text>
      <Text style={styles.meta}>Guests can scan the event poster to open this room.</Text>
      <View
        ref={posterRef}
        collapsable={false}
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
      <View style={styles.posterActions}>
        <TouchableOpacity
          style={[styles.purplePillButton, styles.posterActionButton]}
          disabled={downloading}
          onPress={() => void downloadPoster()}
        >
          <Text style={styles.buttonText}>{downloading ? "Saving..." : "Download Poster"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryPillButton, styles.posterActionButton]}
          onPress={() => void shareEntry()}
        >
          <Text style={styles.secondaryPillText}>Share Room Link</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function RoomAnnouncementEditor({ roomId }: { roomId: string }) {
  const [announcement, setAnnouncement] = useState<ActiveAnnouncement | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [notifyAttendees, setNotifyAttendees] = useState(false);
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
    const { error } = await supabase.rpc("publish_room_announcement_with_push", {
      p_room_id: roomId,
      p_title: title.trim(),
      p_message: message.trim() || null,
      p_cta_label: null,
      p_cta_url: null,
      p_expires_at: null,
      p_notify_attendees: notifyAttendees,
    });
    setBusy(false);
    if (error) {
      Alert.alert("Could not publish announcement", error.message);
      return;
    }
    setCreating(false);
    setTitle("");
    setMessage("");
    setNotifyAttendees(false);
    if (notifyAttendees) {
      void supabase.functions.invoke("dispatch-push-notifications", { body: { roomId } });
    }
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
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>Notify attendees</Text>
              <Text style={styles.meta}>Send a push notification as well as posting in the room.</Text>
            </View>
            <Switch value={notifyAttendees} onValueChange={setNotifyAttendees} trackColor={{ true: "#7C3AED" }} />
          </View>
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

  const [room, setRoom] = useState<Room | null>(null);
  const [queue, setQueue] = useState<UserRow[]>([]);
  const [participants, setParticipants] = useState<UserRow[]>([]);
  const [streamQueue, setStreamQueue] = useState<StreamQueueEntry[]>([]);
  const [streamQueueBusyUserId, setStreamQueueBusyUserId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [myRole, setMyRole] = useState<string | null>(null);
  const [roomDeleted, setRoomDeleted] = useState(false);
  const [afterEventMessage, setAfterEventMessage] = useState("");
  const [closeoutBusy, setCloseoutBusy] = useState(false);
  const [openSettingsGroup, setOpenSettingsGroup] = useState<SettingsGroupKey | null>(null);

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

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "room_stream_queue",
      filter: `room_id=eq.${roomId}`,
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
    await loadStreamQueue();
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

  async function loadStreamQueue() {
    const { data, error } = await supabase
      .from("room_stream_queue")
      .select("id,room_id,user_id,status,priority,approved_at,started_at")
      .eq("room_id", roomId)
      .in("status", ["waiting", "live"])
      .order("priority", { ascending: true });

    if (error) {
      console.log("STREAM QUEUE LOAD ERROR:", error.message);
      return;
    }

    setStreamQueue((data || []) as StreamQueueEntry[]);
  }

  async function runStreamQueueAction(
    userId: string,
    rpcName: string,
    params: Record<string, string>,
  ) {
    if (streamQueueBusyUserId) return;
    setStreamQueueBusyUserId(userId);

    try {
      const { error } = await supabase.rpc(rpcName, params);
      if (error) Alert.alert("Could not update the broadcast queue", error.message);
      await loadAll();
    } finally {
      setStreamQueueBusyUserId(null);
    }
  }

  function approveStreamQueueEntry(userId: string) {
    return runStreamQueueAction(userId, "approve_room_stream", {
      p_room_id: roomId,
      p_user_id: userId,
    });
  }

  function startStreamQueueEntry(userId: string) {
    return runStreamQueueAction(userId, "start_room_stream", {
      p_room_id: roomId,
      p_user_id: userId,
    });
  }

  function moveStreamQueueEntry(userId: string, direction: "up" | "down") {
    return runStreamQueueAction(userId, "move_room_stream_queue_entry", {
      p_direction: direction,
      p_room_id: roomId,
      p_user_id: userId,
    });
  }

  function removeStreamQueueEntry(userId: string) {
    return runStreamQueueAction(userId, "remove_room_stream_queue_entry", {
      p_room_id: roomId,
      p_user_id: userId,
    });
  }

  function endStreamQueueEntry(userId: string) {
    Alert.alert("End broadcast?", "End this broadcast and return the main feed to standby?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End broadcast",
        style: "destructive",
        onPress: () => void runStreamQueueAction(userId, "end_room_stream", {
          p_room_id: roomId,
          p_user_id: userId,
        }),
      },
    ]);
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

async function saveAfterEventMessage() {
  if (!room || !isHost || closeoutBusy) return;
  setCloseoutBusy(true);
  const { error } = await supabase.rpc("set_room_recap_message", {
    p_room_id: room.id,
    p_message: afterEventMessage,
  });
  setCloseoutBusy(false);
  Alert.alert(
    error ? "Could not save after-event message" : "After-event message saved",
    error?.message || (afterEventMessage.trim() ? "Guests will see the updated message in the event archive and recap." : "The custom message was removed."),
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
        {isHost ? (
          <>
            <RoomIdleLoopManager roomId={room.id} presentation="event-replay" />
            <View style={styles.setupCard}>
              <Text style={styles.closeoutEyebrow}>A MESSAGE FROM THE HOST</Text>
              <Text style={styles.name}>After-event message</Text>
              <Text style={styles.meta}>Shown above Event Replay in the room archive and in each attendee&apos;s recap.</Text>
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
              <RecapMediaManager embedded roomId={room.id} />
              <TouchableOpacity style={styles.purplePillButton} disabled={closeoutBusy} onPress={() => void saveAfterEventMessage()}>
                <Text style={styles.buttonText}>{closeoutBusy ? "Saving..." : "Save Message"}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
        {isHost && <WildHostManager roomId={room.id} roomEnded />}
        <RoomMissionManager roomId={room.id} isHost={isHost} roomEnded />
        <TouchableOpacity style={styles.privacyButton} onPress={() => router.replace(`/room/${room.id}`)}>
          <Text style={styles.buttonText}>Back to Past Event</Text>
        </TouchableOpacity>
        {isHost && <TouchableOpacity style={styles.deleteButton} onPress={deleteRoom}><Text style={styles.buttonText}>Delete Exceptional/Test Room</Text></TouchableOpacity>}
      </ScrollView>
    );
  }

  const participantByUserId = new Map(participants.map((user) => [user.user_id, user]));
  const currentBroadcast = streamQueue.find((entry) => entry.status === "live");
  const waitingToBroadcast = streamQueue
    .filter((entry) => entry.status === "waiting")
    .sort((left, right) => left.priority - right.priority);
  const activeBroadcastUserIds = new Set(streamQueue.map((entry) => entry.user_id));
  const availableBroadcasters = participants.filter(
    (user) => !activeBroadcastUserIds.has(user.user_id),
  );

  const bouncers = participants.filter(
    (user) => user.room_role === "bouncer" || user.room_role === "admin"
  );

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>

      <Text style={styles.heading}>Room Settings</Text>
      <Text style={styles.subheading}>Host tools and live operations for {room.title}</Text>

      <SettingsGroup
                title="Room & broadcast"
                subtitle="Live broadcast queue, room details, guest access, and standby media."
                expanded={openSettingsGroup === "experience"}
                onToggle={() => toggleSettingsGroup("experience")}
              >
                {isHost && (
                  <>
                <View style={styles.settingsSubsection}>
                  <Text style={styles.settingsEyebrow}>LIVE BROADCAST QUEUE</Text>
                  <Text style={styles.name}>Current stream</Text>
                  {currentBroadcast ? (
                    <View style={styles.card}>
                      <Text style={styles.name}>
                        {participantByUserId.get(currentBroadcast.user_id)?.username || "Guest"}
                      </Text>
                      <Text style={styles.meta}>Has control of the main feed</Text>
                      <TouchableOpacity
                        style={styles.rejectButton}
                        disabled={Boolean(streamQueueBusyUserId)}
                        onPress={() => endStreamQueueEntry(currentBroadcast.user_id)}
                      >
                        <Text style={styles.buttonText}>
                          {streamQueueBusyUserId === currentBroadcast.user_id ? "Ending..." : "End Broadcast"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={styles.empty}>The main feed is on standby.</Text>
                  )}

                  <Text style={styles.broadcastQueueHeading}>
                    Waiting to stream · {waitingToBroadcast.length}
                  </Text>
                  {waitingToBroadcast.length === 0 ? (
                    <Text style={styles.empty}>Approve a member&apos;s stream to add them here.</Text>
                  ) : (
                    waitingToBroadcast.map((entry, index) => (
                      <View key={entry.id} style={styles.card}>
                        <Text style={styles.rank}>#{index + 1}</Text>
                        <Text style={styles.name}>
                          {participantByUserId.get(entry.user_id)?.username || "Guest"}
                        </Text>
                        <Text style={styles.meta}>Approved and waiting</Text>
                        <View style={styles.actions}>
                          <TouchableOpacity
                            style={[styles.secondaryPillButton, styles.compactControlButton]}
                            disabled={index === 0 || Boolean(streamQueueBusyUserId)}
                            onPress={() => void moveStreamQueueEntry(entry.user_id, "up")}
                          >
                            <Text style={styles.secondaryPillText}>Move Up</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.secondaryPillButton, styles.compactControlButton]}
                            disabled={index === waitingToBroadcast.length - 1 || Boolean(streamQueueBusyUserId)}
                            onPress={() => void moveStreamQueueEntry(entry.user_id, "down")}
                          >
                            <Text style={styles.secondaryPillText}>Move Down</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.acceptButton}
                            disabled={Boolean(streamQueueBusyUserId)}
                            onPress={() => void startStreamQueueEntry(entry.user_id)}
                          >
                            <Text style={styles.buttonText}>
                              {streamQueueBusyUserId === entry.user_id ? "Starting..." : "Start Broadcast"}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.rejectButton}
                            disabled={Boolean(streamQueueBusyUserId)}
                            onPress={() => void removeStreamQueueEntry(entry.user_id)}
                          >
                            <Text style={styles.buttonText}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))
                  )}

                  <Text style={styles.broadcastQueueHeading}>Approved members</Text>
                  {availableBroadcasters.length === 0 ? (
                    <Text style={styles.empty}>Every approved member is already in the stream queue.</Text>
                  ) : (
                    availableBroadcasters.map((user) => (
                      <View key={user.id} style={styles.card}>
                        <Text style={styles.name}>{user.username || "Guest"}</Text>
                        <TouchableOpacity
                          style={styles.purplePillButton}
                          disabled={Boolean(streamQueueBusyUserId)}
                          onPress={() => void approveStreamQueueEntry(user.user_id)}
                        >
                          <Text style={styles.buttonText}>
                            {streamQueueBusyUserId === user.user_id ? "Approving..." : "Approve Stream"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </View>
                <View style={styles.settingsDivider} />
                <RoomDescriptionEditor roomId={room.id} embedded />
                <View style={styles.settingsDivider} />
                  </>
                )}
                <View style={styles.settingsSubsection}>
                  <Text style={styles.name}>Guest access</Text>
                  <Text style={styles.meta}>
                    This room is currently {room.is_private ? "private" : "public"}.
                  </Text>
                  {isHost && (
                    <TouchableOpacity style={styles.privacyButton} onPress={toggleRoomPrivacy}>
                      <Text style={styles.buttonText}>
                        {room.is_private ? "Make Room Public" : "Make Room Private"}
                      </Text>
                    </TouchableOpacity>
                  )}

                  <Text style={styles.broadcastQueueHeading}>Entry queue · {queue.length}</Text>
                  {queue.length === 0 ? (
                    <Text style={styles.empty}>No one is waiting for room access.</Text>
                  ) : (
                    queue.map((user, index) => (
                      <View key={user.id} style={styles.card}>
                        <Text style={styles.rank}>#{index + 1}</Text>
                        <Text style={styles.name}>{user.username || "Guest"}</Text>
                        <Text style={styles.meta}>Queue score: {user.queue_score ?? 50}</Text>
                        <View style={styles.actions}>
                          <TouchableOpacity style={styles.acceptButton} onPress={() => acceptUser(user)}>
                            <Text style={styles.buttonText}>Accept</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.rejectButton} onPress={() => rejectUser(user)}>
                            <Text style={styles.buttonText}>Reject</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))
                  )}
                </View>
                {isHost && (
                  <>
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
                  </>
                )}
              </SettingsGroup>

              <SettingsGroup
                title="Engagement"
                subtitle="Announcements and activities for everyone in the room."
                expanded={openSettingsGroup === "engagement"}
                onToggle={() => toggleSettingsGroup("engagement")}
              >
                {isHost ? (
                  <>
                    <RoomAnnouncementEditor roomId={room.id} />
                    <WildHostManager roomId={room.id} />
                    <LightningTriviaManager roomId={room.id} />
                    <RoomMissionManager roomId={room.id} isHost />
                  </>
                ) : (
                  <RoomMissionManager roomId={room.id} isHost={false} />
                )}
              </SettingsGroup>

              <SettingsGroup
                title="Safety & access"
                subtitle="Bouncers, participant controls, chat safety, and cleanup."
                expanded={openSettingsGroup === "moderation"}
                onToggle={() => toggleSettingsGroup("moderation")}
              >
                <View style={styles.settingsSubsection}>
                  <Text style={styles.settingsEyebrow}>BOUNCERS</Text>
                  {bouncers.length === 0 ? (
                    <Text style={styles.empty}>No bouncers assigned.</Text>
                  ) : (
                    bouncers.map((user) => (
                      <View key={user.id} style={styles.card}>
                        <Text style={styles.name}>{user.username || "Guest"}</Text>
                        <Text style={styles.meta}>Can help manage room access and participants</Text>
                      </View>
                    ))
                  )}

                  {isHost && (
                    <>
                      <Text style={styles.broadcastQueueHeading}>Manage bouncers</Text>
                      {participants
                        .filter((user) => user.user_id !== room.host_id)
                        .map((user) => (
                          <View key={user.id} style={styles.card}>
                            <Text style={styles.name}>{user.username || "Guest"}</Text>
                            <TouchableOpacity style={styles.acceptButton} onPress={() => toggleBouncer(user)}>
                              <Text style={styles.buttonText}>
                                {user.room_role === "bouncer" ? "Remove Bouncer" : "Make Bouncer"}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                    </>
                  )}
                </View>

                <View style={styles.settingsDivider} />
                <View style={styles.settingsSubsection}>
                  <Text style={styles.settingsEyebrow}>PEOPLE INSIDE</Text>
                  {participants.length === 0 ? (
                    <Text style={styles.empty}>No one is inside yet.</Text>
                  ) : (
                    participants.map((user) => (
                      <View key={user.id} style={styles.card}>
                        <Text style={styles.name}>{user.username || "Guest"}</Text>
                        <Text style={styles.meta}>
                          {user.user_id === room.host_id
                            ? "Host"
                            : user.room_role === "bouncer" || user.room_role === "admin"
                              ? "Bouncer"
                              : "Guest"}
                          {user.is_muted ? " · Muted" : ""}
                        </Text>

                        {user.user_id !== room.host_id && user.user_id !== currentUserId && (
                          <View style={styles.actions}>
                            <TouchableOpacity style={styles.rejectButton} onPress={() => toggleMute(user)}>
                              <Text style={styles.buttonText}>{user.is_muted ? "Unmute" : "Mute"}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.repButton}
                              disabled={Boolean(user.reputation_given)}
                              onPress={() => giveReputation(user.user_id)}
                            >
                              <Text style={styles.buttonText}>
                                {user.reputation_given ? "Rep Given" : "Give +2 Rep"}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.kickButton} onPress={() => kickUser(user)}>
                              <Text style={styles.buttonText}>Kick</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    ))
                  )}
                </View>

                {isHost && (
                  <>
                    <View style={styles.settingsDivider} />
                    <RoomChatModerationSettings roomId={room.id} />
                    <ClearRoomParticipantsCard
                      hostId={room.host_id}
                      onCleared={loadAll}
                      roomId={room.id}
                    />
                  </>
                )}
              </SettingsGroup>

              <SettingsGroup
                title="Event lifecycle"
                subtitle="End the event, leave a recap note, or permanently delete it."
                expanded={openSettingsGroup === "closeout"}
                onToggle={() => toggleSettingsGroup("closeout")}
              >
                {isHost ? (
                  <>
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
                    <RecapMediaManager embedded roomId={room.id} />
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
                  </>
                ) : (
                  <View style={styles.settingsSubsection}>
                    <Text style={styles.name}>Host-only controls</Text>
                    <Text style={styles.meta}>Only the room host can end or delete this event.</Text>
                  </View>
                )}
              </SettingsGroup>
      
       <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace(`/room/${room.id}`)}>
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
  broadcastQueueHeading: {
    color: "#C4B5FD",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginBottom: 12,
    marginTop: 22,
    textTransform: "uppercase",
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
    alignSelf: "center",
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 14,
    maxWidth: 320,
    minHeight: 48,
    paddingHorizontal: 18,
    width: "100%",
  },
  secondaryPillButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderColor: "rgba(196,181,253,0.45)",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 14,
    maxWidth: 320,
    minHeight: 48,
    paddingHorizontal: 18,
    width: "100%",
  },
  secondaryPillText: {
    color: "#E9D5FF",
    fontWeight: "900",
    textAlign: "center",
  },
  compactControlButton: {
    flexGrow: 1,
    marginTop: 0,
    minWidth: 120,
    width: "auto",
  },
  inlineActions: {
    alignItems: "center",
    alignSelf: "center",
    gap: 10,
    maxWidth: 320,
    width: "100%",
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
  posterActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    marginTop: 14,
    width: "100%",
  },
  posterActionButton: {
    flex: 1,
    marginTop: 0,
    minWidth: 0,
    paddingHorizontal: 10,
    width: "auto",
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
    alignSelf: "center",
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 14,
    maxWidth: 320,
    minHeight: 48,
    paddingHorizontal: 18,
    width: "100%",
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
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    marginTop: 14,
  },

  acceptButton: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
    borderRadius: 999,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 120,
    paddingHorizontal: 16,
  },

  rejectButton: {
    alignItems: "center",
    backgroundColor: "#2A2A35",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 120,
    paddingHorizontal: 16,
  },

  kickButton: {
    alignItems: "center",
    backgroundColor: "#7F1D1D",
    borderColor: "rgba(248,113,113,0.5)",
    borderRadius: 999,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 120,
    paddingHorizontal: 16,
  },

  privacyButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 18,
    maxWidth: 320,
    minHeight: 48,
    paddingHorizontal: 18,
    width: "100%",
  },
  obsButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 14,
    maxWidth: 320,
    minHeight: 48,
    paddingHorizontal: 18,
    width: "100%",
  },
  
  deleteButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#7F1D1D",
    borderColor: "rgba(248,113,113,0.5)",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 20,
    maxWidth: 320,
    minHeight: 48,
    paddingHorizontal: 18,
    width: "100%",
  },

  buttonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.15,
    textAlign: "center",
  },
  repButton: {
    alignItems: "center",
    backgroundColor: "#15803D",
    borderColor: "rgba(74,222,128,0.55)",
    borderRadius: 999,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 120,
    paddingHorizontal: 16,
  },
});
