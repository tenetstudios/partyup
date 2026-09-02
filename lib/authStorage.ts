import type { SupportedStorage } from "@supabase/supabase-js";
import { Platform } from "react-native";

type AuthStorageEnvironment = "native" | "browser" | "server";

let nativeStoragePromise: Promise<
  typeof import("@react-native-async-storage/async-storage").default
> | null = null;

function getNativeStorage() {
  nativeStoragePromise ??= import("@react-native-async-storage/async-storage").then(
    (module) => module.default,
  );
  return nativeStoragePromise;
}

const nativeStorage: SupportedStorage = {
  async getItem(key) {
    return (await getNativeStorage()).getItem(key);
  },
  async setItem(key, value) {
    await (await getNativeStorage()).setItem(key, value);
  },
  async removeItem(key) {
    await (await getNativeStorage()).removeItem(key);
  },
};

const browserStorage: SupportedStorage = {
  getItem(key) {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage may be unavailable in restricted/private browser contexts.
    }
  },
  removeItem(key) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Removing a missing or unavailable browser value is already a no-op.
    }
  },
};

const serverStorage: SupportedStorage = {
  isServer: true,
  getItem() {
    return null;
  },
  setItem() {},
  removeItem() {},
};

export const authStorageEnvironment: AuthStorageEnvironment =
  Platform.OS !== "web"
    ? "native"
    : typeof window === "undefined"
      ? "server"
      : "browser";

export const supabaseAuthStorage: SupportedStorage =
  authStorageEnvironment === "native"
    ? nativeStorage
    : authStorageEnvironment === "browser"
      ? browserStorage
      : serverStorage;
