import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { MODAL_LAYER_Z_INDEX } from "@/constants/modal";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function AuthModal({ isOpen, onClose, anchorRef }: AuthModalProps) {
  const { t } = useTranslation();
  const { authProfile, authProvider, isLoading, error, startAuth, logout, clearError } = useAuth();
  const wasLoggedInRef = useRef(!!authProfile);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  // Track login state change to auto-close only on successful login (not on open)
  useEffect(() => {
    if (isOpen) {
      // When modal opens, record current login state
      wasLoggedInRef.current = !!authProfile;
    }
  }, [isOpen, authProfile]);

  // Auto-close only when transitioning from logged-out to logged-in
  useEffect(() => {
    if (isOpen && authProfile && !wasLoggedInRef.current && !error && !isLoading) {
      // User just logged in successfully
      const timer = setTimeout(() => {
        onClose();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isOpen, authProfile, error, isLoading, onClose]);

  // Clear error when modal closes
  useEffect(() => {
    if (!isOpen) {
      clearError();
    }
  }, [isOpen, clearError]);

  // Position the panel relative to the trigger button
  useEffect(() => {
    if (!isOpen) return;

    function updatePosition() {
      const anchor = anchorRef?.current;
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        setPanelStyle({
          position: "fixed",
          top: rect.bottom + 8,
          right: window.innerWidth - rect.right,
          width: "min(340px, calc(100vw - 32px))",
          maxHeight: `calc(100vh - ${rect.bottom + 8}px - 16px)`,
        });
      } else {
        setPanelStyle({
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(420px, calc(100vw - 48px))",
          maxHeight: "calc(100vh - 48px)",
        });
      }
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [isOpen, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const displayName = authProfile?.username || t("auth.login");
  const providerLabel = authProvider === "github"
    ? "GitHub"
    : authProvider === "google"
      ? "Google"
      : "-";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: MODAL_LAYER_Z_INDEX,
        backgroundColor: "transparent",
      }}
      onClick={onClose}
    >
      <div
        style={{
          ...panelStyle,
          backgroundColor: "var(--glass-bg-elevated)",
          backdropFilter: "var(--glass-backdrop)",
          WebkitBackdropFilter: "var(--glass-backdrop)",
          border: "1px solid var(--glass-border)",
          boxShadow: "var(--glass-shadow)",
          borderRadius: "var(--radius-xl)",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          overflow: "auto",
          transformOrigin: "top right",
          animation: "scaleIn 180ms cubic-bezier(0.23, 1, 0.32, 1) both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: "0 0 4px 0", fontSize: "16px", fontWeight: 600, color: "var(--foreground)" }}>
              {authProfile ? t("auth.accountTitle") : t("auth.loginTitle")}
            </h3>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              {authProfile ? t("auth.accountDesc") : t("auth.loginDesc")}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "6px",
              border: "1px solid var(--glass-border)",
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
              transition: "background-color 0.15s",
              opacity: isLoading ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.backgroundColor = "var(--secondary)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {authProfile ? (
          /* Logged In View */
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Avatar & Username */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", borderRadius: "12px", backgroundColor: "var(--secondary)" }}>
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "50%",
                  backgroundColor: "var(--muted)",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  border: "2px solid var(--background)",
                }}
              >
                {authProfile.avatar_url ? (
                  <img
                    src={authProfile.avatar_url}
                    alt={displayName}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--foreground)", marginBottom: "2px" }}>
                  {displayName}
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>{t("auth.provider")}:</span>
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    backgroundColor: "var(--background)",
                    fontWeight: 500,
                  }}>
                    {providerLabel}
                  </span>
                </div>
              </div>
            </div>

            {/* Logout Button */}
            <button
              type="button"
              onClick={logout}
              disabled={isLoading}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "10px 14px",
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--foreground)",
                backgroundColor: "var(--secondary)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                cursor: isLoading ? "wait" : "pointer",
                opacity: isLoading ? 0.7 : 1,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.backgroundColor = "var(--muted)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "var(--secondary)";
              }}
            >
              {isLoading ? (
                <>
                  <Spinner />
                  {t("auth.loggingOut")}
                </>
              ) : (
                t("auth.logout")
              )}
            </button>

            {error && <ErrorAlert message={error} />}
          </div>
        ) : (
          /* Login View */
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* GitHub Login */}
            <button
              type="button"
              onClick={() => startAuth("github")}
              disabled={isLoading}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                padding: "10px 14px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#fff",
                backgroundColor: "#24292f",
                border: "1px solid #24292f",
                borderRadius: "8px",
                cursor: isLoading ? "wait" : "pointer",
                opacity: isLoading ? 0.7 : 1,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.backgroundColor = "#1b1f24";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#24292f";
              }}
            >
              <GithubIcon />
              {isLoading ? t("auth.loggingIn") : t("auth.githubLogin")}
            </button>

            {/* Google Login */}
            <button
              type="button"
              onClick={() => startAuth("google")}
              disabled={isLoading}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                padding: "10px 14px",
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--foreground)",
                backgroundColor: "var(--background)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                cursor: isLoading ? "wait" : "pointer",
                opacity: isLoading ? 0.7 : 1,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.backgroundColor = "var(--secondary)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "var(--background)";
              }}
            >
              <GoogleIcon />
              {isLoading ? t("auth.loggingIn") : t("auth.googleLogin")}
            </button>

            {/* Loading State Hint */}
            {isLoading && (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 12px",
                borderRadius: "8px",
                backgroundColor: "var(--secondary)",
                fontSize: "12px",
                color: "var(--muted-foreground)",
              }}>
                <Spinner size={14} />
                <span>{t("auth.waitingForBrowser")}</span>
              </div>
            )}

            {error && <ErrorAlert message={error} />}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper Components
function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ animation: "spin 1s linear infinite" }}
    >
      <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" opacity="0.3" />
      <path d="M12 2v4" strokeLinecap="round" />
    </svg>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "10px 12px",
        borderRadius: "8px",
        backgroundColor: "var(--color-error-bg)",
        border: "1px solid var(--color-error-border)",
        fontSize: "12px",
        color: "var(--color-error)",
        lineHeight: 1.5,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: "1px" }}>
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4m0 4h.01"/>
      </svg>
      <span>{message}</span>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
