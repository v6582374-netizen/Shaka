import { useTranslation } from "../../i18n";

interface RefreshButtonProps {
  onClick: () => void;
  loading?: boolean;
  iconOnly?: boolean;
}

export function RefreshButton({ onClick, loading = false, iconOnly = false }: RefreshButtonProps) {
  const { t } = useTranslation();

  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={iconOnly ? t("common.refresh") : undefined}
      aria-label={iconOnly ? t("common.refresh") : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        padding: iconOnly ? "8px" : "8px 12px",
        fontSize: "13px",
        fontWeight: 400,
        color: "var(--muted-foreground)",
        background: "transparent",
        border: "none",
        borderRadius: "6px",
        cursor: loading ? "not-allowed" : "pointer",
        transition: "color 0.15s, background-color 0.15s",
        opacity: loading ? 0.6 : 1,
        width: iconOnly ? 32 : undefined,
        height: iconOnly ? 32 : undefined,
      }}
      onMouseEnter={(e) => {
        if (!loading) {
          e.currentTarget.style.color = "var(--foreground)";
          if (iconOnly) {
            e.currentTarget.style.backgroundColor = "var(--secondary)";
          }
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--muted-foreground)";
        if (iconOnly) {
          e.currentTarget.style.backgroundColor = "transparent";
        }
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        style={{
          animation: loading ? "spin 1s linear infinite" : "none",
        }}
      >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
      </svg>
      {!iconOnly && t("common.refresh")}
    </button>
  );
}
