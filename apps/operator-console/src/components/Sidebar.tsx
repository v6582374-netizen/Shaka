import { Icon } from "./Icon";

interface Props {
  onOpenG1Monitor: () => void;
  onOpenCamera: () => void;
  onOpenSkillBank: () => void;
  g1MonitorActive: boolean;
  cameraActive: boolean;
  skillBankActive: boolean;
  collapsed?: boolean;
  onCollapse?: () => void;
  onPeekLeave?: () => void;
}

interface ModuleLinkProps {
  active: boolean;
  label: string;
  testId: string;
  icon: "database" | "image" | "sparkle";
  onClick: () => void;
}

function ModuleLink({ active, label, testId, icon, onClick }: ModuleLinkProps) {
  return (
    <button
      className={
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-left hover:bg-paper hover:text-ink " +
        (active ? "text-ink bg-paper" : "text-muted")
      }
      type="button"
      data-testid={testId}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <Icon name={icon} size={15} className="shrink-0" />
      <span className="flex-1">{label}</span>
    </button>
  );
}

/** The web console deliberately exposes only its three supported workspaces. */
export function Sidebar(props: Props) {
  return (
    <aside
      className="sidebar flex flex-col min-h-0 bg-panel border-r border-line"
      aria-label="Application navigation"
      onMouseLeave={props.onPeekLeave}
    >
      <div className="brand px-3.5 pt-2.5 pb-2 flex items-center gap-2" data-tauri-drag-region>
        {props.onCollapse && (
          <button
            className="nav-pin-btn w-7 h-7 grid place-items-center rounded-md text-faint hover:text-ink hover:bg-paper shrink-0"
            type="button"
            title={props.collapsed ? "Dock sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
            aria-label={props.collapsed ? "Dock sidebar" : "Collapse sidebar"}
            onClick={props.onCollapse}
          >
            <Icon name="sidebar" size={16} />
          </button>
        )}
        <div className="brand-wordmark text-[15px]">Vegapunk<span className="beta-tag">BETA</span></div>
      </div>

      <nav className="px-2.5 mt-1 space-y-1" aria-label="Modules">
        <ModuleLink
          active={props.g1MonitorActive}
          label="Body Status"
          testId="nav-g1-monitor"
          icon="database"
          onClick={props.onOpenG1Monitor}
        />
        <ModuleLink
          active={props.cameraActive}
          label="Camera"
          testId="nav-camera"
          icon="image"
          onClick={props.onOpenCamera}
        />
        <ModuleLink
          active={props.skillBankActive}
          label="Skill Bank"
          testId="nav-skill-bank"
          icon="sparkle"
          onClick={props.onOpenSkillBank}
        />
      </nav>
    </aside>
  );
}
