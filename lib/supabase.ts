import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  "https://sgfbbytnmodbjxqesgxq.supabase.co";

const supabaseAnonKey =
  "sb_publishable_TIXZFf-4NrttUYx2_XQcKg_4MW97cne";

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);