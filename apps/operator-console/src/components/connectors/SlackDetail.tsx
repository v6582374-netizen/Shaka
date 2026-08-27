import { useEffect, useRef, useState } from "react";
import {
  addSlackApprovalOwner,
  allowUser,
  disallowUser,
  disconnectConnector,
  getSlackDirectory,
  getSubscriptions,
  resolveUnauthorized,
  removeSlackApprovalOwner,
  unsubscribeChannel,
  type ParkedMessage,
  type SlackMember,
  type Subscription,
} from "../../api";
import { ConnectorBadge } from "../../connectors/ConnectorIcon";
import type { DetailProps } from "./ConnectorsSection";
import { SlackHowItWorks } from "./SlackHowItWorks";
import { ToolsDisclosure } from "./ToolsDisclosure";
import { FOOT, GRP, GRP_H, PILL_ACCENT, PILL_LINE, ROW, XBTN } from "./ui";

// The Slack detail page (UX-DECISIONS §21): Socket Mode, ONE workspace per
// install — People (allow-list) · Approvals · Waiting (parked senders) ·
// Listening (session ↔ channel) · Disconnect. Connecting goes through the ONE
// entry point: the header button → AddConnectionModal (bot + app token paste).

/** Two-letter initials for a person chip. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const LABEL = "text-[12.5px] text-muted w-24 shrink-0";

export function SlackDetail({ c, onChanged }: DetailProps) {
  const [busy, setBusy] = useState(false);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const loadSubs = () => getSubscriptions().then(setSubs).catch(() => setSubs([]));
  useEffect(() => {
    loadSubs();
  }, [c.name]);

  const changed = () => {
    onChanged();
    loadSubs();
  };

  const disconnect = async () => {
    setBusy(true);
    await disconnectConnector("slack");
    setBusy(false);
    changed();
  };

  return (
    <div data-testid="slack-detail">
      <div className="flex items-center gap-3.5 mb-5">
        <ConnectorBadge connector={c} size={44} title="Slack" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold tracking-tight leading-tight">Slack</h2>
          <div className="text-[12.5px] text-muted flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-ok" />
            <span data-testid="slack-mode-badge">Connected · Socket Mode</span>
          </div>
        </div>
      </div>

      {/* UX-027: post-connect orientation — status line + animated how-it-works
          carousel (collapsible; collapsed state is the local "seen" flag). */}
      <SlackHowItWorks c={c} />

      <div data-testid="slack-socket-card">
        <div className={GRP_H}>
          {c.account || "workspace"} <span className="font-normal text-faint">· Socket Mode</span>
        </div>
        <div className={GRP}>
          <PeopleRow
            allowed={c.allowed_users}
            names={c.allowed_user_names}
            protectedIds={c.approval_owner_ids}
            onRemove={(u) => disallowUser("slack", u).then(changed)}
            onChanged={changed}
          />
          <ApprovalOwnersRow
            owners={c.approval_owner_ids ?? []}
            names={c.approval_owner_names}
            onChanged={changed}
          />
          {(c.unauthorized ?? []).map((m) => (
            <WaitingRow key={m.id} m={m} onChanged={changed} />
          ))}
          <ListeningRows
            subs={subs.filter((s) => s.channel.startsWith("slack:"))}
            onChanged={changed}
          />
          <div className={ROW}>
            <span className="flex-1" />
            <button
              className="text-[12.5px] text-danger/80 hover:text-danger shrink-0"
              data-testid="disconnect-slack"
              title="Removes the stored tokens from this computer. The app stays installed in Slack."
              onClick={disconnect}
              disabled={busy}
            >
              {busy ? "Disconnecting…" : "Disconnect workspace"}
            </button>
          </div>
        </div>
      </div>

      <ToolsDisclosure c={c} onChanged={onChanged} />
      <div className={FOOT + " mt-2"}>Names come from Slack automatically. IDs show on hover.</div>
    </div>
  );
}

