import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AboutInfo, ConnectorStatus } from '@mobius/shared';
import { InstallDialog, SkillsSidebar } from './Skills';
import type { SkillsState } from './useSkills';
import { OtherApps } from './settings/sections';
import { APP_GROUPS, APPS, CORE_APPS, isInstalled, withApp, type AppId, type AppInfo } from './apps';
import { APP_ICONS } from './Rail';
import { usePreferences } from './usePreferences';
import { useUpdates } from './useUpdates';
import { ContextMenu } from './ContextMenu';
import './abilities.css';

/**
 * The places in Abilities: the apps you add, and what gives Mobius more to work with, in one app. Plugins come back as
 * a place once there are plugins to show; adding anything starts from the Add menu at the top of the sidebar.
 */
export type ExtensionPlace = 'apps' | 'skills' | 'connectors' | 'updates';
export const EXTENSION_PLACES: readonly { id: ExtensionPlace; name: string; tint: string; icon: ReactNode }[] = [
  { id: 'apps', name: 'Apps', tint: 'var(--app-skills, #8e8e93)', icon: <><rect x="4" y="4" width="5" height="5" rx="1.4" /><rect x="11" y="4" width="5" height="5" rx="1.4" /><rect x="4" y="11" width="5" height="5" rx="1.4" /><rect x="11" y="11" width="5" height="5" rx="1.4" /></> },
  { id: 'skills', name: 'Skills', tint: '#5e5ce6', icon: <><path d="M6 5.5h8M6 10h8M6 14.5h5" /><path d="M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01" /></> },
  { id: 'connectors', name: 'Connectors', tint: '#30b0c7', icon: <><path d="M8 4v3M12 4v3M6.5 7h7v3a3.5 3.5 0 0 1-7 0z" /><path d="M10 13.5V16" /></> },
  { id: 'updates', name: 'Updates', tint: '#34c759', icon: <><path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9" /><path d="M15.5 4v3h-3" /></> },
];

/** One sentence on what each app is for, shown in the library under its name. */
const APP_PURPOSE: Partial<Record<AppId, string>> = {
  browser: 'A full web browser with tabs, favourites and downloads.',
  mail: 'Your mail on this computer, sorted, with drafts in your tone.',
  search: 'One box for conversations, notes, tasks, docs, mail and pages.',
  research: 'Ask a question; Mobius searches, reads and writes a report.',
  reader: 'Pages saved to read later, as clean readable text.',
  notes: 'Quick pages, saved as you type, kept as Markdown files.',
  docs: 'Longer documents with an outline, comments and history.',
  wiki: 'What Mobius knows, on pages you can read and edit.',
  sheets: 'Spreadsheets with formulas, saved as CSV files.',
  tasks: 'Lists of things to do, with dates, flags and reminders.',
  database: 'SQLite databases you query with SQL.',
  calendar: 'Your calendars by day, week or month, with due tasks.',
  slides: 'Presentations with layouts, presenter notes and a player.',
  design: 'Frames on a canvas, with layers, styles and smart guides.',
  photo: 'Your pictures, with crops, adjustments and filters you can undo.',
  studio: 'A small studio for songs: tracks, piano roll and mixer.',
  video: 'Cut footage into a short film on a timeline.',
  code: 'A code editor for projects in your workspace, with git.',
  terminal: 'Run commands in a folder of your workspace.',
  canvas: 'A whiteboard of stickies, shapes, arrows and pen lines.',
};

/** What is typed in the sidebar's search: it narrows the apps, the skills and the connectors. */
let query = '';
const listeners = new Set<() => void>();
const setQuery = (next: string) => { query = next; listeners.forEach((l) => l()); };
export function useAbilitiesQuery(): [string, (next: string) => void] {
  const value = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => query);
  return [value, setQuery];
}
const matches = (q: string, ...words: (string | undefined)[]) => { const t = q.trim().toLowerCase(); return t === '' || words.some((w) => w?.toLowerCase().includes(t)); };
/** Whether an app is found by the search: by its name, its other names or what it is for. */
export const appMatches = (q: string, app: AppInfo) => matches(q, app.name, app.also, APP_PURPOSE[app.id]);

