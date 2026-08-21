import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { EventSeriesProfile, SeriesEvent, formatSeriesDate, getEventSeriesProfile } from "../../../lib/eventSeries";
import { supabase } from "../../../lib/supabase";

export default function SeriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [series, setSeries] = useState<EventSeriesProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const load = useCallback(async () => { if (!id) return; try { setSeries(await getEventSeriesProfile(id)); } catch (error) { Alert.alert("Series unavailable", error instanceof Error ? error.message : "Please try again."); } finally { setLoading(false); } }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function toggleFollow() {
    if (!series || processing) return; setProcessing(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { Alert.alert("Sign in required", "Sign in to follow this series."); setProcessing(false); return; }
    const { error } = await supabase.rpc("set_event_series_follow", { p_series_id: series.id, p_follow: !series.is_following });
    if (error) Alert.alert("Could not update follow", error.message); else await load();
    setProcessing(false);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color="#B875FF" /><Text style={styles.loading}>Loading series...</Text></View>;
  if (!series) return <View style={styles.center}><Text style={styles.title}>Series unavailable</Text></View>;
  const hostName = series.host.display_name || series.host.username || "PartyUp host";
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <View style={styles.hero}>{series.cover_image_url ? <Image source={{ uri: series.cover_image_url }} style={StyleSheet.absoluteFillObject} contentFit="cover" /> : null}<View style={styles.shade} /><TouchableOpacity style={styles.backButton} onPress={() => router.back()}><Text style={styles.back}>Back</Text></TouchableOpacity><View style={styles.heroCopy}><Text style={styles.eyebrow}>EVENT SERIES</Text><Text style={styles.title}>{series.name}</Text><TouchableOpacity style={styles.hostRow} onPress={() => router.push(`/user/${series.host.user_id}`)}>{series.host.avatar_url ? <Image source={{ uri: series.host.avatar_url }} style={styles.avatar} /> : <View style={styles.avatarFallback}><Text style={styles.avatarText}>{hostName.slice(0, 1).toUpperCase()}</Text></View>}<Text style={styles.hostName}>Hosted by {hostName}</Text></TouchableOpacity></View></View>
    <View style={styles.body}>{series.description ? <Text style={styles.description}>{series.description}</Text> : null}
      {!series.is_owner ? <TouchableOpacity style={styles.followButton} disabled={processing} onPress={toggleFollow}><Text style={styles.followText}>{series.is_following ? "Following" : "Follow Series"}</Text></TouchableOpacity> : <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push(`/series/${series.id}/edit` as never)}><Text style={styles.secondaryText}>Edit series</Text></TouchableOpacity>}
      <View style={styles.stats}><Stat value={series.total_events} label="Events" /><Stat value={series.follower_count} label="Followers" /><Stat value={series.returning_attendees} label="Returning" /></View>
      <EventList title="Upcoming events" empty="The next event has not been announced yet." events={series.upcoming_events} />
      <EventList title="Past events and recaps" empty="Completed events will stay here after their rooms end." events={series.past_events} />
    </View>
  </ScrollView>;
}

function Stat({ value, label }: { value: number; label: string }) { return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>; }
function EventList({ title, empty, events }: { title: string; empty: string; events: SeriesEvent[] }) { return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{events.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>{empty}</Text></View> : events.map((event) => <TouchableOpacity key={event.id} style={styles.event} onPress={() => router.push(`/room/${event.id}`)}>{event.cover_image_url ? <Image source={{ uri: event.cover_image_url }} style={styles.eventImage} /> : <View style={styles.eventFallback}><Text style={styles.avatarText}>PU</Text></View>}<View style={styles.eventCopy}><View style={styles.eventTop}><Text numberOfLines={1} style={styles.eventTitle}>{event.title}</Text><Text style={styles.status}>{event.status.toUpperCase()}</Text></View><Text style={styles.eventDate}>{formatSeriesDate(event.event_date)}</Text>{event.venue_name ? <Text numberOfLines={1} style={styles.eventMeta}>{event.venue_name}</Text> : null}<Text style={styles.eventStats}>{event.people_count} attended / {event.memory_count} Memories</Text></View></TouchableOpacity>)}</View>; }

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: "#05040B" }, content: { paddingBottom: 70 }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#05040B" }, loading: { color: "#AAA4B8", marginTop: 12 }, hero: { height: 390, backgroundColor: "#17131E", justifyContent: "flex-end" }, shade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,4,11,0.53)" }, backButton: { position: "absolute", left: 22, top: 56, padding: 8 }, back: { color: "#FFF", fontWeight: "900" }, heroCopy: { padding: 24, paddingBottom: 30 }, eyebrow: { color: "#FF83B8", fontSize: 11, fontWeight: "900" }, title: { color: "#FFF", fontSize: 39, fontWeight: "900", marginTop: 7 }, hostRow: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 18 }, avatar: { width: 38, height: 38, borderRadius: 19 }, avatarFallback: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#39264F" }, avatarText: { color: "#E8D5FF", fontWeight: "900" }, hostName: { color: "#E1DAE7", fontWeight: "800" }, body: { padding: 22 }, description: { color: "#CBC4D2", fontSize: 16, lineHeight: 25 }, followButton: { alignItems: "center", backgroundColor: "#8B3DFF", borderRadius: 8, marginTop: 22, paddingVertical: 14 }, followText: { color: "#FFF", fontWeight: "900" }, secondaryButton: { alignItems: "center", borderColor: "#51425F", borderWidth: 1, borderRadius: 8, marginTop: 22, paddingVertical: 14 }, secondaryText: { color: "#E4D5F5", fontWeight: "900" }, stats: { flexDirection: "row", gap: 8, marginTop: 24 }, stat: { flex: 1, minHeight: 82, justifyContent: "center", backgroundColor: "#111019", borderRadius: 8, padding: 12 }, statValue: { color: "#FFF", fontSize: 23, fontWeight: "900" }, statLabel: { color: "#9D94A4", fontSize: 10, fontWeight: "900", marginTop: 4, textTransform: "uppercase" }, section: { marginTop: 34 }, sectionTitle: { color: "#FFF", fontSize: 23, fontWeight: "900", marginBottom: 13 }, empty: { borderColor: "#332B3B", borderWidth: 1, borderRadius: 8, padding: 18 }, emptyText: { color: "#AAA4B8", lineHeight: 20 }, event: { flexDirection: "row", minHeight: 120, marginBottom: 11, backgroundColor: "#111019", borderRadius: 8, overflow: "hidden" }, eventImage: { width: 105, height: "100%" }, eventFallback: { width: 105, alignItems: "center", justifyContent: "center", backgroundColor: "#22152E" }, eventCopy: { flex: 1, padding: 13 }, eventTop: { flexDirection: "row", alignItems: "center", gap: 7 }, eventTitle: { color: "#FFF", flex: 1, fontSize: 15, fontWeight: "900" }, status: { color: "#CEC4D5", fontSize: 8, fontWeight: "900", backgroundColor: "#29252F", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 4 }, eventDate: { color: "#C9A6FF", fontSize: 12, fontWeight: "800", marginTop: 6 }, eventMeta: { color: "#AAA4B8", fontSize: 11, marginTop: 3 }, eventStats: { color: "#817A89", fontSize: 9, fontWeight: "900", marginTop: 10 } });
