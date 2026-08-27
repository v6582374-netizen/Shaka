import { useEffect, useMemo, useRef } from "react";
import { Toggle } from "@/components/ui/toggle";
import { CustomCaretInput } from "@/components/ui/custom-caret-input";
import {
  MODAL_LAYER_Z_INDEX,
  MODAL_OVERLAY_COLOR,
} from "@/constants/modal";

export type RelationToggleItem = {
  id: string;
  label: string;
  enabled: boolean;
  disabled: boolean;
  tooltip?: string;
  dimmed?: boolean;
  tags?: string[];
};

export type TagBulkSummary = {
  tag: string;
  total: number;
  enabled: number;
};

export function RelationToggleDialog({
  title,
  description,
  query,
  enabledOnly,
  searchPlaceholder,
  enabledOnlyLabel,
  bulkToggleLabel,
  bulkToggleDisabled,
  bulkToggleTitle,
  items,
  emptyLabel,
  doneLabel,
  tagBulkToggleLabel,
  tagBulkToggleAllEnabledLabel,
  onQueryChange,
  onEnabledOnlyChange,
  onToggle,
  onBulkToggle,
  onTagBulkToggle,
  onClose,
}: {
  title: string;
  description: string;
  query: string;
  enabledOnly: boolean;
  searchPlaceholder: string;
  enabledOnlyLabel: string;
  bulkToggleLabel: string;
  bulkToggleDisabled: boolean;
  bulkToggleTitle?: string;
  items: RelationToggleItem[];
  emptyLabel: string;
  doneLabel: string;
  tagBulkToggleLabel: (tag: string, enabled: number, total: number) => string;
  tagBulkToggleAllEnabledLabel: (tag: string, enabled: number, total: number) => string;
  onQueryChange: (query: string) => void;
  onEnabledOnlyChange: (enabledOnly: boolean) => void;
  onToggle: (itemId: string, enabled: boolean) => void;
  onBulkToggle: () => void;
  onTagBulkToggle?: (tag: string) => void;
  onClose: () => void;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the search field on open — Raycast-style search-first UX.
  useEffect(() => {
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  // Esc closes the dialog; Cmd/Ctrl+Enter triggers bulk toggle.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!bulkToggleDisabled) {
          e.preventDefault();
          onBulkToggle();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bulkToggleDisabled, onBulkToggle, onClose]);

  const enabledCount = items.filter((i) => i.enabled).length;

  const tagSummaries = useMemo<TagBulkSummary[]>(() => {
    if (!onTagBulkToggle) return [];
    const map = new Map<string, TagBulkSummary>();
    for (const item of items) {
      if (!item.tags || item.tags.length === 0) continue;
      for (const tag of item.tags) {
        const entry = map.get(tag) ?? { tag, total: 0, enabled: 0 };
        entry.total += 1;
        if (item.enabled) entry.enabled += 1;
        map.set(tag, entry);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.tag.localeCompare(b.tag));
  }, [items, onTagBulkToggle]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: MODAL_OVERLAY_COLOR,
        zIndex: MODAL_LAYER_Z_INDEX,
        padding: "24px",
      }}
      onClick={onClose}
    >
      <div
        className="animate-modal"
        style={{
          width: "min(560px, calc(100vw - 48px))",
          maxHeight: "calc(100vh - 72px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "0 18px 60px rgba(0,0,0,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — compact title row with close affordance */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            padding: "16px 18px 12px",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3
              style={{
                margin: 0,
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--foreground)",
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </h3>
            <p
              style={{
                margin: "4px 0 0 0",
                fontSize: "12px",
                color: "var(--muted-foreground)",
                lineHeight: 1.45,
              }}
            >
              {description}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={doneLabel}
            style={{
              width: "26px",
              height: "26px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              backgroundColor: "var(--secondary)",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
              transition: "background-color 0.15s, color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--muted)";
              e.currentTarget.style.color = "var(--foreground)";
              e.currentTarget.style.borderColor = "var(--ring)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--secondary)";
              e.currentTarget.style.color = "var(--muted-foreground)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search — prominent, Raycast-style focal point */}
        <div style={{ padding: "0 18px" }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              height: "38px",
              padding: "0 12px",
              background: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              transition: "border-color 0.15s",
            }}
            onFocusCapture={(e) => {
              e.currentTarget.style.borderColor = "var(--ring)";
            }}
            onBlurCapture={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            <svg
              style={{
                color: "var(--muted-foreground)",
                flexShrink: 0,
                marginRight: "8px",
              }}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <CustomCaretInput
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: "13px",
                lineHeight: 1.4,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--foreground)",
              }}
            />
            {query.length > 0 && (
              <button
                type="button"
                aria-label="clear"
                onClick={() => onQueryChange("")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "18px",
                  height: "18px",
                  color: "var(--muted-foreground)",
                  background: "transparent",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  flexShrink: 0,
                  padding: 0,
                  marginLeft: "6px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground)")}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Toolbar — enabled-only filter + bulk action */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            padding: "12px 18px 8px",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              color: enabledOnly ? "var(--foreground)" : "var(--muted-foreground)",
              userSelect: "none",
              cursor: "pointer",
              transition: "color 0.15s",
            }}
            onClick={() => onEnabledOnlyChange(!enabledOnly)}
          >
            <Toggle
              checked={enabledOnly}
              onChange={(checked) => onEnabledOnlyChange(checked)}
            />
            {enabledOnlyLabel}
          </label>

          <button
            type="button"
            onClick={onBulkToggle}
            disabled={bulkToggleDisabled}
            title={bulkToggleTitle}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 10px",
              fontSize: "12px",
              fontWeight: 500,
              color: "var(--foreground)",
              backgroundColor: "var(--secondary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              cursor: bulkToggleDisabled ? "not-allowed" : "pointer",
              opacity: bulkToggleDisabled ? 0.5 : 1,
              transition: "background-color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              if (bulkToggleDisabled) return;
              e.currentTarget.style.backgroundColor = "var(--muted)";
              e.currentTarget.style.borderColor = "var(--ring)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--secondary)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
            </svg>
            {bulkToggleLabel}
          </button>
        </div>

        {/* Tag bulk-action bar — click a tag to enable/disable all its skills */}
        {tagSummaries.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              padding: "0 18px 10px",
            }}
          >
            {tagSummaries.map(({ tag, total, enabled: enabledCount }) => {
              const allEnabled = enabledCount === total;
              const title = allEnabled
                ? tagBulkToggleAllEnabledLabel(tag, enabledCount, total)
                : tagBulkToggleLabel(tag, enabledCount, total);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onTagBulkToggle?.(tag)}
                  title={title}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    fontSize: "11px",
                    fontWeight: 500,
                    color: allEnabled ? "var(--primary)" : "var(--muted-foreground)",
                    backgroundColor: allEnabled
                      ? "color-mix(in srgb, var(--primary) 10%, transparent)"
                      : "var(--secondary)",
                    border: allEnabled
                      ? "1px solid color-mix(in srgb, var(--primary) 25%, transparent)"
                      : "1px solid var(--border)",
                    borderRadius: "999px",
                    padding: "3px 8px",
                    lineHeight: 1.2,
                    cursor: "pointer",
                    transition: "background-color 0.15s, border-color 0.15s, color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = allEnabled
                      ? "color-mix(in srgb, var(--primary) 18%, transparent)"
                      : "var(--muted)";
                    e.currentTarget.style.borderColor = "var(--ring)";
                    e.currentTarget.style.color = "var(--foreground)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = allEnabled
                      ? "color-mix(in srgb, var(--primary) 10%, transparent)"
                      : "var(--secondary)";
                    e.currentTarget.style.borderColor = allEnabled
                      ? "color-mix(in srgb, var(--primary) 25%, transparent)"
                      : "var(--border)";
                    e.currentTarget.style.color = allEnabled ? "var(--primary)" : "var(--muted-foreground)";
                  }}
                >
                  <span>#{tag}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", opacity: 0.8 }}>
                    {enabledCount}/{total}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* List — single column, Raycast-style rows */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "4px 12px 8px",
          }}
        >
          {items.length === 0 ? (
            <div
              style={{
                padding: "40px 14px",
                textAlign: "center",
                fontSize: "12px",
                color: "var(--muted-foreground)",
              }}
            >
              {emptyLabel}
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  minHeight: "40px",
                  padding: "8px 12px",
                  marginBottom: "2px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid transparent",
                  backgroundColor: item.enabled
                    ? "var(--primary-tint)"
                    : "transparent",
                  opacity: item.dimmed ? 0.6 : 1,
                  cursor: item.disabled ? "default" : "pointer",
                  transition:
                    "background-color 0.12s ease, border-color 0.12s ease",
                }}
                title={item.tooltip}
                onMouseEnter={(e) => {
                  if (item.disabled) return;
                  if (!item.enabled) {
                    e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (item.disabled) return;
                  e.currentTarget.style.backgroundColor = item.enabled
                    ? "var(--primary-tint)"
                    : "transparent";
                }}
                onClick={() => {
                  if (item.disabled) return;
                  onToggle(item.id, !item.enabled);
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {/* Status dot — subtle ember accent for enabled items */}
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      flexShrink: 0,
                      backgroundColor: item.enabled
                        ? "var(--ember)"
                        : "var(--border)",
                      transition: "background-color 0.15s",
                    }}
                  />
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "var(--foreground)",
                      lineHeight: 1.35,
                      minWidth: 0,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      flexShrink: 1,
                    }}
                  >
                    {item.label}
                  </div>
                  {item.tags && item.tags.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        flexShrink: 0,
                      }}
                    >
                      {item.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontSize: "11px",
                            fontWeight: 500,
                            color: "var(--primary)",
                            backgroundColor:
                              "color-mix(in srgb, var(--primary) 10%, transparent)",
                            border:
                              "1px solid color-mix(in srgb, var(--primary) 25%, transparent)",
                            borderRadius: "999px",
                            padding: "2px 7px",
                            lineHeight: 1.2,
                            whiteSpace: "nowrap",
                          }}
                        >
                          #{tag}
                        </span>
                      ))}
                      {item.tags.length > 3 && (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 500,
                            color: "var(--muted-foreground)",
                            padding: "2px 0",
                            whiteSpace: "nowrap",
                          }}
                        >
                          +{item.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <Toggle
                    checked={item.enabled}
                    disabled={item.disabled}
                    onChange={(checked) => onToggle(item.id, checked)}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer — count + done action */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "10px 18px 14px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              color: "var(--muted-foreground)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.02em",
            }}
          >
            {enabledCount}/{items.length}
          </div>
          <button
            onClick={onClose}
            style={{
              fontSize: "12px",
              fontWeight: 500,
              color: "var(--primary-foreground)",
              backgroundColor: "var(--foreground)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              padding: "7px 16px",
              cursor: "pointer",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            {doneLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
