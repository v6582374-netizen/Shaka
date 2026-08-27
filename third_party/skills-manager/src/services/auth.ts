import { invoke } from "@tauri-apps/api/core";
import type { AuthMeResponse, AuthStartResult } from "@/types";

const PENDING_PROVIDER_KEY = "skills-manager:auth:pending-provider";

export type AuthProvider = "github" | "google";

export function setPendingAuthProvider(provider: AuthProvider) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(PENDING_PROVIDER_KEY, provider);
}

export function takePendingAuthProvider(): AuthProvider | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(PENDING_PROVIDER_KEY);
  localStorage.removeItem(PENDING_PROVIDER_KEY);
  if (raw === "github" || raw === "google") {
    return raw;
  }
  return null;
}

export function clearPendingAuthProvider() {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.removeItem(PENDING_PROVIDER_KEY);
}

export async function startGithubAuth(locale?: string): Promise<AuthStartResult> {
  return invoke<AuthStartResult>("start_github_auth", {
    debug: false,  // Always use normal redirect flow
    locale,
  });
}

export async function startGoogleAuth(locale?: string): Promise<AuthStartResult> {
  return invoke<AuthStartResult>("start_google_auth", {
    debug: false,  // Always use normal redirect flow
    locale,
  });
}

export async function exchangeGithubAuth(
  loginCode: string,
  state: string,
): Promise<AuthMeResponse> {
  return invoke<AuthMeResponse>("exchange_github_auth", {
    loginCode,
    state,
  });
}

export async function exchangeGoogleAuth(
  loginCode: string,
  state: string,
): Promise<AuthMeResponse> {
  return invoke<AuthMeResponse>("exchange_google_auth", {
    loginCode,
    state,
  });
}

export async function getAuthProfile(): Promise<AuthMeResponse | null> {
  return invoke<AuthMeResponse | null>("get_auth_profile");
}

export async function logoutAuth(): Promise<void> {
  await invoke("logout_auth");
}

// URL normalization for deep link handling
export function normalizeAuthUrl(url: string): string {
  return url
    .replace(/^skillsmanager:\/\//, "skills-manager://")
    .replace(/^skills-manager:\/([^/])/, "skills-manager://$1");
}

export function isExpectedAuthUrl(url: string): boolean {
  const normalized = normalizeAuthUrl(url);
  return normalized.startsWith("skills-manager://auth/callback");
}
