import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  registerGlobals,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import type { TrackReference } from "@livekit/react-native";
import { supabase } from "../../lib/supabase";

registerGlobals();

type MatchLiveKitStatus =
  | "requesting-token"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type MatchLiveKitTokenResponse = {
  token?: string;
  roomName?: string;
  participantIdentity?: string;
};

type Props = {
  nextBusy: boolean;
  onNextMatch: (sessionId: string) => Promise<void>;
  onReturnToMatch: () => void;
  sessionId: string;
};

const livekitUrl = "wss://partyup-zh7itwg3.livekit.cloud";

function isTrackReference(trackRef: unknown): trackRef is TrackReference {
  const candidate = trackRef as TrackReference | null;

  return Boolean(candidate?.publication?.track);
}

export default function MatchLiveKitRoomView({
  nextBusy,
  onNextMatch,
  onReturnToMatch,
  sessionId,
}: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const [participantIdentity, setParticipantIdentity] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [status, setStatus] = useState<MatchLiveKitStatus>("requesting-token");
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function requestMatchToken() {
      if (!livekitUrl) {
        setStatus("error");
        setMessage("Missing LiveKit URL.");
        return;
      }

      setStatus("requesting-token");
      setMessage(null);
      setToken(null);
      setRoomName(null);
      setParticipantIdentity(null);

      const { data, error } = await supabase.functions.invoke<MatchLiveKitTokenResponse>(
        "match-livekit-token",
        {
          body: {
            matchSessionId: sessionId,
          },
        },
      );

      if (cancelled) {
        return;
      }

      if (error) {
        setStatus("error");
        setMessage(error.message || "Could not request Match video access.");
        return;
      }

      if (!data?.token || !data.roomName || !data.participantIdentity) {
        setStatus("error");
        setMessage("Match video access returned an incomplete response.");
        return;
      }

      setToken(data.token);
      setRoomName(data.roomName);
      setParticipantIdentity(data.participantIdentity);
      setStatus("connecting");
    }

    void requestMatchToken();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    AudioSession.startAudioSession();

    return () => {
      AudioSession.stopAudioSession();
    };
  }, []);

  const messageTitle = useMemo(() => {
    if (status === "requesting-token") return "Matched";
    if (status === "connecting") return "Connecting";
    if (status === "disconnected") return "Disconnected";
    return "Could not connect";
  }, [status]);

  if (status === "error" || status === "disconnected" || !token) {
    return (
      <View style={styles.messagePage}>
        {(status === "requesting-token" || status === "connecting") && (
          <ActivityIndicator color="#E9D5FF" />
        )}
        <Text style={styles.messageTitle}>{messageTitle}</Text>
        <Text style={styles.messageText}>
          {message ??
            (status === "requesting-token"
              ? "Requesting secure video access..."
              : "Connecting to your Match...")}
        </Text>
        <Text style={styles.sessionText}>Session: {sessionId}</Text>

        {(status === "error" || status === "disconnected") && (
          <TouchableOpacity style={styles.secondaryButton} onPress={onReturnToMatch}>
            <Text style={styles.secondaryButtonText}>Return to Match</Text>
          </TouchableOpacity>
        )}
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
        setStatus("connected");
        setMessage(null);
      }}
      onDisconnected={() => {
        setStatus("disconnected");
        setMessage("You left the Match video room.");
      }}
      onError={(error) => {
        setStatus("error");
        setMessage(error.message || "LiveKit connection failed.");
      }}
    >
      <MatchCallView
        participantIdentity={participantIdentity}
        roomName={roomName}
        sessionId={sessionId}
        status={status}
        message={message}
        nextBusy={nextBusy}
        onNextMatch={onNextMatch}
        onReturnToMatch={onReturnToMatch}
      />
    </LiveKitRoom>
  );
}

