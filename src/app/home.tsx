import { Image } from "expo-image";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";
import type { AndroidSymbol, SFSymbol, SymbolViewProps } from "expo-symbols";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  cover_image?: string | null;
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

const TRENDING_SEARCHES = [
  "Debate",
  "Late Night",
  "VIP",
  "Toronto",
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

  if (!username) return "";

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
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [currentLocationLoading, setCurrentLocationLoading] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<(typeof FILTERS)[number]["label"]>("All");
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (showCreateSheet) {
      setCurrentLocation(null);
    }
  }, [showCreateSheet]);
  const [searchText, setSearchText] = useState("");
  const [isPrivateRoom, setIsPrivateRoom] = useState(false);
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
     const hour = new Date().getHours();
    const greeting =
  hour < 12
    ? "Good morning,"
    : hour < 18
    ? "Good afternoon,"
    : "Good evening,";

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function reloadHomeOnFocus() {
        const { data: sessionData } = await supabase.auth.getSession();
        let userId = sessionData.session?.user?.id;

        if (!userId) {
          const { data: userData } = await supabase.auth.getUser();
          userId = userData.user?.id;
        }

        if (!active || !userId) {
          return;
        }

        await fetchProfile(userId);

        if (active) {
          await fetchRooms();
        }
      }

      void reloadHomeOnFocus();

      return () => {
        active = false;
      };
    }, []),
  );

  useEffect(() => {
  let mounted = true;
  let loaded = false;

  async function loadHomeData(userId: string) {
    if (!mounted || loaded) return;

    loaded = true;
    await fetchProfile(userId);
    await fetchRooms();
  }

  async function loadCurrentSession() {
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user;

    if (sessionUser) {
      await loadHomeData(sessionUser.id);
      return true;
    }

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (user) {
      await loadHomeData(user.id);
      return true;
    }

    return false;
  }

  async function bootHome() {
    for (let attempt = 0; attempt < 6 && mounted && !loaded; attempt += 1) {
      const didLoad = await loadCurrentSession();

      if (didLoad) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  bootHome();

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      void loadHomeData(session.user.id);
    }
  });

  return () => {
    mounted = false;
    subscription.unsubscribe();
  };
}, []);

