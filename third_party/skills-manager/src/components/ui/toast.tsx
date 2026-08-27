import { useState, useEffect, useCallback } from "react";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: "error" | "success" | "info";
  persistent?: boolean; // 持久化 toast，不自动关闭
  action?: ToastAction; // 可选的操作按钮（如"去查看"）
}

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);

  const dismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 300);
  }, [onRemove, toast.id]);

  useEffect(() => {
    // 持久化 toast 或带操作按钮的 toast 不自动关闭，确保用户能看到操作入口
    if (toast.persistent || toast.action) return;

    const timer = setTimeout(() => {
      dismiss();
    }, 3000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.persistent, toast.action, dismiss]);

  const tokenKey = toast.type; // "error" | "success" | "info"
  const bgColor = `var(--color-${tokenKey}-bg)`;
  const borderColor = `var(--color-${tokenKey}-border)`;
  const textColor = `var(--color-${tokenKey})`;

  return (
    <div
      style={{
        padding: "12px 16px",
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: "10px",
        color: textColor,
        fontSize: "14px",
        boxShadow: "var(--shadow-lg)",
        opacity: isExiting ? 0 : 1,
        transform: isExiting ? "translateX(100%)" : "translateX(0)",
        transition: "opacity 0.3s, transform 0.3s",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      {toast.type === "error" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="m15 9-6 6M9 9l6 6"/>
        </svg>
      )}
      {toast.type === "success" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
      )}
      <span style={{ flex: 1 }}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            dismiss();
          }}
          style={{
            background: "transparent",
            border: `1px solid ${textColor}`,
            borderRadius: "6px",
            cursor: "pointer",
            padding: "3px 10px",
            color: textColor,
            fontSize: "12px",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={dismiss}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "2px",
          color: textColor,
          opacity: 0.6,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "20px",
        right: "20px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxWidth: "400px",
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((
    message: string,
    type: Toast["type"] = "error",
    persistent: boolean = false,
    action?: ToastAction,
  ) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type, persistent, action }]);
    return id; // 返回 id 以便后续更新
  }, []);

  const updateToast = useCallback((
    id: string,
    message: string,
    type?: Toast["type"],
    persistent?: boolean,
    action?: ToastAction | null,
  ) => {
    setToasts((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              message,
              type: type !== undefined ? type : t.type,
              persistent: persistent !== undefined ? persistent : t.persistent,
              action: action === undefined ? t.action : action ?? undefined,
            }
          : t
      )
    );
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, updateToast, removeToast };
}
