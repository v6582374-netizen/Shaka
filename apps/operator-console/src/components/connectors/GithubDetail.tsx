import { useEffect, useState } from "react";
import {
  disallowUser,
  disconnectConnector,
  getSubscriptions,
  resolveUnauthorized,
  unsubscribeChannel,
  type ParkedMessage,
  type Subscription,
} from "../../api";
import { ConnectorBadge } from "../../connectors/ConnectorIcon";
import type { DetailProps } from "./ConnectorsSection";
import { ToolsDisclosure } from "./ToolsDisclosure";
import { FOOT, GRP, GRP_H, PILL_ACCENT, PILL_LINE, ROW, XBTN } from "./ui";

// The GitHub detail page: a personal access token, ONE account. People (sender
// logins allowed to trigger work) · Waiting (parked mentions) · Listening
// (session ↔ repo thread) · Disconnect. Connecting goes through the ONE entry
// point: the header button → AddConnectionModal (token paste).

const LABEL = "text-[12.5px] text-muted w-24 shrink-0";

export function GithubDetail({ c, onChanged }: DetailProps) {
  const [busy, setBusy] = useState(false);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const load = () => getSubscriptions().then(setSubs).catch(() => setSubs([]));
  useEffect(() => {
    load();
  }, [c.name]);

  const changed = () => {
    onChanged();
    load();
  };
  const listening = subs.filter((s) => s.channel.startsWith("github:"));
  const parked = c.unauthorized ?? [];

  const disconnect = async () => {
    setBusy(true);
    await disconnectConnector("github");
    setBusy(false);
    changed();
  };

  return (
    <div data-testid="github-detail">
      <div className="flex items-center gap-3.5 mb-5">
        <ConnectorBadge connector={c} size={44} title="GitHub" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold tracking-tight leading-tight">GitHub</h2>
          <div className="text-[12.5px] text-muted flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-ok" />
            <span data-testid="github-mode-badge">Connected · personal access token</span>
          </div>
        </div>
      </div>

      <div data-testid="github-pat-card">
        <div className={GRP_H}>
          {c.account || "account"}{" "}
          <span className="font-normal text-faint">· personal access token</span>
        </div>
        <div className={GRP}>
          <PeopleRow allowed={c.allowed_users} onChanged={changed} />
          {parked.map((m) => (
            <WaitingRow key={m.id} m={m} onChanged={changed} />
          ))}
          {listening.length > 0 && <ListeningRows subs={listening} onChanged={changed} />}
          <div className={ROW}>
            <span className="flex-1" />
            <button
              className="text-[12.5px] text-danger/80 hover:text-danger shrink-0"
              data-testid="disconnect-github"
              title="Removes the stored token from this computer."
              onClick={disconnect}
              disabled={busy}
            >
              {busy ? "Disconnecting…" : "Disconnect GitHub"}
            </button>
          </div>
        </div>
      </div>

      <ToolsDisclosure c={c} onChanged={onChanged} />
      <div className={FOOT + " mt-2"}>
        Tools act as the token's own user. GitHub logins are the readable identity — no
        name lookup needed.
      </div>
    </div>
  );
}

function PeopleRow({ allowed, onChanged }: { allowed: string[]; onChanged: () => void }) {
  return (
    <div className={ROW}>
      <span className={LABEL}>People</span>
      <span className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
        {allowed.length === 0 && (
          <span className="text-[12px] text-faint">nobody yet — approve a waiting sender below</span>
        )}
        {allowed.map((login) => (
          <span
            key={login}
            className="inline-flex items-center gap-1.5 pl-2 pr-2 py-0.5 rounded-full bg-paper border border-line text-[12.5px]"
          >
            {/* GitHub logins ARE the readable identity — no resolution needed. */}
            @{login}
            <button
              className={XBTN}
              title="remove"
              onClick={() => disallowUser("github", login).then(onChanged)}
            >
              ×
            </button>
          </span>
        ))}
      </span>
    </div>
  );
}

function WaitingRow({ m, onChanged }: { m: ParkedMessage; onChanged: () => void }) {
  const act = async (action: "dismiss" | "allow" | "allow_deliver") => {
    await resolveUnauthorized("github", m.id, action);
    onChanged();
  };
  return (
    <div className={ROW + " bg-warnSoft/25"} data-testid={`waiting-${m.id}`}>
      <span className={LABEL}>Waiting</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-[13px]">@{m.user_name || m.user_id}</span>{" "}
        <span className="text-[12.5px] text-muted">in {m.chat_name || m.chat_id}</span>
        <span className="block text-[12.5px] text-muted truncate">“{m.text}”</span>
      </span>
      <button
        className={PILL_ACCENT + " !py-1"}
        data-testid={`parked-allow-deliver-${m.id}`}
        title="Allow the sender and deliver this mention now"
        onClick={() => act("allow_deliver")}
      >
        Allow & deliver
      </button>
      <button
        className={PILL_LINE + " !py-1"}
        data-testid={`parked-allow-${m.id}`}
        title="Allow the sender; this mention is discarded"
        onClick={() => act("allow")}
      >
        Allow
      </button>
      <button className={XBTN + " px-1"} data-testid={`parked-dismiss-${m.id}`} title="Dismiss" onClick={() => act("dismiss")}>
        ×
      </button>
    </div>
  );
}

function ListeningRows({ subs, onChanged }: { subs: Subscription[]; onChanged: () => void }) {
  return (
    <div className={ROW} data-testid="listening-github">
      <span className={LABEL}>Listening</span>
      <span className="min-w-0 flex-1 space-y-1">
        {subs.map((s) => (
          <span key={s.session_id + s.channel} className="flex items-center gap-2 text-[12.5px]">
            <span className="font-medium truncate" title={s.session_id}>
              {s.session_title || s.session_id}
            </span>
            <span className="text-faint">←</span>
            <span className="text-muted truncate" title={s.channel}>
              {s.channel.replace(/^github:/, "")}
            </span>
            <button
              className={XBTN + " ml-auto"}
              title="Unsubscribe this session"
              onClick={async () => {
                await unsubscribeChannel(s.session_id, s.channel);
                onChanged();
              }}
            >
              ×
            </button>
          </span>
        ))}
      </span>
    </div>
  );
}
