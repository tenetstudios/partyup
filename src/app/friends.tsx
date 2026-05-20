import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
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

export default function FriendsScreen() {
  const [userId, setUserId] = useState("");
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRow[]>([]);
  const [sent, setSent] = useState<FriendRow[]>([]);

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

    setFriends(rows.filter((row) => row.status === "accepted"));
    setIncoming(
      rows.filter(
        (row) => row.status === "pending" && row.addressee_id === user.id
      )
    );
    setSent(
      rows.filter(
        (row) => row.status === "pending" && row.requester_id === user.id
      )
    );
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

  function getOtherUser(row: FriendRow) {
    return row.requester_id === userId ? row.addressee_id : row.requester_id;
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
        <Text style={styles.sectionTitle}>Incoming Requests</Text>

        {incoming.length === 0 ? (
          <Text style={styles.empty}>No incoming requests.</Text>
        ) : (
          incoming.map((row) => (
            <View key={row.id} style={styles.row}>
              <View>
                <Text style={styles.name}>Guest {row.requester_id.slice(0, 4)}</Text>
                <Text style={styles.meta}>Wants to be friends</Text>
              </View>

              <TouchableOpacity
                style={styles.acceptButton}
                onPress={() => acceptFriend(row)}
              >
                <Text style={styles.buttonText}>Accept</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Friends</Text>

        {friends.length === 0 ? (
          <Text style={styles.empty}>No friends yet.</Text>
        ) : (
          friends.map((row) => (
            <View key={row.id} style={styles.row}>
              <View>
                <Text style={styles.name}>Guest {getOtherUser(row).slice(0, 4)}</Text>
                <Text style={styles.meta}>Friend</Text>
              </View>

              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => removeFriend(row)}
              >
                <Text style={styles.buttonText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))
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
                <Text style={styles.name}>Guest {row.addressee_id.slice(0, 4)}</Text>
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
  page: {
    flex: 1,
    backgroundColor: "#050509",
  },
  container: {
    padding: 24,
    paddingTop: 70,
  },
  back: {
    color: "#A78BFA",
    fontWeight: "800",
    marginBottom: 24,
  },
  title: {
    color: "white",
    fontSize: 42,
    fontWeight: "900",
  },
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
  empty: {
    color: "#777",
  },
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
  name: {
    color: "white",
    fontWeight: "900",
    fontSize: 16,
  },
  meta: {
    color: "#A78BFA",
    marginTop: 4,
    fontSize: 12,
  },
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
  buttonText: {
    color: "white",
    fontWeight: "800",
  },
});