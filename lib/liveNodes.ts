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
