import { StyleSheet, Text, View } from "react-native";
import IdleLoopMedia from "./IdleLoopMedia";
import type { RoomIdleMedia } from "../lib/roomIdleMedia";

type Props = {
  roomId: string;
  userId: string;
  canPublish: boolean;
  fullscreen?: boolean;
  onExitFullscreen?: () => void;
  onPublishingChange?: (publishing: boolean) => void;
  publishSignal?: number;
  stopSignal?: number;
  shouldConnect?: boolean;
  idleMedia?: RoomIdleMedia | null;
  expectedLive?: boolean;
};

export default function LiveKitRoomView({ idleMedia }: Props) {
  if (idleMedia?.enabled) {
    return <IdleLoopMedia media={idleMedia} />;
  }

  return (
    <View style={styles.placeholder}>
      <Text style={styles.title}>Live video is available in the PartyUp app.</Text>
      <Text style={styles.message}>You can keep using this room on the web.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: "center",
    backgroundColor: "#09090F",
    flex: 1,
    justifyContent: "center",
    minHeight: 240,
    padding: 24,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  message: {
    color: "#A1A1AA",
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
  },
});
