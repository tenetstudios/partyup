import { useCallback, useEffect, useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import {
  createTriviaRound, generateTriviaQuestionIds, getRoomTrivia, getTriviaQuestionBank,
  triviaCategories, triviaDifficulties, triviaLabel, type TriviaQuestion, type TriviaRoundSummary,
} from "../../lib/lightningTrivia";
import { getWildRoomState, type WildRoomState } from "../../lib/wild";

type ToggleFilter = "" | "yes" | "no";

export default function LightningTriviaManager({ roomId }: { roomId: string }) {
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [bankExpanded, setBankExpanded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [chosen, setChosen] = useState<TriviaQuestion[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [humour, setHumour] = useState<ToggleFilter>("");
  const [preview, setPreview] = useState<TriviaQuestion | null>(null);
  const [round, setRound] = useState<TriviaRoundSummary | null>(null);
  const [wild, setWild] = useState<WildRoomState | null>(null);
  const [territory, setTerritory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadBank = useCallback(async () => {
    setQuestions(await getTriviaQuestionBank(supabase, { roomId, search, category, difficulty, humour: humour === "" ? null : humour === "yes" }));
  }, [category, difficulty, humour, roomId, search]);

  const loadRound = useCallback(async () => {
    const [current, wildState] = await Promise.all([getRoomTrivia(supabase, roomId), getWildRoomState(supabase, roomId).catch(() => null)]);
    setRound(current && ["scheduled", "active", "scoring"].includes(current.status) ? current : null);
    setWild(wildState);
  }, [roomId]);

  useEffect(() => { const timer = setTimeout(() => void loadBank().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load questions.")), 200); return () => clearTimeout(timer); }, [loadBank]);
  useEffect(() => { void loadRound().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load trivia.")); }, [loadRound]);

  function toggle(item: TriviaQuestion) {
    if (selected.includes(item.id)) {
      setSelected((current) => current.filter((id) => id !== item.id));
      setChosen((current) => current.filter((question) => question.id !== item.id));
    } else if (selected.length < 10) {
      setSelected((current) => [...current, item.id]);
      setChosen((current) => [...current, item]);
    }
  }

  async function generate() {
    setBusy(true); setError("");
    try {
      const ids = await generateTriviaQuestionIds(supabase, { roomId, category, difficulty });
      const pool = await getTriviaQuestionBank(supabase, { roomId, category, difficulty });
      setSelected(ids); setChosen(ids.map((id) => pool.find((item) => item.id === id)).filter((item): item is TriviaQuestion => Boolean(item)));
      setSearch(""); setHumour("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate a round."); }
    finally { setBusy(false); }
  }

  async function launch() {
    setBusy(true); setError("");
    try {
      const activeWild = wild?.game?.status === "active" ? wild.game : null;
      await createTriviaRound(supabase, { roomId, questionIds: selected, wildGameId: territory ? activeWild?.id : null, territoryKey: territory || null });
      setSelected([]); setChosen([]); await loadRound();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not launch trivia."); }
    finally { setBusy(false); }
  }

  const activeWild = wild?.game?.status === "active" ? wild.game : null;
  const visibleQuestions = bankExpanded ? questions : questions.slice(0, 3);

  return <View style={styles.container}>
    <Text style={styles.eyebrow}>⚡ VERIFIED MISSION</Text>
    <Text style={styles.title}>Lightning Trivia</Text>
    <Text style={styles.copy}>Pick ten read-only questions from PartyUp&apos;s bank. The launched round keeps a permanent snapshot.</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {round ? <View style={styles.liveCard}><Text style={styles.liveTitle}>ROUND {round.status.toUpperCase()}</Text><Text style={styles.copy}>The current Lightning Trivia round is already {round.status}.</Text></View> : <>
      <View style={styles.countRow}><Text style={styles.sectionTitle}>PartyUp Question Bank</Text><Text style={styles.count}>{selected.length}/10</Text></View>
      <TextInput value={search} onChangeText={setSearch} placeholder="Search questions and answers" placeholderTextColor="#71717A" style={styles.input} />
      <Text style={styles.filterLabel}>Category</Text><View style={styles.chips}><Chip label="General Mix" active={!category} onPress={() => setCategory("")} />{triviaCategories.map((value) => <Chip key={value} label={triviaLabel(value)} active={category === value} onPress={() => setCategory(value)} />)}</View>
      <Text style={styles.filterLabel}>Difficulty</Text><View style={styles.chips}><Chip label="Any" active={!difficulty} onPress={() => setDifficulty("")} />{triviaDifficulties.map((value) => <Chip key={value} label={triviaLabel(value)} active={difficulty === value} onPress={() => setDifficulty(value)} />)}</View>
      <Text style={styles.filterLabel}>Humour</Text><View style={styles.chips}><Chip label="Any" active={!humour} onPress={() => setHumour("")} /><Chip label="Yes" active={humour === "yes"} onPress={() => setHumour("yes")} /><Chip label="No" active={humour === "no"} onPress={() => setHumour("no")} /></View>
      <TouchableOpacity disabled={busy} onPress={() => void generate()} style={[styles.generate, busy && styles.disabled]}><Text style={styles.generateText}>Generate 10 from PartyUp Bank</Text></TouchableOpacity>
      <View style={styles.list}>{visibleQuestions.map((item) => { const isSelected = selected.includes(item.id); return <View key={item.id} style={[styles.question, isSelected && styles.questionSelected]}><TouchableOpacity disabled={!isSelected && selected.length >= 10} onPress={() => toggle(item)} style={styles.questionMain}><Text style={styles.check}>{isSelected ? "✓" : "+"}</Text><View style={styles.questionCopy}><Text style={styles.questionText}>{item.question_text}</Text><Text style={styles.meta}>{triviaLabel(item.category)} · {triviaLabel(item.difficulty)}{item.humour ? " · 😄" : ""}</Text></View></TouchableOpacity><TouchableOpacity onPress={() => setPreview(item)}><Text style={styles.previewLink}>Preview</Text></TouchableOpacity></View>; })}</View>
      {questions.length > 3 ? <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: bankExpanded }} onPress={() => setBankExpanded((value) => !value)} style={styles.expandBank}><Text style={styles.expandBankText}>{bankExpanded ? "Show 3 example questions" : `Open full list (${questions.length} questions)`}</Text></TouchableOpacity> : null}
      {chosen.length ? <View style={styles.selectedBox}><Text style={styles.sectionTitle}>Selected order</Text>{selected.map((id, index) => { const item = chosen.find((question) => question.id === id); return item ? <View key={id} style={styles.selectedRow}><Text style={styles.order}>{index + 1}</Text><Text numberOfLines={1} style={styles.selectedText}>{item.question_text}</Text><TouchableOpacity onPress={() => toggle(item)}><Text style={styles.remove}>Remove</Text></TouchableOpacity></View> : null; })}</View> : null}
      {activeWild ? <><Text style={styles.filterLabel}>Wild territory (optional)</Text><View style={styles.chips}><Chip label="Room-wide" active={!territory} onPress={() => setTerritory("")} />{activeWild.config.territories.map((item) => <Chip key={item.key} label={item.label} active={territory === item.key} onPress={() => setTerritory(item.key)} />)}</View></> : null}
      <TouchableOpacity disabled={busy || selected.length !== 10} onPress={() => void launch()} style={[styles.launch, (busy || selected.length !== 10) && styles.disabled]}><Text style={styles.launchText}>Launch selected 10</Text></TouchableOpacity>
    </>}
    <Modal transparent animationType="fade" visible={Boolean(preview)} onRequestClose={() => setPreview(null)}><View style={styles.modalBackdrop}><View style={styles.modal}><TouchableOpacity onPress={() => setPreview(null)} style={styles.close}><Text style={styles.closeText}>Close</Text></TouchableOpacity><Text style={styles.eyebrow}>QUESTION PREVIEW</Text><Text style={styles.previewTitle}>{preview?.question_text}</Text>{preview?.answers.map((answer, index) => <View key={index} style={[styles.answer, index === preview.correct_answer && styles.correct]}><Text style={styles.answerText}>{String.fromCharCode(65 + index)}) {answer}</Text></View>)}</View></View></Modal>
  </View>;
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) { return <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></TouchableOpacity>; }

const styles = StyleSheet.create({
  container: { borderTopWidth: 1, borderTopColor: "#27272A", marginTop: 20, paddingTop: 20 }, eyebrow: { color: "#FDE047", fontSize: 11, fontWeight: "900", letterSpacing: 1.5 }, title: { color: "#FFF", fontSize: 22, fontWeight: "900", marginTop: 5 }, copy: { color: "#A1A1AA", fontSize: 13, lineHeight: 19, marginTop: 5 }, error: { color: "#FECACA", backgroundColor: "#450A0A", borderRadius: 8, padding: 12, marginTop: 12, fontWeight: "700" }, liveCard: { backgroundColor: "#422006", borderColor: "#854D0E", borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 14 }, liveTitle: { color: "#FEF08A", fontWeight: "900" }, countRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 }, sectionTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" }, count: { color: "#111", backgroundColor: "#FACC15", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, fontWeight: "900" }, input: { backgroundColor: "#09090B", color: "#FFF", borderRadius: 10, padding: 13, marginTop: 12 }, filterLabel: { color: "#D4D4D8", fontSize: 12, fontWeight: "800", marginTop: 14, marginBottom: 7 }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, chip: { borderColor: "#3F3F46", borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7 }, chipActive: { backgroundColor: "#7C3AED", borderColor: "#A78BFA" }, chipText: { color: "#A1A1AA", fontSize: 12, fontWeight: "800" }, chipTextActive: { color: "#FFF" }, generate: { backgroundColor: "#FACC15", borderRadius: 10, padding: 13, alignItems: "center", marginTop: 16 }, generateText: { color: "#111", fontWeight: "900" }, disabled: { opacity: 0.4 }, list: { gap: 8, marginTop: 14 }, expandBank: { alignItems: "center", backgroundColor: "#2E2505", borderColor: "#A16207", borderRadius: 10, borderWidth: 1, marginTop: 10, padding: 12 }, expandBankText: { color: "#FEF08A", fontSize: 13, fontWeight: "900" }, question: { backgroundColor: "#09090B", borderColor: "#27272A", borderWidth: 1, borderRadius: 10, padding: 11, flexDirection: "row", alignItems: "center", gap: 8 }, questionSelected: { borderColor: "#FACC15", backgroundColor: "#2E2505" }, questionMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }, check: { color: "#FDE047", fontSize: 18, fontWeight: "900", width: 20 }, questionCopy: { flex: 1 }, questionText: { color: "#FFF", fontWeight: "800", lineHeight: 18 }, meta: { color: "#71717A", fontSize: 11, marginTop: 4 }, previewLink: { color: "#C4B5FD", fontSize: 12, fontWeight: "900" }, selectedBox: { marginTop: 16, gap: 7 }, selectedRow: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#18181B", borderRadius: 8, padding: 9 }, order: { color: "#FDE047", fontWeight: "900", width: 18 }, selectedText: { color: "#FFF", flex: 1, fontWeight: "700" }, remove: { color: "#FCA5A5", fontSize: 11, fontWeight: "900" }, launch: { backgroundColor: "#FACC15", borderRadius: 10, padding: 15, alignItems: "center", marginTop: 18 }, launchText: { color: "#111", fontWeight: "900", fontSize: 15 }, modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "center", padding: 20 }, modal: { backgroundColor: "#181105", borderColor: "#FACC15", borderWidth: 1, borderRadius: 16, padding: 18 }, close: { alignSelf: "flex-end", borderColor: "#52525B", borderWidth: 1, borderRadius: 7, paddingHorizontal: 11, paddingVertical: 7 }, closeText: { color: "#FFF", fontWeight: "800" }, previewTitle: { color: "#FFF", fontSize: 20, fontWeight: "900", lineHeight: 27, marginTop: 9, marginBottom: 12 }, answer: { borderColor: "#3F3F46", borderWidth: 1, borderRadius: 9, padding: 12, marginTop: 7 }, correct: { borderColor: "#34D399", backgroundColor: "#052E24" }, answerText: { color: "#FFF", fontWeight: "700" },
});