function PeopleRow({
  allowed,
  names,
  protectedIds,
  onRemove,
  onChanged,
}: {
  allowed: string[];
  names?: Record<string, string | null>;
  protectedIds?: string[];
  onRemove: (userId: string) => void;
  onChanged: () => void;
}) {
  const label = (u: string) => names?.[u] || u;
  return (
    <div className={ROW}>
      <span className={LABEL}>People</span>
      <span className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
        {allowed.length === 0 && (
          <span className="text-[12px] text-faint">nobody yet — pick a name, or approve a waiting sender below</span>
        )}
        {allowed.map((u) => (
          <span
            key={u}
            className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-paper border border-line text-[12.5px]"
            title={`id ${u}`}
          >
            <span className="w-5 h-5 rounded-full bg-accentSoft text-accent grid place-items-center text-[9px] font-bold">
              {initials(label(u))}
            </span>
            {label(u)}
            {protectedIds?.includes(u) ? (
              <span
                className="text-[10.5px] text-faint"
                title="Remove approval-owner access before removing this person."
              >
                · owner
              </span>
            ) : (
              <button className={XBTN} title="remove" onClick={() => onRemove(u)}>
                ×
              </button>
            )}
          </span>
        ))}
        <PersonPicker allowed={allowed} onChanged={onChanged} />
      </span>
    </div>
  );
}

