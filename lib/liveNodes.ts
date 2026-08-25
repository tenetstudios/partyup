import type { SupabaseClient } from "@supabase/supabase-js";

export type LiveNodeScanStatus = "active" | "winner" | "inactive" | "claimed" | "already_claimed_by_you" | "ended" | "room_ended" | "not_eligible" | "invalid";

export type LiveNodeScanState = {
  status: LiveNodeScanStatus;
  node_id?: string;
  room_id?: string;
  name?: string;
  description?: string | null;
  reward_description?: string | null;
  eligible?: boolean;
  claim_position?: number | null;
  claimed_at?: string | null;
  fulfilled_at?: string | null;
};

export function parseLiveNodeQrToken(value: string): string | null {
  const normalized = value.trim();
  const match = normalized.match(/^(?:partyup:\/\/|https?:\/\/[^/]+\/)?n\/([^/?#]+)/i);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); }
  catch { return null; }
}

export async function getLiveNodeScanState(supabase: SupabaseClient, token: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("get_live_node_scan_state", { p_token: token, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  return data as LiveNodeScanState;
}

export async function claimLiveNode(supabase: SupabaseClient, token: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("claim_live_node", { p_token: token, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  return data as LiveNodeScanState;
}

export async function consumeLiveNodeClaimHandoff(
  supabase: SupabaseClient,
  handoffToken: string,
  guestToken?: string | null,
) {
  const { data, error } = await supabase.rpc("consume_live_node_claim_handoff", {
    p_handoff_token: handoffToken,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as LiveNodeScanState;
}
