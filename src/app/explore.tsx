import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Animated,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { supabase } from "../../lib/supabase";
import { Ionicons } from "@expo/vector-icons";

type Room = {
  id: string;
  title: string;
  type?: string | null;
  mode?: string | null;
  venue_name?: string | null;
  current_users?: number | null;
  max_users?: number | null;
  queue_count?: number | null;
  latitude: number;
  longitude: number;
};

const TORONTO_REGION = {
  latitude: 43.6532,
  longitude: -79.3832,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

const FILTERS = [
  "All",
  "Party",
  "Concert",
  "DJ Set",
  "Pop-Up",
  "Sports",
  "Watch Party",
];

export default function ExploreScreen() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const mapRef = useRef<MapView | null>(null);

  const cardAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("event_rooms")
        .select("*")
        .eq("status", "live")
        .not("latitude", "is", null)
        .not("longitude", "is", null);

      if (error) {
        console.warn("Supabase fetch error", error.message);
        return;
      }

      if (!isMounted || !data) return;

      const parsed = data.map((r: any) => ({
        id: String(r.id),
        title: r.title ?? r.name ?? "Untitled",
        type: r.type ?? null,
        mode: r.mode ?? null,
        venue_name: r.venue_name ?? null,
        current_users: Number(r.current_users ?? 0),
        max_users: Number(r.max_users ?? 0),
        queue_count: Number(r.queue_count ?? 0),
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
      })) as Room[];

      setRooms(parsed);
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    Animated.timing(cardAnim, {
      toValue: selectedRoomId ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [selectedRoomId, cardAnim]);

  const filteredRooms = useMemo(() => {
    if (activeFilter === "All") return rooms;
    return rooms.filter((r) => (r.type ?? "").toLowerCase() === activeFilter.toLowerCase());
  }, [rooms, activeFilter]);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;

  const HeatmapComponent = (MapView as any).Heatmap;

  const handleMapPress = () => setSelectedRoomId(null);
  const handleMarkerPress = (roomId: string) => setSelectedRoomId(roomId);
  const onJoin = (roomId: string) => router.push(`/room/${roomId}`);

  const cardTranslateY = cardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [220, 0],
  });

  return (
    <View style={styles.container}>
      <MapView
        ref={(ref) => { (mapRef as any).current = ref; }}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={TORONTO_REGION}
        onPress={handleMapPress}
        customMapStyle={darkMapStyle}
      >
        {HeatmapComponent ? (
          <HeatmapComponent
            points={rooms.map((r) => ({ latitude: r.latitude, longitude: r.longitude, weight: (r.current_users ?? 0) + (r.queue_count ?? 0) }))}
            radius={50}
            opacity={0.6}
            gradient={{ colors: ["rgba(98,0,238,0.0)", "rgba(98,0,238,0.6)", "rgba(98,0,238,0.9)"], startPoints: [0.01, 0.25, 0.6], colorMapSize: 256 }}
          />
        ) : (
          rooms.map((r) => {
            const intensity = Math.max(1, (r.current_users ?? 0) + (r.queue_count ?? 0));
            const radius = Math.min(600, 80 + intensity * 60);
            return <Circle key={`heat-${r.id}`} center={{ latitude: r.latitude, longitude: r.longitude }} radius={radius} strokeColor={"rgba(98,0,238,0.08)"} fillColor={"rgba(98,0,238,0.18)"} />;
          })
        )}

        {filteredRooms.map((room) => (
          <Marker key={room.id} coordinate={{ latitude: room.latitude, longitude: room.longitude }} onPress={() => handleMarkerPress(room.id)} tracksViewChanges={false}>
            <View style={styles.markerWrap}>
              <View style={styles.markerOuter} />
              <View style={styles.markerInner} />
            </View>
          </Marker>
        ))}
      </MapView>

      <View style={styles.filtersContainer} pointerEvents="box-none">
        <TouchableOpacity
  style={styles.backButton}
  onPress={() => router.back()}
>
  <Ionicons
    name="arrow-back"
    size={22}
    color="#fff"
  />
</TouchableOpacity>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity key={f} onPress={() => setActiveFilter(f)} style={[styles.chip, activeFilter === f && styles.chipActive]}>
              <Text style={[styles.chipText, activeFilter === f && styles.chipTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <Animated.View pointerEvents={selectedRoom ? "auto" : "none"} style={[styles.previewWrap, { transform: [{ translateY: cardTranslateY }], opacity: cardAnim }]}>
        {selectedRoom ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{selectedRoom.title}</Text>
              <Text style={styles.cardMeta}>{selectedRoom.type ?? "—"} • {selectedRoom.mode ?? "—"}</Text>
            </View>

            <View style={styles.cardBody}>
              <Text style={styles.cardLine}>Venue: {selectedRoom.venue_name ?? "—"}</Text>
              <Text style={styles.cardLine}>Users: {selectedRoom.current_users ?? 0}/{selectedRoom.max_users ?? 0}</Text>
              <Text style={styles.cardLine}>Queue: {selectedRoom.queue_count ?? 0}</Text>
            </View>

            <View style={styles.cardFooter}>
              <Pressable style={styles.joinButton} onPress={() => onJoin(selectedRoom.id)}>
                <Text style={styles.joinButtonText}>Join</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  map: { ...StyleSheet.absoluteFillObject },
  filtersContainer: { position: "absolute", top: 48, width: "100%", paddingHorizontal: 12, zIndex: 20 },
  chipsRow: { paddingHorizontal: 6 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)" },
  chipActive: { backgroundColor: "rgba(98,0,238,0.12)", borderColor: "rgba(98,0,238,0.6)", shadowColor: "rgba(98,0,238,0.6)", shadowOpacity: 0.4, shadowRadius: 8 },
  chipText: { color: "#d6d1ff", fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  markerWrap: { alignItems: "center", justifyContent: "center" },
  markerOuter: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(98,0,238,0.18)", alignItems: "center", justifyContent: "center", shadowColor: "rgba(98,0,238,0.9)", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 6 },
  markerInner: { position: "absolute", width: 14, height: 14, borderRadius: 7, backgroundColor: "#6200ee", borderWidth: 2, borderColor: "#fff" },
  previewWrap: { position: "absolute", left: 12, right: 12, bottom: 28, zIndex: 40 },
  card: { backgroundColor: "#0b0b0d", borderRadius: 16, padding: 14, shadowColor: "rgba(98,0,238,0.7)", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 18, elevation: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.03)" },
  cardHeader: { marginBottom: 8 },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cardMeta: { color: "#cfc6ff", fontSize: 12, marginTop: 4 },
  cardBody: { marginVertical: 8 },
  cardLine: { color: "#d6d1ff", fontSize: 13, marginBottom: 4 },
  cardFooter: { flexDirection: "row", justifyContent: "flex-end" },
  joinButton: { backgroundColor: "#7b4bff", paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, shadowColor: "rgba(123,75,255,0.9)", shadowOpacity: 0.35, shadowRadius: 12 },
  joinButtonText: { color: "#fff", fontWeight: "700" },
  backButton: {
  position: "absolute",
  left: 18,
  bottom: -800,
  width: 48,
  height: 48,
  borderRadius: 24,
  backgroundColor: "rgba(20,20,30,0.85)",
  borderWidth: 1,
  borderColor: "rgba(123,75,255,0.4)",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 999,
},
});

const darkMapStyle = [
  {
    featureType: "poi",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "transit",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.business",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.attraction",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.place_of_worship",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative.land_parcel",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#09090F" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#14112A" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#24143D" }],
  },
  {
    featureType: "road",
    elementType: "labels",
    stylers: [{ visibility: "simplified" }],
  },
  {
    elementType: "labels.text.fill",
    stylers: [{ color: "#8e8b99" }],
  },
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#09090F" }],
  },
];
