import type { SupabaseClient } from "@supabase/supabase-js";

export const chatReportReasons = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate or discrimination" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "threats", label: "Threats or violence" },
  { value: "spam_scam", label: "Spam or scam" },
  { value: "personal_information", label: "Sharing personal information" },
  { value: "other", label: "Something else" },
] as const;

export type ChatReportReason = (typeof chatReportReasons)[number]["value"];

export async function submitRoomMessageReport(
  supabase: SupabaseClient,
  messageId: string,
  reason: ChatReportReason,
  details: string,
) {
  const { data, error } = await supabase.rpc("submit_room_message_report", {
    p_message_id: messageId,
    p_reason: reason,
    p_details: details.trim() || null,
  });

  if (error) throw new Error(error.message);
  return data as { id: string; status: "open"; message_id: string };
}

export async function getMyRoomMessageReportIds(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase.rpc("get_my_room_message_report_ids", {
    p_room_id: roomId,
  });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { message_id: string }) => row.message_id);
}
