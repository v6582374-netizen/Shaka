import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useTranslation } from "@/i18n";
import {
  startGithubAuth,
  exchangeGithubAuth,
  startGoogleAuth,
  exchangeGoogleAuth,
  clearPendingAuthProvider,
  setPendingAuthProvider,
  takePendingAuthProvider,
  logoutAuth,
  type AuthProvider,
} from "@/services/auth";
import { buildAuthErrorMessage } from "@/services/authError";
import type { AppConfig, AuthProfile } from "@/types";

interface AuthContextValue {
  config: AppConfig | null;
  authProfile: AuthProfile | null;
  authProvider: "github" | "google" | null;
  isLoading: boolean;
  error: string | null;
  startAuth: (provider: AuthProvider) => Promise<void>;
  logout: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { t, language } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<AuthProvider | null>(null);
  const handledAuthUrlsRef = useRef<Set<string>>(new Set());

  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await invoke<AppConfig>("get_config");
      setConfig(cfg);
    } catch (err) {
      console.error("Failed to fetch config:", err);
    }
  }, []);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  const normalizeAuthUrl = useCallback((value: string) => value.trim(), []);

  const isExpectedAuthUrl = useCallback((value: string) => {
    return value.startsWith("skills-manager://") || value.startsWith("skillsmanager://");
  }, []);

  const extractDeepLinkUrlsFromArgv = useCallback((argv: string[]) => {
    const urls: string[] = [];
    for (const raw of argv) {
      if (!raw) continue;
      const arg = raw.trim();
      for (const scheme of ["skills-manager://", "skillsmanager://"]) {
        const idx = arg.indexOf(scheme);
        if (idx >= 0) {
          const candidate = arg.slice(idx).replace(/^["']|["']$/g, "");
          if (candidate) urls.push(candidate);
        }
      }
    }
    return urls;
  }, []);

  const handleAuthCallback = useCallback(async (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }

    const protocol = parsed.protocol.replace(":", "");
    const isCustomScheme = ["skills-manager", "skillsmanager"].includes(protocol);

    if (isCustomScheme) {
      if (parsed.host !== "auth" || parsed.pathname !== "/callback") return;
    } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return;
    }

    const loginCode = parsed.searchParams.get("login_code");
    const state = parsed.searchParams.get("state");
    if (!loginCode || !state) return;

    setIsLoading(true);
    setError(null);

    const resolvedProvider = pendingProvider ?? takePendingAuthProvider();

    try {
      const exchangeAuth = resolvedProvider === "google" ? exchangeGoogleAuth : exchangeGithubAuth;
      await exchangeAuth(loginCode, state);
      await refreshConfig();
      setPendingProvider(null);
      clearPendingAuthProvider();
      // Success - no error
    } catch (err) {
      console.warn("Failed to exchange auth code:", err);
      setError(
        buildAuthErrorMessage(t, err, {
          provider: resolvedProvider ?? "github",
          stage: "exchange",
        })
      );
    } finally {
      setIsLoading(false);
    }
  }, [pendingProvider, t, refreshConfig]);

  const handleAuthUrl = useCallback((url: string) => {
    const normalized = normalizeAuthUrl(url);
    if (!normalized) return;
    if (!isExpectedAuthUrl(normalized)) return;
    if (handledAuthUrlsRef.current.has(normalized)) return;

    handledAuthUrlsRef.current.add(normalized);
    void handleAuthCallback(normalized);
  }, [handleAuthCallback, isExpectedAuthUrl, normalizeAuthUrl]);

  // Listen to deep links
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    getCurrent()
      .then((urls) => {
        if (urls) {
          urls.forEach((url) => handleAuthUrl(url));
        }
      })
      .catch(() => {
        // ignore
      });

    onOpenUrl((urls: string[]) => {
      urls.forEach((url: string) => handleAuthUrl(url));
    })
      .then((stop: () => void) => {
        unlisten = stop;
      })
      .catch(() => {
        // ignore
      });

    return () => {
      unlisten?.();
    };
  }, [handleAuthUrl]);

  // Listen to argv deep links
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<string[]>("auth:deep-link-argv", (event) => {
      const argv = event.payload;
      const urls = extractDeepLinkUrlsFromArgv(argv);
      if (urls.length === 0) return;
      urls.forEach((url) => handleAuthUrl(url));
    })
      .then((stop) => {
        unlisten = stop;
      })
      .catch(() => {
        // ignore
      });

    return () => {
      unlisten?.();
    };
  }, [extractDeepLinkUrlsFromArgv, handleAuthUrl]);

  const startAuth = useCallback(async (provider: AuthProvider) => {
    setIsLoading(true);
    setError(null);
    setPendingProvider(provider);
    setPendingAuthProvider(provider);

    try {
      const startAuthFn = provider === "google" ? startGoogleAuth : startGithubAuth;
      const result = await startAuthFn(language);
      console.info("OAuth auth_url:", result.auth_url);
      await openUrl(result.auth_url);
    } catch (err) {
      console.warn(`Failed to start ${provider} auth:`, err);
      setError(
        buildAuthErrorMessage(t, err, {
          provider,
          stage: "start",
        })
      );
      setPendingProvider(null);
      clearPendingAuthProvider();
      setIsLoading(false);
    }
    // Note: don't setIsLoading(false) here - wait for callback
  }, [language, t]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await logoutAuth();
      await refreshConfig();
    } catch (err) {
      console.warn("Failed to logout:", err);
      setError(t("auth.logoutFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t, refreshConfig]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const authProfile = config?.auth_session?.profile || null;
  const authProvider = config?.auth_session?.provider as "github" | "google" | null || null;

  const value: AuthContextValue = {
    config,
    authProfile,
    authProvider,
    isLoading,
    error,
    startAuth,
    logout,
    refreshConfig,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
