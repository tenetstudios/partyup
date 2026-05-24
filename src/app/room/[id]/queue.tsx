import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../../../lib/supabase";

type Tab = "queue" | "inside" | "streams" | "bouncers" | "settings";

type Room = {
  id: string;
  title: string;
  host_id: string;
  current_users: number;
  queue_count: number;
  max_users: number;
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

async function deleteRoom() {
  if (!room || !isHost) return;

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

  const streamRequests = [...queue, ...participants].filter(
    (user) => user.stream_status === "requested"
  );

  const bouncers = participants.filter(
    (user) => user.room_role === "bouncer" || user.room_role === "admin"
  );

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>

      <Text style={styles.heading}>Manage Room</Text>
      <Text style={styles.subheading}>{room.title}</Text>

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
                  ? "Streams"
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
          <Text style={styles.sectionTitle}>Waiting Queue</Text>

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

          <View style={styles.card}>
            <Text style={styles.name}>Capacity</Text>
            <Text style={styles.meta}>
              {room.current_users}/{room.max_users} inside
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.name}>Queue</Text>
            <Text style={styles.meta}>{queue.length} waiting</Text>
          </View>

          {isHost && (
  <>
    <TouchableOpacity
      style={styles.privacyButton}
      onPress={toggleRoomPrivacy}
    >
      <Text style={styles.buttonText}>
        {room.is_private
          ? "Make Room Public"
          : "Make Room Private"}
      </Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={styles.deleteButton}
      onPress={deleteRoom}
    >
      <Text style={styles.buttonText}>
        Delete Room
      </Text>
    </TouchableOpacity>
  </>
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

  card: {
    backgroundColor: "#11101B",
    borderRadius: 24,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.18)",
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
  backgroundColor: "#2563EB",
  borderRadius: 999,
  paddingVertical: 16,
  alignItems: "center",
  marginTop: 20,
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