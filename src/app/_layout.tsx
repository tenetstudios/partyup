import { Stack } from "expo-router";
import RoomClearNotice from "../components/RoomClearNotice";
import PushNotificationsProvider from "../components/PushNotificationsProvider";

export default function Layout() {
  return (
    <PushNotificationsProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <RoomClearNotice />
    </PushNotificationsProvider>
  );
}
