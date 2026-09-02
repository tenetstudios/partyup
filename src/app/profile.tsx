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
import { updateMyProfile } from "../../lib/profileUpdates";

export function PublicProfileEditor({ onboarding = false }: { onboarding?: boolean }) {
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
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
      .select("username, avatar_url, bio, location")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.log("LOAD PROFILE ERROR:", error);
      return;
    }

    const metadataName =
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name.trim()
        : "";

    if (data) {
      setUsername(data.username || metadataName);
      setAvatarUrl(data.avatar_url || "");
      setBio(data.bio || "");
      setLocation(data.location || "");
    } else if (metadataName) {
      setUsername(metadataName);
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

    try {
      const result = await updateMyProfile(supabase, {
        username,
        avatarUrl: avatarUrl.trim(),
        bio: bio.trim(),
        location: location.trim(),
        updateDetails: true,
      });

      if (result.status !== "updated") {
        Alert.alert(
          result.status === "name_taken" ? "Name already taken" : "Profile save error",
          result.message,
        );
        return;
      }

      if (result.username) {
        setUsername(result.username);
      }

      Alert.alert("Saved", result.message);
      if (onboarding) router.replace("/home");
    } catch (error: unknown) {
      Alert.alert(
        "Profile save error",
        error instanceof Error ? error.message : "Your profile could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>{onboarding ? "Choose your name" : "Public Profile"}</Text>

      <TouchableOpacity
  onPress={() => router.back()}
  style={styles.closeButton}
>
  <Text style={styles.closeButtonText}>✕</Text>
</TouchableOpacity>

      <Text style={styles.subtitle}>This is the information other people see across PartyUp.</Text>

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
          onChangeText={(value) => setUsername(value.slice(0, 40))}
          placeholder="PartyUp name"
          placeholderTextColor="#777"
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={40}
          style={styles.input}
        />

        <Text style={styles.nameHint}>
          2–40 characters. PartyUp names are unique regardless of capitalization.
        </Text>

        <TextInput
          value={bio}
          onChangeText={(value) => setBio(value.slice(0, 280))}
          placeholder="Short bio"
          placeholderTextColor="#777"
          multiline
          style={[styles.input, { height: 100 }]}
        />

        <TextInput
          value={location}
          onChangeText={(value) => setLocation(value.slice(0, 80))}
          placeholder="General location (city or region)"
          placeholderTextColor="#777"
          maxLength={80}
          style={styles.input}
        />

        <TouchableOpacity style={styles.button} onPress={saveProfile}>
          <Text style={styles.buttonText}>
            {saving ? "Saving..." : "Save Profile"}
          </Text>
        </TouchableOpacity>

        {onboarding && (
          <TouchableOpacity style={styles.skipButton} onPress={() => router.replace("/home")}>
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

export default function Profile() {
  return <PublicProfileEditor onboarding />;
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
  nameHint: {
    color: "#9C95AA",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
    marginTop: -8,
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
  closeButton: {
  position: "absolute",
  top: 54,
  right: 22,
  width: 42,
  height: 42,
  borderRadius: 999,
  backgroundColor: "#14141F",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 50,
},

closeButtonText: {
  color: "#FFFFFF",
  fontSize: 18,
  fontWeight: "900",
},

signOutButton: {
  marginTop: 24,
  backgroundColor: "#ff4d4f",
  paddingVertical: 14,
  borderRadius: 12,
  alignItems: "center",
},

signOutText: {
  color: "#fff",
  fontSize: 16,
  fontWeight: "700",
},
accountDivider: {
  backgroundColor: "#2A2140",
  height: 1,
  marginTop: 24,
},
accountSettingsTitle: {
  color: "#FFFFFF",
  fontSize: 18,
  fontWeight: "900",
  marginTop: 22,
},
accountSettingsCopy: {
  color: "#9C95AA",
  fontSize: 13,
  lineHeight: 19,
  marginTop: 6,
},
accountLinks: {
  backgroundColor: "#0D0D15",
  borderColor: "#2A2140",
  borderRadius: 12,
  borderWidth: 1,
  marginTop: 16,
  overflow: "hidden",
},
accountLink: {
  alignItems: "center",
  borderBottomColor: "#2A2140",
  borderBottomWidth: 1,
  flexDirection: "row",
  justifyContent: "space-between",
  paddingHorizontal: 16,
  paddingVertical: 14,
},
accountLinkLast: {
  borderBottomWidth: 0,
},
accountLinkText: {
  color: "#FFFFFF",
  fontSize: 15,
  fontWeight: "700",
},
accountLinkArrow: {
  color: "#A78BFA",
  fontSize: 24,
  lineHeight: 24,
},
deleteAccountButton: {
  alignItems: "center",
  borderColor: "#FF6B6B",
  borderRadius: 12,
  borderWidth: 1,
  marginTop: 12,
  paddingVertical: 14,
},
deleteAccountText: {
  color: "#FF8A8A",
  fontSize: 16,
  fontWeight: "800",
},
disabledButton: {
  opacity: 0.55,
},
});
