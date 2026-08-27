import { type CSSProperties, type MouseEvent, useState } from "react";

interface FavoriteIconButtonProps {
  favorited: boolean;
  onClick: (event: MouseEvent) => void;
  favoriteLabel: string;
  unfavoriteLabel: string;
  size?: number;
  disabled?: boolean;
}

/**
 * 收藏星标按钮。
 * - 未收藏：描边星标，muted 颜色
 * - 已收藏：实心星标，主题色 var(--primary)
 * - 点击瞬间 scale 弹性回弹反馈
 *
 * 样式与 TranslateIconButton 保持一致：背景 hover、圆角、尺寸。
 */
export function FavoriteIconButton({
  favorited,
  onClick,
  favoriteLabel,
  unfavoriteLabel,
  size = 22,
  disabled = false,
}: FavoriteIconButtonProps) {
  const [popping, setPopping] = useState(false);

  const tooltip = favorited ? unfavoriteLabel : favoriteLabel;
  const color = favorited ? "var(--primary)" : "var(--muted-foreground)";
  const background = favorited
    ? "color-mix(in srgb, var(--primary) 14%, transparent)"
    : "transparent";

  const buttonStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    padding: 0,
    border: "none",
    borderRadius: 8,
    background,
    color,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "background-color 0.15s ease, color 0.15s ease, transform 0.15s ease",
    flexShrink: 0,
    transform: popping ? "scale(1.3)" : "scale(1)",
  };

  return (
    <button
      type="button"
      aria-label={tooltip}
      title={tooltip}
      aria-pressed={favorited}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        setPopping(true);
        window.setTimeout(() => setPopping(false), 150);
        onClick(e);
      }}
      style={buttonStyle}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (!favorited) {
          e.currentTarget.style.backgroundColor = "rgba(15, 23, 42, 0.06)";
          e.currentTarget.style.color = "var(--foreground)";
        }
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.backgroundColor = background;
        e.currentTarget.style.color = color;
      }}
    >
      <svg
        width={Math.floor(size * 0.6)}
        height={Math.floor(size * 0.6)}
        viewBox="0 0 24 24"
        fill={favorited ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}
