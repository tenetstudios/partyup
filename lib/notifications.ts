import { supabase } from "./supabase";

export type NotificationType =
  | "follow"
  | "room_invite"
  | "room_join"
  | "host_live"
  | "friend_live"
  | "friend_created_room"
  | "room_approved"
  | "event_recap"
  | "recap_ready"
  | "mission_started"
  | "announcement"
  | "wild_result"
  | "verification_approved";

export interface Notification {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: NotificationType;
  title: string;
  body: string;
  room_id: string | null;
  recap_room_id: string | null;
  data?: Record<string, unknown> | null;
  is_read: boolean;
  dismissed_at?: string | null;
  created_at: string;
}

export interface CreateNotificationInput {
  userId: string;
  actorId: string;
  type: NotificationType;
  title: string;
  body: string;
  roomId?: string | null;
}

export async function createNotification(
  input: CreateNotificationInput
): Promise<void> {
  const { error } = await supabase.from("notifications").insert({
    user_id: input.userId,
    actor_id: input.actorId,
    type: input.type,
    title: input.title,
    body: input.body,
    room_id: input.roomId || null,
    is_read: false,
  });

  if (error) {
    console.error("Failed to create notification:", error.message);
  }
}

export async function markNotificationAsRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId);

  if (error) {
    console.error("Failed to mark notification as read:", error.message);
  }
}

export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) {
    console.error("Failed to mark all notifications as read:", error.message);
  }
}

export async function dismissNotification(notificationId: string): Promise<void> {
  const { data, error } = await supabase.rpc("dismiss_my_notification", {
    p_notification_id: notificationId,
  });

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Notification not found.");
}
