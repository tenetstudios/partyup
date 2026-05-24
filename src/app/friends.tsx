import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";

type FriendRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "blocked";
  created_at: string;
};

type FriendProfile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

type RoomInviteRow = {
  id: string;
  room_id: string;
  sender_id: string;
  recipient_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
};

export default function FriendsScreen() {
  const [userId, setUserId] = useState("");
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRow[]>([]);
  const [sent, setSent] = useState<FriendRow[]>([]);
  const [searchUsername, setSearchUsername] = useState("");
  const [searchResults, setSearchResults] = useState<FriendProfile[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, FriendProfile>>({});
  const [invites, setInvites] = useState<RoomInviteRow[]>([]);
  const [inviteSenders, setInviteSenders] = useState<Record<string, FriendProfile>>({});
  const [inviteRooms, setInviteRooms] = useState<Record<string, string>>({});

  useEffect(() => {
    loadFriends();
  }, []);

  async function loadFriends() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) return;

    setUserId(user.id);

    const { data, error } = await supabase
      .from("friendships")
      .select("*")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    if (error) {
      window.alert(error.message);
      return;
    }

    const rows = (data || []) as FriendRow[];

    const allUserIds = Array.from(
      new Set(rows.flatMap((row) => [row.requester_id, row.addressee_id]))
    );

    if (allUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", allUserIds);

      const map: Record<string, FriendProfile> = {};

      (profiles || []).forEach((profile) => {
        map[profile.id] = profile as FriendProfile;
      });

      setProfileMap(map);
    }

    const { data: inviteData, error: inviteError } = await supabase
      .from("room_invites")
      .select("id, room_id, sender_id, recipient_id, status, created_at")
      .eq("recipient_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    const inviteRows = (inviteData || []) as RoomInviteRow[];
    setInvites(inviteRows);

    if (inviteError) {
      window.alert(inviteError.message);
    } else {
      const senderIds = Array.from(new Set(inviteRows.map((invite) => invite.sender_id)));
      const roomIds = Array.from(new Set(inviteRows.map((invite) => invite.room_id)));

      if (senderIds.length > 0) {
        const { data: senderProfiles, error: senderError } = await supabase
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", senderIds);

        if (!senderError) {
          const senderMap: Record<string, FriendProfile> = {};
          (senderProfiles || []).forEach((profile) => {
            senderMap[profile.id] = profile as FriendProfile;
          });
          setInviteSenders(senderMap);
        }
      }

      if (roomIds.length > 0) {
        const { data: rooms, error: roomError } = await supabase
          .from("event_rooms")
          .select("id, title")
          .in("id", roomIds);

        if (!roomError) {
          const roomMap: Record<string, string> = {};
          (rooms || []).forEach((room) => {
            roomMap[room.id] = room.title || "Untitled room";
          });
          setInviteRooms(roomMap);
        }
      }
    }

    setFriends(rows.filter((row) => row.status === "accepted"));
    setIncoming(
      rows.filter((row) => row.status === "pending" && row.addressee_id === user.id)
    );
    setSent(
      rows.filter((row) => row.status === "pending" && row.requester_id === user.id)
    );
  }

  function getUserName(id: string) {
    return profileMap[id]?.username || `Guest ${id.slice(0, 4)}`;
  }

  function getInviteSenderName(id: string) {
    return inviteSenders[id]?.username || `Guest ${id.slice(0, 4)}`;
  }

  function getInviteRoomTitle(id: string) {
    return inviteRooms[id] || "Untitled room";
  }

  function getOtherUser(row: FriendRow) {
    return row.requester_id === userId ? row.addressee_id : row.requester_id;
  }

  async function acceptInvite(invite: RoomInviteRow) {
    const { error } = await supabase
      .from("room_invites")
      .update({ status: "accepted" })
      .eq("id", invite.id);

    if (error) {
      window.alert(error.message);
      return;
    }

    router.push(`/room/${invite.room_id}`);
  }

  async function declineInvite(invite: RoomInviteRow) {
    const { error } = await supabase
      .from("room_invites")
      .update({ status: "declined" })
      .eq("id", invite.id);

    if (error) {
      window.alert(error.message);
      return;
    }

    loadFriends();
  }

  async function searchUsers() {
    if (!searchUsername.trim()) return;

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .ilike("username", `%${searchUsername.trim()}%`)
      .limit(10);

    if (error) {
      window.alert(error.message);
      return;
    }

    setSearchResults(
      ((data || []) as FriendProfile[]).filter((profile) => profile.id !== user?.id)
    );
  }

  async function addFriend(targetUserId: string) {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) return;

    const { error } = await supabase.from("friendships").upsert(
      {
        requester_id: user.id,
        addressee_id: targetUserId,
        status: "pending",
      },
      {
        onConflict: "requester_id,addressee_id",
      }
    );

    if (error) {
      window.alert(error.message);
      return;
    }
    await supabase.from("notifications").insert({
  user_id: targetUserId,
  type: "friend_request",
  title: "New friend request",
  body: "Someone sent you a friend request.",
  actor_id: user.id,
});

    window.alert("Friend request sent.");
    setSearchUsername("");
    setSearchResults([]);
    loadFriends();
  }

  async function acceptFriend(row: FriendRow) {
    const { error } = await supabase
      .from("friendships")
      .update({ status: "accepted" })
      .eq("id", row.id);

    if (error) {
      window.alert(error.message);
      return;
    }

    loadFriends();
  }

