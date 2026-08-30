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
import { disablePushNotifications } from "../../lib/pushNotifications";
import { requestAccountDeletion } from "../lib/accountDeletion";
import NotificationSettings from "../components/NotificationSettings";

export default function Profile() {
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

    const metadataName =
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name.trim()
        : "";

    if (data) {
      setUsername(data.username || metadataName);
      setAvatarUrl(data.avatar_url || "");
      setBio(data.bio || "");
    } else if (metadataName) {
      setUsername(metadataName);
    }
  }

  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);

    const result = await requestAccountDeletion();
    setDeleting(false);

    if (result.status === "completed") {
      router.replace("/");
      return;
    }

    if (result.status === "reauthentication_required") {
      Alert.alert("Sign in again", result.message, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign In Again",
          onPress: () => {
            void supabase.auth.signOut({ scope: "local" }).finally(() => router.replace("/"));
          },
        },
      ]);
      return;
    }

    const supportReference = result.requestId ? `\n\nSupport reference: ${result.requestId}` : "";
    Alert.alert("Deletion failed", `${result.message}${supportReference}`);
  }

  function confirmAccountDeletion() {
    Alert.alert(
      "Delete Account",
      "This permanently deletes your PartyUp account and removes or anonymizes its associated personal data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete Account", style: "destructive", onPress: () => void deleteAccount() },
      ],
    );
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

      <TouchableOpacity
  onPress={() => router.back()}
  style={styles.closeButton}
>
  <Text style={styles.closeButtonText}>✕</Text>
</TouchableOpacity>

      <Text style={styles.subtitle}>
        This is how people see you in rooms.
      </Text>

      <NotificationSettings />

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

        <View style={styles.accountDivider} />
        <Text style={styles.accountSettingsTitle}>Account Settings</Text>
        <Text style={styles.accountSettingsCopy}>Manage your session or permanently delete your account.</Text>

        <TouchableOpacity
  style={styles.signOutButton}
  onPress={async () => {
    await disablePushNotifications().catch(() => undefined);
    const { error } = await supabase.auth.signOut({ scope: "local" });

    if (error) {
      Alert.alert("Sign-out error", error.message);
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (data.session) {
      Alert.alert("Sign-out error", "The local session could not be cleared. Please try again.");
      return;
    }

    router.replace("/");
  }}
>
  <Text style={styles.signOutText}>Sign Out</Text>
</TouchableOpacity>

        <TouchableOpacity
          style={[styles.deleteAccountButton, deleting && styles.disabledButton]}
          disabled={deleting}
          onPress={confirmAccountDeletion}
        >
          <Text style={styles.deleteAccountText}>{deleting ? "Deleting Account..." : "Delete Account"}</Text>
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
