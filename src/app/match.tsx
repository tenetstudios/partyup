import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import MatchLiveKitRoomView from "../components/MatchLiveKitRoomView";
import {
  cancelMatchSearch,
  createGuestSession,
  enqueueAndMatch,
  ensurePartyUpIdentity,
  getCurrentMatchQueueState,
  getGlobalMatchPool,
  getMatchSession,
  getMatchPool,
  guestCancelMatchSearch,
  guestEnqueueAndMatch,
  guestGetCurrentMatchQueueState,
  guestGetMatchSession,
  guestNextMatch,
  nextMatch,
  type MatchPool,
  type MatchSession,
} from "../lib/matchmaking";

type MatchState = "idle" | "searching" | "matched" | "disconnected" | "error";

function isAnonymousUser(user: User | null) {
  return Boolean((user as { is_anonymous?: boolean } | null)?.is_anonymous);
}

function readParam(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;

  return candidate && candidate.trim().length > 0 ? candidate : null;
}

export default function MatchScreen() {
  const params = useLocalSearchParams<{ pool?: string | string[]; roomId?: string | string[] }>();
  const initialPoolId = readParam(params.pool);
  const returnRoomId = readParam(params.roomId);
  const [authLoading, setAuthLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchState, setMatchState] = useState<MatchState>("idle");
  const [disconnectedMessage, setDisconnectedMessage] = useState<string | null>(null);
  const [disconnectedSessionId, setDisconnectedSessionId] = useState<string | null>(null);
  const [nextBusy, setNextBusy] = useState(false);
  const [poolLoading, setPoolLoading] = useState(Boolean(initialPoolId));
  const [activePool, setActivePool] = useState<MatchPool | null>(null);
  const [searchIdentityId, setSearchIdentityId] = useState<string | null>(null);
  const [session, setSession] = useState<MatchSession | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [guestIdentityId, setGuestIdentityId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const sessionChannelRef = useRef<RealtimeChannel | null>(null);

  const hasAccount = Boolean(user && !isAnonymousUser(user));
  const isGuest = !hasAccount;
  const contextLabel =
    initialPoolId && (activePool?.pool_type === "event" || !activePool)
      ? "Matching with people here"
      : null;

  const clearSubscription = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const clearSessionSubscription = useCallback(() => {
    if (sessionChannelRef.current) {
      supabase.removeChannel(sessionChannelRef.current);
      sessionChannelRef.current = null;
    }
  }, []);

  const fail = useCallback(
    (message: string) => {
      clearSubscription();
      setBusy(false);
      setNextBusy(false);
      setError(message);
      setDisconnectedSessionId(null);
      setSearchIdentityId(null);
      setSession(null);
      setMatchState("error");
    },
    [clearSubscription],
  );

  const transitionToMatched = useCallback(
    async (sessionId: string, guestTokenOverride?: string | null) => {
      try {
        const token = guestTokenOverride ?? guestToken;
        const matchedSession =
          isGuest && token
            ? await guestGetMatchSession(sessionId, token)
            : await getMatchSession(sessionId);

        clearSubscription();
        clearSessionSubscription();
        setSession(matchedSession);
        setSearchIdentityId(null);
        setDisconnectedSessionId(null);
        setDisconnectedMessage(null);
        setError(null);
        setMatchState("matched");
      } catch (reason) {
        fail(reason instanceof Error ? reason.message : "The matched session could not be loaded.");
      }
    },
    [clearSessionSubscription, clearSubscription, fail, guestToken, isGuest],
  );

  const transitionToDisconnected = useCallback(
    (message: string, endedSessionId: string | null) => {
      clearSessionSubscription();
      setBusy(false);
      setNextBusy(false);
      setDisconnectedSessionId(endedSessionId);
      setSession(null);
      setSearchIdentityId(null);
      setDisconnectedMessage(message);
      setMatchState("disconnected");
    },
    [clearSessionSubscription],
  );

  const checkCurrentSessionEnded = useCallback(
    async (sessionId: string) => {
      const currentSession =
        isGuest && guestToken
          ? await guestGetMatchSession(sessionId, guestToken)
          : await getMatchSession(sessionId);

      if (currentSession.status === "ended" && !nextBusy) {
        transitionToDisconnected(
          currentSession.ended_reason === "next" ? "They moved on." : "Connection ended.",
          sessionId,
        );
      }
    },
    [guestToken, isGuest, nextBusy, transitionToDisconnected],
  );

  const checkCurrentQueueForMatch = useCallback(
    async (identityId: string, guestTokenOverride?: string | null) => {
      const token = guestTokenOverride ?? guestToken;
      const queueState =
        isGuest && token
          ? await guestGetCurrentMatchQueueState(token)
          : await getCurrentMatchQueueState(identityId);

      if (queueState?.status === "matched" && queueState.match_session_id) {
        await transitionToMatched(queueState.match_session_id, token);
      }
    },
    [guestToken, isGuest, transitionToMatched],
  );

  const subscribeToQueue = useCallback(
    (identityId: string) =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        clearSubscription();

        const channel = supabase
          .channel(`mobile-match-queue:${identityId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "match_queue",
              filter: `identity_id=eq.${identityId}`,
            },
            (payload) => {
              const row = payload.new as {
                status?: string;
                match_session_id?: string | null;
              };

              if (row.status === "matched" && row.match_session_id) {
                void transitionToMatched(row.match_session_id);
              }
            },
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED" && !settled) {
              settled = true;
              resolve();
            }

            if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !settled) {
              settled = true;
              reject(new Error("Realtime matchmaking updates could not be started."));
            }
          });

        channelRef.current = channel;
      }),
    [clearSubscription, transitionToMatched],
  );

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      const { data, error: authError } = await supabase.auth.getUser();

      if (!mounted) {
        return;
      }

      if (authError) {
        setError(authError.message);
        setMatchState("error");
      }

      setUser(data.user ?? null);
      setAuthLoading(false);
    }

    void loadUser();

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUser = nextSession?.user ?? null;
      setUser(nextUser);
      setAuthLoading(false);

      if (!nextUser) {
        clearSubscription();
        clearSessionSubscription();
        setBusy(false);
        setNextBusy(false);
        setDisconnectedSessionId(null);
        setSearchIdentityId(null);
        setSession(null);
        setMatchState("idle");
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      clearSubscription();
      clearSessionSubscription();
    };
  }, [clearSessionSubscription, clearSubscription]);

  useEffect(() => {
    let mounted = true;

    async function loadInitialPool() {
      if (!initialPoolId) {
        setActivePool(null);
        setPoolLoading(false);
        return;
      }

      setPoolLoading(true);
      setError(null);

      try {
        const pool = await getMatchPool(initialPoolId);

        if (!mounted) {
          return;
        }

        setActivePool(pool);
      } catch (reason) {
        if (!mounted) {
          return;
        }

        setActivePool(null);
        setError(reason instanceof Error ? reason.message : "That Match pool could not be loaded.");
        setMatchState("error");
      } finally {
        if (mounted) {
          setPoolLoading(false);
        }
      }
    }

    void loadInitialPool();

    return () => {
      mounted = false;
    };
  }, [initialPoolId]);

  useEffect(() => {
    if (matchState !== "searching" || !searchIdentityId) {
      return;
    }

    const intervalId = setInterval(() => {
      void checkCurrentQueueForMatch(searchIdentityId).catch((reason) => {
        fail(reason instanceof Error ? reason.message : "Matchmaking updates could not be checked.");
      });
    }, 2000);

    return () => {
      clearInterval(intervalId);
    };
  }, [checkCurrentQueueForMatch, fail, matchState, searchIdentityId]);

  useEffect(() => {
    if (matchState !== "matched" || !session?.id) {
      return;
    }

    const sessionId = session.id;
    clearSessionSubscription();

    const channel = supabase
      .channel(`mobile-match-session:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "match_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as { status?: string; ended_reason?: string | null };

          if (row.status === "ended" && !nextBusy) {
            transitionToDisconnected(
              row.ended_reason === "next" ? "They moved on." : "Connection ended.",
              sessionId,
            );
          }
        },
      )
      .subscribe();

    sessionChannelRef.current = channel;

    const intervalId = setInterval(() => {
      void checkCurrentSessionEnded(sessionId).catch(() => {
        // Realtime is primary; polling is only a fallback for missed session updates.
      });
    }, 2000);

    return () => {
      clearInterval(intervalId);

      if (sessionChannelRef.current === channel) {
        supabase.removeChannel(channel);
        sessionChannelRef.current = null;
      } else {
        supabase.removeChannel(channel);
      }
    };
  }, [
    checkCurrentSessionEnded,
    clearSessionSubscription,
    matchState,
    nextBusy,
    session?.id,
    transitionToDisconnected,
  ]);

  async function startMatching() {
    if (busy || poolLoading) {
      return;
    }

    setBusy(true);
    setError(null);
    setDisconnectedMessage(null);
    setDisconnectedSessionId(null);
    setSession(null);
    setSearchIdentityId(null);
    setNextBusy(false);
    clearSubscription();
    clearSessionSubscription();

    try {
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user ?? null;
      setUser(currentUser);

      try {
        if (currentUser && !isAnonymousUser(currentUser)) {
          await cancelMatchSearch();
        } else if (guestToken) {
          await guestCancelMatchSearch(guestToken);
        }
      } catch {
        // A fresh search should not be blocked if there was no active queue row.
      }

      const pool = initialPoolId ? await getMatchPool(initialPoolId) : activePool ?? (await getGlobalMatchPool());
      let identityId: string;
      let result;
      let guestTokenForMatch: string | null = null;

      if (currentUser && !isAnonymousUser(currentUser)) {
        const identity = await ensurePartyUpIdentity();
        identityId = identity.id;
        result = await enqueueAndMatch(pool.id);
      } else {
        const guestSession = await createGuestSession();
        setGuestToken(guestSession.guestToken);
        setGuestIdentityId(guestSession.identityId);
        guestTokenForMatch = guestSession.guestToken;
        identityId = guestSession.identityId;
        result = await guestEnqueueAndMatch(pool.id, guestSession.guestToken);
      }

      setActivePool(pool);

      if (result.matched) {
        if (!result.session_id) {
          throw new Error("Matchmaking returned a match without a session.");
        }

        await transitionToMatched(
          result.session_id,
          guestTokenForMatch,
        );
        return;
      }

      setMatchState("searching");
      setSearchIdentityId(identityId);
      if (currentUser && !isAnonymousUser(currentUser)) {
        await subscribeToQueue(identityId);
      }
      await checkCurrentQueueForMatch(
        identityId,
        guestTokenForMatch,
      );
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "Matchmaking could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSearch() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (isGuest && guestToken) {
        await guestCancelMatchSearch(guestToken);
      } else {
        await cancelMatchSearch();
      }
      clearSubscription();
      clearSessionSubscription();
      setSession(null);
      setDisconnectedSessionId(null);
      setSearchIdentityId(null);
      setNextBusy(false);
      setMatchState("idle");
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "The match search could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }

  function returnHome() {
    clearSubscription();
    clearSessionSubscription();
    if (returnRoomId) {
      router.push(`/room/${returnRoomId}`);
      return;
    }

    router.push("/home");
  }

  async function handleNextMatch(sessionId: string) {
    if (nextBusy) {
      return;
    }

    setNextBusy(true);
    setError(null);
    setDisconnectedMessage(null);
    setDisconnectedSessionId(null);

    try {
      const result =
        isGuest && guestToken
          ? await guestNextMatch(sessionId, guestToken)
          : await nextMatch(sessionId);
      clearSessionSubscription();
      setSession(null);

      if (result.matched) {
        if (!result.session_id) {
          throw new Error("Matchmaking returned a match without a session.");
        }

        await transitionToMatched(result.session_id, isGuest ? guestToken : null);
        return;
      }

      const identityId =
        isGuest && guestIdentityId ? guestIdentityId : (await ensurePartyUpIdentity()).id;
      setMatchState("searching");
      setSearchIdentityId(identityId);
      if (!isGuest) {
        await subscribeToQueue(identityId);
      }
      await checkCurrentQueueForMatch(identityId, isGuest ? guestToken : null);
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "Could not move to the next Match.");
    } finally {
      setNextBusy(false);
    }
  }

  async function findSomeoneElse() {
    if (disconnectedSessionId) {
      await handleNextMatch(disconnectedSessionId);
      return;
    }

    await startMatching();
  }

  if (authLoading) {
    return (
      <View style={styles.page}>
        <View style={styles.ambientGlow} />
        <View style={styles.matchPanel}>
          <ActivityIndicator color="#F472B6" size="large" />
          <Text style={styles.stateEyebrow}>Warming up the signal</Text>
          <Text style={styles.muted}>Checking your PartyUp access...</Text>
        </View>
      </View>
    );
  }

  if (matchState === "matched" && session?.id) {
    return (
      <MatchLiveKitRoomView
        guestToken={isGuest ? guestToken : null}
        isGuest={isGuest}
        nextBusy={nextBusy}
        onNextMatch={handleNextMatch}
        onRemoteParticipantLeft={() => {
          transitionToDisconnected("Your Match left.", session.id);
        }}
        sessionId={session.id}
        onReturnToMatch={() => {
          clearSessionSubscription();
          setSession(null);
          setSearchIdentityId(null);
          setDisconnectedSessionId(null);
          setNextBusy(false);
          setMatchState("idle");
        }}
      />
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.ambientGlow} />
      {matchState === "idle" && (
        <View style={styles.matchPanel}>
          <View style={styles.panelHeader}>
            <View style={styles.liveDot} />
            <Text style={styles.panelHeaderText}>ELECTRIC FRIENDSHIP ENGINE</Text>
          </View>
          {contextLabel && <Text style={styles.contextText}>{contextLabel}</Text>}
          <Text style={styles.title}>Find your next spark.</Text>
          <Text style={styles.subtitle}>
            {contextLabel
              ? "Tune into someone sharing this room, right now."
              : "Drop into a live one-to-one and see where the energy goes."}
          </Text>

          <View style={styles.signalGrid}>
            <View style={styles.signalTile}>
              <Ionicons name="sparkles" size={17} color="#F9A8D4" />
              <Text style={styles.signalLabel}>VIBE</Text>
              <Text style={styles.signalValue}>Live</Text>
            </View>
            <View style={styles.signalTile}>
              <Ionicons name="people" size={17} color="#C4B5FD" />
              <Text style={styles.signalLabel}>SOCIAL RADIUS</Text>
              <Text style={styles.signalValue}>{contextLabel ? "This event" : "PartyUp"}</Text>
            </View>
            <View style={styles.signalTile}>
              <Ionicons name="flash" size={17} color="#6EE7B7" />
              <Text style={styles.signalLabel}>MOMENTUM</Text>
              <Text style={styles.signalValue}>Ready</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, (busy || poolLoading) && styles.disabledButton]}
            onPress={startMatching}
            disabled={busy || poolLoading}
          >
            <Ionicons name="flash" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>
              {busy || poolLoading ? "Tuning your signal..." : "Find my vibe"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={returnHome}>
            <Ionicons name="arrow-back" size={18} color="#E9D5FF" />
            <Text style={styles.secondaryButtonText}>
              {returnRoomId ? "Return to Event" : "Return Home"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {matchState === "searching" && (
        <View style={[styles.matchPanel, styles.centeredPanel]}>
          <View style={styles.radarWrap}>
            <View style={styles.radarRingOuter} />
            <View style={styles.radarRingInner} />
            <View style={styles.radarCore} />
          </View>
          <Text style={styles.stateEyebrow}>SIGNAL SWEEPING</Text>
          {contextLabel && <Text style={styles.contextText}>{contextLabel}</Text>}
          <Text style={styles.title}>{nextBusy ? "Retuning the room..." : "Reading the room..."}</Text>
          <Text style={styles.searchCopy}>Checking live energy, timing, and party readiness.</Text>

          <View style={styles.scanRow}>
            <Text style={styles.scanItem}>VIBE / SCANNING</Text>
            <Text style={styles.scanItem}>TIMING / SCANNING</Text>
          </View>

          <TouchableOpacity
            style={[styles.secondaryButton, busy && styles.disabledButton]}
            onPress={cancelSearch}
            disabled={busy}
          >
            <Ionicons name="close" size={18} color="#E9D5FF" />
            <Text style={styles.secondaryButtonText}>
              {busy ? "Leaving the radar..." : "Leave the radar"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {matchState === "matched" && (
        <View style={[styles.matchPanel, styles.centeredPanel]}>
          <Ionicons name="alert-circle" size={34} color="#FCA5A5" />
          <Text style={styles.title}>Signal interrupted</Text>
          {contextLabel && <Text style={styles.contextText}>{contextLabel}</Text>}
          <Text style={styles.errorText}>The matched session could not be opened.</Text>

          <TouchableOpacity style={styles.secondaryButton} onPress={returnHome}>
            <Ionicons name="arrow-back" size={18} color="#E9D5FF" />
            <Text style={styles.secondaryButtonText}>
              {returnRoomId ? "Return to Event" : "Return Home"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {matchState === "disconnected" && (
        <View style={[styles.matchPanel, styles.centeredPanel]}>
          <Text style={styles.stateEyebrow}>MOMENTUM RESET</Text>
          <Text style={styles.title}>That moment wrapped.</Text>
          {contextLabel && <Text style={styles.contextText}>{contextLabel}</Text>}
          <Text style={styles.subtitle}>{disconnectedMessage ?? "Connection ended."}</Text>
          <Text style={styles.nextSignal}>Your next connection is one signal away.</Text>

          <TouchableOpacity
            style={[styles.primaryButton, (busy || nextBusy) && styles.disabledButton]}
            onPress={findSomeoneElse}
            disabled={busy || nextBusy}
          >
            <Ionicons name="flash" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>
              {busy || nextBusy ? "Tuning..." : "Find the next vibe"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={returnHome}>
            <Ionicons name="arrow-back" size={18} color="#E9D5FF" />
            <Text style={styles.secondaryButtonText}>
              {returnRoomId ? "Return to Event" : "Return Home"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {matchState === "error" && (
        <View style={[styles.matchPanel, styles.centeredPanel]}>
          <Ionicons name="alert-circle" size={34} color="#FCA5A5" />
          <Text style={styles.title}>Signal dropped</Text>
          {contextLabel && <Text style={styles.contextText}>{contextLabel}</Text>}
          <Text style={styles.errorText}>{error ?? "Something went wrong."}</Text>

          <TouchableOpacity
            style={[styles.primaryButton, (busy || poolLoading) && styles.disabledButton]}
            onPress={startMatching}
            disabled={busy || poolLoading}
          >
            <Ionicons name="refresh" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>{poolLoading ? "Retuning..." : "Tune again"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={returnHome}>
            <Ionicons name="arrow-back" size={18} color="#E9D5FF" />
            <Text style={styles.secondaryButtonText}>
              {returnRoomId ? "Return to Event" : "Return Home"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: "center",
    flex: 1,
    backgroundColor: "#050509",
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 18,
    paddingVertical: 28,
  },
  ambientGlow: {
    backgroundColor: "rgba(190, 24, 93, 0.2)",
    borderRadius: 220,
    height: 360,
    position: "absolute",
    right: -190,
    top: -110,
    width: 360,
  },
  matchPanel: {
    backgroundColor: "rgba(17, 8, 28, 0.97)",
    borderColor: "rgba(244, 114, 182, 0.24)",
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 520,
    padding: 22,
    width: "100%",
  },
  centeredPanel: {
    alignItems: "center",
  },
  panelHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 22,
  },
  panelHeaderText: {
    color: "#F9A8D4",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
  },
  liveDot: {
    backgroundColor: "#34D399",
    borderRadius: 5,
    height: 9,
    width: 9,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 39,
    marginTop: 10,
  },
  subtitle: {
    color: "#C8C1D3",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 23,
    marginTop: 12,
  },
  contextText: {
    color: "#F9A8D4",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 6,
    textTransform: "uppercase",
  },
  stateEyebrow: {
    color: "#F9A8D4",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 18,
  },
  muted: {
    color: "#A1A1AA",
    fontWeight: "700",
    marginTop: 10,
    textAlign: "center",
  },
  sessionText: {
    color: "#E9D5FF",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 28,
    textAlign: "center",
  },
  errorText: {
    color: "#FCA5A5",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
    marginTop: 14,
    marginBottom: 24,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#EC4899",
    borderRadius: 999,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 24,
    minHeight: 54,
    paddingHorizontal: 26,
    width: "100%",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#181425",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 50,
    paddingHorizontal: 22,
    width: "100%",
  },
  secondaryButtonText: {
    color: "#E9D5FF",
    fontSize: 15,
    fontWeight: "900",
  },
  disabledButton: {
    opacity: 0.55,
  },
  signalGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 24,
  },
  signalTile: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    minHeight: 92,
    padding: 10,
  },
  signalLabel: {
    color: "#777181",
    fontSize: 9,
    fontWeight: "900",
    marginTop: 9,
  },
  signalValue: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 3,
  },
  radarWrap: {
    alignItems: "center",
    height: 120,
    justifyContent: "center",
    width: 120,
  },
  radarRingOuter: {
    borderColor: "rgba(244,114,182,0.28)",
    borderRadius: 60,
    borderWidth: 1,
    height: 120,
    position: "absolute",
    width: 120,
  },
  radarRingInner: {
    borderColor: "rgba(196,181,253,0.42)",
    borderRadius: 42,
    borderWidth: 1,
    height: 84,
    position: "absolute",
    width: 84,
  },
  radarCore: {
    backgroundColor: "#EC4899",
    borderRadius: 18,
    height: 36,
    width: 36,
  },
  searchCopy: {
    color: "#A7A1B4",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 12,
    textAlign: "center",
  },
  scanRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 22,
  },
  scanItem: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 6,
    borderWidth: 1,
    color: "#E9D5FF",
    flex: 1,
    fontSize: 9,
    fontWeight: "900",
    paddingHorizontal: 9,
    paddingVertical: 11,
    textAlign: "center",
  },
  nextSignal: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 2,
    textAlign: "center",
  },
});
