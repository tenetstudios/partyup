import { Image } from "expo-image";
import { router } from "expo-router";
import type { AndroidSymbol, SFSymbol, SymbolViewProps } from "expo-symbols";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  ImageBackground,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

type RoomType = "party" | "concert" | "dj_set" | "popup" | "sports" | "watch_party";
type RoomMode = "irl" | "livestream" | "hybrid";
type RoomStatusType = "scheduled" | "live" | "ended";

type Room = {
  id: string;
  title: string;
  host_id: string;
  current_users: number;
  queue_count: number;
  max_users: number;
  is_private: boolean;
  type?: RoomType;
  mode?: RoomMode;
  status?: RoomStatusType;
  venue_name?: string;
  distance_km?: number;
  latitude?: number;
  longitude?: number;
};

type Profile = {
  username: string | null;
  avatar_url: string | null;
};

type RoomStatus = {
  label: string;
  tone: "open" | "trending" | "full";
};

type SymbolName = SymbolViewProps["name"];

const makeIcon = (ios: SFSymbol, android: AndroidSymbol): SymbolName => ({
  ios,
  android,
  web: android,
});

const ICONS = {
  bell: makeIcon("bell", "notifications"),
  bolt: makeIcon("bolt", "bolt"),
  checkmark: makeIcon("checkmark", "check"),
  chevronRight: makeIcon("chevron.right", "chevron_right"),
  crown: makeIcon("crown", "crown"),
  flame: makeIcon("flame", "local_fire_department"),
  flameFill: makeIcon("flame.fill", "local_fire_department"),
  heart: makeIcon("heart", "favorite_border"),
  houseFill: makeIcon("house.fill", "house"),
  lockFill: makeIcon("lock.fill", "lock"),
  magnifyingglass: makeIcon("magnifyingglass", "search"),
  moon: makeIcon("moon", "moon_stars"),
  musicNote: makeIcon("music.note", "music_note"),
  person: makeIcon("person", "person"),
  person2: makeIcon("person.2", "groups"),
  person2Fill: makeIcon("person.2.fill", "groups"),
  personQueue: makeIcon("person.crop.circle.badge.plus", "person_add"),
  plus: makeIcon("plus", "add"),
  quoteBubble: makeIcon("quote.bubble", "format_quote"),
  sliders: makeIcon("slider.horizontal.3", "sliders"),
  sparkles: makeIcon("sparkles", "auto_awesome"),
  stack: makeIcon("square.stack.3d.up", "stacks"),
  waveform: makeIcon("waveform.path.ecg", "ecg_heart"),
  xmark: makeIcon("xmark", "close"),
} as const;

type IconName = keyof typeof ICONS;

const FILTERS = [
  { label: "All", icon: "sparkles" },
  { label: "Chill", icon: "heart" },
  { label: "Debate", icon: "quoteBubble" },
  { label: "Music", icon: "musicNote" },
  { label: "Late Night", icon: "moon" },
  { label: "VIP", icon: "crown" },
] as const;

const ROOM_TYPES: { value: RoomType; label: string }[] = [
  { value: "party", label: "Party" },
  { value: "concert", label: "Concert" },
  { value: "dj_set", label: "DJ Set" },
  { value: "popup", label: "Pop-Up" },
  { value: "sports", label: "Sports" },
  { value: "watch_party", label: "Watch Party" },
];

const ROOM_MODES: { value: RoomMode; label: string }[] = [
  { value: "irl", label: "IRL" },
  { value: "livestream", label: "Livestream" },
  { value: "hybrid", label: "Hybrid" },
];

const ROOM_STATUSES: { value: RoomStatusType; label: string }[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "live", label: "Live" },
  { value: "ended", label: "Ended" },
];

const VIBE_TAGS = [
  "Chill",
  "Deep Talk",
  "Good Vibes",
  "VIP",
  "Exclusive",
  "Upscale",
  "Debate",
  "Opinions",
  "No Filter",
  "Music",
  "Afrobeats",
  "Vibes",
];

