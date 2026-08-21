import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getMemoryPublicUrl, getRoomMemories, saveRoomMemory, unsaveRoomMemory, type RoomMemory } from "../../../lib/memories";
import { getEventRecap, getRecapConnectionName, selectRecapMemories, type EventRecap } from "../../../lib/recaps";

function initials(value: string) { return value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }

export default function EventRecapScreen() {
  const { roomId: routeRoomId } = useLocalSearchParams<{ roomId: string }>();
  const roomId = String(routeRoomId || "");
  const [recap, setRecap] = useState<EventRecap | null>(null);
  const [memories, setMemories] = useState<RoomMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!roomId) return;
    setLoading(true); setError(null);
    try {
      const nextRecap = await getEventRecap(roomId);
      const allMemories = await getRoomMemories(roomId);
      setRecap(nextRecap);
      setMemories(selectRecapMemories(allMemories, nextRecap.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "This recap is unavailable."); }
    finally { setLoading(false); }
  }, [roomId]);

  useEffect(() => { void load(); }, [load]);

  async function toggleSaved(memory: RoomMemory) {
    if (processingId) return;
    const nextSaved = !memory.is_saved;
    setProcessingId(memory.id);
    setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, is_saved: nextSaved } : item));
    try { if (nextSaved) await saveRoomMemory(memory.id); else await unsaveRoomMemory(memory.id); }
    catch (reason) { setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, is_saved: !nextSaved } : item)); setError(reason instanceof Error ? reason.message : "Could not update this Memory."); }
    finally { setProcessingId(null); }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color="#C35DFF" size="large" /><Text style={styles.loadingText}>Opening your recap...</Text></View>;
  if (!recap) return <View style={styles.center}><Text style={styles.errorTitle}>Recap unavailable</Text><Text style={styles.errorText}>{error || "This event recap could not be found."}</Text><TouchableOpacity onPress={() => router.push("/activity")}><Text style={styles.activityLink}>Back to Activity</Text></TouchableOpacity></View>;

  const metrics = [[recap.metrics.people, "people were here"], [recap.metrics.memories, "Memories posted"], [recap.metrics.matches, "Matches happened"], [recap.metrics.connections, "Connections made"]] as const;

  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <View style={styles.hero}>{recap.cover_image_url ? <Image source={{ uri: recap.cover_image_url }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={180} /> : null}<View style={styles.heroShade} /><TouchableOpacity style={styles.backButton} onPress={() => router.push("/activity")} accessibilityLabel="Back to Activity"><Ionicons name="arrow-back" color="#FFFFFF" size={22} /></TouchableOpacity><View style={styles.heroCopy}><Text style={styles.eyebrowPink}>LAST NIGHT</Text><Text style={styles.title}>Last Night at {recap.room_title}</Text><Text style={styles.date}>{new Date(recap.event_date).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</Text></View></View>
    {error && <Text style={styles.inlineError}>{error}</Text>}
    <View style={styles.section}><Text style={styles.eyebrowPurple}>FROM THE ROOM</Text><Text style={styles.sectionTitle}>Memories</Text>{memories.length === 0 ? <Text style={styles.emptyText}>No Memories from this event are available now.</Text> : <View style={styles.memoryGrid}>{memories.map((memory) => { const url = getMemoryPublicUrl(memory.media_path); return <View key={memory.id} style={styles.memoryItem}><TouchableOpacity style={styles.memoryMedia} activeOpacity={memory.media_type === "video" ? 0.72 : 1} onPress={memory.media_type === "video" ? () => void Linking.openURL(url) : undefined}>{memory.media_type === "image" ? <Image source={{ uri: url }} style={styles.memoryImage} contentFit="cover" transition={150} /> : <View style={styles.videoPlaceholder}><Ionicons name="play" size={27} color="#FFFFFF" /><Text style={styles.videoText}>Open video</Text></View>}</TouchableOpacity><View style={styles.memoryMeta}><Text numberOfLines={1} style={styles.uploader}>{memory.uploader_name || "Guest"}</Text><TouchableOpacity style={[styles.saveButton, memory.is_saved && styles.saveButtonActive]} disabled={processingId === memory.id} onPress={() => void toggleSaved(memory)} accessibilityLabel={memory.is_saved ? "Unsave Memory" : "Save Memory"}><Ionicons name={memory.is_saved ? "bookmark" : "bookmark-outline"} color="#FFFFFF" size={17} /></TouchableOpacity></View></View>; })}</View>}</View>
    <View style={styles.section}><Text style={styles.eyebrowPink}>STILL WITH YOU</Text><Text style={styles.sectionTitle}>People You Kept</Text>{recap.connections.length === 0 ? <Text style={styles.emptyText}>No event Connections to show.</Text> : <View style={styles.peopleList}>{recap.connections.map((connection) => { const name = getRecapConnectionName(connection); return <TouchableOpacity key={connection.connection_id} disabled={!connection.profile_user_id} onPress={() => connection.profile_user_id && router.push(`/user/${connection.profile_user_id}`)} style={styles.personRow}><View style={styles.avatar}>{connection.avatar_url ? <Image source={{ uri: connection.avatar_url }} style={styles.avatarImage} contentFit="cover" /> : <Text style={styles.avatarText}>{initials(name)}</Text>}</View><View style={styles.personCopy}><Text style={styles.personName}>{name}</Text><Text style={styles.connected}>Connected</Text></View><Ionicons name="chevron-forward" size={18} color={connection.profile_user_id ? "#8F8899" : "transparent"} /></TouchableOpacity>; })}</View>}</View>
    <View style={styles.section}><Text style={styles.sectionTitle}>The night in a few numbers</Text><View style={styles.metrics}>{metrics.map(([value, label]) => <View key={label} style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>)}</View><Text style={styles.personal}>You kept {recap.personal.connections} {recap.personal.connections === 1 ? "person" : "people"} and saved {recap.personal.saved_memories} {recap.personal.saved_memories === 1 ? "Memory" : "Memories"}.</Text></View>
    {recap.host_message && <View style={styles.hostMessage}><Text style={styles.hostLabel}>FROM YOUR HOST</Text><Text style={styles.hostCopy}>{recap.host_message}</Text></View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#05040B" }, content: { paddingBottom: 90 }, center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#05040B" }, loadingText: { marginTop: 14, color: "#AAA4B8", fontWeight: "700" }, errorTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "900" }, errorText: { marginTop: 10, color: "#AAA4B8", textAlign: "center", lineHeight: 21 }, activityLink: { marginTop: 24, color: "#C35DFF", fontWeight: "900" },
  hero: { height: 390, justifyContent: "flex-end", backgroundColor: "#160B20", overflow: "hidden" }, heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,4,11,0.6)" }, backButton: { position: "absolute", top: 54, left: 20, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "rgba(5,4,11,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" }, heroCopy: { padding: 22, paddingBottom: 30 }, eyebrowPink: { color: "#FF63A8", fontSize: 12, fontWeight: "900", letterSpacing: 0.8 }, eyebrowPurple: { color: "#C35DFF", fontSize: 12, fontWeight: "900", letterSpacing: 0.8 }, title: { marginTop: 10, color: "#FFFFFF", fontSize: 40, lineHeight: 45, fontWeight: "900", letterSpacing: 0 }, date: { marginTop: 14, color: "#D1CAD8", fontSize: 14, fontWeight: "700" }, inlineError: { margin: 20, padding: 14, color: "#FDE68A", backgroundColor: "rgba(120,53,15,0.35)", borderRadius: 6 },
  section: { paddingHorizontal: 20, paddingTop: 38 }, sectionTitle: { marginTop: 7, color: "#FFFFFF", fontSize: 28, lineHeight: 34, fontWeight: "900", letterSpacing: 0 }, emptyText: { marginTop: 16, color: "#AAA4B8", fontSize: 14, lineHeight: 21 }, memoryGrid: { marginTop: 20, flexDirection: "row", flexWrap: "wrap", gap: 10 }, memoryItem: { width: "48.4%", backgroundColor: "#10101A", borderWidth: 1, borderColor: "#262131", borderRadius: 6, overflow: "hidden" }, memoryMedia: { width: "100%", aspectRatio: 1, backgroundColor: "#09080D" }, memoryImage: { width: "100%", height: "100%" }, videoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#171322" }, videoText: { color: "#D8D2DF", fontSize: 11, fontWeight: "800" }, memoryMeta: { height: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 10 }, uploader: { flex: 1, color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, saveButton: { width: 42, height: 46, alignItems: "center", justifyContent: "center", backgroundColor: "#17151E" }, saveButtonActive: { backgroundColor: "#7C3AED" },
  peopleList: { marginTop: 18, borderTopWidth: 1, borderTopColor: "#24202C" }, personRow: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 13, borderBottomWidth: 1, borderBottomColor: "#24202C" }, avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: "#7C3AED" }, avatarImage: { width: "100%", height: "100%" }, avatarText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" }, personCopy: { flex: 1 }, personName: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" }, connected: { marginTop: 3, color: "#AAA4B8", fontSize: 12, fontWeight: "700" },
  metrics: { marginTop: 20, flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#292330" }, metric: { width: "50%", minHeight: 112, padding: 17, justifyContent: "center", borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#292330", backgroundColor: "#10101A" }, metricValue: { color: "#D8B4FE", fontSize: 29, fontWeight: "900" }, metricLabel: { marginTop: 7, color: "#AAA4B8", fontSize: 12, lineHeight: 17, fontWeight: "700" }, personal: { marginTop: 18, color: "#B8B2C8", fontSize: 14, lineHeight: 21, fontWeight: "700" }, hostMessage: { marginHorizontal: 20, marginTop: 42, paddingVertical: 23, paddingHorizontal: 20, borderLeftWidth: 2, borderLeftColor: "#FF63A8", backgroundColor: "#140D19" }, hostLabel: { color: "#FF82B8", fontSize: 11, fontWeight: "900", letterSpacing: 0.8 }, hostCopy: { marginTop: 11, color: "#FFFFFF", fontSize: 19, lineHeight: 28, fontWeight: "800" },
});
