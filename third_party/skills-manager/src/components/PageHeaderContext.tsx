import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useLayoutEffect,
  useSyncExternalStore,
  ReactNode,
} from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface PageHeaderContextValue {
  title: string;
  setHeader: (title: string) => void;
  /** Register a portal target node for page actions. Called by the TopBar. */
  registerActionsTarget: (node: HTMLElement | null) => void;
  /** Subscribe to actions target changes. Returns an unsubscribe fn. */
  subscribeActionsTarget: (cb: () => void) => () => void;
  /** Read the current actions target node synchronously. */
  getActionsTarget: () => HTMLElement | null;
  /** Shared page-level search query (driven by the TopBar scope field). */
  pageSearchQuery: string;
  setPageSearchQuery: (q: string) => void;
  /** Placeholder the active page advertises to the scope search field. */
  pageSearchPlaceholder: string;
  setPageSearchPlaceholder: (p: string) => void;
  /** 全局风险扫描状态：true 表示扫描进行中。由 Settings 页触发，搜索框 chip 消费。 */
  riskScanning: boolean;
  setRiskScanning: (v: boolean) => void;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState("");
  const [pageSearchQuery, setPageSearchQuery] = useState("");
  const [pageSearchPlaceholder, setPageSearchPlaceholder] = useState("");
  const [riskScanning, setRiskScanning] = useState(false);

  // 兜底：监听 risk-scan-completed 事件重置扫描状态。覆盖 Settings 页
  // unmount 后 invoke Promise 回调无法更新状态的边界情况（如用户切走页面）。
  // Skills 页保留自己的监听用于刷新 riskReports，两者各司其职。
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    listen("risk-scan-completed", () => {
      setRiskScanning(false);
    }).then((stop) => {
      if (cancelled) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // The actions target is a DOM node owned by the TopBar. Pages render their
  // actions into it via a React portal. Keeping it as an external subscription
  // (not React state) means action updates never re-render the provider or the
  // subscribed pages — eliminating the render loop entirely.
  const actionsTargetRef = useRef<HTMLElement | null>(null);
  const listenersRef = useRef(new Set<() => void>());

  const setHeader = useCallback((nextTitle: string) => {
    setTitle((prev) => (prev === nextTitle ? prev : nextTitle));
  }, []);

  const registerActionsTarget = useCallback((node: HTMLElement | null) => {
    if (actionsTargetRef.current === node) return;
    actionsTargetRef.current = node;
    listenersRef.current.forEach((cb) => cb());
  }, []);

  const subscribeActionsTarget = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const getActionsTarget = useCallback(() => actionsTargetRef.current, []);

  return (
    <PageHeaderContext.Provider
      value={{
        title,
        setHeader,
        registerActionsTarget,
        subscribeActionsTarget,
        getActionsTarget,
        pageSearchQuery,
        setPageSearchQuery,
        pageSearchPlaceholder,
        setPageSearchPlaceholder,
        riskScanning,
        setRiskScanning,
      }}
    >
      {children}
    </PageHeaderContext.Provider>
  );
}

export function usePageHeaderState() {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("usePageHeaderState must be used within a PageHeaderProvider");
  return ctx;
}

// TopBar uses this to register the DOM node that receives portalled actions.
// useSyncExternalStore reads the target synchronously on mount, so the TopBar
// never renders a stale (null) target for a frame when the actions slot ref
// becomes available.
export function useActionsTarget() {
  const ctx = useContext(PageHeaderContext);
  const target = useSyncExternalStore(
    ctx?.subscribeActionsTarget ?? (() => () => {}),
    ctx?.getActionsTarget ?? (() => null),
    () => null,
  );
  return { target, registerActionsTarget: ctx?.registerActionsTarget };
}

// Pages call this to push their title (string) into context and receive the
// portal target so they can render actions into it. Title goes through context
// (loop-safe). Actions are rendered into the TopBar's portal target, so they
// update naturally on every render without any loop. useSyncExternalStore
// returns the target synchronously on mount, so the portal is created in the
// same commit as the page — the actions slot never flashes empty between pages.
export function useRegisterPageHeader(title: string) {
  const ctx = useContext(PageHeaderContext);
  const target = useSyncExternalStore(
    ctx?.subscribeActionsTarget ?? (() => () => {}),
    ctx?.getActionsTarget ?? (() => null),
    () => null,
  );

  useEffect(() => {
    ctx?.setHeader(title);
  }, [ctx, title]);

  return target;
}

// Pages call this to advertise a search placeholder and read the shared query
// that the TopBar scope field writes back. The placeholder is cleared on unmount
// so a page without an in-page search falls back to the default scope hint.
// useLayoutEffect ensures the placeholder swap happens in the same paint frame
// as the route change, so the scope field never flashes the default placeholder
// for one frame between pages.
export function usePageSearch(placeholder: string) {
  const ctx = useContext(PageHeaderContext);
  useLayoutEffect(() => {
    ctx?.setPageSearchPlaceholder(placeholder);
    return () => ctx?.setPageSearchPlaceholder("");
  }, [ctx, placeholder]);
  return {
    query: ctx?.pageSearchQuery ?? "",
    setQuery: ctx?.setPageSearchQuery ?? (() => {}),
  };
}
