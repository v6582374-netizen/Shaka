import { createPortal } from "react-dom";
import { useRegisterPageHeader } from "@/components/PageHeaderContext";

interface PageHeaderProps {
  title: string;
  actions?: React.ReactNode;
}

/**
 * No longer renders its own bar. It registers the page title into the TopBar
 * via context (loop-safe) and renders the actions into the TopBar's action
 * slot through a React portal. The portal updates naturally on every page
 * render, so action changes (loading -> loaded, etc.) propagate without any
 * render loop. Pages keep using <PageHeader/> unchanged.
 */
export function PageHeader({ title, actions }: PageHeaderProps) {
  const target = useRegisterPageHeader(title);
  if (!actions || !target) return null;
  return createPortal(
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{actions}</div>,
    target,
  );
}
