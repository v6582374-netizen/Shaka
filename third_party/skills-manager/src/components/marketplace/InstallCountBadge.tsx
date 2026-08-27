import { ArrowDownToLine } from "lucide-react";
import { getMarketplaceMetaChipStyle } from "./marketplaceMetaChipStyle";

interface InstallCountBadgeProps {
  label: string;
  size?: "compact" | "default";
}

export function InstallCountBadge({
  label,
  size = "compact",
}: InstallCountBadgeProps) {
  const compact = size === "compact";
  const baseStyle = getMarketplaceMetaChipStyle(size);

  return (
    <span
      style={{
        ...baseStyle,
      }}
    >
      <ArrowDownToLine
        size={compact ? 11 : 12}
        style={{ color: "var(--muted-foreground)", flexShrink: 0 }}
      />
      <span>{label}</span>
    </span>
  );
}
