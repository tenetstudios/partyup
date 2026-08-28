import type { SupabaseClient } from "@supabase/supabase-js";

export type TriviaStanding = { faction_key: string; participant_count: number; counted_count: number; average_score: number; eligible: boolean; placement: number | null };
export type TriviaRoundSummary = { id: string; room_id: string; status: "scheduled" | "active" | "scoring" | "ended" | "cancelled"; starts_at: string; question_count: number; seconds_per_question: number; feedback_ms: number; territory_key: string | null; participant_count: number; standings: TriviaStanding[] | null; reward_status: string };
export type TriviaPlayerState = {
  round: TriviaRoundSummary;
  joined: boolean;
  faction_key: string | null;
  questions: { question_order: number; question_text: string; answers: string[]; category: string | null }[];
  answers: { question_order: number; selected_answer: number; is_correct: boolean; score_awarded: number; response_ms: number }[];
  player_result: null | { total_score: number; correct_count: number; average_correct_response_ms: number | null; counted_for_faction: boolean };
};

export function getTriviaTimeline(startsAt: string, secondsPerQuestion: number, feedbackMs: number, now = Date.now()) {
  const elapsed = now - Date.parse(startsAt);
  const slotMs = secondsPerQuestion * 1000 + feedbackMs;
  if (elapsed < 0) return { phase: "countdown" as const, countdownMs: -elapsed, questionIndex: -1, remainingMs: 0 };
  const questionIndex = Math.floor(elapsed / slotMs);
  if (questionIndex >= 10) return { phase: "complete" as const, countdownMs: 0, questionIndex: 10, remainingMs: 0 };
  const withinSlot = elapsed - questionIndex * slotMs;
  if (withinSlot < secondsPerQuestion * 1000) return { phase: "question" as const, countdownMs: 0, questionIndex, remainingMs: secondsPerQuestion * 1000 - withinSlot };
  return { phase: "feedback" as const, countdownMs: 0, questionIndex, remainingMs: slotMs - withinSlot };
}

export async function getRoomTrivia(client: SupabaseClient, roomId: string) {
  const { data, error } = await client.rpc("get_room_lightning_trivia", { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return data as TriviaRoundSummary | null;
}
export async function getTriviaPlayerState(client: SupabaseClient, roundId: string, guestToken?: string | null) {
  const { data, error } = await client.rpc("get_lightning_trivia_player_state", { p_round_id: roundId, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  return data as TriviaPlayerState;
}
export async function joinTriviaRound(client: SupabaseClient, roundId: string, guestToken?: string | null) {
  const { error } = await client.rpc("join_lightning_trivia_round", { p_round_id: roundId, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
}
export async function submitTriviaAnswer(client: SupabaseClient, roundId: string, questionOrder: number, selectedAnswer: number, guestToken?: string | null) {
  const { data, error } = await client.rpc("submit_lightning_trivia_answer", { p_round_id: roundId, p_question_order: questionOrder, p_selected_answer: selectedAnswer, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  return data as { correct: boolean; score_awarded: number };
}