const ROOM_BACKDROPS = [
  require("../../assets/images/logo-glow.png"),
  require("../../assets/images/android-icon-background.png"),
  require("../../assets/images/icon.png"),
];

function showAlert(message: string) {
  Alert.alert("PartyUp", message);
}

function getRoomScore(room: Room) {
  return `${room.title}${room.id}`
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);
}

function getRoomStatus(room: Room): RoomStatus {
  if (room.current_users >= room.max_users) {
    return { label: "FULL", tone: "full" };
  }

  if (room.queue_count >= 5 || room.current_users >= room.max_users - 1) {
    return { label: "TRENDING", tone: "trending" };
  }

  return { label: "OPEN", tone: "open" };
}

function getRoomVibes(room: Room) {
  const score = getRoomScore(room);
  const firstIndex = score % VIBE_TAGS.length;
  const secondIndex = (firstIndex + 3 + (room.queue_count % 3)) % VIBE_TAGS.length;
  const thirdIndex = (firstIndex + 7) % VIBE_TAGS.length;

  return Array.from(
    new Set([VIBE_TAGS[firstIndex], VIBE_TAGS[secondIndex], VIBE_TAGS[thirdIndex]])
  );
}

function getRoomBackdrop(room: Room) {
  return ROOM_BACKDROPS[getRoomScore(room) % ROOM_BACKDROPS.length];
}

function getGreetingName(profile: Profile | null) {
  const username = profile?.username?.trim();

  if (!username) return "Alex";

  return username.split(" ")[0];
}

