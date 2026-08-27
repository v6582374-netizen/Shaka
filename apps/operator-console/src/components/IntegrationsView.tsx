import { useEffect, useState } from "react";
import { getConnectors } from "../api";
import { ApiServicesView } from "./ApiServicesView";
import { McpTab } from "./ManageTabs";
import { PanelHead } from "./PanelHead";
import { ConnectorsSection } from "./connectors/ConnectorsSection";
import { Icon } from "./Icon";

export { PanelHead } from "./PanelHead";

// Integrations keeps three stable sibling modules: Connectors, External data, and MCP servers.
// Connector detail remains a subpage under Connectors; research-source credentials never live in
// that list, so the quiet stack can stay calm as the catalog grows.
type IntTab = "connectors" | "external-data" | "mcp";

// Fixed sub-nav (UX-DECISIONS §21): connector detail lives as a SUBPAGE under
// Connectors, never as a nav item — the nav must not grow per connector.
const INT_TABS: { key: IntTab; label: string; icon: "plug" | "database" | "code" }[] = [
  { key: "connectors", label: "Connectors", icon: "plug" },
  { key: "external-data", label: "External data", icon: "database" },
  { key: "mcp", label: "MCP servers", icon: "code" },
];

export function IntegrationsView() {
  const [tab, setTab] = useState<IntTab>("connectors");
  // Sub-nav count: how many connectors exist. Polled so the badge stays live.
  const [connCount, setConnCount] = useState<number | null>(null);

  useEffect(() => {
    const load = () => {
      getConnectors().then((cs) => setConnCount(cs.length)).catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="flex-1 min-w-0 flex bg-paper">
      <nav className="page-subnav w-[208px] shrink-0 border-r border-line bg-panel/40 px-3 py-4">
        <div className="px-2 text-[13.5px] font-semibold mb-3 flex items-center gap-2">
          <Icon name="plug" size={16} /> Integrations
        </div>
        {INT_TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              className={
                "w-full text-left px-2.5 py-2 rounded-lg text-[13px] flex items-center justify-between " +
                (active
                  ? "bg-paper text-accent font-medium"
                  : "text-muted hover:bg-paper hover:text-ink")
              }
              onClick={() => setTab(t.key)}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Icon name={t.icon} size={15} /> {t.label}
              </span>
              {t.key === "connectors" && connCount != null && (
                <span className={"text-[11px] shrink-0 " + (active ? "text-accent" : "text-faint")}>
                  {connCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 min-w-0 overflow-y-auto hairline-scroll">
        <div className="max-w-4xl mx-auto px-7 py-6">
          {tab === "connectors" ? (
            <section>
              <PanelHead
                title="Connectors"
                sub="Apps and tools your coworkers can use. Connected ones come first."
              />
              <ConnectorsSection />
            </section>
          ) : tab === "external-data" ? (
            <ApiServicesView />
          ) : (
            <section>
              <PanelHead
                title="MCP servers"
                sub="External tool servers (stdio or HTTP), shared across all agents."
              />
              <McpTab />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
