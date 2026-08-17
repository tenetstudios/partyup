import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Animated,
  Pressable,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack, 
  useConnectionState,
  useLocalParticipant,
  useTracks,
  registerGlobals,
} from "@livekit/react-native";
import { ConnectionState, Track } from "livekit-client";
import { supabase } from "../../lib/supabase";
import type { TrackReference } from "@livekit/react-native";

registerGlobals();

type Props = {
  roomId: string;
  userId: string;
  canPublish: boolean;
  fullscreen?: boolean;
  onExitFullscreen?: () => void;
  onPublishingChange?: (publishing: boolean) => void;
  publishSignal?: number;
  stopSignal?: number;
};

function VideoGrid() {
 const tracks = useTracks([
  {
    source: Track.Source.Camera,
    withPlaceholder: false,
  },
  {
    source: Track.Source.Unknown,
    withPlaceholder: false,
  },
]);

  const videoTracks = tracks.filter(
  (trackRef: any): trackRef is TrackReference =>
    !!trackRef.publication?.track
);

  if (videoTracks.length === 0) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          Waiting for someone to go live...
        </Text>
      </View>
    );
  }

  const selectedTrack = videoTracks[0];

  return (
    <View style={styles.feedLayout}>
      <View style={styles.mainFeed}>
        <VideoTrack
          trackRef={selectedTrack}
          style={styles.video}
          objectFit="cover"
        />

        <View style={styles.feedNameBadge}>
          <Text style={styles.feedNameText}>
            {selectedTrack.participant.name ||
              selectedTrack.participant.identity ||
              "Live feed"}
          </Text>
        </View>
      </View>

    </View>
  );
}

