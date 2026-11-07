import { useEffect, useRef, useState, type ReactNode } from 'react';
import { APPS, type AppId } from './apps';
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
  const built = APPS.filter((a) => a.available && has(a.name, status[a.id] ?? ''));
  const later = APPS.filter((a) => !a.available && has(a.name));
  const starts = actions.filter((a) => has(a.label));
  // Close the dialog first, so the focus it gives back lands before the opened thing takes it.
  const go = (run: () => void) => { dialog.current?.close(); onClose(false); run(); };

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
            {starts.map((a) => (
              <button key={a.id} type="button" className="hub-start" onClick={() => go(a.run)}>
                <Tile id={a.app}><span className="hub-plus" /></Tile>
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {built.length > 0 && (
        <section className="hub-section" aria-label="Apps">
          <h2 className="hub-heading">Apps</h2>
          <ul className="hub-grid" role="list">
            {built.map((a) => (
              <li key={a.id}>
                <button type="button" className="hub-app" aria-current={a.id === current ? 'page' : undefined} aria-label={status[a.id] ? `${a.name}, ${status[a.id]}` : a.name} onClick={() => go(() => onOpenApp(a.id))}>
                  <Tile id={a.id} />
                  <span className="hub-name">{a.name}</span>
                  {status[a.id] && <span className="hub-status">{status[a.id]}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {later.length > 0 && (
        <section className="hub-section" aria-label="Coming later">
          <h2 className="hub-heading">Coming later</h2>
          <ul className="hub-grid" role="list">
            {later.map((a) => (
              <li key={a.id}>
                <button type="button" className="hub-app" disabled aria-label={`${a.name}, not built yet`}>
                  <Tile id={a.id} />
                  <span className="hub-name">{a.name}</span>
                  <span className="hub-status">Not built yet</span>
                </button>
              </li>
            ))}
          </ul>
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
