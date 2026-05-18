import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../../lib/supabase";

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
};

type QueueUser = {
  id: string;
  event_room_id: string;
  user_id: string;
  username?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  status: string;
  created_at: string;
  profile: Profile | null;
};

type Participant = QueueUser;

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
  user_id: string;
  display_name: string | null;
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

function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

export default function RoomScreen() {
  const { id } = useLocalSearchParams();
  const roomId = String(id);

  const [room, setRoom] = useState<Room | null>(null);
  const [queue, setQueue] = useState<QueueUser[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [myQueueStatus, setMyQueueStatus] = useState<string | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);

  useEffect(() => {
  loadAll();

  const channel = supabase
    .channel(`room-${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "event_attendees",
        filter: `event_room_id=eq.${roomId}`,
      },
      () => {
        loadQueue();
        loadParticipants();
        loadRoom();
      }
    )
    .on(
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
    )
    .on(
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
    )
    .on(
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
    )
    .subscribe();

  const typingInterval = setInterval(() => {
    loadTypingUsers();
  }, 1000);

  return () => {
    clearInterval(typingInterval);
    supabase.removeChannel(channel);
  };
}, []);

  async function loadAll() {
  await updatePresence();
  await loadRoom();
  await loadQueue();
  await loadParticipants();
  await loadMessages();
  await loadPresence();
  await loadTypingUsers();
}

  async function loadRoom() {
    const { data, error } = await supabase
      .from("event_rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (error) {
      window.alert(error.message);
      return;
    }

    setRoom(data);
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

    setMessages(data || []);
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
      await supabase
        .from("event_rooms")
        .update({
          queue_count: Math.max(room.queue_count - 1, 0),
          current_users: room.current_users + 1,
        })
        .eq("id", room.id);
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

  async function deleteRoom() {
  if (!room) return;

  const confirmed = window.confirm(
    "Delete this room?"
  );

  if (!confirmed) return;

  const { error } = await supabase
    .from("event_rooms")
    .delete()
    .eq("id", room.id);

  if (error) {
    window.alert(error.message);
    return;
  }

  router.replace("/home");
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

    const { data: profile } = await supabase
  .from("profiles")
  .select("username")
  .eq("id", user.id)
  .maybeSingle();

const { error } = await supabase.from("room_messages").insert({
  room_id: roomId,
  user_id: user.id,
  display_name:
    profile?.username || `Guest ${user.id.slice(0, 4)}`,
  message: messageText.trim(),
});

    if (error) {
      window.alert(error.message);
      return;
    }

    setMessageText("");
    loadMessages();
  }

  async function updatePresence() {
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

  await supabase.from("room_presence").upsert({
    room_id: roomId,
    user_id: user.id,
    username: profile?.username || `Guest ${user.id.slice(0, 4)}`,
    last_seen: new Date().toISOString(),
  });
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




  if (!room) {
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.loading}>Loading room...</Text>
    </ScrollView>
  );
}

const isHost = currentUserId === room.host_id;

return (
  <ScrollView
    style={styles.page}
    contentContainerStyle={styles.container}
  >
    <TouchableOpacity onPress={() => router.replace("/home")}>
      <Text style={styles.back}>← Back</Text>
    </TouchableOpacity>

    <Text style={styles.title}>{room.title}</Text>

    <View style={styles.roomTagsRow}>
      {room.type && (
        <Text style={styles.roomTag}>{room.type.replace("_", " ")}</Text>
      )}
      {room.mode && <Text style={styles.roomTag}>{room.mode.toUpperCase()}</Text>}
      {room.status && <Text style={styles.roomTag}>{room.status}</Text>}
    </View>

    <Text style={styles.meta}>
      {room.current_users} inside • {room.queue_count} waiting
    </Text>

    <Text style={styles.presenceText}>
      {presenceUsers.length} online now
    </Text>

    <TouchableOpacity
      style={styles.deleteRoomButton}
      onPress={deleteRoom}
    >
      <Text style={styles.actionText}>Delete Room</Text>
    </TouchableOpacity>

    <View style={styles.participantsBox}>
      <Text style={styles.participantsTitle}>
        Inside the Room
      </Text>

      {participants.length === 0 ? (
        <Text style={styles.empty}>
          No one inside yet.
        </Text>
      ) : (
        participants.map((person) => {
          const participantName = getDisplayName(person);

          return (
            <View
              key={person.id}
              style={styles.participantCard}
            >
              <Text style={styles.userText} numberOfLines={1}>
                {participantName}
              </Text>

              {isHost && (
                <TouchableOpacity
                  style={styles.kickButton}
                  onPress={() => kickUser(person)}
                >
                  <Text style={styles.actionText}>
                    Kick
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}
    </View>

    <View style={styles.chatBox}>
      <Text style={styles.participantsTitle}>
        Room Chat
      </Text>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.messageCard}>
            <Text style={styles.messageUser}>
              {item.display_name ||
                `Guest ${item.user_id.slice(0, 4)}`}
            </Text>

            <Text style={styles.messageText}>
              {item.message}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No messages yet.
          </Text>
        }
      />

      {typingUsers.length > 0 && (
  <Text style={styles.typingText}>
    {typingUsers.length === 1
      ? `${typingUsers[0].username || "Someone"} is typing...`
      : `${typingUsers.length} people are typing...`}
  </Text>
)}

        <View style={styles.messageInputRow}>
        <TextInput
          value={messageText}
          onChangeText={(text) => {
            setMessageText(text);

            if (text.trim()) {
              updateTyping();
            }
          }}
          placeholder="Say something..."
          placeholderTextColor="#777"
          style={styles.messageInput}
        />

        <TouchableOpacity
          style={styles.sendButton}
          onPress={sendMessage}
        >
          <Text style={styles.actionText}>
            Send
          </Text>
        </TouchableOpacity>
      </View>
    </View>

    {isHost ? (
      <>
        <Text style={styles.sectionTitle}>
          Host Dashboard
        </Text>

        <Text style={styles.subtitle}>
          Pick who gets into the room.
        </Text>

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
                    <Image
                      source={{ uri: avatarUrl }}
                      style={styles.avatar}
                    />
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

                    <Text style={styles.bioText} numberOfLines={3}>
                      {getBio(item)}
                    </Text>
                  </View>
                </View>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.acceptButton}
                  onPress={() => acceptUser(item)}
                >
                  <Text style={styles.actionText}>
                    Accept
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.rejectButton}
                  onPress={() => rejectUser(item)}
                >
                  <Text style={styles.actionText}>
                    Reject
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No one is waiting yet.
            </Text>
          }
        />
      </>
    ) : (
      <>
        <Text style={styles.sectionTitle}>
          {myQueueStatus === "accepted"
            ? "You’re in."
            : myQueueStatus === "rejected"
            ? "Rejected."
            : myQueueStatus === "kicked"
            ? "Kicked."
            : "You’re in the lobby"}
        </Text>

        <Text style={styles.subtitle}>
          {myQueueStatus === "accepted"
            ? "Welcome inside the room."
            : myQueueStatus === "rejected"
            ? "The host passed this time."
            : myQueueStatus === "kicked"
            ? "The host removed you from the room."
            : "The host controls who gets in."}
        </Text>
      </>
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
    backgroundColor: "#050509",
    padding: 24,
    paddingTop: 70,
  },
  loading: {
    color: "white",
  },
  back: {
    color: "#A78BFA",
    marginBottom: 22,
    fontWeight: "700",
  },
  title: {
    color: "white",
    fontSize: 34,
    fontWeight: "900",
  },
  meta: {
    color: "#aaa",
    marginTop: 8,
    marginBottom: 30,
  },
  roomTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
  },
  roomTag: {
    color: "#E9D5FF",
    backgroundColor: "rgba(124,58,237,0.18)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "700",
  },
  sectionTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 6,
  },
  subtitle: {
    color: "#888",
    marginBottom: 20,
  },
  participantsBox: {
    backgroundColor: "#11111A",
    borderColor: "#2A2140",
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
  },
  participantsTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 12,
  },
  participantCard: {
    backgroundColor: "#08080D",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  queueCard: {
    backgroundColor: "#14141F",
    borderColor: "#332855",
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 4,
  },
  userText: {
    color: "white",
    fontWeight: "800",
    marginBottom: 0,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
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
  kickButton: {
    backgroundColor: "#2A2A35",
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
    marginTop: 10,
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
  chatBox: {
    backgroundColor: "#11111A",
    borderColor: "#2A2140",
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
  },
  messageCard: {
    backgroundColor: "#08080D",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  messageUser: {
    color: "#A78BFA",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
  },
  messageText: {
    color: "white",
  },
  messageInputRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  messageInput: {
    flex: 1,
    color: "white",
    backgroundColor: "#08080D",
    borderRadius: 14,
    padding: 12,
  },
  sendButton: {
    backgroundColor: "#7C3AED",
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteRoomButton: {
  backgroundColor: "#3A1111",
  paddingVertical: 12,
  borderRadius: 999,
  alignItems: "center",
  marginBottom: 24,
},
presenceText: {
  color: "#A78BFA",
  marginBottom: 20,
  fontWeight: "800",
},
typingText: {
  color: "#A78BFA",
  marginTop: 6,
  marginBottom: 8,
  fontStyle: "italic",
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
});
