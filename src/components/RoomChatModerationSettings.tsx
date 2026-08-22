import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import {
  getRoomModerationSettings,
  setRoomModerationSettings,
  type ChatLinksMode,
  type ChatModerationPreset,
  type RoomModerationSettings,
} from "../../lib/chatModeration";

const presets: { value: ChatModerationPreset; label: string; description: string }[] = [
  { value: "relaxed", label: "Relaxed", description: "Normal conversation with duplicate-spam protection." },
  { value: "social", label: "Social", description: "Adds a 5-second slow mode for busier rooms." },
  { value: "host_only", label: "Host Only", description: "Only hosts and bouncers can post." },
];

const links: { value: ChatLinksMode; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "hosts_only", label: "Hosts & bouncers only" },
];

export default function RoomChatModerationSettings({ roomId }: { roomId: string }) {
  const [settings, setSettings] = useState<RoomModerationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSettings(await getRoomModerationSettings(supabase, roomId));
  }, [roomId]);

  useEffect(() => {
    void load().catch((reason) => {
      setStatus(reason instanceof Error ? reason.message : "Could not load chat moderation settings.");
    });
  }, [load]);

  async function save(preset: ChatModerationPreset, linksMode: ChatLinksMode) {
    if (!settings || saving) return;
    setSaving(true);
    setStatus(null);

    try {
      setSettings(await setRoomModerationSettings(supabase, roomId, preset, linksMode));
      setStatus("Chat moderation updated.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Could not update chat moderation.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>HOST CONTROL</Text>
      <Text style={styles.title}>Chat Moderation</Text>
      <Text style={styles.description}>Ordinary profanity is allowed. These controls focus on spam and room management.</Text>

      <Text style={styles.label}>Preset</Text>
      <View style={styles.optionGrid}>
        {presets.map((option) => {
          const selected = settings.preset === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: saving }}
              disabled={saving}
              onPress={() => void save(option.value, settings.links_mode)}
              style={[styles.presetOption, selected && styles.selectedOption]}
            >
              <Text style={[styles.optionTitle, selected && styles.selectedText]}>{option.label}</Text>
              <Text style={[styles.optionDescription, selected && styles.selectedDescription]}>{option.description}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Links</Text>
      <View style={styles.linkRow}>
        {links.map((option) => {
          const selected = settings.links_mode === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: saving }}
              disabled={saving}
              onPress={() => void save(settings.preset, option.value)}
              style={[styles.linkOption, selected && styles.selectedOption]}
            >
              <Text style={[styles.linkText, selected && styles.selectedText]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {saving ? <Text style={styles.status}>Saving moderation settings...</Text> : null}
      {status && !saving ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(17,16,27,0.96)",
    borderColor: "rgba(196,181,253,0.34)",
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 14,
    padding: 18,
  },
  eyebrow: { color: "#C4B5FD", fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginTop: 6 },
  description: { color: "#A1A1AA", fontSize: 13, lineHeight: 19, marginTop: 6 },
  label: { color: "#E9D5FF", fontSize: 13, fontWeight: "900", marginBottom: 9, marginTop: 18 },
  optionGrid: { gap: 10 },
  presetOption: {
    backgroundColor: "#08080D",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  selectedOption: { backgroundColor: "#7C3AED", borderColor: "#C4B5FD" },
  optionTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  selectedText: { color: "#FFFFFF" },
  optionDescription: { color: "#A1A1AA", fontSize: 12, lineHeight: 18, marginTop: 4 },
  selectedDescription: { color: "#EDE9FE" },
  linkRow: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  linkOption: {
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 17,
  },
  linkText: { color: "#D4D4D8", fontSize: 13, fontWeight: "900" },
  status: { color: "#C4B5FD", fontSize: 12, fontWeight: "800", marginTop: 14 },
});