/** The apps the library lists: every app that can be added, leaving out Mobius's own apps, which are always there. */
const LIBRARY = APPS.filter((a) => a.available && !(CORE_APPS as readonly string[]).includes(a.id));

/** The connectors Mobius started, looked at again once they have had a moment to start. */
function useConnectors(): { status: ConnectorStatus | null; reload: () => void } {
  const api = window.mobius.extensions;
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const reload = useCallback(() => { void api?.connectors().then(setStatus).catch(() => undefined); }, [api]);
  useEffect(reload, [reload]);
  useEffect(() => { const t = window.setTimeout(reload, 3000); return () => window.clearTimeout(t); }, [reload]);
  return { status, reload };
}

function PlaceIcon({ tint, children }: { tint: string; children: ReactNode }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true" className="abl-place-icon" style={{ background: tint }}>{children}</svg>;
}

function Places({ place, onPlace, skills }: { place: ExtensionPlace; onPlace: (p: ExtensionPlace) => void; skills: SkillsState }) {
  const preferences = usePreferences();
  const { status } = useConnectors();
  // Counted from the preferences, so the number changes as soon as an app is added or removed.
  const list = preferences.value.installedApps;
  const added = LIBRARY.filter((a) => (Array.isArray(list) ? list.includes(a.id) : isInstalled(a.id))).length;
  const counts: Record<ExtensionPlace, number | null> = {
    apps: added,
    skills: skills.available ? skills.list.length : null,
    connectors: status ? status.running.length + status.failed.length : null,
    updates: null,
  };
  return (
    <nav className="task-lists ext-places" aria-label="Abilities">
      <ul role="list">
        {EXTENSION_PLACES.map((p) => (
          <li key={p.id}>
            <button type="button" className="list-row abl-place" aria-current={place === p.id ? 'page' : undefined} onClick={() => onPlace(p.id)}>
              <PlaceIcon tint={p.tint}>{p.icon}</PlaceIcon>
              <span className="list-name">{p.name}</span>
              {counts[p.id] !== null && <span className="list-count" aria-hidden="true">{counts[p.id]}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Add, first in the sidebar as New is in every app: one menu for everything that can be added. A skill can be written
 * here or installed from a file; a connector is a server listed in mcp.json.
 */
function AddMenu({ skills, onPlace, onNewSkill }: { skills: SkillsState; onPlace: (p: ExtensionPlace) => void; onNewSkill: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [shared, setShared] = useState<string | null>(null);
  return (
    <div className="side-new">
      <button
        type="button"
        className="side-new-row"
        aria-label="Add"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        title="Add an app, a skill or a connector"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
        <span>Add</span>
      </button>
      <input ref={picker} type="file" accept=".md,text/markdown,text/plain" hidden aria-label="Choose a SKILL.md" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void f.text().then(setShared); }} />
      {shared !== null && <InstallDialog text={shared} skills={skills} onClose={() => { setShared(null); if (skills.open) onPlace('skills'); }} />}
      {menu && createPortal(
        <ContextMenu x={menu.x} y={menu.y} label="Add" onClose={() => setMenu(null)} items={[
          { label: 'An app…', run: () => { setQuery(''); onPlace('apps'); } },
          { label: 'New skill', run: onNewSkill, separated: true, disabled: !skills.available },
          { label: 'Install a skill…', run: () => picker.current?.click(), disabled: !skills.available },
          { label: 'A connector…', run: () => onPlace('connectors'), separated: true },
        ]} />,
        document.body,
      )}
    </div>
  );
}

/** Abilities' sidebar: Add, Search, its places, and under Skills the skills themselves. */
export function ExtensionsSidebar({ place, onPlace, skills, pin, changed }: { place: ExtensionPlace; onPlace: (p: ExtensionPlace) => void; skills: SkillsState; pin?: ReactNode; changed?: ReadonlySet<string> }) {
  const [q, setQ] = useAbilitiesQuery();
  // New skill opens the naming field in the skills list, so it goes to Skills first.
  const [naming, setNaming] = useState(0);
  const newSkill = () => { onPlace('skills'); setNaming((n) => n + 1); };
  const top = (
    <>
      <AddMenu skills={skills} onPlace={onPlace} onNewSkill={newSkill} />
      <input className="side-search" type="search" aria-label="Search abilities" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      <Places place={place} onPlace={onPlace} skills={skills} />
    </>
  );
  if (place === 'skills') return <SkillsSidebar skills={skills} pin={pin} changed={changed} places={top} query={q} nameToken={naming} />;
  return (
    <aside className="side skills-side" aria-label="Abilities sidebar">
      <div className="side-head">
        <span className="side-title">Abilities</span>
        <span className="side-actions">{pin}</span>
      </div>
      {top}
    </aside>
  );
}

/** Abilities' page for every place but Skills (which has its own editor). */
export function ExtensionsPage({ place, onOpenApp }: { place: Exclude<ExtensionPlace, 'skills'>; onOpenApp?: (id: AppId) => void }) {
  const name = EXTENSION_PLACES.find((p) => p.id === place)?.name ?? 'Abilities';
  return (
    <section className="skills-page abl-page" aria-label={name}>
      <div className="abl-column">
        <h1 className="abl-title">{name}</h1>
        {place === 'apps' && <AppLibrary onOpenApp={onOpenApp} />}
        {place === 'connectors' && <Connectors />}
        {place === 'updates' && <Updates />}
      </div>
    </section>
  );
}

/**
 * The app library: every app Mobius has, by what it is for, each with what it does and one switch. Adding one puts it
 * in the switcher, the launcher and the sidebar; removing it takes it away and keeps its files, so adding it again
 * brings them back. An added app opens from its row.
 */
function AppLibrary({ onOpenApp }: { onOpenApp?: ((id: AppId) => void) | undefined }) {
  const preferences = usePreferences();
  const [q] = useAbilitiesQuery();
  const [problem, setProblem] = useState<string | null>(null);
  const change = async (id: AppId, add: boolean) => {
    setProblem(null);
    try { await preferences.set({ installedApps: withApp(id, add) }); } catch { setProblem('That could not be changed.'); }
  };
  const groups = APP_GROUPS.map((group) => ({ group, members: LIBRARY.filter((a) => a.group === group && appMatches(q, a)) })).filter((g) => g.members.length > 0);
  return (
    <>
      <p className="abl-lede">Add the apps you use. Removing one keeps its files: add it again and they are back.</p>
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {groups.length === 0 && <p className="abl-empty">No apps match “{q.trim()}”.</p>}
      {groups.map(({ group, members }) => (
        <section key={group} className="abl-group" aria-label={group}>
          <h2 className="abl-group-title">{group}</h2>
          <ul role="list" className="abl-list">
            {members.map((app) => {
              const added = isInstalled(app.id);
              const body = (
                <>
                  <svg viewBox="0 0 20 20" aria-hidden="true" className="ability-icon" style={{ background: `var(--app-${app.id})` }}>{APP_ICONS[app.id]}</svg>
                  <span className="abl-text">
                    <span className="abl-name">{app.name}</span>
                    {APP_PURPOSE[app.id] && <span className="abl-sub">{APP_PURPOSE[app.id]}</span>}
                  </span>
                </>
              );
              return (
                <li key={app.id} className="abl-row" data-added={added || undefined}>
                  {added && onOpenApp
                    ? <button type="button" className="abl-open" aria-label={`Open ${app.name}`} title={`Open ${app.name}`} onClick={() => onOpenApp(app.id)}>{body}</button>
                    : <span className="abl-open">{body}</span>}
                  <label className="switch-line abl-switch" title={added ? `Remove ${app.name} (its files are kept)` : `Add ${app.name}`}>
                    <input type="checkbox" role="switch" aria-label={app.name} checked={added} onChange={(e) => void change(app.id, e.target.checked)} />
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/** The MCP servers Mobius starts from mcp.json, and Mobius offered to other apps. */
function Connectors() {
  const api = window.mobius.extensions;
  const { status } = useConnectors();
  const [q] = useAbilitiesQuery();
  const none = status && status.running.length === 0 && status.failed.length === 0;
  const running = status?.running.filter((s) => matches(q, s)) ?? [];
  const failed = status?.failed.filter((f) => matches(q, f.server)) ?? [];
  return (
    <>
      <p className="abl-lede">Connectors give Mobius tools from other apps over MCP. Each one asks before it is used, as your approvals say.</p>
      <section className="abl-group" aria-label="Tools from other apps">
        <h2 className="abl-group-title">Tools from other apps</h2>
        {!api && <p className="abl-empty">Only the desktop app runs connectors.</p>}
        {status?.problem && <p className="field-error" role="alert">{status.problem}</p>}
        {none && <p className="abl-empty">No connectors yet. MCP servers listed in mcp.json in the data folder start when Mobius opens.</p>}
        {(running.length > 0 || failed.length > 0) && (
          <ul className="abl-list" role="list" aria-label="Connectors">
            {running.map((s) => (
              <li key={s} className="abl-row" aria-label={s}>
                <span className="abl-dot" data-state="on" aria-hidden="true" />
                <span className="abl-text"><span className="abl-name">{s}</span><span className="abl-sub">Connected</span></span>
              </li>
            ))}
            {failed.map((f) => (
              <li key={f.server} className="abl-row" aria-label={f.server}>
                <span className="abl-dot" data-state="failed" aria-hidden="true" />
                <span className="abl-text"><span className="abl-name">{f.server}</span><span className="abl-sub abl-error">Couldn’t start: {f.error}</span></span>
              </li>
            ))}
          </ul>
        )}
        {status && !none && running.length === 0 && failed.length === 0 && <p className="abl-empty">No connectors match “{q.trim()}”.</p>}
        {api && (
          <div className="abl-actions">
            <button type="button" className="btn" onClick={() => void window.mobius.app.openDataFolder()}>Open Data Folder</button>
            <span className="abl-note">Add a server to mcp.json there, then reopen Mobius.</span>
          </div>
        )}
      </section>
      <section className="abl-group" aria-label="Mobius for other apps">
        <h2 className="abl-group-title">Mobius for other apps</h2>
        <div className="abl-card"><OtherApps subpage="other-apps" highlight={null} /></div>
      </section>
    </>
  );
}

/** What is running, and Software Update, in the same grouped list as the rest of Abilities. */
function Updates() {
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const { info, check, restart } = useUpdates();
  useEffect(() => { void window.mobius.app.about().then(setAbout).catch(() => undefined); }, []);
  const busy = info.state === 'checking' || info.state === 'downloading';
  return (
    <>
      <section className="abl-group" aria-label="Software Update">
        <h2 className="abl-group-title">Software Update</h2>
        <ul className="abl-list" role="list">
          <li className="abl-row">
            <span className="abl-text"><span className="abl-name">{info.current ? `Mobius ${info.current}` : 'Mobius'}</span><span className="abl-sub" role="status" data-update-state={info.state}>{info.status}</span></span>
            {info.state === 'ready'
              ? <button type="button" className="btn primary" onClick={() => void restart()}>Restart to Install</button>
              : <button type="button" className="btn" disabled={info.state === 'off' || busy} onClick={() => void check()}>Check for Updates</button>}
          </li>
        </ul>
      </section>
      <section className="abl-group" aria-label="Installed">
        <h2 className="abl-group-title">Installed</h2>
        <table className="abl-list abl-table" aria-label="Versions">
          <tbody>
            <tr className="abl-row"><th scope="row" className="abl-name">Mobius</th><td>{about?.app ?? '…'}</td></tr>
            <tr className="abl-row"><th scope="row" className="abl-name">Core</th><td>{about?.core ? `${about.core.version} (protocol ${about.core.protocol})` : 'Not running'}</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