function MatchCallView({
  nextBusy,
  onNextMatch,
  participantIdentity,
  roomName,
  sessionId,
  status,
  message,
  onReturnToMatch,
}: {
  message: string | null;
  nextBusy: boolean;
  onNextMatch: (sessionId: string) => Promise<void>;
  onReturnToMatch: () => void;
  participantIdentity: string | null;
  roomName: string | null;
  sessionId: string;
  status: MatchLiveKitStatus;
}) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [mediaMessage, setMediaMessage] = useState<string | null>(null);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);

  const tracks = useTracks(
    [
      {
        source: Track.Source.Camera,
        withPlaceholder: false,
      },
    ],
    { onlySubscribed: false },
  );

  const cameraTracks = tracks.filter(isTrackReference);
  const localIdentity = localParticipant.identity || participantIdentity;
  const localTrack = cameraTracks.find(
    (trackRef) => trackRef.participant.identity === localIdentity,
  );
  const remoteTrack = cameraTracks.find(
    (trackRef) => trackRef.participant.identity !== localIdentity,
  );

  useEffect(() => {
    if (status !== "connected") {
      return;
    }

    let cancelled = false;

    async function enableLocalMedia() {
      try {
        await localParticipant.setCameraEnabled(true);

        if (!cancelled) {
          setCameraEnabled(true);
        }
      } catch {
        if (!cancelled) {
          setCameraEnabled(false);
          setMediaMessage("Camera permission was denied.");
        }
      }

      try {
        await localParticipant.setMicrophoneEnabled(true);

        if (!cancelled) {
          setMicrophoneEnabled(true);
        }
      } catch {
        if (!cancelled) {
          setMicrophoneEnabled(false);
          setMediaMessage((current) =>
            current
              ? `${current} Microphone permission was denied.`
              : "Microphone permission was denied.",
          );
        }
      }
    }

    void enableLocalMedia();

    return () => {
      cancelled = true;
      void localParticipant.setCameraEnabled(false);
      void localParticipant.setMicrophoneEnabled(false);
    };
  }, [localParticipant, status]);

  async function toggleCamera() {
    const next = !cameraEnabled;

    try {
      await localParticipant.setCameraEnabled(next);
      setCameraEnabled(next);
      setMediaMessage(null);
    } catch {
      setCameraEnabled(false);
      setMediaMessage("Camera permission was denied.");
    }
  }

  async function toggleMicrophone() {
    const next = !microphoneEnabled;

    try {
      await localParticipant.setMicrophoneEnabled(next);
      setMicrophoneEnabled(next);
      setMediaMessage(null);
    } catch {
      setMicrophoneEnabled(false);
      setMediaMessage("Microphone permission was denied.");
    }
  }

  async function moveNext() {
    if (nextBusy) {
      return;
    }

    try {
      await onNextMatch(sessionId);
    } finally {
      room.disconnect();
    }
  }

  function leaveMatch() {
    room.disconnect();
    onReturnToMatch();
  }

  return (
    <View style={styles.callPage}>
      <View style={styles.remoteVideo}>
        {remoteTrack ? (
          <VideoTrack trackRef={remoteTrack} style={styles.video} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>Your Match</Text>
            <Text style={styles.placeholderText}>
              {status === "connected" ? "Camera off" : "Connecting..."}
            </Text>
          </View>
        )}

        <View style={styles.remoteBadge}>
          <Text style={styles.badgeText}>Your Match</Text>
        </View>
      </View>

      <View style={styles.localPreview}>
        {localTrack && cameraEnabled ? (
          <VideoTrack trackRef={localTrack} style={styles.localVideo} />
        ) : (
          <View style={styles.localPlaceholder}>
            <Text style={styles.localPlaceholderText}>You</Text>
          </View>
        )}
      </View>

      <View style={styles.statusPanel}>
        <Text style={styles.statusLabel}>
          {status === "connected" ? "Matched" : "Connecting"}
        </Text>
        <Text style={styles.statusText} numberOfLines={1}>
          Session: {sessionId}
        </Text>
        {roomName && (
          <Text style={styles.statusText} numberOfLines={1}>
            Room: {roomName}
          </Text>
        )}
      </View>

      {(mediaMessage || message) && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{mediaMessage ?? message}</Text>
        </View>
      )}

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.nextButton, nextBusy && styles.disabledButton]}
          onPress={moveNext}
          disabled={nextBusy}
        >
          <Text style={styles.controlText}>{nextBusy ? "Finding..." : "Next"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, !microphoneEnabled && styles.controlButtonOff]}
          onPress={toggleMicrophone}
        >
          <Text style={styles.controlText}>{microphoneEnabled ? "Mute" : "Unmute"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, !cameraEnabled && styles.controlButtonOff]}
          onPress={toggleCamera}
        >
          <Text style={styles.controlText}>{cameraEnabled ? "Camera Off" : "Camera On"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.leaveButton} onPress={leaveMatch}>
          <Text style={styles.controlText}>Leave</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  callPage: {
    backgroundColor: "#000000",
    flex: 1,
  },
  controlButton: {
    alignItems: "center",
    backgroundColor: "#EC4899",
    borderRadius: 999,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  controlButtonOff: {
    backgroundColor: "#2A2A35",
  },
  controlText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  controls: {
    bottom: 28,
    elevation: 40,
    flexDirection: "row",
    gap: 10,
    left: 16,
    position: "absolute",
    right: 16,
    zIndex: 40,
  },
  disabledButton: {
    opacity: 0.55,
  },
  leaveButton: {
    alignItems: "center",
    backgroundColor: "#3F1D2F",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  localPlaceholder: {
    alignItems: "center",
    backgroundColor: "#181425",
    flex: 1,
    justifyContent: "center",
  },
  localPlaceholderText: {
    color: "#A1A1AA",
    fontSize: 12,
    fontWeight: "900",
  },
  localPreview: {
    backgroundColor: "#111111",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 18,
    borderWidth: 1,
    height: 150,
    overflow: "hidden",
    position: "absolute",
    right: 16,
    top: 56,
    width: 108,
    elevation: 30,
    zIndex: 30,
  },
  localVideo: {
    height: "100%",
    width: "100%",
  },
  nextButton: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  messagePage: {
    alignItems: "center",
    backgroundColor: "#050509",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  messageText: {
    color: "#A1A1AA",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
    marginTop: 10,
    textAlign: "center",
  },
  messageTitle: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 14,
    textAlign: "center",
  },
  notice: {
    backgroundColor: "rgba(146,64,14,0.82)",
    borderColor: "rgba(251,191,36,0.25)",
    borderRadius: 14,
    borderWidth: 1,
    left: 18,
    padding: 12,
    position: "absolute",
    right: 18,
    top: 214,
    elevation: 35,
    zIndex: 35,
  },
  noticeText: {
    color: "#FEF3C7",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  placeholder: {
    alignItems: "center",
    backgroundColor: "#050509",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  placeholderText: {
    color: "#A1A1AA",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 6,
  },
  placeholderTitle: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "900",
  },
  remoteBadge: {
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 999,
    bottom: 100,
    left: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    position: "absolute",
    elevation: 20,
    zIndex: 20,
  },
  remoteVideo: {
    flex: 1,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#181425",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 22,
    minHeight: 48,
    paddingHorizontal: 22,
  },
  secondaryButtonText: {
    color: "#E9D5FF",
    fontSize: 15,
    fontWeight: "900",
  },
  sessionText: {
    color: "#E9D5FF",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 14,
    textAlign: "center",
  },
  statusLabel: {
    color: "#C4B5FD",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  statusPanel: {
    backgroundColor: "rgba(0,0,0,0.58)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    borderWidth: 1,
    left: 16,
    maxWidth: "60%",
    padding: 12,
    position: "absolute",
    top: 56,
    elevation: 25,
    zIndex: 25,
  },
  statusText: {
    color: "#A1A1AA",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  video: {
    height: "100%",
    width: "100%",
  },
});