useEffect(() => {
  let mounted = true;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  async function fetchUnreadCount(userId: string) {
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    if (error) {
      console.log("Unread notification count error:", error.message);
      return;
    }

    if (mounted) {
      setUnreadNotificationCount(count ?? 0);
    }
  }

  async function setupNotifications() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user || !mounted) return;

    await fetchUnreadCount(user.id);

    channel = supabase
      .channel(`notifications-home-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchUnreadCount(user.id);
        }
      )
      .subscribe();
  }

  setupNotifications();

  return () => {
    mounted = false;

    if (channel) {
      supabase.removeChannel(channel);
    }
  };
}, []);

  const filteredRooms = useMemo(() => {
  let result = rooms;

  if (selectedFilter !== "All") {
    result = result.filter((room) =>
      getRoomVibes(room).includes(selectedFilter)
    );
  }

  if (searchText.trim()) {
    const q = searchText.trim().toLowerCase();

    result = result.filter((room) =>
      [
        room.title,
        room.type,
        room.mode,
        room.status,
        room.venue_name,
        ...getRoomVibes(room),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  return result;
}, [rooms, selectedFilter, searchText]);

const stats = useMemo(() => {
  const liveRooms = rooms.length;
  const peopleOnline = rooms.reduce(
    (total, room) => total + room.current_users,
    0
  );

  const trending = rooms.filter(
    (room) => getRoomStatus(room).tone === "trending"
  ).length;

  const queue = rooms.reduce(
    (total, room) => total + room.queue_count,
    0
  );

  return [
    {
      label: "Live Rooms",
      value: liveRooms,
      icon: "person2" as IconName,
    },
    {
      label: "People Online",
      value: peopleOnline,
      icon: "flame" as IconName,
    },
    {
      label: "Trending",
      value: trending,
      icon: "bolt" as IconName,
    },
    {
      label: "Your Queue",
      value: queue,
      icon: "personQueue" as IconName,
    },
  ];
}, [rooms]);

  async function fetchProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, auth_user_id, username, avatar_url")
    .or(`auth_user_id.eq.${userId},id.eq.${userId}`)
    .maybeSingle();

  console.log("PROFILE RESULT:", data);
  console.log("PROFILE ERROR:", error);

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

async function syncRoomCounts(roomId: string) {
  const { count: acceptedCount } = await supabase
    .from("event_attendees")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("event_room_id", roomId)
    .eq("status", "accepted");

  const { count: waitingCount } = await supabase
    .from("event_attendees")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("event_room_id", roomId)
    .eq("status", "waiting");

  await supabase
    .from("event_rooms")
    .update({
      current_users:
        acceptedCount || 0,

      queue_count:
        waitingCount || 0,

      last_active_at:
        new Date().toISOString(),
    })
    .eq("id", roomId);
}

  async function handleUseCurrentLocation() {
    if (currentLocationLoading) {
      return;
    }

    setCurrentLocationLoading(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== Location.PermissionStatus.GRANTED) {
        showAlert(
          "Location permission denied. Please enable location access to use your current location."
        );
        return;
      }

      const locationResult = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Lowest,
      });

      if (!locationResult?.coords) {
        showAlert("Unable to read your location. Please try again.");
        return;
      }

      setCurrentLocation({
        latitude: locationResult.coords.latitude,
        longitude: locationResult.coords.longitude,
      });
    } catch (error) {
      console.log("Location error:", error);
      showAlert("Could not get current location. Please try again.");
    } finally {
      setCurrentLocationLoading(false);
    }
  }

  async function createRoom() {
  if (loading) return;

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

  const { data: insertedRoom, error: roomError } = await supabase
    .from("event_rooms")
    .insert({
      title: title.trim(),
      host_id: user.id,
      current_users: 0,
      queue_count: 0,
      max_users: Number(maxUsers) || 12,
      is_private: isPrivateRoom,
      type: roomType,
      mode: roomMode,
      status: roomStatus,
      venue_name: venueName.trim() || null,
      latitude: currentLocation?.latitude ?? null,
      longitude: currentLocation?.longitude ?? null,
      last_active_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (roomError || !insertedRoom?.id) {
    setLoading(false);
    showAlert(roomError?.message || "Room could not be created.");
    return;
  }

  const { error: attendeeError } = await supabase
    .from("event_attendees")
    .upsert(
      {
        event_room_id: insertedRoom.id,
        user_id: user.id,
        username: profile?.username || "Host",
        avatar_url: profile?.avatar_url || "",
        status: "accepted",
        can_stream: true,
        stream_status: "off",
      },
      {
        onConflict: "event_room_id,user_id",
      }
    );

  if (attendeeError) {
    setLoading(false);
    showAlert(attendeeError.message);
    return;
  }

  await syncRoomCounts(insertedRoom.id);

  setTitle("");
  setSelectedVibes([]);
  setCurrentLocation(null);
  setShowCreateSheet(false);
  setLoading(false);

  router.push(`/room/${insertedRoom.id}`);
}

  async function joinQueue(room: Room) {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      showAlert("You need to sign in first.");
      return;
    }
    if (room.host_id === user.id) {
  router.push(`/room/${room.id}`);
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

    const { error } = await supabase.from("event_attendees").upsert(
  {
    event_room_id: room.id,
    user_id: user.id,
    username: profileData?.username || `Guest ${user.id.slice(0, 4)}`,
    avatar_url: profileData?.avatar_url || "",
    bio: profileData?.bio || "",
    status: "waiting",
  },
  {
    onConflict: "event_room_id,user_id",
  }
);
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

  async function confirmDeleteRoom(roomId: string) {
  setRooms((currentRooms) =>
    currentRooms.filter((room) => room.id !== roomId)
  );

  const { data, error } = await supabase
    .from("event_rooms")
    .delete()
    .eq("id", roomId)
    .select();

  console.log("DELETE RESULT:", { data, error });

  if (error) {
    showAlert(error.message);
    await fetchRooms();
    return;
  }

  if (!data || data.length === 0) {
    showAlert("Delete ran, but no room was deleted. Check RLS or host_id.");
    await fetchRooms();
    return;
  }

  setTimeout(() => {
    fetchRooms();
  }, 300);
}

  async function deleteRoom(room: Room) {
  const confirmed = window.confirm("Delete this room?");

  if (!confirmed) return;

  await confirmDeleteRoom(room.id);
}

 async function quickJoin() {
  const openRooms = rooms.filter((room) => room.current_users < room.max_users);

  if (openRooms.length === 0) {
    showAlert("No open rooms right now.");
    return;
  }

  const randomRoom =
    openRooms[Math.floor(Math.random() * openRooms.length)];

  await joinQueue(randomRoom);
}

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }


  function renderRoom({ item, index }: { item: Room; index: number }) {
    const vibes = getRoomVibes(item);
    const isFull = item.current_users >= item.max_users;
    const roomImage = item.cover_image ? { uri: item.cover_image } : getRoomBackdrop(item);
   
    return (
      <View style={styles.roomCard}>
        <View style={styles.roomCardInner}>
          {/* Image Thumbnail */}
          <ImageBackground
            source={roomImage}
            resizeMode="cover"
            imageStyle={styles.roomThumbnailImage}
            style={[
              styles.roomThumbnail,
              index % 3 === 1 && styles.roomThumbnailAlt,
              index % 3 === 2 && styles.roomThumbnailWarm,
            ]}
          >
            <View style={styles.roomThumbnailOverlay} />
            {/* LIVE Badge */}
            {item.status === "live" && (
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            )}
          </ImageBackground>

          {/* Content Section */}
          <View style={styles.roomContent}>
            {/* Header: Title + Status Badge */}
            <View style={styles.roomContentHeader}>
              <View style={styles.roomTitleBlock}>
                <Text style={styles.roomTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <View style={styles.statusPill}>
                  <View style={styles.statusDot} />
                  <Text style={styles.statusPillText}>OPEN</Text>
                </View>
              </View>
            </View>

            {/* Type/Mode Badges */}
            {(item.type || item.mode) && (
              <View style={styles.badgesRow}>
                {item.type && (
                  <View style={styles.smallBadge}>
                    <Text style={styles.smallBadgeText}>{item.type.replace("_", " ")}</Text>
                  </View>
                )}
                {item.mode && (
                  <View style={styles.smallBadge}>
                    <Text style={styles.smallBadgeText}>{item.mode.toUpperCase()}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Description */}
            <Text style={styles.roomDescription} numberOfLines={1}>
              {vibes.join(", ")}
            </Text>

            {/* Footer: Capacity + Distance */}
            <View style={styles.roomFooter}>
              <View style={styles.capacityRowCompact}>
                <Icon name="person2Fill" size={14} color="#A7A1B4" />
                <Text style={styles.capacityTextCompact}>
                  {item.current_users} / {item.max_users}
                </Text>
              </View>
              {item.distance_km != null && item.distance_km > 0 && (
  <Text style={styles.distanceText}>
    {item.distance_km.toFixed(1)} km away
  </Text>
)}
            </View>
          </View>

          {/* Actions */}
          <View style={styles.roomActions}>
            <TouchableOpacity
              style={[styles.joinButtonCompact, isFull && styles.joinButtonCompactFull]}
              onPress={() => (isFull ? router.push(`/room/${item.id}`) : joinQueue(item))}
            >
              <Text style={styles.joinButtonCompactText}>
                {isFull ? "Queue" : "Join"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
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
            <TouchableOpacity
  style={styles.iconButton}
  onPress={() => router.push("/activity")}
>
  <Icon name="bell" size={23} color="#FFFFFF" />
  {unreadNotificationCount > 0 && (
    <View style={styles.notificationBadge}>
      <Text style={styles.notificationBadgeText}>
        {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
      </Text>
    </View>
  )}
</TouchableOpacity>
            <TouchableOpacity
  style={styles.iconButton}
  onPress={() => setSearchOpen((current) => !current)}
><Icon
    name="magnifyingglass"
    size={22}
    color="#FFFFFF"/>
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
    <Text style={styles.greeting}>
  {profile?.username
    ? `${greeting} ${getGreetingName(profile)}`
    : greeting}
</Text>

    <Text style={styles.subtitle}>
      Find a vibe. Join the conversation. Meet someone new.
    </Text>
  </View>
</View>

{searchOpen && (
  <View style={styles.searchContainer}>
    <TextInput
      autoFocus
      value={searchText}
      onChangeText={setSearchText}
      placeholder="Search rooms, music, pop-ups..."
      placeholderTextColor="#7F778D"
      style={styles.searchInput}
    />
    <View style={styles.trendingSearchesRow}>
      {TRENDING_SEARCHES.map((term) => (
        <TouchableOpacity
          key={term}
          style={styles.trendingSearchChip}
          onPress={() => setSearchText(term)}
        >
          <Text style={styles.trendingSearchText}>{term}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
)}

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
              <Text style={styles.emptyTitle}>
                {searchText.trim()
                  ? `No rooms matched '${searchText.trim()}'`
                  : "No rooms are open yet."}
              </Text>
              <Text style={styles.emptyCopy}>
                {searchText.trim()
                  ? "Try a different vibe or clear the search."
                  : "Start one and set the tone for tonight."}
              </Text>
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

        <View style={styles.matchTestCard}>
          <View style={styles.quickIcon}>
            <Icon name="sparkles" size={24} color="#FDB4D4" />
          </View>

          <View style={styles.quickTextBlock}>
            <Text style={styles.quickTitle}>Match</Text>
            <Text style={styles.quickSubtitle}>Test global 1-on-1 matching</Text>
          </View>

          <TouchableOpacity style={styles.matchTestButton} onPress={() => router.push("/match" as never)}>
            <Text style={styles.surpriseText}>Open</Text>
            <Icon name="chevronRight" size={15} color="#FDB4D4" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity style={styles.navItem}>
          <Icon name="houseFill" size={27} color="#8B3DFF" />
          <Text style={[styles.navText, styles.navTextActive]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => router.push("/rooms")}>
          <Icon name="stack" size={25} color="#A0A0AA" />
          <Text style={styles.navText}>Rooms</Text>
        </TouchableOpacity>

        <TouchableOpacity
  style={styles.navItem}
  onPress={() => router.push("/explore")}
>
  <Icon
    name="flame"
    size={25}
    color="#A0A0AA"
  />

  <Text style={styles.navText}>
    Explore
  </Text>
</TouchableOpacity>

        <TouchableOpacity style={styles.createFab} onPress={() => setShowCreateSheet(true)}>
          <Icon name="plus" size={34} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity
  style={styles.navItem}
  onPress={() => router.push("/activity")}
>
  <View style={styles.navIconContainer}>
    <Icon name="bell" size={25} color="#A0A0AA" />
    {unreadNotificationCount > 0 && (
      <View style={styles.navNotificationBadge}>
        <Text style={styles.navNotificationBadgeText}>
          {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
        </Text>
      </View>
    )}
  </View>

  <Text style={styles.navText}>
    Activity
  </Text>
</TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => router.push("/connections" as never)}>
          <Icon name="person2" size={27} color="#A0A0AA" />
          <Text style={styles.navText}>Circle</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => router.push("/profile")}>
          <Icon name="person" size={27} color="#A0A0AA" />
          <Text style={styles.navText}>Profile</Text>
        </TouchableOpacity>
      </View>

      <Modal transparent visible={showCreateSheet} animationType="fade">
        <View style={styles.modalBackdrop}>
          <ScrollView
  style={styles.createSheet}
  contentContainerStyle={{
    paddingBottom: 140,
  }}
  showsVerticalScrollIndicator={true}
  keyboardShouldPersistTaps="handled"
>
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

            <TouchableOpacity
              style={styles.locationButton}
              onPress={handleUseCurrentLocation}
              disabled={currentLocationLoading}
            >
              <Text style={styles.locationButtonText}>
                {currentLocationLoading
                  ? "Checking location..."
                  : "Use Current Location"}
              </Text>
            </TouchableOpacity>

            {currentLocation ? (
              <Text style={styles.locationStatusText}>
                Location added
              </Text>
            ) : null}

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
  <Text style={styles.controlLabel}>
    Mode
  </Text>

  <View style={styles.choiceRow}>
    {ROOM_MODES.map((option) => (
      <TouchableOpacity
        key={option.value}
        style={[
          styles.choicePill,
          roomMode === option.value &&
            styles.choicePillActive,
        ]}
        onPress={() =>
          setRoomMode(option.value)
        }
      >
        <Text
          style={[
            styles.choicePillText,
            roomMode === option.value &&
              styles.choicePillTextActive,
          ]}
        >
          {option.label}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
</View>

<View style={styles.controlGroup}>
  <Text style={styles.controlLabel}>
    Status
  </Text>

  <View style={styles.choiceRow}>
    {ROOM_STATUSES.map((option) => (
      <TouchableOpacity
        key={option.value}
        style={[
          styles.choicePill,
          roomStatus === option.value &&
            styles.choicePillActive,
        ]}
        onPress={() =>
          setRoomStatus(option.value)
        }
      >
        <Text
          style={[
            styles.choicePillText,
            roomStatus === option.value &&
              styles.choicePillTextActive,
          ]}
        >
          {option.label}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
</View>

<View style={styles.controlGroup}>
  <Text style={styles.controlLabel}>
    Vibes
  </Text>

  <View style={styles.choiceRow}>
    {VIBE_TAGS.map((tag) => {
      const active = selectedVibes.includes(tag);

      return (
        <TouchableOpacity
          key={tag}
          style={[
            styles.choicePill,
            active && styles.choicePillActive,
          ]}
          onPress={() =>
            setSelectedVibes((current) =>
              current.includes(tag)
                ? current.filter((item) => item !== tag)
                : [...current, tag]
            )
          }
        >
          <Text
            style={[
              styles.choicePillText,
              active && styles.choicePillTextActive,
            ]}
          >
            {tag}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
</View>

<View style={styles.controlGroup}>
  <Text style={styles.controlLabel}>
    Privacy
  </Text>

  <TouchableOpacity
    style={[
      styles.choicePill,
      isPrivateRoom &&
        styles.choicePillActive,
    ]}
    onPress={() =>
      setIsPrivateRoom(
        (current) => !current
      )
    }
  >
    <Text
      style={[
        styles.choicePillText,
        isPrivateRoom &&
          styles.choicePillTextActive,
      ]}
    >
      {isPrivateRoom
        ? "Private Room On"
        : "Private Room Off"}
    </Text>
  </TouchableOpacity>
</View>

<TouchableOpacity
  style={[
    styles.createButton,
    loading && { opacity: 0.55 },
  ]}
  onPress={createRoom}
  disabled={loading}
>
  <Text style={styles.createButtonText}>
    {loading
      ? "Creating..."
      : "Open Room"}
  </Text>
</TouchableOpacity>

  </ScrollView>
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
  notificationBadge: {
    backgroundColor: "#EC4899",
    borderRadius: 999,
    height: 20,
    minWidth: 20,
    position: "absolute",
    right: -2,
    top: -2,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  notificationBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
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
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  subtitle: {
    color: "#9CA3AF",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
    fontWeight: "500",
  },
  statsPanel: {
    backgroundColor: "#0F0E19",
    borderColor: "#1F1D2D",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 32,
    paddingVertical: 20,
    paddingHorizontal: 12,
  },
  statCell: {
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    position: "relative",
    gap: 6,
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  statLabel: {
    color: "#9CA3AF",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  statDivider: {
    backgroundColor: "#27252F",
    height: 40,
    position: "absolute",
    right: 0,
    top: 8,
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
    gap: 12,
    paddingBottom: 20,
  },
  filterChip: {
    alignItems: "center",
    backgroundColor: "#1F1D2D",
    borderColor: "#2F2D3D",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  filterChipActive: {
    backgroundColor: "#8B5CF6",
    borderColor: "#7C3AED",
  },
  filterChipText: {
    color: "#D1D5DB",
    fontSize: 15,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: "#FFFFFF",
  },
  roomList: {
    gap: 12,
  },
  roomCard: {
    backgroundColor: "#0C0B12",
    borderColor: "#1F1D2D",
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 140,
    overflow: "hidden",
  },
  roomCardInner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
  },
  roomThumbnail: {
    width: 140,
    minHeight: 140,
    overflow: "hidden",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    padding: 10,
  },
  roomThumbnailAlt: {
    backgroundColor: "#160827",
  },
  roomThumbnailWarm: {
    backgroundColor: "#211006",
  },
  roomThumbnailImage: {
    opacity: 0.4,
    transform: [{ scale: 1.25 }],
  },
  roomThumbnailOverlay: {
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  liveBadge: {
    backgroundColor: "#DC2626",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 10,
  },
  liveBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  roomContent: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: "space-between",
  },
  roomContentHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  roomTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  roomTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
    letterSpacing: 0,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(34, 197, 94, 0.12)",
    borderColor: "rgba(34, 197, 94, 0.25)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#22C55E",
  },
  statusPillText: {
    color: "#86EFAC",
    fontSize: 11,
    fontWeight: "800",
  },
  badgesRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 6,
  },
  smallBadge: {
    backgroundColor: "rgba(124, 58, 237, 0.15)",
    borderColor: "rgba(124, 58, 237, 0.25)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  smallBadgeText: {
    color: "#E9D5FF",
    fontSize: 11,
    fontWeight: "700",
  },
  roomDescription: {
    color: "#A7A1B4",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  roomFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  capacityRowCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  capacityTextCompact: {
    color: "#D1D5DB",
    fontSize: 12,
    fontWeight: "700",
  },
  distanceText: {
    color: "#9CA3AF",
    fontSize: 11,
  },
  roomActions: {
    paddingHorizontal: 10,
    paddingVertical: 12,
    justifyContent: "space-between",
    alignItems: "center",
    borderLeftColor: "#1F1D2D",
    borderLeftWidth: 1,
    gap: 8,
  },
  joinButtonCompact: {
    backgroundColor: "#7C3AED",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  joinButtonCompactFull: {
    backgroundColor: "#5B4680",
  },
  joinButtonCompactText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  deleteButtonCompact: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: "#0F0E19",
    borderColor: "#1F1D2D",
    borderRadius: 18,
    borderWidth: 1,
    padding: 28,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  emptyCopy: {
    color: "#9CA3AF",
    marginTop: 8,
    textAlign: "center",
    fontSize: 15,
  },
  quickJoinCard: {
    alignItems: "center",
    backgroundColor: "#1a0d3d",
    borderColor: "#3d1f6d",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    marginTop: 16,
    padding: 14,
  },
  matchTestCard: {
    alignItems: "center",
    backgroundColor: "#21101F",
    borderColor: "#5B2242",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    marginTop: 12,
    padding: 14,
  },
  quickIcon: {
    alignItems: "center",
    backgroundColor: "#2d1050",
    borderRadius: 12,
    height: 50,
    justifyContent: "center",
    width: 50,
  },
  quickTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  quickTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  quickSubtitle: {
    color: "#9CA3AF",
    fontSize: 13,
    marginTop: 3,
  },
  surpriseButton: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderColor: "#8B5CF6",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  matchTestButton: {
    alignItems: "center",
    backgroundColor: "#EC4899",
    borderColor: "#F472B6",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  surpriseText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  bottomNav: {
    alignItems: "center",
    backgroundColor: "#0A0812",
    borderColor: "#1F1D2D",
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    left: 0,
    paddingTop: 10,
    position: "absolute",
    right: 0,
  },
  navItem: {
    alignItems: "center",
    flex: 1,
    gap: 4,
    minHeight: 60,
  },
  navText: {
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "700",
  },
  navTextActive: {
    color: "#8B5CF6",
  },
  navIconContainer: {
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  navNotificationBadge: {
    backgroundColor: "#EC4899",
    borderRadius: 999,
    height: 16,
    minWidth: 16,
    position: "absolute",
    right: -6,
    top: -4,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 3,
  },
  navNotificationBadgeText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "900",
  },
  createFab: {
    alignItems: "center",
    backgroundColor: "#8B5CF6",
    borderRadius: 34,
    height: 68,
    justifyContent: "center",
    marginTop: -34,
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
  maxHeight: "88%",
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
  locationButton: {
    alignItems: "center",
    backgroundColor: "#1F1D2D",
    borderColor: "#4C3E6A",
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 50,
    justifyContent: "center",
    marginBottom: 8,
  },
  locationButtonText: {
    color: "#D8B4FE",
    fontSize: 15,
    fontWeight: "800",
  },
  locationStatusText: {
    color: "#9CA3AF",
    fontSize: 13,
    marginBottom: 12,
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
  searchContainer: {
    marginBottom: 20,
  },
  searchInput: {
    backgroundColor: "#11101B",
    borderColor: "#2A2440",
    borderWidth: 1,
    borderRadius: 16,
    color: "#FFFFFF",
    padding: 14,
    marginBottom: 16,
    fontSize: 15,
  },
  trendingSearchesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  trendingSearchChip: {
    backgroundColor: "#1F1D2D",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2E2A42",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  trendingSearchText: {
    color: "#EDE9FE",
    fontSize: 13,
    fontWeight: "700",
  },
});
