import type { User } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase";

let completionInFlight: Promise<User> | null = null;

function readCallbackParams(callbackUrl: string) {
  const params = new URLSearchParams();
  const query = callbackUrl.split("?")[1]?.split("#")[0];
  const fragment = callbackUrl.split("#")[1];

  for (const source of [query, fragment]) {
    if (!source) continue;

    new URLSearchParams(source).forEach((value, key) => {
      params.set(key, value);
    });
  }

  return params;
}

async function establishOAuthSession(callbackUrl: string): Promise<User> {
  const { data: existingSession, error: existingSessionError } =
    await supabase.auth.getSession();

  if (existingSessionError) throw existingSessionError;
  if (existingSession.session?.user) return existingSession.session.user;

  const params = readCallbackParams(callbackUrl);
  const providerError = params.get("error_description") ?? params.get("error");

  if (providerError) {
    throw new Error(providerError);
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const authCode = params.get("code");

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) throw error;

    const user = data.session?.user ?? data.user;
    if (user) return user;
  } else if (authCode) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);

    if (error) throw error;
    if (data.user) return data.user;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;
  if (data.session?.user) return data.session.user;

  throw new Error("Could not confirm your signed-in session.");
}

export function completeOAuthSession(callbackUrl: string): Promise<User> {
  if (completionInFlight) return completionInFlight;

  completionInFlight = establishOAuthSession(callbackUrl).finally(() => {
    completionInFlight = null;
  });

  return completionInFlight;
}
