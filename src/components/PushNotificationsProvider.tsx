import * as Notifications from "expo-notifications";
import { usePathname } from "expo-router";
import { PropsWithChildren, useEffect, useRef } from "react";
import { openNotification } from "../lib/notificationRouting";
import { enablePushNotifications, getPushPermissionStatus } from "../../lib/pushNotifications";
import { supabase } from "../../lib/supabase";

let currentPathname = "/";

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

export default function PushNotificationsProvider({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const handledInitial = useRef(false);
  const lastTokenSync = useRef(0);

  useEffect(() => { currentPathname = pathname; }, [pathname]);

  useEffect(() => {
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
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void openNotification(response.notification.request.content.data ?? {});
    });
    if (!handledInitial.current) {
      handledInitial.current = true;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) void openNotification(response.notification.request.content.data ?? {});
      });
    }
    return () => subscription.remove();
  }, []);

  return children;
}
