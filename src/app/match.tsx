import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import {
  cancelMatchSearch,
  enqueueAndMatch,
  ensurePartyUpIdentity,
  getCurrentMatchQueueState,
  getGlobalMatchPool,
  getMatchSession,
  type MatchSession,
} from "../lib/matchmaking";

type MatchState = "idle" | "searching" | "matched" | "error";

function isAnonymousUser(user: User | null) {
  return Boolean((user as { is_anonymous?: boolean } | null)?.is_anonymous);
}

export default function MatchScreen() {
  const [authLoading, setAuthLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchState, setMatchState] = useState<MatchState>("idle");
  const [searchIdentityId, setSearchIdentityId] = useState<string | null>(null);
  const [session, setSession] = useState<MatchSession | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const hasAccount = Boolean(user && !isAnonymousUser(user));

  const clearSubscription = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const fail = useCallback(
    (message: string) => {
      clearSubscription();
      setBusy(false);
      setError(message);
      setSearchIdentityId(null);
      setSession(null);
      setMatchState("error");
    },
    [clearSubscription],
  );

  const transitionToMatched = useCallback(
    async (sessionId: string) => {
      try {
        const matchedSession = await getMatchSession(sessionId);

        clearSubscription();
        setSession(matchedSession);
        setSearchIdentityId(null);
        setError(null);
        setMatchState("matched");
      } catch (reason) {
        fail(reason instanceof Error ? reason.message : "The matched session could not be loaded.");
      }
    },
    [clearSubscription, fail],
  );

  const checkCurrentQueueForMatch = useCallback(
    async (identityId: string) => {
      const queueState = await getCurrentMatchQueueState(identityId);

      if (queueState?.status === "matched" && queueState.match_session_id) {
        await transitionToMatched(queueState.match_session_id);
      }
    },
    [transitionToMatched],
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
        setBusy(false);
        setSearchIdentityId(null);
        setSession(null);
        setMatchState("idle");
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      clearSubscription();
    };
  }, [clearSubscription]);

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

  async function startMatching() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    setSession(null);
    setSearchIdentityId(null);
    clearSubscription();

    try {
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user ?? null;
      setUser(currentUser);

      if (!currentUser || isAnonymousUser(currentUser)) {
        throw new Error("Sign in to test Match.");
      }

      try {
        await cancelMatchSearch();
      } catch {
        // A fresh search should not be blocked if there was no active queue row.
      }

      const identity = await ensurePartyUpIdentity();
      const pool = await getGlobalMatchPool();
      const result = await enqueueAndMatch(pool.id);

      if (result.matched) {
        if (!result.session_id) {
          throw new Error("Matchmaking returned a match without a session.");
        }

        await transitionToMatched(result.session_id);
        return;
      }

      setMatchState("searching");
      setSearchIdentityId(identity.id);
      await subscribeToQueue(identity.id);
      await checkCurrentQueueForMatch(identity.id);
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
      await cancelMatchSearch();
      clearSubscription();
      setSession(null);
      setSearchIdentityId(null);
      setMatchState("idle");
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "The match search could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }

  function returnHome() {
    clearSubscription();
    router.push("/home");
  }

  if (authLoading) {
    return (
      <View style={styles.page}>
        <ActivityIndicator color="#E9D5FF" />
        <Text style={styles.muted}>Checking sign-in...</Text>
      </View>
    );
  }

  if (!hasAccount) {
    return (
      <View style={styles.page}>
        <Text style={styles.title}>Match</Text>
        <Text style={styles.subtitle}>Sign in to test Match</Text>

        <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace("/")}>
          <Text style={styles.primaryButtonText}>Go to Sign In</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={returnHome}>
          <Text style={styles.secondaryButtonText}>Return Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      {matchState === "idle" && (
        <>
          <Text style={styles.title}>Match</Text>
          <Text style={styles.subtitle}>Meet someone new.</Text>

          <TouchableOpacity
            style={[styles.primaryButton, busy && styles.disabledButton]}
            onPress={startMatching}
            disabled={busy}
          >
            <Text style={styles.primaryButtonText}>
              {busy ? "Starting..." : "Start Matching"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={returnHome}>
            <Text style={styles.secondaryButtonText}>Return Home</Text>
          </TouchableOpacity>
        </>
      )}

      {matchState === "searching" && (
        <>
          <ActivityIndicator color="#E9D5FF" />
          <Text style={styles.title}>Finding someone...</Text>

          <TouchableOpacity
            style={[styles.secondaryButton, busy && styles.disabledButton]}
            onPress={cancelSearch}
            disabled={busy}
          >
            <Text style={styles.secondaryButtonText}>
              {busy ? "Cancelling..." : "Cancel"}
            </Text>
          </TouchableOpacity>
        </>
      )}

      {matchState === "matched" && (
        <>
          <Text style={styles.title}>Matched</Text>
          <Text style={styles.sessionText}>Session: {session?.id}</Text>

          <TouchableOpacity style={styles.secondaryButton} onPress={returnHome}>
            <Text style={styles.secondaryButtonText}>Return Home</Text>
          </TouchableOpacity>
        </>
      )}

      {matchState === "error" && (
        <>
          <Text style={styles.title}>Match</Text>
          <Text style={styles.errorText}>{error ?? "Something went wrong."}</Text>

          <TouchableOpacity
            style={[styles.primaryButton, busy && styles.disabledButton]}
            onPress={startMatching}
            disabled={busy}
          >
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={returnHome}>
            <Text style={styles.secondaryButtonText}>Return Home</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#050509",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 36,
    fontWeight: "900",
    marginTop: 14,
    textAlign: "center",
  },
  subtitle: {
    color: "#C4B5FD",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 28,
    textAlign: "center",
  },
  muted: {
    color: "#A1A1AA",
    fontWeight: "700",
    marginTop: 14,
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
    alignSelf: "center",
    backgroundColor: "#EC4899",
    borderRadius: 999,
    justifyContent: "center",
    marginTop: 10,
    minHeight: 52,
    paddingHorizontal: 26,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#181425",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 48,
    paddingHorizontal: 22,
  },
  secondaryButtonText: {
    color: "#E9D5FF",
    fontSize: 15,
    fontWeight: "900",
  },
  disabledButton: {
    opacity: 0.55,
  },
});
