import * as Linking from "expo-linking";
import { Platform } from "react-native";
import { apiBaseUrl } from "../api/config";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export async function fetchCurrentUser() {
  const response = await fetch(`${apiBaseUrl()}/api/me`, {
    credentials: "include"
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Session check failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { user: CurrentUser };

  return payload.user;
}

export async function startGoogleSignIn() {
  const mode = Platform.OS === "web" ? "web" : "mobile";
  const returnTo =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.origin
      : Linking.createURL("auth/callback");
  const startUrl = `${apiBaseUrl()}/api/auth/google/start?${new URLSearchParams({
    mode,
    returnTo
  }).toString()}`;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.assign(startUrl);
    return;
  }

  await Linking.openURL(startUrl);
}

export async function logout() {
  await fetch(`${apiBaseUrl()}/api/auth/logout`, {
    credentials: "include",
    method: "POST"
  });
}
