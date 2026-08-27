import { useEffect, RefObject } from "react";

/**
 * 在元素展开时监听 document 的 mousedown 事件，点击发生在元素
 * 外部时调用 onClose。
 *
 * 用于替代 `position: fixed; inset: 0` 的全屏遮罩方案——当祖先元素
 * 设置了 `backdrop-filter` / `transform` / `filter` 时，fixed 后代会
 * 相对于该祖先定位而非视口，导致遮罩无法真正覆盖整个页面。
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, isOpen, onClose]);
}
