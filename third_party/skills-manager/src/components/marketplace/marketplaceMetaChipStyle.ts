export interface MarketplaceMetaChipStyle {
  display: "inline-flex";
  alignItems: "center";
  gap: string;
  fontSize: string;
  fontWeight: number;
  lineHeight: string;
  color: string;
  backgroundColor: string;
  padding: string;
  borderRadius: string;
  border: string;
  whiteSpace: "nowrap";
  minHeight: string;
  boxSizing: "border-box";
}

export function getMarketplaceMetaChipStyle(
  size: "compact" | "default" = "compact",
): MarketplaceMetaChipStyle {
  const compact = size === "compact";

  return {
    display: "inline-flex",
    alignItems: "center",
    gap: compact ? "4px" : "5px",
    fontSize: compact ? "10px" : "11px",
    fontWeight: 500,
    lineHeight: "1",
    color: "var(--muted-foreground)",
    backgroundColor: "var(--background)",
    padding: compact ? "2px 6px" : "5px 10px",
    borderRadius: compact ? "5px" : "999px",
    border: "1px solid var(--border)",
    whiteSpace: "nowrap",
    minHeight: compact ? "24px" : "28px",
    boxSizing: "border-box",
  };
}