function StreamControls({
  canPublish,
  publishSignal = 0,
  stopSignal = 0,
  onPublishingChange,
}: {
  canPublish: boolean;
  publishSignal?: number;
  stopSignal?: number;
  onPublishingChange?: (publishing: boolean) => void;
}) {
  const { localParticipant } = useLocalParticipant();

  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const lastPublishSignalRef = useRef(0);
  const lastStopSignalRef = useRef(0);


  async function toggleMic() {
    const next = !micOn;
    setMicOn(next);

    await localParticipant.setMicrophoneEnabled(next);
  }

 async function toggleCamera() {
  if (!canPublish) {
    Alert.alert(
      "Cannot Go Live",
      "The host has not approved you to stream yet."
    );
    return;
  }

  const next = !cameraOn;

  try {
    await localParticipant.setCameraEnabled(next);
    setCameraOn(next);
  } catch (e) {
    console.log("CAMERA ERROR:", e);
    Alert.alert("Camera Error", "Could not start your camera.");
  }
}

async function startPublishing() {
  if (!canPublish) {
    Alert.alert(
      "Cannot Go Live",
      "The host has not approved you to stream yet."
    );
    return;
  }

  try {
    await localParticipant.setCameraEnabled(true);
    setCameraOn(true);
    onPublishingChange?.(true);
  } catch (e) {
    console.log("CAMERA ERROR:", e);
    Alert.alert("Camera Error", "Could not start your camera.");
  }

  try {
    await localParticipant.setMicrophoneEnabled(true);
    setMicOn(true);
  } catch (e) {
    console.log("MIC ERROR:", e);
  }
}

async function stopPublishing() {
  await localParticipant.setCameraEnabled(false);
  await localParticipant.setMicrophoneEnabled(false);
  setCameraOn(false);
  setMicOn(false);
  onPublishingChange?.(false);
}

useEffect(() => {
  if (publishSignal === lastPublishSignalRef.current) {
    return;
  }

  lastPublishSignalRef.current = publishSignal;
  void startPublishing();
}, [publishSignal]);

useEffect(() => {
  if (stopSignal === lastStopSignalRef.current) {
    return;
  }

  lastStopSignalRef.current = stopSignal;
  void stopPublishing();
}, [stopSignal]);

useEffect(() => {
  if (!canPublish && (cameraOn || micOn)) {
    void stopPublishing();
  }
}, [canPublish, cameraOn, micOn]);

 async function toggleCameraFacing() {
  try {
    const publication =
      localParticipant.getTrackPublication(
        Track.Source.Camera
      );

    const cameraTrack = publication?.track;

    if (!cameraTrack) {
      console.log("No camera track found");
      return;
    }

    const nextFacingMode = isFrontCamera
      ? "environment"
      : "user";

    await (cameraTrack as any).restartTrack({
      facingMode: nextFacingMode,
    });

    setIsFrontCamera(!isFrontCamera);
  } catch (e) {
    console.log("CAMERA SWITCH ERROR:", e);
  }
}

  return (
    <View style={styles.controls}>
      <TouchableOpacity
        style={[
          styles.controlButton,
          !micOn && styles.controlButtonOff,
        ]}
        onPress={toggleMic}
      >
        <Ionicons name={micOn ? "mic" : "mic-off"} size={16} color="#FFFFFF" />
        <Text style={styles.controlText}>
          {micOn ? "Mute" : "Unmute"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.controlButton,
          !cameraOn && styles.controlButtonOff,
        ]}
        onPress={toggleCamera}
      >
        <Ionicons name={cameraOn ? "videocam" : "videocam-off"} size={16} color="#FFFFFF" />
        <Text style={styles.controlText}>
  {!canPublish
    ? "Needs Approval"
    : cameraOn
    ? "Camera Off"
    : "Camera On"}
</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.controlButton}
        onPress={toggleCameraFacing}
      >
        <Ionicons name="camera-reverse" size={16} color="#FFFFFF" />
        <Text style={styles.controlText}>
          {isFrontCamera
            ? "Back Cam"
            : "Front Cam"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
export default function LiveKitRoomView({
  roomId,
  userId,
  canPublish,
  fullscreen = false,
  onExitFullscreen,
  onPublishingChange,
  publishSignal = 0,
  stopSignal = 0,
}: Props) {
  const [token, setToken] = useState("");
  const livekitUrl = "wss://partyup-zh7itwg3.livekit.cloud";

  const [controlsVisible, setControlsVisible] = useState(true);
const controlsOpacity = useState(new Animated.Value(1))[0];

function showControls() {
  setControlsVisible(true);

  Animated.timing(controlsOpacity, {
    toValue: 1,
    duration: 180,
    useNativeDriver: true,
  }).start();

  setTimeout(() => {
    Animated.timing(controlsOpacity, {
      toValue: 0,
      duration: 450,
      useNativeDriver: true,
    }).start(() => {
      setControlsVisible(false);
    });
  }, 2500);
}

  useEffect(() => {
    AudioSession.startAudioSession();

    return () => {
      AudioSession.stopAudioSession();
    };
  }, []);

  useEffect(() => {
    async function getToken() {
  setToken("");

  const { data: profile } = await supabase
  .from("profiles")
  .select("username")
  .or(`auth_user_id.eq.${userId},id.eq.${userId}`)
  .maybeSingle();

  const displayName =
    profile?.username || `Guest ${userId.slice(0, 4)}`;

  const { data, error } = await supabase.functions.invoke("livekit-token", {
    body: {
      roomName: roomId,
      participantName: displayName,
      canPublish,
    },
  });

  if (error) {
    console.log("LIVEKIT TOKEN ERROR:", error);
    return;
  }

  setToken(data.token);
}
    if (roomId && userId) {
      getToken();
    }
  }, [roomId, userId, canPublish]);

  if (!token) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Connecting to livestream...</Text>
      </View>
    );
  }

  return (
  <LiveKitRoom
  key={token}
  serverUrl={livekitUrl}
  token={token}
  connect={true}
  audio={false}
  video={false}
  onConnected={() => {
    console.log("LIVEKIT CONNECTED");
  }}
  onDisconnected={() => {
    console.log("LIVEKIT DISCONNECTED");
  }}
  onError={(error) => {
    console.log("LIVEKIT ROOM ERROR:", error);
  }}
>
    <RoomStreamSurface
      canPublish={canPublish}
      controlsOpacity={controlsOpacity}
      controlsVisible={controlsVisible}
      fullscreen={fullscreen}
      onExitFullscreen={onExitFullscreen}
      onPublishingChange={onPublishingChange}
      onShowControls={showControls}
      publishSignal={publishSignal}
      stopSignal={stopSignal}
    />
  </LiveKitRoom>
);
}

