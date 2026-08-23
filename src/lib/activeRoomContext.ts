import AsyncStorage from "@react-native-async-storage/async-storage";

const storageKey = "partyup_active_room_context_v1";

export type ActiveRoomContext = {
  roomId: string;
  enteredAt: string;
};

export async function readActiveRoomContext(): Promise<ActiveRoomContext | null> {
  try {
    const value = await AsyncStorage.getItem(storageKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<ActiveRoomContext>;
    if (!parsed.roomId || !parsed.enteredAt) {
      await AsyncStorage.removeItem(storageKey);
      return null;
    }
    return { roomId: parsed.roomId, enteredAt: parsed.enteredAt };
  } catch {
    return null;
  }
}

export async function writeActiveRoomContext(roomId: string) {
  if (!roomId) return;
  await AsyncStorage.setItem(storageKey, JSON.stringify({ roomId, enteredAt: new Date().toISOString() }));
}

export async function clearActiveRoomContext(roomId?: string) {
  if (roomId) {
    const current = await readActiveRoomContext();
    if (current?.roomId !== roomId) return;
  }
  await AsyncStorage.removeItem(storageKey);
}
