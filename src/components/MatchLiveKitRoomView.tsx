import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  registerGlobals,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import type { TrackReference } from "@livekit/react-native";
import { supabase } from "../../lib/supabase";
import {
  endMatchSession,
  getMatchConnectionState,
  guestEndMatchSession,
  guestGetMatchConnectionState,
  guestKeepMatchConnection,
  keepMatchConnection,
} from "../lib/matchmaking";

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
  guestToken?: string | null;
  isGuest?: boolean;
  nextBusy: boolean;
  onNextMatch: (sessionId: string) => Promise<void>;
  onRemoteParticipantLeft: () => void;
  onReturnToMatch: () => void;
  sessionId: string;
};

const livekitUrl = "wss://partyup-zh7itwg3.livekit.cloud";

function isTrackReference(trackRef: unknown): trackRef is TrackReference {
  const candidate = trackRef as TrackReference | null;

  return Boolean(candidate?.publication?.track);
}

export default function MatchLiveKitRoomView({
  guestToken,
  isGuest = false,
  nextBusy,
  onNextMatch,
  onRemoteParticipantLeft,
  onReturnToMatch,
  sessionId,
}: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const [participantIdentity, setParticipantIdentity] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [status, setStatus] = useState<MatchLiveKitStatus>("requesting-token");
  const [token, setToken] = useState<string | null>(null);

  async function endCurrentMatch() {
    if (isGuest && !guestToken) {
      return;
    }

    try {
      if (isGuest && guestToken) {
        await guestEndMatchSession(sessionId, guestToken);
        return;
      }

      await endMatchSession(sessionId);
    } catch {
      // Local disconnect should still complete; polling/realtime will recover if the RPC already ran elsewhere.
    }
  }

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

      if (isGuest && !guestToken) {
        setStatus("error");
        setMessage("Guest Match access was not ready. Return to Match and try again.");
        return;
      }

      const functionName = isGuest ? "guest-match-livekit-token" : "match-livekit-token";
      const body = isGuest
        ? {
            guestToken,
            matchSessionId: sessionId,
          }
        : {
            matchSessionId: sessionId,
          };

      const { data, error } = await supabase.functions.invoke<MatchLiveKitTokenResponse>(
        functionName,
        { body },
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
  }, [guestToken, isGuest, sessionId]);

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
        void endCurrentMatch();
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
        onRemoteParticipantLeft={onRemoteParticipantLeft}
        onReturnToMatch={onReturnToMatch}
        onEndMatch={endCurrentMatch}
        guestToken={guestToken}
        isGuest={isGuest}
      />
    </LiveKitRoom>
  );
}

