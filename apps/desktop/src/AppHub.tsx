import { useEffect, useRef, useState, type ReactNode } from 'react';
import { APP_GROUPS, APPS, isInstalled, recentApps, type AppId, type AppInfo } from './apps';
import { APP_ICONS, OWN_ICONS, type OwnApp } from './Rail';
import { morphOut, useMorphIn } from './motion';
import { afterPaint } from './ui/frame';

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
  /** Mobius's own apps (Agents, Activity, Abilities): opened from here, not kept in the rail. */
  own?: readonly OwnApp[];
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

/** The hub's groups of apps. A group of one (Agent, Review) joins the group beside it rather than sitting alone. */
export function hubGroups(): Array<{ group: string; members: AppInfo[] }> {
  const groups = APP_GROUPS.map((group) => ({ group: group as string, members: APPS.filter((a) => a.group === group && !a.own && isInstalled(a.id)) })).filter((g) => g.members.length > 0);
  const out: Array<{ group: string; members: AppInfo[] }> = [];
  let carry: AppInfo[] = [];
  for (const g of groups) {
    if (g.members.length === 1 && groups.length > 1) { carry.push(...g.members); continue; }
    out.push({ group: g.group, members: [...carry, ...g.members] });
    carry = [];
  }
  if (carry.length > 0) { const last = out.at(-1); if (last) last.members.push(...carry); else out.push({ group: 'Apps', members: carry }); }
  return out;
}

export function AppHub({ open, onClose, current, onOpenApp, actions, status, onConnect, own = [] }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Opened again while it was on its way out: it stays.
  const stillOpen = useRef(open);
  stillOpen.current = open;
  const [query, setQuery] = useState('');
  // It grows out of the All apps button that opened it, not from the middle of the window.
  useMorphIn(dialog, open, 'left');

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) { setQuery(''); el.showModal(); input.current?.focus(); }
    // Put away, it goes back toward the button that opened it before it closes.
    else if (!open && el.open) void morphOut(el, 'left').then(() => { if (!el.isConnected || stillOpen.current) return; el.close(); el.getAnimations().forEach((a) => a.cancel()); });
  }, [open]);

  const q = query.trim().toLowerCase();
  const has = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
  // Searching, an app whose name starts with the words comes first, then one whose name has them, then the rest.
  const rank = (name: string) => (name.toLowerCase().startsWith(q) ? 0 : name.toLowerCase().includes(q) ? 1 : 2);
  const built = APPS.filter((a) => a.available && !a.own && isInstalled(a.id) && has(a.name, status[a.id] ?? '', a.also ?? ''))
    .sort((a, b) => (q ? rank(a.name) - rank(b.name) : 0));
  const later = APPS.filter((a) => !a.available && has(a.name));
  const starts = actions.filter((a) => has(a.label));
  // Settings lives at the foot of the rail, so it is listed here only when it is looked for.
  const ownShown = own.filter((o) => (q ? true : o.id !== 'settings') && has(o.name));
  // Eight to start from; the rest when asked for, or found by typing.
  const [allStarts, setAllStarts] = useState(false);
  useEffect(() => { if (!open) setAllStarts(false); }, [open]);
  const shownStarts = q || allStarts ? starts : starts.filter((a) => FEATURED.includes(a.id));
  // Close the dialog first, so the focus it gives back lands before the opened thing takes it.
  // When the opened thing takes no focus itself, it goes to the work area, not back to All apps: the button would keep
  // its focus ring and read as lit beside the app that is really open.
  const go = (run: () => void) => {
    dialog.current?.close(); onClose(false); run();
    afterPaint(() => {
      const at = document.activeElement;
      if (at === document.body || at?.closest('.rail')) document.querySelector<HTMLElement>('main.stage')?.focus({ preventScroll: true });
    });
  };
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
      <form className="hub-search" role="search" onSubmit={(e) => { e.preventDefault(); const first = built[0]; const mine = ownShown[0]; if (first && (!mine || rank(first.name) <= rank(mine.name))) go(() => onOpenApp(first.id)); else if (mine) go(mine.run); else if (starts[0]) go(starts[0].run); }}>
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
            <div className="hub-groups">{hubGroups().map(({ group, members }) => {
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
      {ownShown.length > 0 && (
        <section className="hub-section" aria-label="Mobius">
          <h2 className="hub-heading">Mobius</h2>
          <ul className="hub-grid" role="list">{ownShown.map((o) => (
            <li key={o.id}>
              <button type="button" className="hub-app" aria-current={o.current ? 'page' : undefined} aria-label={o.name} onClick={() => go(o.run)}>
                <span className="hub-icon" data-app={o.id} aria-hidden="true"><svg viewBox="0 0 20 20">{OWN_ICONS[o.id]}</svg></span>
                <span className="hub-name">{o.name}</span>
              </button>
            </li>
          ))}</ul>
        </section>
      )}
      {!q && (
        <button type="button" className="hub-connect" onClick={() => go(onConnect)}>
          <span className="hub-icon" data-app="connect" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M8 4v4M12 4v4M6 8h8v2a4 4 0 0 1-8 0zM10 14v3" /></svg></span>
          <span><span className="hub-name">Connect other apps</span><span className="hub-status">Give the agent tools from other apps over MCP, or let them use Mobius</span></span>
        </button>
      )}
      {built.length === 0 && later.length === 0 && starts.length === 0 && ownShown.length === 0 && <p className="hub-empty" role="status">No apps match “{query.trim()}”.</p>}
    </dialog>
  );
}
