import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";

interface TranslateIconButtonProps {
  hasTranslation: boolean;
  showingTranslation: boolean;
  translating: boolean;
  onClick: (event: MouseEvent) => void;
  translateLabel: string;
  showOriginalLabel: string;
  showTranslationLabel: string;
  translatingLabel: string;
  retranslateLabel?: string;
  onRetranslate?: () => void;
  size?: number;
}

export function TranslateIconButton({
  hasTranslation,
  showingTranslation,
  translating,
  onClick,
  translateLabel,
  showOriginalLabel,
  showTranslationLabel,
  translatingLabel,
  retranslateLabel,
  onRetranslate,
  size = 28,
}: TranslateIconButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: globalThis.MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("contextmenu", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("contextmenu", close);
    };
  }, [menuOpen]);

  const tooltip = translating
    ? translatingLabel
    : hasTranslation
      ? showingTranslation
        ? showOriginalLabel
        : showTranslationLabel
      : translateLabel;

  const color = showingTranslation || hasTranslation
    ? "var(--primary)"
    : "var(--muted-foreground)";

  const opacity = translating ? 0.5 : 1;

  const buttonStyle: CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    padding: 0,
    border: "none",
    borderRadius: 8,
    background: showingTranslation ? "color-mix(in srgb, var(--primary) 14%, transparent)" : "transparent",
    color,
    cursor: translating ? "wait" : "pointer",
    opacity,
    transition: "background-color 0.15s ease, color 0.15s ease",
    flexShrink: 0,
  };

  const canShowMenu = hasTranslation && !!onRetranslate && !translating;

  return (
    <div ref={containerRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={tooltip}
        title={canShowMenu ? `${tooltip} · ${retranslateLabel ?? ""}` : tooltip}
        onClick={(e) => {
          e.stopPropagation();
          if (translating) return;
          setMenuOpen(false);
          onClick(e);
        }}
        onContextMenu={(e) => {
          if (!canShowMenu) return;
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        disabled={translating}
        style={buttonStyle}
        onMouseEnter={(e) => {
          if (translating) return;
          if (!showingTranslation) {
            e.currentTarget.style.backgroundColor = "rgba(15, 23, 42, 0.06)";
          }
        }}
        onMouseLeave={(e) => {
          if (translating) return;
          e.currentTarget.style.backgroundColor = showingTranslation
            ? "color-mix(in srgb, var(--primary) 14%, transparent)"
            : "transparent";
        }}
      >
        {translating ? (
          <svg width={Math.floor(size * 0.5)} height={Math.floor(size * 0.5)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 0.8s linear infinite" }}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg width={Math.floor(size * 0.5)} height={Math.floor(size * 0.5)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 8 6 6" />
            <path d="m4 14 6-6 2-3" />
            <path d="M2 5h12" />
            <path d="M7 2h1" />
            <path d="m22 22-5-10-5 10" />
            <path d="M14 18h6" />
          </svg>
        )}
        {hasTranslation && !showingTranslation && !translating && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 5,
              right: 5,
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: "var(--primary)",
              border: "1px solid var(--background)",
            }}
          />
        )}
      </button>

      {menuOpen && canShowMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 120,
            padding: 4,
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              onClick(e);
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 8%, transparent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {showingTranslation ? showOriginalLabel : showTranslationLabel}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              onRetranslate?.();
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 8%, transparent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {retranslateLabel}
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--popover-foreground)",
  background: "transparent",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
  whiteSpace: "nowrap",
};
