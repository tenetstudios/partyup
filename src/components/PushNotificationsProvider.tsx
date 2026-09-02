import { usePathname } from "expo-router";
import { PropsWithChildren, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { openNotification } from "../lib/notificationRouting";
import { enablePushNotifications, getPushPermissionStatus } from "../../lib/pushNotifications";
import { supabase } from "../../lib/supabase";

let currentPathname = "/";
let notificationHandlerConfigured = false;

async function getNativeNotifications() {
  if (Platform.OS === "web") return null;
  return import("expo-notifications");
}

async function configureNotificationHandler() {
  if (notificationHandlerConfigured) return;
  const Notifications = await getNativeNotifications();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data ?? {};
      const roomId = typeof data.roomId === "string" ? data.roomId : null;
      const alreadyViewingRoom = Boolean(roomId && currentPathname.startsWith(`/room/${roomId}`));
      return {
        shouldShowBanner: !alreadyViewingRoom,
        shouldShowList: !alreadyViewingRoom,
        shouldPlaySound: !alreadyViewingRoom,
        shouldSetBadge: false,
      };
    },
  });
  notificationHandlerConfigured = true;
}

export default function PushNotificationsProvider({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const handledInitial = useRef(false);
  const lastTokenSync = useRef(0);

  useEffect(() => { currentPathname = pathname; }, [pathname]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    // Refresh the token without prompting when the user has already opted in.
    // Retrying on navigation also catches a guest identity created after boot.
    if (Date.now() - lastTokenSync.current < 5 * 60_000) return;
    lastTokenSync.current = Date.now();
    void getPushPermissionStatus().then((status) => {
      if (status === "granted") {
        void enablePushNotifications().catch(() => { lastTokenSync.current = 0; });
      }
    });
  }, [pathname]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN") return;
      lastTokenSync.current = Date.now();
      void getPushPermissionStatus().then((status) => {
        if (status === "granted") void enablePushNotifications().catch(() => undefined);
      });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;

    let active = true;
    let subscription: { remove(): void } | null = null;

    void configureNotificationHandler()
      .then(getNativeNotifications)
      .then((Notifications) => {
        if (!active || !Notifications) return;

        subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          void openNotification(response.notification.request.content.data ?? {});
        });
        if (!handledInitial.current) {
          handledInitial.current = true;
          void Notifications.getLastNotificationResponseAsync().then((response) => {
            if (active && response) void openNotification(response.notification.request.content.data ?? {});
          });
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  return children;
}
