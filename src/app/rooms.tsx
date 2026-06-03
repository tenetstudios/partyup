import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";

type Room = {
  id: string;
  title: string;
  host_id: string;
  current_users: number;
  queue_count: number;
  max_users: number;
  type?: string;
  mode?: string;
  status?: string;
  venue_name?: string | null;
};

export default function RoomsScreen() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [userId, setUserId] = useState("");

  useEffect(() => {
    loadRooms();
  }, []);

  async function loadRooms() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) return;

    setUserId(user.id);

    const { data, error } = await supabase
      .from("event_rooms")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return;

    setRooms(data || []);
  }

  const myRooms = useMemo(
    () => rooms.filter((room) => room.host_id === userId),
    [rooms, userId]
  );

  const followingRooms = useMemo(
    () => rooms.filter((room) => room.status === "live" && room.host_id !== userId),
    [rooms, userId]
  );

  const recentRooms = useMemo(
    () => rooms.filter((room) => room.host_id !== userId).slice(0, 4),
    [rooms, userId]
  );

  function RoomCard({ room, label }: { room: Room; label?: string }) {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/room/${room.id}`)}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {room.title}
          </Text>

          <View style={styles.livePill}>
            <Text style={styles.livePillText}>
              {room.status === "live" ? "LIVE" : room.status || "ROOM"}
            </Text>
          </View>
        </View>

        <Text style={styles.cardMeta}>
          {room.type?.replace("_", " ") || "Room"} • {room.mode || "Live"}{" "}
          {room.venue_name ? `• ${room.venue_name}` : ""}
        </Text>

        <View style={styles.statRow}>
          <Text style={styles.statText}>
            {room.current_users}/{room.max_users} inside
          </Text>

          <Text style={styles.statText}>
            {room.queue_count} waiting
          </Text>
        </View>

        {label && <Text style={styles.cardLabel}>{label}</Text>}
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <TouchableOpacity onPress={() => router.push("/home")}>
        <Text style={styles.back}>← Home</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Rooms</Text>
      <Text style={styles.subtitle}>
        Follow rooms, manage your spaces, and rejoin active communities.
      </Text>

      <TouchableOpacity style={styles.createButton} onPress={() => router.push("/home")}>
        <Text style={styles.createButtonText}>+ Create Room from Home</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Following</Text>
      {followingRooms.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No followed rooms yet</Text>
          <Text style={styles.emptyText}>
            Follow recurring scenes like Late Night Debate, Toronto Rooftops, or GymBuddy Live.
          </Text>
        </View>
      ) : (
        followingRooms.map((room) => (
          <RoomCard key={room.id} room={room} label="Following room" />
        ))
      )}

      <Text style={styles.sectionTitle}>Your Rooms</Text>
      {myRooms.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>You are not hosting yet</Text>
          <Text style={styles.emptyText}>
            Create a room and build a repeatable scene people can come back to.
          </Text>
        </View>
      ) : (
        myRooms.map((room) => (
          <RoomCard key={room.id} room={room} label="You host this room" />
        ))
      )}

      <Text style={styles.sectionTitle}>Recently Active</Text>
      {recentRooms.map((room) => (
        <RoomCard key={room.id} room={room} />
      ))}
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
  createButton: {
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 28,
  },
  createButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 14,
    marginTop: 10,
  },
  card: {
    backgroundColor: "#10101A",
    borderColor: "#242033",
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  cardTitle: {
    color: "#FFFFFF",
    flex: 1,
    fontSize: 18,
    fontWeight: "900",
  },
  livePill: {
    backgroundColor: "rgba(255, 82, 146, 0.2)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  livePillText: {
    color: "#F9A8D4",
    fontSize: 11,
    fontWeight: "900",
  },
  cardMeta: {
    color: "#B8B2C8",
    fontSize: 13,
    lineHeight: 19,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    gap: 10,
  },
  statText: {
    color: "#D8B4FE",
    fontSize: 13,
    fontWeight: "800",
  },
  cardLabel: {
    color: "#7C7A86",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 12,
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