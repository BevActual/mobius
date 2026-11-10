import { useEffect, useRef, useState, type ReactNode } from 'react';
import { APP_GROUPS, APPS, recentApps, type AppId, type AppInfo } from './apps';
import { APP_ICONS } from './Rail';

export interface HubAction { id: string; label: string; app: AppId; run: () => void }

interface Props {
  open: boolean;
  /** `restore`: put focus back where it was (not when something was opened, which takes focus itself). */
  onClose: (restore?: boolean) => void;
  current: AppId;
  onOpenApp: (id: AppId) => void;
  /** Things to start from anywhere: a conversation, a note, a task, a page. */
  actions: HubAction[];
  /** A few live words per app: what is waiting there. */
  status: Partial<Record<AppId, string>>;
  onConnect: () => void;
}

const Tile = ({ id, children }: { id: string; children?: ReactNode }) => (
  <span className="hub-icon" data-app={id} aria-hidden="true">
    <svg viewBox="0 0 20 20">{APP_ICONS[id]}</svg>
    {children}
  </span>
);

/**
 * The application hub: every Mobius app as a tile with what is happening in it, ways to start something new, and
 * the apps still to come. Opens from the rail; type to narrow it, Enter opens the first match, Escape closes.
 */
/** What the hub offers to start before more is asked for. */
const FEATURED = ['conversation', 'note', 'task', 'tab', 'doc', 'message', 'research', 'event'];

export function AppHub({ open, onClose, current, onOpenApp, actions, status, onConnect }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) { setQuery(''); el.showModal(); input.current?.focus(); }
    else if (!open && el.open) el.close();
  }, [open]);

  const q = query.trim().toLowerCase();
  const has = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
  const built = APPS.filter((a) => a.available && !a.own && has(a.name, status[a.id] ?? ''));
  const later = APPS.filter((a) => !a.available && has(a.name));
  const starts = actions.filter((a) => has(a.label));
  // Eight to start from; the rest when asked for, or found by typing.
  const [allStarts, setAllStarts] = useState(false);
  useEffect(() => { if (!open) setAllStarts(false); }, [open]);
  const shownStarts = q || allStarts ? starts : starts.filter((a) => FEATURED.includes(a.id));
  // Close the dialog first, so the focus it gives back lands before the opened thing takes it.
  const go = (run: () => void) => { dialog.current?.close(); onClose(false); run(); };
  // Read when the hub opens: the apps used most recently, to start from.
  const recent = open ? recentApps().map((id) => APPS.find((a) => a.id === id)).filter((a): a is AppInfo => a !== undefined) : [];
  const appButton = (a: AppInfo) =>
    a.available ? (
      <button type="button" className="hub-app" aria-current={a.id === current ? 'page' : undefined} aria-label={status[a.id] ? `${a.name}, ${status[a.id]}` : a.name} onClick={() => go(() => onOpenApp(a.id))}>
        <Tile id={a.id} />
        <span className="hub-name">{a.name}</span>
        {status[a.id] && <span className="hub-status">{status[a.id]}</span>}
      </button>
    ) : (
      <button type="button" className="hub-app" disabled aria-label={`${a.name}, not built yet`}>
        <Tile id={a.id} />
        <span className="hub-name">{a.name}</span>
        <span className="hub-status">Not built yet</span>
      </button>
    );

  return (
    <dialog ref={dialog} className="hub" aria-label="Applications" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === dialog.current) onClose(); }}>
      <form className="hub-search" role="search" onSubmit={(e) => { e.preventDefault(); const first = built[0]; if (first) go(() => onOpenApp(first.id)); else if (starts[0]) go(starts[0].run); }}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5" /><path d="m13 13 3.5 3.5" /></svg>
        <input ref={input} type="search" aria-label="Find apps" placeholder="Find apps and actions" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && <button type="button" className="strip-btn" aria-label="Clear" onClick={() => { setQuery(''); input.current?.focus(); }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg></button>}
      </form>
      {starts.length > 0 && (
        <section className="hub-section" aria-label="Start something">
          <h2 className="hub-heading">Start</h2>
          <div className="hub-starts">
            {shownStarts.map((a) => (
              <button key={a.id} type="button" className="hub-start" onClick={() => go(a.run)}>
                <Tile id={a.app}><span className="hub-plus" /></Tile>
                <span>{a.label}</span>
              </button>
            ))}
          </div>
          {!q && starts.length > shownStarts.length && <button type="button" className="hub-more" onClick={() => setAllStarts(true)}>{`${starts.length - shownStarts.length} more…`}</button>}
        </section>
      )}
      {!q && recent.length > 1 && (
        <section className="hub-section" aria-label="Recent">
          <h2 className="hub-heading">Recent</h2>
          <ul className="hub-grid" role="list">{recent.map((a) => <li key={a.id}>{appButton(a)}</li>)}</ul>
        </section>
      )}
      {(built.length > 0 || later.length > 0) && (
        <section className="hub-section" aria-label="Apps">
          <h2 className="hub-heading">Apps</h2>
          {q ? (
            // Searching: one list of what matches.
            <ul className="hub-grid" role="list">{[...built, ...later].map((a) => <li key={a.id}>{appButton(a)}</li>)}</ul>
          ) : (
            // Otherwise by what each app is for; apps still to come sit in their group, dimmed. The groups flow side by
            // side, each as wide as its apps, so a few small groups stay as compact as one grid.
            <div className="hub-groups">{APP_GROUPS.map((group) => {
              const members = APPS.filter((a) => a.group === group && !a.own);
              if (members.length === 0) return null;
              return (
                <div key={group} className="hub-group" role="group" aria-label={group}>
                  <h3 className="hub-group-name">{group}</h3>
                  <ul className="hub-grid" role="list">{members.map((a) => <li key={a.id}>{appButton(a)}</li>)}</ul>
                </div>
              );
            })}</div>
          )}
        </section>
      )}
      {!q && (
        <button type="button" className="hub-connect" onClick={() => go(onConnect)}>
          <span className="hub-icon" data-app="connect" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M8 4v4M12 4v4M6 8h8v2a4 4 0 0 1-8 0zM10 14v3" /></svg></span>
          <span><span className="hub-name">Connect other apps</span><span className="hub-status">Give the agent tools from other apps over MCP, or let them use Mobius</span></span>
        </button>
      )}
      {built.length === 0 && later.length === 0 && starts.length === 0 && <p className="hub-empty" role="status">No apps match “{query.trim()}”.</p>}
    </dialog>
  );
}
