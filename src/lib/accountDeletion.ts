import AsyncStorage from "@react-native-async-storage/async-storage";
import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase";

export type AccountDeletionResult =
  | { status: "completed" }
  | { status: "reauthentication_required"; message: string }
  | { status: "error"; message: string; requestId?: string };

export async function requestAccountDeletion(): Promise<AccountDeletionResult> {
  const { data, error } = await supabase.functions.invoke("delete-account", {
    body: { confirmed: true },
  });

  if (!error && data?.status === "completed") {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    await AsyncStorage.clear();
    return { status: "completed" };
  }

  if (error instanceof FunctionsHttpError) {
    const response = await error.context.json().catch(() => null);
    if (response?.code === "reauthentication_required") {
      return {
        status: "reauthentication_required",
        message: response.error || "Please sign in again before deleting your account.",
      };
    }

    return {
      status: "error",
      message: response?.error || "Account deletion could not be completed. Please try again.",
      requestId: response?.requestId,
    };
  }

  return {
    status: "error",
    message: error?.message || "Account deletion could not be completed. Please try again.",
  };
}
