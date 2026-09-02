import "react-native-url-polyfill/auto";

import { createClient } from "@supabase/supabase-js";
import { supabaseAuthStorage } from "./authStorage";

const supabaseUrl =
  "https://sgfbbytnmodbjxqesgxq.supabase.co";

const supabaseAnonKey =
  "sb_publishable_TIXZFf-4NrttUYx2_XQcKg_4MW97cne";

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storage: supabaseAuthStorage,
      autoRefreshToken: true,
      persistSession: true,
      // PartyUp completes OAuth explicitly in src/lib/oauthSession on every platform.
      detectSessionInUrl: false,
    },
  }
);
