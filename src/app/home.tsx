import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";
import type { AndroidSymbol, SFSymbol, SymbolViewProps } from "expo-symbols";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

type RoomType = "party" | "concert" | "dj_set" | "popup" | "sports" | "watch_party";
type RoomMode = "irl" | "livestream" | "hybrid";
type RoomStatusType = "scheduled" | "live" | "ended";
type CreateRoomStatus = "scheduled" | "live";
type TimePeriod = "AM" | "PM";
type CreateRoomStep = 0 | 1 | 2 | 3;

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
  chevronLeft: makeIcon("chevron.left", "chevron_left"),
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

const CREATE_ROOM_STEPS = ["Basics", "When", "Details", "Review"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

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

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function toDateValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getDefaultSchedule() {
  const date = new Date();
  const currentHour = date.getHours();
  const defaultHour = currentHour >= 22 ? 20 : 21;

  if (currentHour >= 22) {
    date.setDate(date.getDate() + 1);
  }

  return {
    date: toDateValue(date),
    hour: defaultHour > 12 ? defaultHour - 12 : defaultHour,
    minute: 0,
    month: new Date(date.getFullYear(), date.getMonth(), 1),
    period: (defaultHour >= 12 ? "PM" : "AM") as TimePeriod,
  };
}

function getCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days: (Date | null)[] = Array.from({ length: firstDay.getDay() }, () => null);

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push(new Date(month.getFullYear(), month.getMonth(), day));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function getTwentyFourHour(hour: number, period: TimePeriod) {
  if (period === "AM") {
    return hour === 12 ? 0 : hour;
  }

  return hour === 12 ? 12 : hour + 12;
}

function getScheduledAt(dateValue: string, hour: number, minute: number, period: TimePeriod) {
  const [year, month, day] = dateValue.split("-").map(Number);

  return new Date(year, month - 1, day, getTwentyFourHour(hour, period), minute).toISOString();
}

function formatScheduledDate(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function TimeSlider({
  maximumValue,
  minimumValue,
  onValueChange,
  step,
  value,
}: {
  maximumValue: number;
  minimumValue: number;
  onValueChange: (value: number) => void;
  step: number;
  value: number;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = (value - minimumValue) / (maximumValue - minimumValue);

  function updateValue(locationX: number) {
    if (!trackWidth) return;

    const clampedX = Math.max(0, Math.min(trackWidth, locationX));
    const rawValue = minimumValue + (clampedX / trackWidth) * (maximumValue - minimumValue);
    const nextValue = minimumValue + Math.round((rawValue - minimumValue) / step) * step;

    onValueChange(Math.max(minimumValue, Math.min(maximumValue, nextValue)));
  }

  return (
    <View
      style={styles.createRoomSlider}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => updateValue(event.nativeEvent.locationX)}
      onResponderMove={(event) => updateValue(event.nativeEvent.locationX)}
    >
      <View style={styles.createRoomSliderTrack}>
        <View style={[styles.createRoomSliderFill, { width: `${progress * 100}%` }]} />
        <View
          style={[
            styles.createRoomSliderThumb,
            { left: Math.max(0, Math.min(Math.max(0, trackWidth - 20), progress * trackWidth - 10)) },
          ]}
        />
      </View>
    </View>
  );
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
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const createRoomTranslateX = useRef(new Animated.Value(0)).current;
  const [rooms, setRooms] = useState<Room[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [maxUsers, setMaxUsers] = useState("12");
  const [roomType, setRoomType] = useState<RoomType>("party");
  const [roomMode, setRoomMode] = useState<RoomMode>("livestream");
  const [roomStatus, setRoomStatus] = useState<CreateRoomStatus>("live");
  const [venueName, setVenueName] = useState("");
  const [coverImageUri, setCoverImageUri] = useState<string | null>(null);
  const [currentCreateStep, setCurrentCreateStep] = useState<CreateRoomStep>(0);
  const [scheduledDate, setScheduledDate] = useState(() => getDefaultSchedule().date);
  const [scheduledHour, setScheduledHour] = useState(() => getDefaultSchedule().hour);
  const [scheduledMinute, setScheduledMinute] = useState(() => getDefaultSchedule().minute);
  const [scheduledPeriod, setScheduledPeriod] = useState<TimePeriod>(() => getDefaultSchedule().period);
  const [calendarMonth, setCalendarMonth] = useState(() => getDefaultSchedule().month);
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

  useEffect(() => {
    Animated.timing(createRoomTranslateX, {
      duration: 260,
      toValue: -currentCreateStep * windowWidth,
      useNativeDriver: true,
    }).start();
  }, [createRoomTranslateX, currentCreateStep, windowWidth]);

  const [searchText, setSearchText] = useState("");
  const [isPrivateRoom, setIsPrivateRoom] = useState(false);
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

  function resetSchedule() {
    const schedule = getDefaultSchedule();

    setScheduledDate(schedule.date);
    setScheduledHour(schedule.hour);
    setScheduledMinute(schedule.minute);
    setScheduledPeriod(schedule.period);
    setCalendarMonth(schedule.month);
  }

  function openCreateRoom() {
    setRoomStatus("live");
    setCurrentCreateStep(0);
    createRoomTranslateX.setValue(0);
    setShowCreateSheet(true);
  }

  function closeCreateRoom() {
    if (loading) return;

    setShowCreateSheet(false);
    setCurrentCreateStep(0);
  }

  function goToNextCreateStep() {
    if (currentCreateStep === 0 && !title.trim()) {
      showAlert("Enter a room name");
      return;
    }

    if (
      currentCreateStep === 1 &&
      roomStatus === "scheduled" &&
      new Date(getScheduledAt(scheduledDate, scheduledHour, scheduledMinute, scheduledPeriod)) <= new Date()
    ) {
      showAlert("Choose a time in the future.");
      return;
    }

    if (currentCreateStep === 2) {
      setMaxUsers(String(getCapacityValue(maxUsers)));
    }

    setCurrentCreateStep((step) => Math.min(step + 1, 3) as CreateRoomStep);
  }

  function goToPreviousCreateStep() {
    setCurrentCreateStep((step) => Math.max(step - 1, 0) as CreateRoomStep);
  }

  function adjustCapacity(change: number) {
    const currentCapacity = getCapacityValue(maxUsers);
    setMaxUsers(String(Math.min(100, Math.max(2, currentCapacity + change))));
  }

  function getCapacityValue(value: string) {
    if (!value.trim()) return 12;

    const parsedValue = Number(value);

    return Number.isFinite(parsedValue) ? Math.min(100, Math.max(2, parsedValue)) : 12;
  }

  function updateCapacity(value: string) {
    setMaxUsers(value.replace(/\D/g, "").slice(0, 3));
  }

  async function pickCoverImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== "granted") {
      showAlert("Photo access is required to choose a room cover.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setCoverImageUri(result.assets[0].uri);
    }
  }

  async function createRoom() {
    if (loading) return;

    if (!title.trim()) {
      showAlert("Enter a room name");
      setCurrentCreateStep(0);
      return;
    }

    if (
      roomStatus === "scheduled" &&
      new Date(getScheduledAt(scheduledDate, scheduledHour, scheduledMinute, scheduledPeriod)) <= new Date()
    ) {
      showAlert("Choose a time in the future.");
      setCurrentCreateStep(1);
      return;
    }

    setLoading(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      if (!user) {
        showAlert("You need to sign in first.");
        return;
      }

      let coverImage: string | null = null;

      if (coverImageUri) {
        const fileExt = coverImageUri.split(".").pop()?.split("?")[0] || "jpg";
        const filePath = `${user.id}/room_${Date.now()}.${fileExt}`;
        const response = await fetch(coverImageUri);
        const arrayBuffer = await response.arrayBuffer();
        const { error: uploadError } = await supabase.storage
          .from("event-images")
          .upload(filePath, arrayBuffer, {
            contentType: `image/${fileExt === "png" ? "png" : "jpeg"}`,
            upsert: false,
          });

        if (uploadError) {
          showAlert(uploadError.message);
          return;
        }

        coverImage = supabase.storage.from("event-images").getPublicUrl(filePath).data.publicUrl;
      }

      const { data: insertedRoom, error: roomError } = await supabase
        .from("event_rooms")
        .insert({
          title: title.trim(),
          host_id: user.id,
          cover_image: coverImage,
          current_users: 0,
          queue_count: 0,
          max_users: getCapacityValue(maxUsers),
          is_private: isPrivateRoom,
          type: roomType,
          mode: roomMode,
          status: roomStatus,
          scheduled_at:
            roomStatus === "scheduled"
              ? getScheduledAt(scheduledDate, scheduledHour, scheduledMinute, scheduledPeriod)
              : null,
          venue_name: roomMode === "livestream" ? null : venueName.trim() || null,
          latitude: roomMode === "livestream" ? null : currentLocation?.latitude ?? null,
          longitude: roomMode === "livestream" ? null : currentLocation?.longitude ?? null,
          last_active_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (roomError || !insertedRoom?.id) {
        showAlert(roomError?.message || "Room could not be created.");
        return;
      }

      const { error: attendeeError } = await supabase.from("event_attendees").upsert(
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
        showAlert(attendeeError.message);
        return;
      }

      await syncRoomCounts(insertedRoom.id);

      setTitle("");
      setMaxUsers("12");
      setRoomType("party");
      setRoomMode("livestream");
      setRoomStatus("live");
      setVenueName("");
      setCoverImageUri(null);
      setCurrentLocation(null);
      setIsPrivateRoom(false);
      setCurrentCreateStep(0);
      resetSchedule();
      setShowCreateSheet(false);

      router.push(`/room/${insertedRoom.id}`);
    } catch (error) {
      showAlert(error instanceof Error ? error.message : "Room could not be created.");
    } finally {
      setLoading(false);
    }
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

  const calendarDays = getCalendarDays(calendarMonth);
  const todayValue = toDateValue(new Date());
  const scheduledTimeLabel = `${scheduledHour}:${pad(scheduledMinute)} ${scheduledPeriod}`;
  const scheduledLabel = `${formatScheduledDate(scheduledDate)} at ${scheduledTimeLabel}`;
  const compactCreateRoom = windowHeight < 760;
  const selectedRoomTypeLabel = ROOM_TYPES.find((option) => option.value === roomType)?.label || "Party";
  const selectedRoomModeLabel = ROOM_MODES.find((option) => option.value === roomMode)?.label || "Livestream";

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

        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Icon name="waveform" size={25} color="#8B3DFF" />
            <Text style={styles.sectionTitle}>Live Rooms</Text>
          </View>

          <TouchableOpacity style={styles.filterButton} onPress={() => router.push("/rooms")}>
            <Text style={styles.filterText}>View all</Text>
            <Icon name="chevronRight" size={17} color="#C4B5FD" />
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
          data={filteredRooms.slice(0, 4)}
          keyExtractor={(item) => item.id}
          renderItem={renderRoom}
          contentContainerStyle={styles.roomList}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                {searchText.trim()
                  ? `No rooms matched '${searchText.trim()}'`
                  : selectedFilter !== "All"
                    ? `No ${selectedFilter} rooms are open.`
                  : "No rooms are open yet."}
              </Text>
              <Text style={styles.emptyCopy}>
                {searchText.trim()
                  ? "Try a different vibe or clear the search."
                  : selectedFilter !== "All"
                    ? "Try another filter or view all rooms."
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

        <TouchableOpacity style={styles.createFab} onPress={openCreateRoom}>
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

      <Modal
        visible={showCreateSheet}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={closeCreateRoom}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.createRoomModal}
        >
          <View style={[styles.createRoomHeader, { paddingTop: Math.max(insets.top, 16) }]}>
            <View style={styles.createRoomTitleRow}>
              <View>
                <Text style={styles.createRoomBrand}>PARTYUP</Text>
                <Text style={styles.createRoomTitle}>Open a Room</Text>
              </View>
              <TouchableOpacity
                accessibilityLabel="Close room creator"
                style={styles.createRoomCloseButton}
                onPress={closeCreateRoom}
                disabled={loading}
              >
                <Icon name="xmark" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.createRoomProgressRow}>
              {CREATE_ROOM_STEPS.map((step, index) => (
                <View
                  key={step}
                  style={[
                    styles.createRoomProgressTrack,
                    index <= currentCreateStep && styles.createRoomProgressTrackActive,
                  ]}
                />
              ))}
            </View>
            <View style={styles.createRoomStepRow}>
              <Text style={styles.createRoomStepName}>{CREATE_ROOM_STEPS[currentCreateStep]}</Text>
              <Text style={styles.createRoomStepCount}>{currentCreateStep + 1} / 4</Text>
            </View>
          </View>

          <View style={styles.createRoomViewport}>
            <Animated.View
              style={[
                styles.createRoomPages,
                {
                  width: windowWidth * CREATE_ROOM_STEPS.length,
                  transform: [{ translateX: createRoomTranslateX }],
                },
              ]}
            >
              <View style={[styles.createRoomPage, { width: windowWidth }]}>
                <View style={styles.createRoomPageIntro}>
                  <Text style={styles.createRoomPageTitle}>Room basics</Text>
                </View>

                <View>
                  <Text style={styles.createRoomFieldLabel}>Room name</Text>
                  <TextInput
                    value={title}
                    onChangeText={setTitle}
                    placeholder="Late night party room"
                    placeholderTextColor="#756D82"
                    style={styles.createRoomInput}
                    returnKeyType="done"
                  />
                </View>

                <View>
                  <Text style={styles.createRoomFieldLabel}>Event type</Text>
                  <View style={styles.createRoomTypeGrid}>
                    {ROOM_TYPES.map((option) => (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.createRoomTypeOption,
                          roomType === option.value && styles.createRoomOptionActive,
                        ]}
                        onPress={() => setRoomType(option.value)}
                      >
                        <Text
                          style={[
                            styles.createRoomOptionText,
                            roomType === option.value && styles.createRoomOptionTextActive,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View>
                  <Text style={styles.createRoomFieldLabel}>Mode</Text>
                  <View style={styles.createRoomSegmentedControl}>
                    {ROOM_MODES.map((option) => (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.createRoomSegment,
                          roomMode === option.value && styles.createRoomSegmentActive,
                        ]}
                        onPress={() => setRoomMode(option.value)}
                      >
                        <Text
                          style={[
                            styles.createRoomSegmentText,
                            roomMode === option.value && styles.createRoomOptionTextActive,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <View
                style={[
                  styles.createRoomPage,
                  styles.createRoomWhenPage,
                  compactCreateRoom && styles.createRoomPageCompact,
                  { width: windowWidth },
                ]}
              >
                <View style={styles.createRoomPageIntro}>
                  <Text style={styles.createRoomPageTitle}>When is it happening?</Text>
                </View>

                <View style={styles.createRoomSegmentedControl}>
                  {(["live", "scheduled"] as CreateRoomStatus[]).map((status) => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.createRoomSegment,
                        roomStatus === status && styles.createRoomSegmentActive,
                      ]}
                      onPress={() => setRoomStatus(status)}
                    >
                      <Text
                        style={[
                          styles.createRoomSegmentText,
                          roomStatus === status && styles.createRoomOptionTextActive,
                        ]}
                      >
                        {status === "live" ? "Live now" : "Schedule"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {roomStatus === "live" ? (
                  <View style={styles.createRoomLivePanel}>
                    <View style={styles.createRoomLiveDot} />
                    <View style={styles.createRoomLiveCopy}>
                      <Text style={styles.createRoomLiveTitle}>Ready when you are</Text>
                      <Text style={styles.createRoomLiveText}>The room opens as soon as you finish creating it.</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.createRoomScheduleContent}>
                    <View style={styles.createRoomCalendar}>
                      <View style={styles.createRoomCalendarHeader}>
                        <TouchableOpacity
                          accessibilityLabel="Previous month"
                          style={styles.createRoomCalendarArrow}
                          onPress={() =>
                            setCalendarMonth(
                              (month) => new Date(month.getFullYear(), month.getMonth() - 1, 1)
                            )
                          }
                        >
                          <Icon name="chevronLeft" size={17} color="#D6C8E8" />
                        </TouchableOpacity>
                        <Text style={styles.createRoomCalendarMonth}>
                          {new Intl.DateTimeFormat(undefined, {
                            month: "long",
                            year: "numeric",
                          }).format(calendarMonth)}
                        </Text>
                        <TouchableOpacity
                          accessibilityLabel="Next month"
                          style={styles.createRoomCalendarArrow}
                          onPress={() =>
                            setCalendarMonth(
                              (month) => new Date(month.getFullYear(), month.getMonth() + 1, 1)
                            )
                          }
                        >
                          <Icon name="chevronRight" size={17} color="#D6C8E8" />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.createRoomCalendarGrid}>
                        {WEEKDAYS.map((day, index) => (
                          <Text key={`${day}-${index}`} style={styles.createRoomWeekday}>{day}</Text>
                        ))}
                        {calendarDays.map((day, index) => {
                          const dateValue = day ? toDateValue(day) : "";
                          const selected = dateValue === scheduledDate;
                          const disabled = !day || dateValue < todayValue;

                          return (
                            <TouchableOpacity
                              key={day ? dateValue : `blank-${index}`}
                              disabled={disabled}
                              hitSlop={4}
                              style={[
                                styles.createRoomCalendarDay,
                                compactCreateRoom && styles.createRoomCalendarDayCompact,
                                selected && styles.createRoomCalendarDayActive,
                              ]}
                              onPress={() => day && setScheduledDate(dateValue)}
                            >
                              <Text
                                style={[
                                  styles.createRoomCalendarDayText,
                                  disabled && styles.createRoomCalendarDayTextDisabled,
                                  selected && styles.createRoomOptionTextActive,
                                ]}
                              >
                                {day?.getDate() || ""}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>

                    <View style={styles.createRoomTimePanel}>
                      <View style={styles.createRoomTimeHeader}>
                        <Text style={styles.createRoomFieldLabel}>Time</Text>
                        <Text style={styles.createRoomTimeValue}>{scheduledTimeLabel}</Text>
                      </View>
                      <View style={styles.createRoomSliderRow}>
                        <Text style={styles.createRoomSliderLabel}>Hour</Text>
                        <TimeSlider
                          minimumValue={1}
                          maximumValue={12}
                          step={1}
                          value={scheduledHour}
                          onValueChange={setScheduledHour}
                        />
                        <Text style={styles.createRoomSliderValue}>{scheduledHour}</Text>
                      </View>
                      <View style={styles.createRoomSliderRow}>
                        <Text style={styles.createRoomSliderLabel}>Min</Text>
                        <TimeSlider
                          minimumValue={0}
                          maximumValue={55}
                          step={5}
                          value={scheduledMinute}
                          onValueChange={setScheduledMinute}
                        />
                        <Text style={styles.createRoomSliderValue}>{pad(scheduledMinute)}</Text>
                      </View>
                      <View style={styles.createRoomPeriodControl}>
                        {(["AM", "PM"] as TimePeriod[]).map((period) => (
                          <TouchableOpacity
                            key={period}
                            style={[
                              styles.createRoomPeriodOption,
                              scheduledPeriod === period && styles.createRoomSegmentActive,
                            ]}
                            onPress={() => setScheduledPeriod(period)}
                          >
                            <Text
                              style={[
                                styles.createRoomSegmentText,
                                scheduledPeriod === period && styles.createRoomOptionTextActive,
                              ]}
                            >
                              {period}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  </View>
                )}
              </View>

              <View
                style={[
                  styles.createRoomPage,
                  compactCreateRoom && styles.createRoomPageCompact,
                  { width: windowWidth },
                ]}
              >
                <View style={styles.createRoomPageIntro}>
                  <Text style={styles.createRoomPageTitle}>Room details</Text>
                </View>

                <View style={styles.createRoomSettingRow}>
                  <View style={styles.createRoomSettingCopy}>
                    <Text style={styles.createRoomSettingTitle}>Capacity</Text>
                    <Text style={styles.createRoomSettingHint}>Type a number from 2 to 100</Text>
                  </View>
                  <View style={styles.createRoomStepper}>
                    <TouchableOpacity
                      accessibilityLabel="Decrease capacity"
                      style={styles.createRoomStepperButton}
                      onPress={() => adjustCapacity(-1)}
                    >
                      <Text style={styles.createRoomStepperSymbol}>-</Text>
                    </TouchableOpacity>
                    <TextInput
                      accessibilityLabel="Room capacity"
                      keyboardType="number-pad"
                      maxLength={3}
                      onBlur={() => setMaxUsers(String(getCapacityValue(maxUsers)))}
                      onChangeText={updateCapacity}
                      selectTextOnFocus
                      style={styles.createRoomCapacityInput}
                      value={maxUsers}
                    />
                    <TouchableOpacity
                      accessibilityLabel="Increase capacity"
                      style={styles.createRoomStepperButton}
                      onPress={() => adjustCapacity(1)}
                    >
                      <Icon name="plus" size={17} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                </View>

                {roomMode !== "livestream" && (
                  <View style={styles.createRoomLocationBlock}>
                    <Text style={styles.createRoomFieldLabel}>Venue</Text>
                    <TextInput
                      value={venueName}
                      onChangeText={setVenueName}
                      placeholder="Venue or location"
                      placeholderTextColor="#756D82"
                      style={styles.createRoomInput}
                    />
                    <TouchableOpacity
                      style={[
                        styles.createRoomSecondaryButton,
                        currentLocation && styles.createRoomSecondaryButtonActive,
                      ]}
                      onPress={handleUseCurrentLocation}
                      disabled={currentLocationLoading}
                    >
                      <Text style={styles.createRoomSecondaryButtonText}>
                        {currentLocationLoading
                          ? "Checking location..."
                          : currentLocation
                            ? "Current location added"
                            : "Use Current Location"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity style={styles.createRoomCoverRow} onPress={pickCoverImage}>
                  {coverImageUri ? (
                    <Image source={{ uri: coverImageUri }} style={styles.createRoomCoverPreview} contentFit="cover" />
                  ) : (
                    <View style={styles.createRoomCoverPlaceholder}>
                      <Icon name="plus" size={20} color="#C899FF" />
                    </View>
                  )}
                  <View style={styles.createRoomCoverCopy}>
                    <Text style={styles.createRoomSettingTitle}>Cover image</Text>
                    <Text style={styles.createRoomSettingHint}>
                      {coverImageUri ? "Tap to replace" : "Optional"}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={18} color="#71697D" />
                </TouchableOpacity>

                <View style={styles.createRoomSettingRow}>
                  <View style={styles.createRoomPrivacyCopy}>
                    <Text style={styles.createRoomSettingTitle}>Private room</Text>
                    <Text style={styles.createRoomSettingHint}>Only invited people can discover it.</Text>
                  </View>
                  <Switch
                    value={isPrivateRoom}
                    onValueChange={setIsPrivateRoom}
                    trackColor={{ false: "#3B3347", true: "#7440B8" }}
                    thumbColor={isPrivateRoom ? "#D8B4FE" : "#A59CAC"}
                  />
                </View>
              </View>

              <View
                style={[
                  styles.createRoomPage,
                  styles.createRoomReviewPage,
                  compactCreateRoom && styles.createRoomPageCompact,
                  { width: windowWidth },
                ]}
              >
                <View style={styles.createRoomPageIntro}>
                  <Text style={styles.createRoomPageTitle}>Review</Text>
                </View>

                <View style={styles.createRoomReviewHero}>
                  {coverImageUri && (
                    <Image source={{ uri: coverImageUri }} style={styles.createRoomReviewCover} contentFit="cover" />
                  )}
                  <View style={styles.createRoomReviewHeroCopy}>
                    <Text style={styles.createRoomReviewLabel}>ROOM</Text>
                    <Text style={styles.createRoomReviewTitle} numberOfLines={1}>{title.trim()}</Text>
                    <Text style={styles.createRoomReviewMeta}>{selectedRoomTypeLabel} / {selectedRoomModeLabel}</Text>
                  </View>
                </View>

                <View style={styles.createRoomReviewCard}>
                  <Text style={styles.createRoomReviewLabel}>WHEN</Text>
                  <Text style={styles.createRoomReviewValue} numberOfLines={2}>
                    {roomStatus === "live" ? "Live now" : scheduledLabel}
                  </Text>
                </View>

                <View style={styles.createRoomReviewGrid}>
                  <View style={styles.createRoomReviewHalfCard}>
                    <Text style={styles.createRoomReviewLabel}>CAPACITY</Text>
                    <Text style={styles.createRoomReviewValue}>{maxUsers} people</Text>
                  </View>
                  <View style={styles.createRoomReviewHalfCard}>
                    <Text style={styles.createRoomReviewLabel}>PRIVACY</Text>
                    <Text style={styles.createRoomReviewValue}>{isPrivateRoom ? "Private" : "Public"}</Text>
                  </View>
                </View>

                {roomMode !== "livestream" && (
                  <View style={styles.createRoomReviewCard}>
                    <Text style={styles.createRoomReviewLabel}>VENUE</Text>
                    <Text style={styles.createRoomReviewValue} numberOfLines={1}>
                      {venueName.trim() || (currentLocation ? "Current location" : "Not set")}
                    </Text>
                  </View>
                )}
              </View>
            </Animated.View>
          </View>

          <View style={[styles.createRoomFooter, { paddingBottom: Math.max(insets.bottom, 14) }]}>
            <TouchableOpacity
              style={styles.createRoomBackButton}
              onPress={currentCreateStep === 0 ? closeCreateRoom : goToPreviousCreateStep}
              disabled={loading}
            >
              <Text style={styles.createRoomBackButtonText}>
                {currentCreateStep === 0 ? "Cancel" : "Back"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.createRoomPrimaryButton, loading && styles.createRoomButtonDisabled]}
              onPress={currentCreateStep < 3 ? goToNextCreateStep : createRoom}
              disabled={loading}
            >
              <Text style={styles.createRoomPrimaryButtonText}>
                {currentCreateStep < 3
                  ? "Next"
                  : loading
                    ? "Creating..."
                    : roomStatus === "scheduled"
                      ? "Schedule Room"
                      : "Open Room"}
              </Text>
              {currentCreateStep < 3 && <Icon name="chevronRight" size={18} color="#FFFFFF" />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
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
    marginTop: 16,
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
    marginBottom: 32,
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
  createRoomModal: {
    backgroundColor: "#0D0713",
    flex: 1,
  },
  createRoomHeader: {
    borderBottomColor: "#271B31",
    borderBottomWidth: 1,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  createRoomTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  createRoomBrand: {
    color: "#C899FF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
  },
  createRoomTitle: {
    color: "#FFFFFF",
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: 0,
    marginTop: 2,
  },
  createRoomCloseButton: {
    alignItems: "center",
    backgroundColor: "#1D1524",
    borderColor: "#382843",
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  createRoomProgressRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 16,
  },
  createRoomProgressTrack: {
    backgroundColor: "#302536",
    borderRadius: 3,
    flex: 1,
    height: 5,
  },
  createRoomProgressTrackActive: {
    backgroundColor: "#9146FF",
  },
  createRoomStepRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  createRoomStepName: {
    color: "#C8BECF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  createRoomStepCount: {
    color: "#7D7484",
    fontSize: 11,
    fontWeight: "900",
  },
  createRoomViewport: {
    flex: 1,
    overflow: "hidden",
  },
  createRoomPages: {
    flex: 1,
    flexDirection: "row",
  },
  createRoomPage: {
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  createRoomPageCompact: {
    gap: 10,
    paddingVertical: 10,
  },
  createRoomWhenPage: {
    gap: 12,
  },
  createRoomReviewPage: {
    gap: 10,
  },
  createRoomPageIntro: {
    gap: 2,
  },
  createRoomPageTitle: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 0,
  },
  createRoomFieldLabel: {
    color: "#D7CFDC",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 7,
  },
  createRoomInput: {
    backgroundColor: "#08060B",
    borderColor: "#2A2032",
    borderRadius: 8,
    borderWidth: 1,
    color: "#FFFFFF",
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  createRoomTypeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  createRoomTypeOption: {
    alignItems: "center",
    backgroundColor: "#17111D",
    borderColor: "#362641",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: "31%",
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 8,
  },
  createRoomOptionActive: {
    backgroundColor: "#7130D5",
    borderColor: "#A967FF",
  },
  createRoomOptionText: {
    color: "#CDB7DD",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  createRoomOptionTextActive: {
    color: "#FFFFFF",
  },
  createRoomSegmentedControl: {
    backgroundColor: "#08060B",
    borderColor: "#2A2032",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    padding: 4,
  },
  createRoomSegment: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 6,
  },
  createRoomSegmentActive: {
    backgroundColor: "#7130D5",
  },
  createRoomSegmentText: {
    color: "#958A9E",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  createRoomLivePanel: {
    alignItems: "center",
    backgroundColor: "#0D251E",
    borderColor: "#194D3C",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    padding: 16,
  },
  createRoomLiveDot: {
    backgroundColor: "#34D399",
    borderRadius: 6,
    height: 12,
    marginRight: 12,
    width: 12,
  },
  createRoomLiveCopy: {
    flex: 1,
  },
  createRoomLiveTitle: {
    color: "#D1FAE5",
    fontSize: 15,
    fontWeight: "900",
  },
  createRoomLiveText: {
    color: "#8EC8B2",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  createRoomScheduleContent: {
    gap: 10,
  },
  createRoomCalendar: {
    backgroundColor: "#15101A",
    borderColor: "#35243F",
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  createRoomCalendarHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  createRoomCalendarArrow: {
    alignItems: "center",
    backgroundColor: "#211827",
    borderRadius: 6,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  createRoomCalendarMonth: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  createRoomCalendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  createRoomWeekday: {
    color: "#756C7D",
    fontSize: 10,
    fontWeight: "900",
    height: 18,
    textAlign: "center",
    width: "14.2857%",
  },
  createRoomCalendarDay: {
    alignItems: "center",
    borderRadius: 6,
    height: 29,
    justifyContent: "center",
    width: "14.2857%",
  },
  createRoomCalendarDayCompact: {
    height: 25,
  },
  createRoomCalendarDayActive: {
    backgroundColor: "#7C3AED",
  },
  createRoomCalendarDayText: {
    color: "#DCD4E2",
    fontSize: 12,
    fontWeight: "800",
  },
  createRoomCalendarDayTextDisabled: {
    color: "#403746",
  },
  createRoomTimePanel: {
    backgroundColor: "#15101A",
    borderColor: "#35243F",
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  createRoomTimeHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  createRoomTimeValue: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  createRoomSliderRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 34,
  },
  createRoomSliderLabel: {
    color: "#948A9C",
    fontSize: 11,
    fontWeight: "800",
    width: 35,
  },
  createRoomSlider: {
    flex: 1,
    height: 34,
    justifyContent: "center",
  },
  createRoomSliderTrack: {
    backgroundColor: "#3B3347",
    borderRadius: 3,
    height: 5,
    position: "relative",
  },
  createRoomSliderFill: {
    backgroundColor: "#9146FF",
    borderRadius: 3,
    height: 5,
  },
  createRoomSliderThumb: {
    backgroundColor: "#C899FF",
    borderColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    position: "absolute",
    top: -8,
    width: 20,
  },
  createRoomSliderValue: {
    color: "#DCC4FF",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "right",
    width: 25,
  },
  createRoomPeriodControl: {
    alignSelf: "flex-end",
    backgroundColor: "#08060B",
    borderRadius: 6,
    flexDirection: "row",
    padding: 3,
    width: 132,
  },
  createRoomPeriodOption: {
    alignItems: "center",
    borderRadius: 5,
    flex: 1,
    justifyContent: "center",
    minHeight: 30,
  },
  createRoomSettingRow: {
    alignItems: "center",
    backgroundColor: "#15101A",
    borderColor: "#302339",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 68,
    padding: 12,
  },
  createRoomSettingTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  createRoomSettingCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  createRoomSettingHint: {
    color: "#7F7587",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  createRoomStepper: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  createRoomStepperButton: {
    alignItems: "center",
    backgroundColor: "#2A1C33",
    borderRadius: 6,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  createRoomStepperSymbol: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "700",
  },
  createRoomCapacityInput: {
    backgroundColor: "#21152B",
    borderColor: "#7C3AED",
    borderRadius: 6,
    borderWidth: 1,
    color: "#C899FF",
    fontSize: 16,
    fontWeight: "900",
    height: 38,
    minWidth: 48,
    paddingHorizontal: 6,
    paddingVertical: 0,
    textAlign: "center",
  },
  createRoomLocationBlock: {
    gap: 8,
  },
  createRoomSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#211827",
    borderColor: "#453053",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  createRoomSecondaryButtonActive: {
    backgroundColor: "#153328",
    borderColor: "#28634F",
  },
  createRoomSecondaryButtonText: {
    color: "#D8B4FE",
    fontSize: 13,
    fontWeight: "800",
  },
  createRoomCoverRow: {
    alignItems: "center",
    backgroundColor: "#15101A",
    borderColor: "#302339",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 68,
    padding: 8,
  },
  createRoomCoverPlaceholder: {
    alignItems: "center",
    backgroundColor: "#27172F",
    borderRadius: 6,
    height: 50,
    justifyContent: "center",
    width: 72,
  },
  createRoomCoverPreview: {
    borderRadius: 6,
    height: 50,
    width: 72,
  },
  createRoomCoverCopy: {
    flex: 1,
    paddingHorizontal: 12,
  },
  createRoomPrivacyCopy: {
    flex: 1,
    paddingRight: 12,
  },
  createRoomReviewHero: {
    backgroundColor: "#15101A",
    borderColor: "#382545",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 82,
    overflow: "hidden",
  },
  createRoomReviewCover: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.32,
  },
  createRoomReviewHeroCopy: {
    flex: 1,
    justifyContent: "center",
    padding: 14,
  },
  createRoomReviewLabel: {
    color: "#C899FF",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0,
  },
  createRoomReviewTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    marginTop: 3,
  },
  createRoomReviewMeta: {
    color: "#AAA0B2",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  createRoomReviewCard: {
    backgroundColor: "#15101A",
    borderColor: "#302339",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 68,
    padding: 12,
  },
  createRoomReviewGrid: {
    flexDirection: "row",
    gap: 10,
  },
  createRoomReviewHalfCard: {
    backgroundColor: "#15101A",
    borderColor: "#302339",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 68,
    padding: 12,
  },
  createRoomReviewValue: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  createRoomFooter: {
    alignItems: "center",
    backgroundColor: "#100817",
    borderTopColor: "#2A1C33",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  createRoomBackButton: {
    alignItems: "center",
    borderColor: "#3B2B45",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  createRoomBackButtonText: {
    color: "#D7CEDD",
    fontSize: 14,
    fontWeight: "900",
  },
  createRoomPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#8338EC",
    borderRadius: 8,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  createRoomPrimaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  createRoomButtonDisabled: {
    opacity: 0.55,
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
