import type { SupabaseClient } from "@supabase/supabase-js";
import { requestPushDispatch } from "./pushDispatch";

export const triviaCategories = ["humour", "music", "movies_tv", "pop_culture", "sports", "geography", "science_nature", "history", "food_drink", "internet_gaming", "general_knowledge"] as const;
export const triviaDifficulties = ["very_easy", "easy", "medium", "hard"] as const;
export type TriviaQuestion = { id: string; question_text: string; answers: string[]; correct_answer: number; correct_answer_key: "A" | "B" | "C" | "D"; category: string; difficulty: string; humour: boolean; is_active: boolean; bank_scope: "partyup" | "custom"; status: "active" | "archived"; updated_at: string };

export function triviaLabel(value: string) { return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }

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
export async function getTriviaQuestionBank(client: SupabaseClient, input: { roomId: string; search?: string; category?: string; difficulty?: string; humour?: boolean | null }) {
  const { data, error } = await client.rpc("get_trivia_question_bank", { p_room_id: input.roomId, p_search: input.search?.trim() || null, p_category: input.category || null, p_difficulty: input.difficulty || null, p_humour: input.humour ?? null, p_limit: 500 });
  if (error) throw new Error(error.message);
  return (data ?? []) as TriviaQuestion[];
}
export async function generateTriviaQuestionIds(client: SupabaseClient, input: { roomId: string; category?: string; difficulty?: string }) {
  const { data, error } = await client.rpc("generate_trivia_question_ids", { p_room_id: input.roomId, p_category: input.category || null, p_difficulty: input.difficulty || null });
  if (error) throw new Error(error.message);
  return (data ?? []) as string[];
}
export async function createTriviaRound(client: SupabaseClient, input: { roomId: string; questionIds: string[]; wildGameId?: string | null; territoryKey?: string | null }) {
  const { data, error } = await client.rpc("create_lightning_trivia_round", { p_room_id: input.roomId, p_question_ids: input.questionIds, p_starts_at: null, p_seconds_per_question: 5, p_countdown_seconds: 10, p_wild_game_id: input.wildGameId ?? null, p_territory_key: input.territoryKey ?? null, p_minimum_faction_participants: 5, p_first_place_reward: 50, p_second_place_reward: 20, p_third_place_reward: 10 });
  if (error) throw new Error(error.message);
  requestPushDispatch(client, input.roomId);
  return data as TriviaRoundSummary;
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
