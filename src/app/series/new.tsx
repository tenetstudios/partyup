import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../../../lib/supabase";

export default function NewSeriesScreen() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function pickCover() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [16, 9], quality: 0.85 });
    if (!result.canceled) setCoverUri(result.assets[0].uri);
  }

  async function createSeries() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error("Sign in to create an Event Series.");
      let coverImageUrl: string | null = null;
      if (coverUri) {
        const extension = coverUri.split(".").pop()?.split("?")[0] || "jpg";
        const response = await fetch(coverUri);
        const bytes = await response.arrayBuffer();
        const path = `${user.id}/series-${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("event-images").upload(path, bytes, { contentType: `image/${extension === "png" ? "png" : "jpeg"}` });
        if (uploadError) throw uploadError;
        coverImageUrl = supabase.storage.from("event-images").getPublicUrl(path).data.publicUrl;
      }
      const { data, error } = await supabase.rpc("create_event_series", { p_name: name.trim(), p_description: description.trim() || null, p_cover_image_url: coverImageUrl });
      if (error) throw error;
      router.replace(`/series/${data}` as never);
    } catch (error) {
      Alert.alert("Could not create series", error instanceof Error ? error.message : "Please try again.");
      setSaving(false);
    }
  }

  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>Back</Text></TouchableOpacity>
    <Text style={styles.eyebrow}>HOST TOOLS</Text><Text style={styles.title}>Create Event Series</Text><Text style={styles.subtitle}>Give recurring events one persistent home.</Text>
    <Text style={styles.label}>Series name</Text><TextInput value={name} onChangeText={setName} maxLength={100} placeholder="Sundays @ XYZ" placeholderTextColor="#716B79" style={styles.input} />
    <Text style={styles.label}>Description</Text><TextInput value={description} onChangeText={setDescription} maxLength={1000} multiline placeholder="What people can expect each time" placeholderTextColor="#716B79" style={[styles.input, styles.textarea]} />
    <Text style={styles.label}>Cover image</Text><TouchableOpacity style={styles.coverButton} onPress={pickCover}>{coverUri ? <Image source={{ uri: coverUri }} style={styles.cover} contentFit="cover" /> : <View style={styles.coverEmpty}><Text style={styles.coverEmptyText}>Add cover image</Text></View>}</TouchableOpacity>
    <TouchableOpacity style={[styles.createButton, (!name.trim() || saving) && styles.disabled]} disabled={!name.trim() || saving} onPress={createSeries}><Text style={styles.createButtonText}>{saving ? "Creating..." : "Create Series"}</Text></TouchableOpacity>
  </ScrollView>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: "#05040B" }, content: { padding: 24, paddingTop: 54, paddingBottom: 60 }, back: { color: "#C9A6FF", fontWeight: "800" }, eyebrow: { color: "#FF63A8", fontSize: 11, fontWeight: "900", marginTop: 36 }, title: { color: "#FFF", fontSize: 36, fontWeight: "900", marginTop: 6 }, subtitle: { color: "#AAA4B8", fontSize: 15, marginTop: 8, marginBottom: 24 }, label: { color: "#FFF", fontSize: 14, fontWeight: "900", marginBottom: 8, marginTop: 18 }, input: { minHeight: 50, backgroundColor: "#111019", borderColor: "#2B2632", borderWidth: 1, borderRadius: 8, color: "#FFF", paddingHorizontal: 14 }, textarea: { height: 130, paddingTop: 14, textAlignVertical: "top" }, coverButton: { height: 170, borderRadius: 8, overflow: "hidden" }, cover: { width: "100%", height: "100%" }, coverEmpty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#17131E", borderColor: "#34263F", borderWidth: 1 }, coverEmptyText: { color: "#C9A6FF", fontWeight: "900" }, createButton: { alignItems: "center", backgroundColor: "#8B3DFF", borderRadius: 8, marginTop: 30, paddingVertical: 16 }, disabled: { opacity: 0.5 }, createButtonText: { color: "#FFF", fontWeight: "900", fontSize: 16 } });
