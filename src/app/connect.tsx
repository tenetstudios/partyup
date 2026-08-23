import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import * as ExpoLinking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-native-qrcode-svg";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  cancelPartyUpTapToken,
  createPartyUpTapToken,
  getPartyUpTapTokenStatus,
  redeemPartyUpTapToken,
  type PartyUpTapPerson,
  type PartyUpTapRedeemResult,
  type PartyUpTapToken,
} from "../../lib/partyupTap";
import { supabase } from "../../lib/supabase";
import { readActiveRoomContext } from "../lib/activeRoomContext";

type Mode = "show" | "scan" | "result";
type ShowState = "generating" | "ready" | "expired" | "error";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function extractTapValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith("partyup-tap:")) return trimmed.slice(12);

  try {
    const parsed = ExpoLinking.parse(trimmed);
    const queryToken = parsed.queryParams?.token;
    if (typeof queryToken === "string" && queryToken) return queryToken;
    const pathMatch = parsed.path?.match(/(?:^|\/)connect\/t\/([^/?#]+)/i);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  } catch {
    // A manual short code or raw temporary token is valid input too.
  }

  return /^[a-f0-9]{48}$/i.test(trimmed) || /^[a-f0-9]{6}$/i.test(trimmed)
    ? trimmed
    : null;
}

export default function PartyUpConnectScreen() {
  const params = useLocalSearchParams<{ token?: string | string[]; roomId?: string | string[] }>();
  const incomingToken = readParam(params.token);
  const requestedRoomId = readParam(params.roomId);
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>(incomingToken ? "scan" : "show");
  const [showState, setShowState] = useState<ShowState>("generating");
  const [tapToken, setTapToken] = useState<PartyUpTapToken | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [manualCode, setManualCode] = useState("");
  const [scanLocked, setScanLocked] = useState(Boolean(incomingToken));
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<PartyUpTapRedeemResult | null>(null);
  const [creatorResult, setCreatorResult] = useState<PartyUpTapPerson | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const incomingHandled = useRef(false);

  const generate = useCallback(async () => {
    setShowState("generating");
    setMessage(null);
    setResult(null);
    setCreatorResult(null);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/");
        return;
      }
      const stickyRoom = requestedRoomId ? null : await readActiveRoomContext();
      const created = await createPartyUpTapToken(requestedRoomId ?? stickyRoom?.roomId ?? null);
      setTapToken(created);
      setShowState("ready");
      setMode("show");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not make a Tap.");
      setShowState("error");
    }
  }, [requestedRoomId]);

  const redeem = useCallback(async (rawValue: string) => {
    const value = extractTapValue(rawValue);
    if (!value) {
      setMessage("That isn’t a PartyUp Tap code.");
      setScanLocked(false);
      return;
    }
    setBusy(true);
    setScanLocked(true);
    setMessage(null);
    try {
      const nextResult = await redeemPartyUpTapToken(value);
      setResult(nextResult);
      setMode("result");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect right now.");
      setScanLocked(false);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (incomingToken) {
      if (!incomingHandled.current) {
        incomingHandled.current = true;
        void redeem(incomingToken);
      }
      return;
    }
    void generate();
  }, [generate, incomingToken, redeem]);

  useEffect(() => {
    if (!tapToken || mode !== "show" || showState !== "ready") return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(tapToken.expires_at) - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) setShowState("expired");
    };
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [mode, showState, tapToken]);

  useEffect(() => {
    if (!tapToken || mode !== "show" || showState !== "ready") return;
    const interval = setInterval(async () => {
      try {
        const status = await getPartyUpTapTokenStatus(tapToken.token);
        if (status.status === "connected") {
          setCreatorResult(status.person ?? null);
          setResult({
            status: "connected",
            connection_id: status.connection_id,
            origin_room_id: tapToken.origin_room_id,
            origin_label: tapToken.origin_label,
            person: status.person,
          });
          setMode("result");
        } else if (status.status === "expired" || status.status === "cancelled") {
          setShowState("expired");
        }
      } catch {
        // A temporary polling failure must not invalidate the QR.
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [mode, showState, tapToken]);

  async function close() {
    if (tapToken && mode === "show" && showState === "ready") {
      await cancelPartyUpTapToken(tapToken.token).catch(() => undefined);
    }
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }

  async function openScanner() {
    setMessage(null);
    setScanLocked(false);
    setTorchEnabled(false);
    setMode("scan");
    if (!permission?.granted) await requestPermission();
  }

  async function showMyTap() {
    if (tapToken && showState === "ready") {
      setMode("show");
      return;
    }
    await generate();
  }

  const qrPayload = tapToken
    ? ExpoLinking.createURL("/connect", { queryParams: { token: tapToken.token } })
    : "partyup://connect";
  const success = result?.status === "connected" || result?.status === "already_connected";
  const resultPerson = result?.person ?? creatorResult;

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
        <TouchableOpacity accessibilityLabel="Close Connect" style={styles.closeButton} onPress={() => void close()}>
          <Ionicons name="close" size={25} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>PARTYUP TAP</Text>
          <Text style={styles.headerTitle}>Connect on PartyUp</Text>
        </View>
        <View style={styles.closeButton} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 24 }]} keyboardShouldPersistTaps="handled">
        {mode === "show" && (
          <View style={styles.centered}>
            {showState === "generating" ? (
              <StateMessage title="Making your Tap…" copy="One sec." />
            ) : showState === "ready" && tapToken ? (
              <>
                <View style={styles.qrGlow}><View style={styles.qrBox}><QRCode value={qrPayload} size={270} backgroundColor="#FFFFFF" color="#090611" /></View></View>
                <Text style={styles.scanMe}>Scan me</Text>
                <Text style={styles.helper}>They can scan inside PartyUp.</Text>
                <View style={styles.codeRow}><View style={styles.line} /><Text style={styles.or}>OR ENTER</Text><View style={styles.line} /></View>
                <Text style={styles.shortCode}>{tapToken.short_code}</Text>
                <Text style={styles.timer}>{secondsLeft}s</Text>
                {tapToken.origin_label ? <Text style={styles.roomContext}>Meeting at {tapToken.origin_label}</Text> : null}
              </>
            ) : showState === "expired" ? (
              <View style={styles.stateBlock}><Ionicons name="time-outline" size={56} color="#A78BFA" /><Text style={styles.stateTitle}>That Tap expired.</Text><Text style={styles.stateCopy}>Make a fresh one when you&apos;re ready.</Text><TouchableOpacity style={styles.primaryButton} onPress={() => void generate()}><Text style={styles.primaryText}>New Tap</Text></TouchableOpacity></View>
            ) : (
              <View style={styles.stateBlock}><Ionicons name="cloud-offline-outline" size={56} color="#FBBF24" /><Text style={styles.stateTitle}>Couldn&apos;t make a Tap.</Text><Text style={styles.errorText}>{message}</Text><TouchableOpacity style={styles.primaryButton} onPress={() => void generate()}><Text style={styles.primaryText}>Try again</Text></TouchableOpacity></View>
            )}
            {showState === "ready" && <TouchableOpacity style={styles.secondaryButton} onPress={() => void openScanner()}><Ionicons name="scan" size={21} color="#E9D5FF" /><Text style={styles.secondaryText}>Scan their Tap</Text></TouchableOpacity>}
          </View>
        )}

        {mode === "scan" && (
          <View style={styles.scannerContent}>
            <Text style={styles.modeTitle}>Scan their Tap</Text>
            <Text style={styles.modeCopy}>Point the camera at their temporary PartyUp QR.</Text>
            {permission?.granted ? (
              <View style={styles.cameraShell}>
                <CameraView
                  active={mode === "scan"}
                  style={styles.camera}
                  facing="back"
                  enableTorch={torchEnabled}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={scanLocked ? undefined : ({ data }) => void redeem(data)}
                />
                <View pointerEvents="none" style={styles.scanFrame} />
                {busy && <View style={styles.cameraBusy}><ActivityIndicator size="large" color="#FFFFFF" /><Text style={styles.cameraBusyText}>Connecting…</Text></View>}
              </View>
            ) : (
              <TouchableOpacity style={styles.permissionCard} onPress={() => void requestPermission()}><Ionicons name="camera-outline" size={44} color="#C4B5FD" /><Text style={styles.stateTitle}>Allow camera</Text><Text style={styles.stateCopy}>PartyUp only uses it to scan the code.</Text></TouchableOpacity>
            )}
            {permission?.granted && <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: torchEnabled }} style={[styles.torchButton, torchEnabled && styles.torchActive]} onPress={() => setTorchEnabled((value) => !value)}><Ionicons name={torchEnabled ? "flashlight" : "flashlight-outline"} size={20} color="#FFFFFF" /><Text style={styles.torchText}>{torchEnabled ? "Flashlight on" : "Flashlight"}</Text></TouchableOpacity>}
            <Text style={styles.manualLabel}>OR ENTER THEIR CODE</Text>
            <View style={styles.manualRow}><TextInput value={manualCode} onChangeText={(value) => setManualCode(value.toUpperCase())} autoCapitalize="characters" maxLength={48} placeholder="ABC123" placeholderTextColor="#6F6979" style={styles.codeInput} /><TouchableOpacity disabled={!manualCode.trim() || busy} style={[styles.connectButton, (!manualCode.trim() || busy) && styles.disabled]} onPress={() => void redeem(manualCode)}><Text style={styles.connectText}>Connect</Text></TouchableOpacity></View>
            {message ? <Text style={styles.errorText}>{message}</Text> : null}
            <TouchableOpacity style={styles.textButton} onPress={() => void showMyTap()}><Text style={styles.textButtonText}>Show my Tap instead</Text></TouchableOpacity>
          </View>
        )}

        {mode === "result" && result && (
          <View style={styles.resultBlock}>
            {success ? <View style={styles.avatar}>{resultPerson?.avatar_url ? <Image source={{ uri: resultPerson.avatar_url }} style={styles.avatarImage} contentFit="cover" /> : <Text style={styles.avatarText}>{(resultPerson?.display_name || "P").slice(0, 1).toUpperCase()}</Text>}</View> : <View style={styles.resultIcon}><Ionicons name={result.status === "self_scan" ? "person-outline" : "alert-circle-outline"} size={54} color="#D8B4FE" /></View>}
            <Text style={styles.resultTitle}>{result.status === "connected" ? "Connected ⚡" : result.status === "already_connected" ? "Already connected" : result.status === "self_scan" ? "That’s your Tap" : result.status === "expired" ? "Tap expired" : "Invalid Tap"}</Text>
            {success && resultPerson ? <Text style={styles.resultName}>{resultPerson.display_name}</Text> : null}
            {result.origin_label ? <Text style={styles.roomContext}>Met at {result.origin_label}</Text> : null}
            {!success ? <Text style={styles.stateCopy}>{result.status === "self_scan" ? "Have someone else scan your code." : result.status === "expired" ? "Ask them to make a fresh one." : "This isn’t an active PartyUp Tap."}</Text> : null}
            <TouchableOpacity style={styles.primaryButton} onPress={() => { if (success) router.replace("/connections"); else router.replace("/connect" as never); }}><Text style={styles.primaryText}>{success ? "See Connections" : "Try another Tap"}</Text></TouchableOpacity>
            {success && <TouchableOpacity style={styles.textButton} onPress={() => router.replace("/home")}><Text style={styles.textButtonText}>Done</Text></TouchableOpacity>}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StateMessage({ title, copy }: { title: string; copy: string }) {
  return <View style={styles.stateBlock}><ActivityIndicator size="large" color="#C35DFF" /><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateCopy}>{copy}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#050509" },
  header: { alignItems: "center", borderBottomColor: "rgba(255,255,255,0.08)", borderBottomWidth: 1, flexDirection: "row", paddingBottom: 14, paddingHorizontal: 18 },
  closeButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  headerCopy: { alignItems: "center", flex: 1 },
  eyebrow: { color: "#C35DFF", fontSize: 11, fontWeight: "900", letterSpacing: 1.8 },
  headerTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginTop: 3 },
  content: { flexGrow: 1, padding: 20 },
  centered: { alignItems: "center", flex: 1 },
  qrGlow: { backgroundColor: "rgba(139,61,255,0.2)", borderRadius: 30, marginTop: 18, padding: 10, shadowColor: "#8B3DFF", shadowOpacity: 0.7, shadowRadius: 28 },
  qrBox: { backgroundColor: "#FFFFFF", borderRadius: 22, padding: 16 },
  scanMe: { color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 22 },
  helper: { color: "#AAA4B8", fontSize: 14, fontWeight: "700", marginTop: 6 },
  codeRow: { alignItems: "center", flexDirection: "row", gap: 12, marginTop: 22, width: "90%" },
  line: { backgroundColor: "rgba(255,255,255,0.1)", flex: 1, height: 1 },
  or: { color: "#817B8B", fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  shortCode: { color: "#E9D5FF", fontSize: 28, fontWeight: "900", letterSpacing: 7, marginLeft: 7, marginTop: 13 },
  timer: { color: "#C35DFF", fontSize: 14, fontWeight: "900", marginTop: 12 },
  roomContext: { color: "#C4B5FD", fontSize: 14, fontWeight: "800", marginTop: 10, textAlign: "center" },
  secondaryButton: { alignItems: "center", borderColor: "rgba(196,181,253,0.28)", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 9, marginTop: 25, paddingHorizontal: 22, paddingVertical: 13 },
  secondaryText: { color: "#E9D5FF", fontSize: 15, fontWeight: "900" },
  stateBlock: { alignItems: "center", justifyContent: "center", minHeight: 360, paddingHorizontal: 18 },
  stateTitle: { color: "#FFFFFF", fontSize: 27, fontWeight: "900", marginTop: 18, textAlign: "center" },
  stateCopy: { color: "#AAA4B8", fontSize: 15, fontWeight: "700", lineHeight: 22, marginTop: 8, textAlign: "center" },
  errorText: { color: "#FDE68A", fontSize: 14, fontWeight: "800", lineHeight: 20, marginTop: 14, textAlign: "center" },
  primaryButton: { alignItems: "center", backgroundColor: "#7C3AED", borderRadius: 999, marginTop: 24, minWidth: 190, paddingHorizontal: 24, paddingVertical: 15 },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  scannerContent: { alignItems: "center" },
  modeTitle: { color: "#FFFFFF", fontSize: 30, fontWeight: "900", marginTop: 8 },
  modeCopy: { color: "#AAA4B8", fontSize: 14, fontWeight: "700", marginBottom: 18, marginTop: 7, textAlign: "center" },
  cameraShell: { borderColor: "rgba(196,181,253,0.35)", borderRadius: 24, borderWidth: 1, height: 360, overflow: "hidden", position: "relative", width: "100%" },
  camera: { flex: 1 },
  scanFrame: { borderColor: "#FFFFFF", borderRadius: 20, borderWidth: 3, height: 230, left: "50%", marginLeft: -115, marginTop: -115, position: "absolute", top: "50%", width: 230 },
  cameraBusy: { ...StyleSheet.absoluteFillObject, alignItems: "center", backgroundColor: "rgba(5,5,9,0.72)", justifyContent: "center" },
  cameraBusyText: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", marginTop: 12 },
  permissionCard: { alignItems: "center", backgroundColor: "#10101A", borderColor: "#2B2540", borderRadius: 24, borderWidth: 1, justifyContent: "center", minHeight: 300, padding: 28, width: "100%" },
  torchButton: { alignItems: "center", borderColor: "rgba(255,255,255,0.16)", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 14, paddingHorizontal: 18, paddingVertical: 11 },
  torchActive: { backgroundColor: "#7C3AED", borderColor: "#A78BFA" },
  torchText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  manualLabel: { color: "#817B8B", fontSize: 11, fontWeight: "900", letterSpacing: 1.5, marginTop: 24 },
  manualRow: { flexDirection: "row", gap: 10, marginTop: 10, width: "100%" },
  codeInput: { backgroundColor: "#10101A", borderColor: "#2B2540", borderRadius: 14, borderWidth: 1, color: "#FFFFFF", flex: 1, fontSize: 17, fontWeight: "900", letterSpacing: 3, paddingHorizontal: 16, paddingVertical: 14 },
  connectButton: { alignItems: "center", backgroundColor: "#7C3AED", borderRadius: 14, justifyContent: "center", paddingHorizontal: 18 },
  connectText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  textButton: { marginTop: 20, padding: 10 },
  textButtonText: { color: "#C4B5FD", fontSize: 15, fontWeight: "900" },
  resultBlock: { alignItems: "center", flex: 1, justifyContent: "center", minHeight: 520, paddingHorizontal: 12 },
  avatar: { alignItems: "center", backgroundColor: "#7C3AED", borderRadius: 58, height: 116, justifyContent: "center", overflow: "hidden", shadowColor: "#8B3DFF", shadowOpacity: 0.8, shadowRadius: 30, width: 116 },
  avatarImage: { height: "100%", width: "100%" },
  avatarText: { color: "#FFFFFF", fontSize: 42, fontWeight: "900" },
  resultIcon: { alignItems: "center", backgroundColor: "#171124", borderRadius: 56, height: 112, justifyContent: "center", width: 112 },
  resultTitle: { color: "#FFFFFF", fontSize: 40, fontWeight: "900", letterSpacing: -1, marginTop: 25, textAlign: "center" },
  resultName: { color: "#DDD6E7", fontSize: 20, fontWeight: "800", marginTop: 10 },
});