// "Find your name in a list": typeahead over the workspace directory (users.list,
// cached on the desktop). A pick lands on the allow-list with the display name in
// hand — the park→approve flow stays as the path for senders nobody pre-added.
function PersonPicker({
  allowed,
  onChanged,
  onPick,
  buttonLabel = "＋ Add person",
  testId,
}: {
  allowed: string[];
  onChanged: () => void;
  onPick?: (member: SlackMember) => Promise<{ ok: boolean; error?: string }>;
  buttonLabel?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SlackMember[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  // Fixed-position drop: the group cards clip overflow (GRP is overflow-hidden),
  // so an absolute popover inside them would be cut off after the first row.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const toggle = () => {
    if (open) return setOpen(false);
    const r = btn.current?.getBoundingClientRect();
    setPos(r ? { top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 300) } : null);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      getSlackDirectory(q)
        .then((r) => {
          if (r.ok) {
            setRows(r.members || []);
            setErr(null);
          } else setErr(r.error || "directory unavailable");
        })
        .catch(() => setErr("directory unavailable"));
    }, 200);
    return () => clearTimeout(t);
  }, [open, q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = async (m: SlackMember) => {
    const result = onPick
      ? await onPick(m)
      : await allowUser("slack", m.id, m.name);
    if (result?.ok === false) {
      setErr(result.error || "could not add person");
      return;
    }
    setOpen(false);
    setQ("");
    onChanged();
  };
  const candidates = rows.filter((m) => !allowed.includes(m.id));

  return (
    <span className="relative" ref={wrap}>
      <button
        ref={btn}
        className="inline-flex items-center px-2 py-0.5 rounded-full border border-dashed border-line text-[12.5px] text-muted hover:text-ink hover:border-faint"
        data-testid={testId || "add-person-default"}
        title="Pick from the workspace directory"
        onClick={toggle}
      >
        {buttonLabel}
      </button>
      {open && (
        <div
          className="fixed z-50 w-72 rounded-xl border border-line bg-panel shadow-lg p-1"
          style={{ top: pos?.top, left: pos?.left }}
          data-testid="person-picker"
        >
          <input
            autoFocus
            className="w-full bg-paper border border-line rounded-lg px-2 py-1 text-[12.5px] outline-none placeholder:text-faint"
            placeholder="Type a name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <div className="max-h-56 overflow-y-auto py-1">
            {err ? (
              <div className="px-2 py-1.5 text-[12px] text-warnInk">{err}</div>
            ) : candidates.length === 0 ? (
              <div className="px-2 py-1.5 text-[12px] text-faint">no matches</div>
            ) : (
              candidates.map((m) => (
                <button
                  key={m.id}
                  className="block w-full text-left px-2 py-1.5 rounded-lg hover:bg-paper"
                  data-testid={`pick-person-${m.id}`}
                  title={`id ${m.id}`}
                  onMouseDown={(e) => {
                    // mousedown (not click) so the pick lands before the input's blur
                    e.preventDefault();
                    pick(m);
                  }}
                >
                  <span className="text-[12.5px] font-medium">{m.name}</span>{" "}
                  <span className="text-[11.5px] text-faint">@{m.handle}</span>
                  {m.guest && (
                    <span className="ml-1.5 text-[10.5px] text-warnInk bg-warnSoft/70 border border-warnInk/15 rounded px-1 py-0.5">
                      guest
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="px-2 pb-1 text-[10.5px] text-faint">
            From your workspace directory — stays on this computer.
          </div>
        </div>
      )}
    </span>
  );
}

function ApprovalOwnersRow({
  owners,
  names,
  onChanged,
}: {
  owners: string[];
  names?: Record<string, string | null>;
  onChanged: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const label = (u: string) => names?.[u] || u;
  const remove = async (userId: string) => {
    const result = await removeSlackApprovalOwner(userId);
    if (!result.ok) {
      setErr(result.error || "could not remove approval owner");
      return;
    }
    setErr(null);
    onChanged();
  };
  return (
    <div className={ROW} data-testid="slack-approval-owners">
      <span className={LABEL}>Approvals</span>
      <span className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
        {owners.length === 0 && (
          <span className="text-[12px] text-warnInk">
            Choose at least one owner before routing Inbox approvals to Slack.
          </span>
        )}
        {owners.map((u) => (
          <span
            key={u}
            className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-paper border border-line text-[12.5px]"
            title={`id ${u}`}
            data-testid={`approval-owner-${u}`}
          >
            <span className="w-5 h-5 rounded-full bg-accentSoft text-accent grid place-items-center text-[9px] font-bold">
              {initials(label(u))}
            </span>
            {label(u)}
            <button className={XBTN} title="remove approval owner" onClick={() => remove(u)}>
              ×
            </button>
          </span>
        ))}
        <PersonPicker
          allowed={owners}
          onChanged={onChanged}
          onPick={(m) => addSlackApprovalOwner(m.id, m.name)}
          buttonLabel="＋ Add owner"
          testId="add-approval-owner"
        />
        {err && <span className="basis-full text-[11.5px] text-warnInk">{err}</span>}
      </span>
    </div>
  );
}

function WaitingRow({ m, onChanged }: { m: ParkedMessage; onChanged: () => void }) {
  const act = async (action: "dismiss" | "allow" | "allow_deliver") => {
    await resolveUnauthorized("slack", m.id, action);
    onChanged();
  };
  return (
    <div className={ROW + " bg-warnSoft/25"} data-testid={`waiting-${m.id}`}>
      <span className={LABEL}>Waiting</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-[13px]">{m.user_name || m.user_id}</span>{" "}
        <span className="text-[12.5px] text-muted">in {m.chat_name || m.chat_id}</span>
        <span className="block text-[12.5px] text-muted truncate">“{m.text}”</span>
      </span>
      <button
        className={PILL_ACCENT + " !py-1"}
        data-testid={`parked-allow-deliver-${m.id}`}
        title="Allow the sender and deliver this message now"
        onClick={() => act("allow_deliver")}
      >
        Allow & deliver
      </button>
      <button
        className={PILL_LINE + " !py-1"}
        data-testid={`parked-allow-${m.id}`}
        title="Allow the sender; this message is discarded"
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
  if (subs.length === 0) return null;
  return (
    <div className={ROW} data-testid="listening-slack">
      <span className={LABEL}>Listening</span>
      <span className="min-w-0 flex-1 space-y-1">
        {subs.map((s) => (
          <span key={s.session_id + s.channel} className="flex items-center gap-2 text-[12.5px]">
            <span className="font-medium truncate" title={s.session_id}>
              {s.session_title || s.session_id}
            </span>
            <span className="text-faint">←</span>
            <span className="text-muted truncate" title={s.channel}>
              {s.channel_name ? `#${s.channel_name}` : s.channel}
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
