import type { User } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import { supabase } from "../../lib/supabase";

function cleanNamePart(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

export async function signInWithApple(): Promise<User> {
  if (Platform.OS !== "ios") {
    throw new Error("Sign in with Apple is available on iOS.");
  }

  const rawNonce = Crypto.randomUUID();
  const state = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  const credential = await AppleAuthentication.signInAsync({
    nonce: hashedNonce,
    state,
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  if (credential.state !== state) {
    throw new Error("Apple sign-in could not be verified. Please try again.");
  }
  if (!credential.identityToken) {
    throw new Error("Apple did not return a valid identity token.");
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    access_token: credential.authorizationCode ?? undefined,
    nonce: rawNonce,
  });

  if (error) throw error;
  if (!data.user) throw new Error("Apple sign-in did not create a PartyUp session.");

  const givenName = cleanNamePart(credential.fullName?.givenName);
  const middleName = cleanNamePart(credential.fullName?.middleName);
  const familyName = cleanNamePart(credential.fullName?.familyName);
  const fullName = [givenName, middleName, familyName].filter(Boolean).join(" ");
  const existingFullName = cleanNamePart(data.user.user_metadata?.full_name);

  if (fullName && !existingFullName) {
    const { data: updated, error: updateError } = await supabase.auth.updateUser({
      data: {
        full_name: fullName,
        given_name: givenName,
        family_name: familyName,
      },
    });

    if (updateError) throw updateError;
    return updated.user ?? data.user;
  }

  return data.user;
}
