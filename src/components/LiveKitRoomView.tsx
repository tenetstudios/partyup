import { useEffect, useState } from "react";
import {
  Animated,
  Pressable,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack, 
  useLocalParticipant,
  useTracks,
  registerGlobals,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import { supabase } from "../../lib/supabase";
import type { TrackReference } from "@livekit/react-native";

registerGlobals();

type Props = {
  roomId: string;
  userId: string;
  canPublish: boolean;
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

  const [selectedSid, setSelectedSid] = useState<string | null>(null);

  if (videoTracks.length === 0) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          Waiting for someone to go live...
        </Text>
      </View>
    );
  }

  const selectedTrack =
    videoTracks.find(
      (trackRef: any) =>
        trackRef.publication?.trackSid === selectedSid
    ) || videoTracks[0];

  return (
    <View style={styles.feedLayout}>
      <View style={styles.mainFeed}>
        <VideoTrack
          trackRef={selectedTrack}
          style={styles.video}
        />

        <View style={styles.feedNameBadge}>
          <Text style={styles.feedNameText}>
            {selectedTrack.participant.name ||
              selectedTrack.participant.identity ||
              "Live feed"}
          </Text>
        </View>
      </View>

      <View style={styles.cameraGrid}>
        {videoTracks.map((trackRef: any, index: number) => {
          const sid =
            trackRef.publication?.trackSid ||
            `${trackRef.participant.identity}-${index}`;

          const isSelected =
            selectedTrack.publication?.trackSid ===
            trackRef.publication?.trackSid;

          return (
            <TouchableOpacity
              key={sid}
              style={[
                styles.cameraThumb,
                isSelected && styles.cameraThumbActive,
              ]}
              onPress={() =>
                setSelectedSid(trackRef.publication?.trackSid)
              }
            >
              <VideoTrack
                trackRef={trackRef}
                style={styles.cameraThumbVideo}
              />

              <View style={styles.cameraThumbLabel}>
                <Text style={styles.cameraThumbText}>
                  {trackRef.participant.name ||
                    trackRef.participant.identity ||
                    "Camera"}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function StreamControls({ canPublish }: { canPublish: boolean }) {
  const { localParticipant } = useLocalParticipant();

  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);


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
    <Pressable style={styles.room} onPress={showControls}>
  <VideoGrid />

  {controlsVisible && (
    <Animated.View style={{ opacity: controlsOpacity }}>
      <StreamControls canPublish={canPublish} />
    </Animated.View>
  )}
</Pressable>
  </LiveKitRoom>
);
}

const styles = StyleSheet.create({
  room: {
    width: "100%",
    height: "100%",
    minHeight: 320,
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
    gap: 12,
  },

  mainFeed: {
    flex: 1,
    minHeight: 320,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#050509",
    position: "relative",
  },

  video: {
    width: "100%",
    height: "100%",
  },

  cameraGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },

  cameraThumb: {
    width: 110,
    height: 78,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#111",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.08)",
  },

  cameraThumbActive: {
    borderColor: "#A855F7",
  },

  cameraThumbVideo: {
    width: "100%",
    height: "100%",
  },

  cameraThumbLabel: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },

  cameraThumbText: {
    color: "white",
    fontSize: 10,
    fontWeight: "800",
  },

  controls: {
  position: "absolute",
  left: 16,
  right: 16,
  bottom: 24,
  gap: 10,
  zIndex: 9999,
  elevation: 9999,
},

  controlButton: {
    flex: 1,
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },

  controlButtonOff: {
    backgroundColor: "#2A2A35",
  },

  controlText: {
    color: "white",
    fontWeight: "900",
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