function Icon({
  name,
  size = 20,
  color = "white",
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <SymbolView name={ICONS[name]} tintColor={color} size={size} />;
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [maxUsers, setMaxUsers] = useState("12");
  const [roomType, setRoomType] = useState<RoomType>("party");
  const [roomMode, setRoomMode] = useState<RoomMode>("livestream");
  const [roomStatus, setRoomStatus] = useState<RoomStatusType>("live");
  const [venueName, setVenueName] = useState("");
  const [distanceKm, setDistanceKm] = useState("1.2");
  const [selectedFilter, setSelectedFilter] = useState<(typeof FILTERS)[number]["label"]>("All");
  const [showCreateSheet, setShowCreateSheet] = useState(false);

  useEffect(() => {
    fetchRooms();
    fetchProfile();
  }, []);

  const filteredRooms = useMemo(() => {
    if (selectedFilter === "All") return rooms;

    return rooms.filter((room) => getRoomVibes(room).includes(selectedFilter));
  }, [rooms, selectedFilter]);

  const stats = useMemo(() => {
    const liveRooms = rooms.length;
    const peopleOnline = rooms.reduce((total, room) => total + room.current_users, 0);
    const trending = rooms.filter((room) => getRoomStatus(room).tone === "trending").length;
    const queue = rooms.reduce((total, room) => total + room.queue_count, 0);

    return [
      { label: "Live Rooms", value: liveRooms, icon: "person2" as IconName },
      { label: "People Online", value: peopleOnline, icon: "flame" as IconName },
      { label: "Trending", value: trending, icon: "bolt" as IconName },
      { label: "Your Queue", value: queue, icon: "personQueue" as IconName },
    ];
  }, [rooms]);

  async function fetchProfile() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) return;

    const { data } = await supabase
      .from("profiles")
      .select("username, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    setProfile(data || null);
  }

  async function fetchRooms() {
    const { data, error } = await supabase
      .from("event_rooms")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      showAlert(error.message);
      return;
    }

    setRooms(data || []);
  }

  async function createRoom() {
    if (!title.trim()) {
      showAlert("Enter a room name");
      return;
    }

    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      setLoading(false);
      showAlert("You need to sign in first.");
      return;
    }

    const { data: insertedRoom, error } = await supabase
      .from("event_rooms")
      .insert({
        title: title.trim(),
        host_id: user.id,
        current_users: 1,
        queue_count: 0,
        max_users: Number(maxUsers) || 12,
        is_private: false,
        type: roomType,
        mode: roomMode,
        status: roomStatus,
        venue_name: venueName.trim() || null,
        distance_km: Number(distanceKm) || 0,
      })
      .select("id")
      .single();

    setLoading(false);

    if (error) {
      showAlert(error.message);
      return;
    }

    setTitle("");
    setShowCreateSheet(false);

    if (insertedRoom?.id) {
      router.push(`/room/${insertedRoom.id}`);
      return;
    }

    fetchRooms();
  }

  async function joinQueue(room: Room) {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      showAlert("You need to sign in first.");
      return;
    }

    if (room.current_users >= room.max_users) {
      router.push(`/room/${room.id}`);
      return;
    }

    const { data: profileData } = await supabase
      .from("profiles")
      .select("username, avatar_url, bio")
      .eq("id", user.id)
      .maybeSingle();

    const { error } = await supabase.from("event_attendees").insert({
      event_room_id: room.id,
      user_id: user.id,
      username: profileData?.username || `Guest ${user.id.slice(0, 4)}`,
      avatar_url: profileData?.avatar_url || "",
      bio: profileData?.bio || "",
      status: "requested",
    });

    if (error) {
      showAlert(error.message);
      return;
    }

    await supabase
      .from("event_rooms")
      .update({
        queue_count: room.queue_count + 1,
      })
      .eq("id", room.id);

    router.push(`/room/${room.id}`);
  }

  async function deleteRoom(room: Room) {
    Alert.alert(
      "Delete room",
      "Are you sure you want to delete this room?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("event_rooms")
              .delete()
              .eq("id", room.id);

            if (error) {
              showAlert(error.message);
              return;
            }

            fetchRooms();
          },
        },
      ]
    );
  }

  async function quickJoin() {
    const openRoom = rooms.find((room) => room.current_users < room.max_users);

    if (!openRoom) {
      showAlert("No open rooms right now.");
      return;
    }

    await joinQueue(openRoom);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  function renderRoom({ item, index }: { item: Room; index: number }) {
    const status = getRoomStatus(item);
    const vibes = getRoomVibes(item);
    const isFull = status.tone === "full";

    return (
      <View style={styles.roomCard}>
        <ImageBackground
          source={getRoomBackdrop(item)}
          resizeMode="cover"
          imageStyle={styles.roomBackdropImage}
          style={[
            styles.roomBackdrop,
            index % 3 === 1 && styles.roomBackdropAlt,
            index % 3 === 2 && styles.roomBackdropWarm,
          ]}
        >
          <View style={styles.roomOverlay} />

          <View style={[styles.statusBadge, styles[`${status.tone}Badge`]]}>
            <Icon
              name={status.tone === "full" ? "lockFill" : status.tone === "trending" ? "flameFill" : "checkmark"}
              size={13}
              color={status.tone === "trending" ? "#120A02" : "#06120A"}
            />
            <Text style={[styles.statusText, status.tone === "full" && styles.fullStatusText]}>
              {status.label}
            </Text>
          </View>

          <View style={styles.roomMain}>
            <View style={styles.roomTextBlock}>
              <Text style={styles.roomTitle} numberOfLines={1}>
                {item.title}
              </Text>

              <View style={styles.eventMetaRow}>
                {item.type && (
                  <View style={styles.eventBadge}>
                    <Text style={styles.eventBadgeText}>{item.type.replace("_", " ")}</Text>
                  </View>
                )}
                {item.mode && (
                  <View style={styles.eventBadgeAlt}>
                    <Text style={styles.eventBadgeText}>{item.mode.toUpperCase()}</Text>
                  </View>
                )}
                {item.status && (
                  <View style={styles.eventBadgeSoft}>
                    <Text style={styles.eventBadgeText}>{item.status}</Text>
                  </View>
                )}
              </View>

              <View style={styles.vibeRow}>
                {vibes.map((vibe) => (
                  <View key={vibe} style={styles.vibePill}>
                    <Text style={styles.vibeText} numberOfLines={1}>
                      {vibe}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.avatarRow}>
                {[0, 1, 2, 3, 4].map((avatarIndex) => (
                  <View key={avatarIndex} style={[styles.miniAvatar, { marginLeft: avatarIndex ? -9 : 0 }]}>
                    <Text style={styles.miniAvatarText}>
                      {String.fromCharCode(65 + ((getRoomScore(item) + avatarIndex) % 26))}
                    </Text>
                  </View>
                ))}

                {item.queue_count > 0 && (
                  <View style={styles.extraAvatar}>
                    <Text style={styles.extraAvatarText}>+{item.queue_count}</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.roomActionBlock}>
              <View style={styles.capacityRow}>
                <Icon name="person2Fill" size={18} color="#FFFFFF" />
                <Text style={styles.capacityText}>
                  {item.current_users} / {item.max_users}
                </Text>
              </View>

              <View style={styles.cardActionsRow}>
                <TouchableOpacity
                  style={[styles.joinButton, isFull && styles.queueButton]}
                  onPress={() => (isFull ? router.push(`/room/${item.id}`) : joinQueue(item))}
                >
                  <Text style={styles.joinButtonText}>
                    {isFull ? "View Queue" : "Join Room"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => deleteRoom(item)}
                >
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ImageBackground>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 24) + 18, paddingBottom: 126 + insets.bottom },
        ]}
      >
        <View style={styles.topBar}>
          <View style={styles.logoRow}>
            <Text style={styles.logoLight}>Party</Text>
            <Text style={styles.logoAccent}>Up</Text>
          </View>

          <View style={styles.topActions}>
            <TouchableOpacity style={styles.iconButton} onPress={fetchRooms}>
              <Icon name="bell" size={23} color="#FFFFFF" />
              <View style={styles.notificationDot} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.profileAvatar} onPress={() => router.push("/profile")}>
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.profileImage} />
              ) : (
                <Text style={styles.profileInitial}>
                  {getGreetingName(profile).slice(0, 1).toUpperCase()}
                </Text>
              )}
              <View style={styles.onlineDot} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.greetingRow}>
          <View style={styles.greetingText}>
            <Text style={styles.greeting}>Good evening, {getGreetingName(profile)}</Text>
            <Text style={styles.subtitle}>Find a vibe. Join the conversation. Meet someone new.</Text>
          </View>

          <TouchableOpacity style={styles.searchButton}>
            <Icon name="magnifyingglass" size={31} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.statsPanel}>
          {stats.map((stat, index) => (
            <View key={stat.label} style={styles.statCell}>
              <Icon name={stat.icon} size={24} color={index === 1 ? "#FF4FC3" : "#A855F7"} />
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel} numberOfLines={1}>
                {stat.label}
              </Text>
              {index < stats.length - 1 && <View style={styles.statDivider} />}
            </View>
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Icon name="waveform" size={25} color="#8B3DFF" />
            <Text style={styles.sectionTitle}>Live Rooms</Text>
          </View>

          <TouchableOpacity style={styles.filterButton} onPress={fetchRooms}>
            <Icon name="sliders" size={19} color="#FFFFFF" />
            <Text style={styles.filterText}>Filter</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterList}
        >
          {FILTERS.map((filter) => {
            const active = selectedFilter === filter.label;

            return (
              <TouchableOpacity
                key={filter.label}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setSelectedFilter(filter.label)}
              >
                <Icon name={filter.icon} size={18} color={active ? "#FFFFFF" : "#F5F3FF"} />
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {filter.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <FlatList
          scrollEnabled={false}
          data={filteredRooms}
          keyExtractor={(item) => item.id}
          renderItem={renderRoom}
          contentContainerStyle={styles.roomList}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No rooms are open yet.</Text>
              <Text style={styles.emptyCopy}>Start one and set the tone for tonight.</Text>
            </View>
          }
        />

        <View style={styles.quickJoinCard}>
          <View style={styles.quickIcon}>
            <Icon name="person2Fill" size={24} color="#E9D5FF" />
          </View>

          <View style={styles.quickTextBlock}>
            <Text style={styles.quickTitle}>Quick Join</Text>
            <Text style={styles.quickSubtitle}>Join a random open room</Text>
          </View>

          <TouchableOpacity style={styles.surpriseButton} onPress={quickJoin}>
            <Icon name="sparkles" size={18} color="#FFFFFF" />
            <Text style={styles.surpriseText}>Surprise Me</Text>
            <Icon name="chevronRight" size={15} color="#C4B5FD" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity style={styles.navItem}>
          <Icon name="houseFill" size={27} color="#8B3DFF" />
          <Text style={[styles.navText, styles.navTextActive]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => router.push("/explore")}>
          <Icon name="stack" size={25} color="#A0A0AA" />
          <Text style={styles.navText}>Rooms</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.createFab} onPress={() => setShowCreateSheet(true)}>
          <Icon name="plus" size={34} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={fetchRooms}>
          <View>
            <Icon name="bolt" size={28} color="#A0A0AA" />
            <View style={styles.activityDot} />
          </View>
          <Text style={styles.navText}>Activity</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => router.push("/profile")}>
          <Icon name="person" size={27} color="#A0A0AA" />
          <Text style={styles.navText}>Profile</Text>
        </TouchableOpacity>
      </View>

      <Modal transparent visible={showCreateSheet} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.createSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Create Room</Text>
              <TouchableOpacity style={styles.closeButton} onPress={() => setShowCreateSheet(false)}>
                <Icon name="xmark" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Room name"
              placeholderTextColor="#7F778D"
              style={styles.input}
            />

            <TextInput
              value={maxUsers}
              onChangeText={setMaxUsers}
              placeholder="Max people"
              placeholderTextColor="#7F778D"
              keyboardType="numeric"
              style={styles.input}
            />

            <TextInput
              value={venueName}
              onChangeText={setVenueName}
              placeholder="Venue or location"
              placeholderTextColor="#7F778D"
              style={styles.input}
            />

            <TextInput
              value={distanceKm}
              onChangeText={setDistanceKm}
              placeholder="Distance (km)"
              placeholderTextColor="#7F778D"
              keyboardType="numeric"
              style={styles.input}
            />

            <View style={styles.controlGroup}>
              <Text style={styles.controlLabel}>Event type</Text>
              <View style={styles.choiceRow}>
                {ROOM_TYPES.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.choicePill,
                      roomType === option.value && styles.choicePillActive,
                    ]}
                    onPress={() => setRoomType(option.value)}
                  >
                    <Text
                      style={[
                        styles.choicePillText,
                        roomType === option.value && styles.choicePillTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.controlGroup}>
              <Text style={styles.controlLabel}>Mode</Text>
              <View style={styles.choiceRow}>
                {ROOM_MODES.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.choicePill,
                      roomMode === option.value && styles.choicePillActive,
                    ]}
                    onPress={() => setRoomMode(option.value)}
                  >
                    <Text
                      style={[
                        styles.choicePillText,
                        roomMode === option.value && styles.choicePillTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.controlGroup}>
              <Text style={styles.controlLabel}>Status</Text>
              <View style={styles.choiceRow}>
                {ROOM_STATUSES.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.choicePill,
                      roomStatus === option.value && styles.choicePillActive,
                    ]}
                    onPress={() => setRoomStatus(option.value)}
                  >
                    <Text
                      style={[
                        styles.choicePillText,
                        roomStatus === option.value && styles.choicePillTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity style={styles.createButton} onPress={createRoom}>
              <Text style={styles.createButtonText}>{loading ? "Creating..." : "Open Room"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#030306",
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 34,
  },
  logoRow: {
    alignItems: "baseline",
    flexDirection: "row",
  },
  logoLight: {
    color: "#EBD9FF",
    fontSize: 39,
    fontWeight: "900",
    letterSpacing: 0,
  },
  logoAccent: {
    color: "#7C3AED",
    fontSize: 39,
    fontWeight: "900",
    letterSpacing: 0,
  },
  topActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
  },
  iconButton: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  notificationDot: {
    backgroundColor: "#7C3AED",
    borderRadius: 7,
    height: 14,
    position: "absolute",
    right: 5,
    top: 4,
    width: 14,
  },
  profileAvatar: {
    alignItems: "center",
    backgroundColor: "#201B2B",
    borderColor: "#3B334D",
    borderRadius: 27,
    borderWidth: 2,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  profileImage: {
    borderRadius: 25,
    height: 50,
    width: 50,
  },
  profileInitial: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
  },
  onlineDot: {
    backgroundColor: "#55DD73",
    borderColor: "#11111A",
    borderRadius: 8,
    borderWidth: 2,
    bottom: 0,
    height: 16,
    position: "absolute",
    right: -2,
    width: 16,
  },
  greetingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
    marginBottom: 28,
  },
  greetingText: {
    flex: 1,
    minWidth: 0,
  },
  greeting: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0,
  },
  subtitle: {
    color: "#A7A1B4",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 7,
  },
  searchButton: {
    alignItems: "center",
    backgroundColor: "#151521",
    borderColor: "#29263A",
    borderRadius: 36,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  statsPanel: {
    backgroundColor: "#11101B",
    borderColor: "#1F1D2D",
    borderRadius: 21,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 28,
    paddingVertical: 17,
  },
  statCell: {
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    position: "relative",
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "900",
    marginTop: 4,
  },
  statLabel: {
    color: "#B7B1C4",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  statDivider: {
    backgroundColor: "#363142",
    height: 46,
    position: "absolute",
    right: 0,
    top: 4,
    width: 1,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sectionTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  filterButton: {
    alignItems: "center",
    backgroundColor: "#171722",
    borderColor: "#343246",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 45,
    paddingHorizontal: 17,
  },
  filterText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  filterList: {
    gap: 10,
    paddingBottom: 18,
  },
  filterChip: {
    alignItems: "center",
    backgroundColor: "#171722",
    borderColor: "#343246",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 17,
  },
  filterChipActive: {
    backgroundColor: "#6D28D9",
    borderColor: "#7C3AED",
  },
  filterChipText: {
    color: "#F5F3FF",
    fontSize: 14,
    fontWeight: "800",
  },
  filterChipTextActive: {
    color: "#FFFFFF",
  },
  roomList: {
    gap: 14,
  },
  roomCard: {
    backgroundColor: "#0C0B12",
    borderColor: "#312747",
    borderRadius: 22,
    borderWidth: 1,
    minHeight: 190,
    overflow: "hidden",
  },
  roomBackdrop: {
    flex: 1,
    justifyContent: "space-between",
    minHeight: 190,
    overflow: "hidden",
    padding: 15,
  },
  roomBackdropAlt: {
    backgroundColor: "#160827",
  },
  roomBackdropWarm: {
    backgroundColor: "#211006",
  },
  roomBackdropImage: {
    opacity: 0.34,
    transform: [{ scale: 1.22 }],
  },
  roomOverlay: {
    backgroundColor: "rgba(0, 0, 0, 0.48)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  statusBadge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  openBadge: {
    backgroundColor: "#59E07C",
  },
  trendingBadge: {
    backgroundColor: "#FDBA3B",
  },
  fullBadge: {
    backgroundColor: "#F05252",
  },
  statusText: {
    color: "#06120A",
    fontSize: 12,
    fontWeight: "900",
  },
  fullStatusText: {
    color: "#170303",
  },
  roomMain: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
    marginTop: 22,
  },
  roomTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  roomTitle: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: 0,
  },
  vibeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  eventMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  eventBadge: {
    backgroundColor: "rgba(124,58,237,0.18)",
    borderColor: "rgba(124,58,237,0.35)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  eventBadgeAlt: {
    backgroundColor: "rgba(92,33,182,0.18)",
    borderColor: "rgba(92,33,182,0.30)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  eventBadgeText: {
    color: "#F8F0FF",
    fontSize: 12,
    fontWeight: "700",
  },
  eventBadgeSoft: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  vibePill: {
    backgroundColor: "rgba(35, 24, 55, 0.82)",
    borderColor: "rgba(132, 78, 192, 0.35)",
    borderRadius: 9,
    borderWidth: 1,
    maxWidth: 118,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  vibeText: {
    color: "#D8B4FE",
    fontSize: 12,
    fontWeight: "800",
  },
  avatarRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: 13,
  },
  miniAvatar: {
    alignItems: "center",
    backgroundColor: "#28233A",
    borderColor: "#0B0B11",
    borderRadius: 16,
    borderWidth: 2,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  miniAvatarText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
  extraAvatar: {
    alignItems: "center",
    backgroundColor: "rgba(27, 27, 38, 0.9)",
    borderRadius: 17,
    height: 34,
    justifyContent: "center",
    marginLeft: -6,
    width: 42,
  },
  extraAvatarText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  roomActionBlock: {
    alignItems: "flex-end",
    gap: 16,
  },
  cardActionsRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  deleteButton: {
    flex: 1,
    backgroundColor: "#EF4444",
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  deleteButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
  },
  capacityRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  capacityText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  joinButton: {
    alignItems: "center",
    backgroundColor: "#6D28D9",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 52,
    minWidth: 142,
    paddingHorizontal: 20,
  },
  queueButton: {
    backgroundColor: "#232634",
  },
  joinButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: "#11101B",
    borderColor: "#2A2440",
    borderRadius: 22,
    borderWidth: 1,
    padding: 24,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  emptyCopy: {
    color: "#A7A1B4",
    marginTop: 6,
    textAlign: "center",
  },
  quickJoinCard: {
    alignItems: "center",
    backgroundColor: "#1A0B39",
    borderColor: "#4C1D95",
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: 13,
    marginTop: 14,
    padding: 13,
  },
  quickIcon: {
    alignItems: "center",
    backgroundColor: "#382071",
    borderRadius: 14,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  quickTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  quickTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  quickSubtitle: {
    color: "#C4B5FD",
    fontSize: 13,
    marginTop: 4,
  },
  surpriseButton: {
    alignItems: "center",
    backgroundColor: "#5B21B6",
    borderColor: "#7C3AED",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 47,
    paddingHorizontal: 16,
  },
  surpriseText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  bottomNav: {
    alignItems: "center",
    backgroundColor: "#080A12",
    borderColor: "#111626",
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    left: 0,
    paddingTop: 12,
    position: "absolute",
    right: 0,
  },
  navItem: {
    alignItems: "center",
    flex: 1,
    gap: 5,
    minHeight: 58,
  },
  navText: {
    color: "#9A97A5",
    fontSize: 12,
    fontWeight: "700",
  },
  navTextActive: {
    color: "#8B3DFF",
  },
  createFab: {
    alignItems: "center",
    backgroundColor: "#6D28D9",
    borderRadius: 34,
    height: 68,
    justifyContent: "center",
    marginTop: -36,
    width: 68,
  },
  activityDot: {
    backgroundColor: "#6D28D9",
    borderRadius: 7,
    height: 14,
    position: "absolute",
    right: -3,
    top: -2,
    width: 14,
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    flex: 1,
    justifyContent: "flex-end",
    padding: 20,
  },
  createSheet: {
    backgroundColor: "#11101B",
    borderColor: "#332855",
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    width: "100%",
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sheetTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#23212F",
    borderRadius: 16,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  input: {
    backgroundColor: "#08080D",
    borderColor: "#242033",
    borderRadius: 16,
    borderWidth: 1,
    color: "#FFFFFF",
    marginBottom: 12,
    padding: 14,
  },
  controlGroup: {
    marginBottom: 16,
  },
  controlLabel: {
    color: "#C4B5FD",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 10,
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  choicePill: {
    backgroundColor: "#110F19",
    borderColor: "#3A2A55",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  choicePillActive: {
    backgroundColor: "#7C3AED",
    borderColor: "#7C3AED",
  },
  choicePillText: {
    color: "#D8B4FE",
    fontSize: 13,
    fontWeight: "800",
  },
  choicePillTextActive: {
    color: "#FFFFFF",
  },
  createButton: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    minHeight: 50,
    justifyContent: "center",
  },
  createButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  signOutButton: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 8,
  },
  signOutText: {
    color: "#9A97A5",
    fontWeight: "800",
  },
});
