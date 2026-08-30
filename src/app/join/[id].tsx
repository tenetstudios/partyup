import { Redirect, useLocalSearchParams } from "expo-router";

export default function JoinRoomRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const roomId = Array.isArray(id) ? id[0] : id;

  if (!roomId) return <Redirect href="/" />;

  return <Redirect href={{ pathname: "/room/[id]", params: { id: roomId } }} />;
}