function RoomStreamSurface({
  canPublish,
  controlsOpacity,
  controlsVisible,
  fullscreen,
  onExitFullscreen,
  onPublishingChange,
  onShowControls,
  publishSignal,
  stopSignal,
}: {
  canPublish: boolean;
  controlsOpacity: Animated.Value;
  controlsVisible: boolean;
  fullscreen: boolean;
  onExitFullscreen?: () => void;
  onPublishingChange?: (publishing: boolean) => void;
  onShowControls: () => void;
  publishSignal: number;
  stopSignal: number;
}) {
  const connectionState = useConnectionState();
  const isConnected = connectionState === ConnectionState.Connected;

  const controls = isConnected && controlsVisible ? (
    <Animated.View style={{ opacity: controlsOpacity }}>
      <StreamControls
        canPublish={canPublish}
        publishSignal={publishSignal}
        stopSignal={stopSignal}
        onPublishingChange={onPublishingChange}
      />
    </Animated.View>
  ) : null;

  return (
    <Pressable style={styles.room} onPress={onShowControls}>
      <VideoGrid />

      {!fullscreen && controls}

      <Modal visible={fullscreen} animationType="fade">
        <View style={styles.fullscreenPage}>
          <Pressable style={styles.fullscreenRoom} onPress={onShowControls}>
            <VideoGrid />

            <View style={styles.fullscreenTop}>
              <TouchableOpacity
                style={styles.fullscreenCloseButton}
                onPress={onExitFullscreen}
              >
                <Text style={styles.fullscreenCloseText}>Close</Text>
              </TouchableOpacity>
            </View>

            {fullscreen && controls}
          </Pressable>
        </View>
      </Modal>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  room: {
    width: "100%",
    height: "100%",
    minHeight: 320,
  },
  fullscreenPage: {
    backgroundColor: "#000000",
    flex: 1,
  },
  fullscreenRoom: {
    flex: 1,
    width: "100%",
  },
  fullscreenTop: {
    left: 18,
    position: "absolute",
    right: 18,
    top: 48,
    zIndex: 10000,
    elevation: 10000,
  },
  fullscreenCloseButton: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.66)",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  fullscreenCloseText: {
    color: "white",
    fontWeight: "900",
  },

  placeholder: {
    flex: 1,
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#09090F",
    borderRadius: 24,
    padding: 20,
  },

  placeholderText: {
    color: "white",
    fontWeight: "800",
    textAlign: "center",
  },

  feedLayout: {
    flex: 1,
    width: "100%",
    height: "100%",
  },

  mainFeed: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#050509",
    position: "relative",
  },

  video: {
    width: "100%",
    height: "100%",
  },

  controls: {
  position: "absolute",
  left: 12,
  right: 12,
  bottom: 12,
  flexDirection: "row",
  gap: 8,
  zIndex: 9999,
  elevation: 9999,
},

  controlButton: {
    flex: 1,
    backgroundColor: "rgba(124,58,237,0.9)",
    borderRadius: 999,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },

  controlButtonOff: {
    backgroundColor: "rgba(42,42,53,0.92)",
  },

  controlText: {
    color: "white",
    fontWeight: "900",
    fontSize: 11,
  },

  debugText: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 9999,
    color: "white",
    backgroundColor: "red",
    padding: 10,
    borderRadius: 10,
    fontWeight: "900",
  },

  cameraError: {
    position: "absolute",
    bottom: 70,
    left: 0,
    right: 0,
    color: "white",
    backgroundColor: "red",
    padding: 10,
    borderRadius: 10,
    fontWeight: "900",
    textAlign: "center",
  },

  streamDebugPanel: {
    backgroundColor: "rgba(255,0,0,0.9)",
    padding: 10,
    borderRadius: 12,
  },

  streamDebugText: {
    color: "white",
    fontWeight: "900",
  },

  feedNameBadge: {
    position: "absolute",
    left: 12,
    bottom: 12,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    zIndex: 50,
    elevation: 50,
  },

  feedNameText: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
  },
});