async function declineFriend(row: FriendRow) {
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("id", row.id);

  if (error) {
    window.alert(error.message);
    return;
  }

  loadFriends();
}

  async function removeFriend(row: FriendRow) {
    const { error } = await supabase
      .from("friendships")
      .delete()
      .eq("id", row.id);

    if (error) {
      window.alert(error.message);
      return;
    }

    loadFriends();
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Friends</Text>
      <Text style={styles.subtitle}>
        Your PartyUp circle. Add invites and friend activity later.
      </Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Add Friend</Text>

        <TextInput
          value={searchUsername}
          onChangeText={setSearchUsername}
          placeholder="Search username..."
          placeholderTextColor="#777"
          style={styles.input}
        />

        <TouchableOpacity style={styles.acceptButton} onPress={searchUsers}>
          <Text style={styles.buttonText}>Search</Text>
        </TouchableOpacity>

        {searchResults.map((profile) => (
          <View key={profile.id} style={styles.row}>
            <View>
              <Text style={styles.name}>
                {profile.username || `Guest ${profile.id.slice(0, 4)}`}
              </Text>
              <Text style={styles.meta}>PartyUp user</Text>
            </View>

            <TouchableOpacity
              style={styles.acceptButton}
              onPress={() => addFriend(profile.id)}
            >
              <Text style={styles.buttonText}>Add</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Incoming Requests</Text>

        {incoming.length === 0 ? (
          <Text style={styles.empty}>No incoming requests.</Text>
        ) : (
          incoming.map((row) => (
            <View key={row.id} style={styles.row}>
              <View>
                <Text style={styles.name}>{getUserName(row.requester_id)}</Text>
                <Text style={styles.meta}>Wants to be friends</Text>
              </View>

              <View style={styles.requestActions}>
                <TouchableOpacity
                  style={styles.acceptButton}
                  onPress={() => acceptFriend(row)}
                >
                  <Text style={styles.buttonText}>Accept</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => declineFriend(row)}
                >
                  <Text style={styles.buttonText}>Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Invites</Text>

        {invites.length === 0 ? (
          <Text style={styles.empty}>No invites.</Text>
        ) : (
          invites.map((invite) => (
            <View key={invite.id} style={styles.row}>
              <View>
                <Text style={styles.name}>{getInviteSenderName(invite.sender_id)}</Text>
                <Text style={styles.meta}>
                  Invited you to {getInviteRoomTitle(invite.room_id)}
                </Text>
              </View>

              <View style={styles.requestActions}>
                <TouchableOpacity
                  style={styles.acceptButton}
                  onPress={() => acceptInvite(invite)}
                >
                  <Text style={styles.buttonText}>Accept</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => declineInvite(invite)}
                >
                  <Text style={styles.buttonText}>Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Friends</Text>

        {friends.length === 0 ? (
          <Text style={styles.empty}>No friends yet.</Text>
        ) : (
          friends.map((row) => {
            const otherUserId = getOtherUser(row);

            return (
              <View key={row.id} style={styles.row}>
                <View>
                  <Text style={styles.name}>{getUserName(otherUserId)}</Text>
                  <Text style={styles.meta}>Friend</Text>
                </View>

                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => removeFriend(row)}
                >
                  <Text style={styles.buttonText}>Remove</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Sent Requests</Text>

        {sent.length === 0 ? (
          <Text style={styles.empty}>No sent requests.</Text>
        ) : (
          sent.map((row) => (
            <View key={row.id} style={styles.row}>
              <View>
                <Text style={styles.name}>{getUserName(row.addressee_id)}</Text>
                <Text style={styles.meta}>Pending</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#050509" },
  container: { padding: 24, paddingTop: 70 },
  back: { color: "#A78BFA", fontWeight: "800", marginBottom: 24 },
  title: { color: "white", fontSize: 42, fontWeight: "900" },
  subtitle: {
    color: "#A7A1B4",
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 22,
  },
  card: {
    backgroundColor: "#11101B",
    borderColor: "#2A2440",
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    marginBottom: 18,
  },
  sectionTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 14,
  },
  empty: { color: "#777" },
  row: {
    backgroundColor: "#08080D",
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  name: { color: "white", fontWeight: "900", fontSize: 16 },
  meta: { color: "#A78BFA", marginTop: 4, fontSize: 12 },
  acceptButton: {
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  removeButton: {
    backgroundColor: "#2A2A35",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: { color: "white", fontWeight: "800" },
  input: {
    backgroundColor: "#08080D",
    borderColor: "#2A2440",
    borderWidth: 1,
    borderRadius: 16,
    color: "#FFFFFF",
    padding: 14,
    marginBottom: 12,
  },
  requestActions: {
  flexDirection: "row",
  gap: 8,
},
});