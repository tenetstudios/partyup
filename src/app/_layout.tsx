import { Stack } from "expo-router";
import RoomClearNotice from "../components/RoomClearNotice";

export default function Layout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <RoomClearNotice />
    </>
  );
}