function MatchCallView({
  nextBusy,
  onNextMatch,
  onRemoteParticipantLeft,
  participantIdentity,
  roomName,
  sessionId,
  status,
  message,
  onReturnToMatch,
  onEndMatch,
  guestToken,
  isGuest,
}: {
  guestToken?: string | null;
  isGuest: boolean;
  message: string | null;
  nextBusy: boolean;
  onNextMatch: (sessionId: string) => Promise<void>;
  onRemoteParticipantLeft: () => void;
  onReturnToMatch: () => void;
  onEndMatch: () => Promise<void>;
  participantIdentity: string | null;
  roomName: string | null;
  sessionId: string;
  status: MatchLiveKitStatus;
}) {
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const room = useRoomContext();
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [hasSeenRemoteParticipant, setHasSeenRemoteParticipant] = useState(false);
  const [keepInTouchMessage, setKeepInTouchMessage] = useState<string | null>(null);
  const [keepInTouchStatus, setKeepInTouchStatus] = useState<
    "idle" | "saving" | "saved" | "connected"
  >("idle");
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
  const remoteParticipantCount = participants.filter(
    (participant) => participant.identity !== localIdentity,
  ).length;
  const remotePlaceholderText =
    remoteParticipantCount === 0 && hasSeenRemoteParticipant
      ? "Left the call"
      : remoteParticipantCount > 0
        ? "Camera off"
        : "Connecting...";

  useEffect(() => {
    if (remoteParticipantCount > 0) {
      setHasSeenRemoteParticipant(true);
      return;
    }

    if (status !== "connected" || !hasSeenRemoteParticipant || nextBusy) {
      return;
    }

    const timeoutId = setTimeout(() => {
      void onEndMatch();
      onRemoteParticipantLeft();
    }, 1500);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    hasSeenRemoteParticipant,
    nextBusy,
    onEndMatch,
    onRemoteParticipantLeft,
    remoteParticipantCount,
    status,
  ]);

  useEffect(() => {
    setKeepInTouchStatus("idle");
    setKeepInTouchMessage(null);
  }, [sessionId]);

  useEffect(() => {
    if (keepInTouchStatus !== "saved") {
      return;
    }

    let cancelled = false;

    async function checkConnectionState() {
      try {
        const result =
          isGuest && guestToken
            ? await guestGetMatchConnectionState(sessionId, guestToken)
            : await getMatchConnectionState(sessionId);

        if (!cancelled && result.mutual) {
          setKeepInTouchStatus("connected");
          setKeepInTouchMessage("You're connected.");
        }
      } catch {
        // The saved vote remains valid; polling is only a confirmation fallback.
      }
    }

    const channel = supabase
      .channel(`mobile-match-connection:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "partyup_connections",
          filter: `source_match_session_id=eq.${sessionId}`,
        },
        () => {
          void checkConnectionState();
        },
      )
      .subscribe();

    void checkConnectionState();

    const intervalId = setInterval(() => {
      void checkConnectionState();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [guestToken, isGuest, keepInTouchStatus, sessionId]);

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

  async function saveKeepInTouch() {
    if (keepInTouchStatus === "saving" || keepInTouchStatus === "connected") {
      return;
    }

    const previousStatus = keepInTouchStatus;
    setKeepInTouchStatus("saving");
    setKeepInTouchMessage(null);

    try {
      if (isGuest && !guestToken) {
        throw new Error("Guest Match access was not ready.");
      }

      const result =
        isGuest && guestToken
          ? await guestKeepMatchConnection(sessionId, guestToken)
          : await keepMatchConnection(sessionId);

      if (result.mutual) {
        setKeepInTouchStatus("connected");
        setKeepInTouchMessage("You're connected.");
        return;
      }

      setKeepInTouchStatus("saved");
      setKeepInTouchMessage("Request saved. You'll connect if they choose the same.");
    } catch (reason) {
      setKeepInTouchStatus(previousStatus);
      setKeepInTouchMessage(
        reason instanceof Error ? reason.message : "Could not save your connection choice.",
      );
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

  async function leaveMatch() {
    await onEndMatch();
    room.disconnect();
    onReturnToMatch();
  }

  const keepInTouchLabel =
    keepInTouchStatus === "connected"
      ? "Connected"
      : keepInTouchStatus === "saved"
        ? "Request saved"
        : keepInTouchStatus === "saving"
          ? "Saving..."
          : "Stay connected";
  const keepInTouchDisabled =
    keepInTouchStatus === "saving" || keepInTouchStatus === "connected";

  return (
    <View style={styles.callPage}>
      <View style={styles.remoteVideo}>
        {remoteTrack ? (
          <VideoTrack trackRef={remoteTrack} style={styles.video} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>Connection live</Text>
            <Text style={styles.placeholderText}>{remotePlaceholderText}</Text>
          </View>
        )}

        <View style={styles.remoteBadge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>CONNECTION LIVE</Text>
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
          {status === "connected" ? "CONNECTION LIVE" : "LOCKING SIGNAL"}
        </Text>
        <Text style={styles.statusText}>
          {roomName ? "Private 1:1 / signal live" : "Secure room starting"}
        </Text>
      </View>

      {(mediaMessage || message) && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{mediaMessage ?? message}</Text>
        </View>
      )}

      {keepInTouchMessage && (
        <View style={styles.keepInTouchNotice}>
          <Text style={styles.keepInTouchNoticeText}>{keepInTouchMessage}</Text>
        </View>
      )}

      <View style={styles.relationshipControls}>
        <TouchableOpacity
          style={[
            styles.keepInTouchButton,
            keepInTouchStatus === "saved" && styles.keepInTouchButtonSaved,
            keepInTouchStatus === "connected" && styles.keepInTouchButtonConnected,
            keepInTouchDisabled && styles.disabledButton,
          ]}
          onPress={saveKeepInTouch}
          disabled={keepInTouchDisabled}
        >
          <Ionicons
            name={keepInTouchStatus === "connected" ? "checkmark" : "sparkles"}
            size={17}
            color={keepInTouchStatus === "saved" || keepInTouchStatus === "connected" ? "#050509" : "#FFFFFF"}
          />
          <Text
            style={[
              styles.keepInTouchText,
              keepInTouchStatus === "saved" && styles.keepInTouchTextSaved,
              keepInTouchStatus === "connected" && styles.keepInTouchTextConnected,
            ]}
          >
            {keepInTouchLabel}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.nextButton, nextBusy && styles.disabledButton]}
          onPress={moveNext}
          disabled={nextBusy}
        >
          <Ionicons name="play-skip-forward" size={17} color="#FFFFFF" />
          <Text style={styles.controlText}>{nextBusy ? "Tuning..." : "Next match"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityLabel={microphoneEnabled ? "Mute microphone" : "Unmute microphone"}
          style={[styles.controlButton, !microphoneEnabled && styles.controlButtonOff]}
          onPress={toggleMicrophone}
        >
          <Ionicons name={microphoneEnabled ? "mic" : "mic-off"} size={18} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityLabel={cameraEnabled ? "Turn camera off" : "Turn camera on"}
          style={[styles.controlButton, !cameraEnabled && styles.controlButtonOff]}
          onPress={toggleCamera}
        >
          <Ionicons name={cameraEnabled ? "videocam" : "videocam-off"} size={18} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity accessibilityLabel="Leave match" style={styles.leaveButton} onPress={leaveMatch}>
          <Ionicons name="exit-outline" size={19} color="#FFFFFF" />
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
  badgeDot: {
    backgroundColor: "#34D399",
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  callPage: {
    backgroundColor: "#000000",
    flex: 1,
  },
  controlButton: {
    alignItems: "center",
    backgroundColor: "#EC4899",
    borderRadius: 999,
    width: 48,
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
    backgroundColor: "rgba(5,5,9,0.82)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    borderWidth: 1,
    bottom: 28,
    elevation: 40,
    flexDirection: "row",
    gap: 10,
    left: 16,
    position: "absolute",
    padding: 8,
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
  keepInTouchButton: {
    alignItems: "center",
    backgroundColor: "rgba(24,20,37,0.96)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 18,
  },
  keepInTouchButtonConnected: {
    backgroundColor: "#34D399",
    borderColor: "#6EE7B7",
  },
  keepInTouchButtonSaved: {
    backgroundColor: "#FFFFFF",
    borderColor: "#FFFFFF",
  },
  keepInTouchNotice: {
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    borderWidth: 1,
    bottom: 144,
    elevation: 36,
    maxWidth: "88%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    position: "absolute",
    zIndex: 36,
  },
  keepInTouchNoticeText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  keepInTouchText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  keepInTouchTextConnected: {
    color: "#050509",
  },
  keepInTouchTextSaved: {
    color: "#050509",
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
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 48,
  },
  relationshipControls: {
    alignItems: "center",
    bottom: 88,
    elevation: 38,
    left: 16,
    position: "absolute",
    right: 16,
    zIndex: 38,
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
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 999,
    bottom: 100,
    flexDirection: "row",
    gap: 7,
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
    maxWidth: "58%",
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
