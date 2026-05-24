import { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";

export default function Profile() {
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("username, avatar_url, bio")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.log("LOAD PROFILE ERROR:", error);
      return;
    }

    if (data) {
      setUsername(data.username || "");
      setAvatarUrl(data.avatar_url || "");
      setBio(data.bio || "");
    }
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        "Permission required",
        "Camera roll access is required to upload a profile photo."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]?.uri) {
      return;
    }

    await uploadImage(result.assets[0].uri);
  }

  async function uploadImage(uri: string) {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    Alert.alert(
      "Sign in required",
      "You must be signed in to upload an avatar."
    );
    return;
  }

  try {
    setUploading(true);

    const fileExt =
      uri.split(".").pop()?.split("?")[0] || "jpg";

    const filePath =
      `${user.id}/avatar_${Date.now()}.${fileExt}`;

    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("profile-images")
      .upload(filePath, arrayBuffer, {
        contentType: `image/${fileExt === "png" ? "png" : "jpeg"}`,
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const {
      data: { publicUrl },
    } = supabase.storage
      .from("profile-images")
      .getPublicUrl(filePath);

    if (!publicUrl) {
      throw new Error("Failed to get public avatar URL.");
    }

    setAvatarUrl(publicUrl);
  } catch (error: any) {
    console.log("UPLOAD AVATAR ERROR:", error);

    Alert.alert(
      "Upload failed",
      error?.message || "Could not upload avatar."
    );
  } finally {
    setUploading(false);
  }
}

  async function saveProfile() {
    if (!username.trim()) {
      Alert.alert("Validation", "Enter a username.");
      return;
    }

    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      setSaving(false);
      Alert.alert("Sign in required", "You need to sign in first.");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          username: username.trim(),
          avatar_url: avatarUrl.trim(),
          bio: bio.trim(),
        },
        { onConflict: "id" }
      )
      .select();

    setSaving(false);

    if (error) {
      Alert.alert("Profile save error", error.message);
      return;
    }

    Alert.alert("Saved", "Your profile was updated.");
    router.replace("/home");
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>Choose your name</Text>

      <Text style={styles.subtitle}>
        This is how people see you in rooms.
      </Text>

      <View style={styles.card}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatarPreview} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarFallbackText}>Upload</Text>
          </View>
        )}

        <TouchableOpacity style={styles.uploadButton} onPress={pickImage}>
          <Text style={styles.uploadButtonText}>
            {uploading ? "Uploading…" : "Upload profile photo"}
          </Text>
        </TouchableOpacity>

        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Username"
          placeholderTextColor="#777"
          style={styles.input}
        />

        <TextInput
          value={bio}
          onChangeText={setBio}
          placeholder="Short bio"
          placeholderTextColor="#777"
          multiline
          style={[styles.input, { height: 100 }]}
        />

        <TouchableOpacity style={styles.button} onPress={saveProfile}>
          <Text style={styles.buttonText}>
            {saving ? "Saving..." : "Save Profile"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => router.replace("/home")}
        >
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
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
    minHeight: "100%",
    padding: 24,
    paddingTop: 90,
    paddingBottom: 60,
  },
  title: {
    color: "white",
    fontSize: 34,
    fontWeight: "900",
  },
  subtitle: {
    color: "#A78BFA",
    marginTop: 8,
    marginBottom: 28,
  },
  card: {
    backgroundColor: "#11111A",
    borderColor: "#2A2140",
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
  },
  input: {
    color: "white",
    backgroundColor: "#08080D",
    borderColor: "#2A2140",
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#7C3AED",
    paddingVertical: 15,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonText: {
    color: "white",
    fontWeight: "800",
  },
  uploadButton: {
    backgroundColor: "#5B21B6",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
    marginBottom: 18,
  },
  uploadButtonText: {
    color: "white",
    fontWeight: "800",
  },
  avatarPreview: {
    width: 120,
    height: 120,
    borderRadius: 100,
    marginBottom: 18,
    alignSelf: "center",
  },
  avatarFallback: {
    width: 120,
    height: 120,
    borderRadius: 100,
    backgroundColor: "#1F1B33",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
    alignSelf: "center",
  },
  avatarFallbackText: {
    color: "#A78BFA",
    fontWeight: "700",
  },
  skipButton: {
    marginTop: 18,
    alignItems: "center",
  },
  skipText: {
    color: "#777",
    fontWeight: "700",
  },
});