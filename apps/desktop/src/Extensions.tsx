import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectorStatus } from '@mobius/shared';
import { InstallDialog, SkillsSidebar } from './Skills';
import type { SkillsState } from './useSkills';
import { OtherApps } from './settings/sections';
import { APP_GROUPS, APPS, CORE_APPS, isInstalled, withApp, type AppId, type AppInfo } from './apps';
import { APP_ICONS } from './Rail';
import { usePreferences } from './usePreferences';
import { ContextMenu } from './ContextMenu';
import { isConnectorName, splitArgs, suggestName } from './connector-form';
import './abilities.css';

/**
 * The places in Abilities: the apps you add, and what gives Mobius more to work with, in one app. Plugins, and updates
 * to skills and connectors, come back as places once there are some (Mobius's own updates live in Settings); adding anything starts from the Add menu at the top of the sidebar.
 */
export type ExtensionPlace = 'apps' | 'skills' | 'connectors';
export const EXTENSION_PLACES: readonly { id: ExtensionPlace; name: string; tint: string; icon: ReactNode }[] = [
  { id: 'apps', name: 'Apps', tint: 'var(--app-skills, #8e8e93)', icon: <><rect x="4" y="4" width="5" height="5" rx="1.4" /><rect x="11" y="4" width="5" height="5" rx="1.4" /><rect x="4" y="11" width="5" height="5" rx="1.4" /><rect x="11" y="11" width="5" height="5" rx="1.4" /></> },
  { id: 'skills', name: 'Skills', tint: '#5e5ce6', icon: <><path d="M6 5.5h8M6 10h8M6 14.5h5" /><path d="M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01" /></> },
  { id: 'connectors', name: 'Connectors', tint: '#30b0c7', icon: <><path d="M8 4v3M12 4v3M6.5 7h7v3a3.5 3.5 0 0 1-7 0z" /><path d="M10 13.5V16" /></> },
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

/** Whether the Add a Connector sheet is open: Add in the sidebar and the Connectors page both open it. */
let addingConnector = false;
const sheetListeners = new Set<() => void>();
const setAddingConnector = (next: boolean) => { addingConnector = next; sheetListeners.forEach((l) => l()); };
function useAddingConnector(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore((l) => { sheetListeners.add(l); return () => sheetListeners.delete(l); }, () => addingConnector);
  return [value, setAddingConnector];
}

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

/** The connectors Mobius started, kept in one place so the sidebar's count and the page agree after a change. */
let connectorStatus: ConnectorStatus | null = null;
const connectorListeners = new Set<() => void>();
const loadConnectors = () => {
  void window.mobius.extensions?.connectors().then((next) => { connectorStatus = next; connectorListeners.forEach((l) => l()); }).catch(() => undefined);
};
function useConnectors(): { status: ConnectorStatus | null; reload: () => void } {
  const status = useSyncExternalStore((l) => { connectorListeners.add(l); return () => connectorListeners.delete(l); }, () => connectorStatus);
  // Servers start in the background: look now, and again once they have had a moment.
  useEffect(() => { loadConnectors(); const t = window.setTimeout(loadConnectors, 3000); return () => window.clearTimeout(t); }, []);
  return { status, reload: loadConnectors };
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
    connectors: status ? status.running.length + status.failed.length + (status.waiting?.length ?? 0) - (status.leaving?.length ?? 0) : null,
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
        <svg viewBox="0 0 20 20" aria-hidden="true" className="abl-chevron"><path d="m7 8.5 3 3 3-3" /></svg>
      </button>
      <input ref={picker} type="file" accept=".md,text/markdown,text/plain" hidden aria-label="Choose a SKILL.md" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void f.text().then(setShared); }} />
      {shared !== null && <InstallDialog text={shared} skills={skills} onClose={() => { setShared(null); if (skills.open) onPlace('skills'); }} />}
      {menu && createPortal(
        <ContextMenu x={menu.x} y={menu.y} label="Add" onClose={() => setMenu(null)} items={[
          { label: 'Add an app…', run: () => { setQuery(''); onPlace('apps'); } },
          { label: 'New skill', run: onNewSkill, separated: true, disabled: !skills.available },
          { label: 'Install a skill…', run: () => picker.current?.click(), disabled: !skills.available },
          { label: 'Add a connector…', run: () => { onPlace('connectors'); setAddingConnector(true); }, separated: true },
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
          <ul role="list" className="abl-list settings-card">
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
  const { status, reload } = useConnectors();
  const [q] = useAbilitiesQuery();
  const [adding, setAdding] = useAddingConnector();
  const [details, setDetails] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const leaving = new Set(status?.leaving ?? []);
  const rows: { name: string; state: 'on' | 'failed' | 'waiting'; error?: string }[] = [
    ...(status?.running ?? []).map((name) => ({ name, state: 'on' as const })),
    ...(status?.failed ?? []).map((f) => ({ name: f.server, state: 'failed' as const, error: f.error })),
    ...(status?.waiting ?? []).map((name) => ({ name, state: 'waiting' as const })),
  ];
  const shown = rows.filter((r) => matches(q, r.name));
  const remove = async (name: string) => {
    setProblem(null);
    const done = await api?.removeConnector?.(name).catch(() => null);
    if (!done || !done.ok) { setProblem(done && !done.ok ? done.error : 'That connector could not be removed.'); return; }
    setRemoving(null);
    reload();
  };
  const sub = (r: (typeof rows)[number]) => {
    if (leaving.has(r.name)) return 'Removed. It stops when Mobius reopens.';
    if (r.state === 'waiting') return 'Added. It starts when Mobius reopens.';
    if (r.state === 'failed') return 'Couldn’t start';
    return 'Connected';
  };
  return (
    <>
      <p className="abl-lede">Connectors give Mobius tools from other apps over MCP. Each one asks before it is used, as your approvals say.</p>
      <section className="abl-group" aria-label="Tools from other apps">
        <div className="abl-group-head">
          <h2 className="abl-group-title">Tools from other apps</h2>
          <button type="button" className="btn" onClick={() => setAdding(true)}>Add a connector…</button>
        </div>
        {!api && <p className="abl-empty settings-card">Only the desktop app runs connectors.</p>}
        {status?.problem && <p className="field-error" role="alert">{status.problem}</p>}
        {problem && <p className="field-error" role="alert">{problem}</p>}
        {status && rows.length === 0 && <p className="abl-empty settings-card">No connectors yet. Add one to give Mobius tools from another app.</p>}
        {shown.length > 0 && (
          <ul className="abl-list settings-card" role="list" aria-label="Connectors">
            {shown.map((r) => (
              <li
                key={r.name}
                className="abl-row abl-row-wrap"
                aria-label={r.name}
                tabIndex={0}
                onContextMenu={(e) => { if (leaving.has(r.name) || !api?.removeConnector) return; e.preventDefault(); setMenu({ name: r.name, x: e.clientX, y: e.clientY }); }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget || leaving.has(r.name) || !api?.removeConnector) return;
                  if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') { e.preventDefault(); const b = e.currentTarget.getBoundingClientRect(); setMenu({ name: r.name, x: b.right - 180, y: b.bottom - 6 }); }
                }}
              >
                <span className="abl-dot" data-state={leaving.has(r.name) ? 'waiting' : r.state} aria-hidden="true" />
                <span className="abl-text"><span className="abl-name">{r.name}</span><span className={r.state === 'failed' && !leaving.has(r.name) ? 'abl-sub abl-error' : 'abl-sub'}>{sub(r)}</span></span>
                {r.state === 'failed' && !leaving.has(r.name) && (
                  <button type="button" className="btn" aria-expanded={details === r.name} onClick={() => setDetails((d) => (d === r.name ? null : r.name))}>{details === r.name ? 'Hide details' : 'Show details'}</button>
                )}
                {!leaving.has(r.name) && api?.removeConnector && removing !== r.name && (
                  <button type="button" className="strip-btn abl-more" aria-label={`More for ${r.name}`} title="More" aria-haspopup="menu" onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); setMenu({ name: r.name, x: b.left, y: b.bottom + 4 }); }}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="1.3" /><circle cx="10" cy="10" r="1.3" /><circle cx="15" cy="10" r="1.3" /></svg>
                  </button>
                )}
                {removing === r.name && (
                  <span className="abl-confirm" role="group" aria-label={`Remove ${r.name}?`}>
                    <span className="abl-note" title="It is taken out of mcp.json in the data folder.">Remove {r.name}?</span>
                    <button type="button" className="btn" onClick={() => setRemoving(null)}>Cancel</button>
                    <button type="button" className="btn danger" onClick={() => void remove(r.name)}>Remove</button>
                  </span>
                )}
                {details === r.name && r.error && <p className="abl-detail">{r.error}. Fix its entry in mcp.json, then reopen Mobius to start it again.</p>}
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && shown.length === 0 && <p className="abl-empty settings-card">No connectors match “{q.trim()}”.</p>}
      </section>
      <section className="abl-group" aria-label="Mobius for other apps">
        <h2 className="abl-group-title">Mobius for other apps</h2>
        <div className="settings-card abl-card"><OtherApps subpage="other-apps" highlight={null} /></div>
      </section>
      {adding && <AddConnectorSheet onClose={() => setAdding(false)} onAdded={reload} />}
      {menu && createPortal(
        <ContextMenu x={menu.x} y={menu.y} label={menu.name} onClose={() => setMenu(null)} items={[
          { label: 'Remove…', danger: true, run: () => setRemoving(menu.name) },
        ]} />,
        document.body,
      )}
    </>
  );
}

/**
 * Add a Connector: the server's command, its arguments and any keys it needs, written to mcp.json for you. The
 * connector starts the next time Mobius opens; editing the file yourself stays one click away.
 */
function AddConnectorSheet({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const api = window.mobius.extensions;
  const [command, setCommand] = useState('');
  const [argLine, setArgLine] = useState('');
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);
  const [keys, setKeys] = useState<{ key: string; value: string }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const args = splitArgs(argLine);
  const shownName = named ? name : suggestName(command, args);
  const nameOk = isConnectorName(shownName);
  const keysOk = keys.every((k) => k.key.trim() === '' || /^[A-Za-z_][A-Za-z0-9_]*$/.test(k.key.trim()));
  const ready = command.trim() !== '' && nameOk && keysOk && !saving;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !api?.addConnector) return;
    setSaving(true);
    setProblem(null);
    const env = Object.fromEntries(keys.filter((k) => k.key.trim() !== '').map((k) => [k.key.trim(), k.value]));
    const done = await api.addConnector({ name: shownName, command: command.trim(), args, env }).catch(() => null);
    setSaving(false);
    if (!done || !done.ok) { setProblem(done && !done.ok ? done.error : 'The connector could not be added.'); return; }
    onAdded();
    onClose();
  };
  return createPortal(
    <div className="cal-modal-layer" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="camera-dialog abl-sheet" role="dialog" aria-modal="true" aria-label="Add a connector" onSubmit={(e) => void submit(e)}>
        <h2>Add a connector</h2>
        <p className="camera-note">A connector is an MCP server: a small program that gives Mobius tools from another app, such as GitHub or Linear. Its maker’s page gives the command that runs it.</p>
        <div className="abl-fields settings-card">
          <label className="abl-field"><span>Command</span><input autoFocus aria-label="Command" placeholder="npx" value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} /></label>
          <label className="abl-field"><span>Arguments</span><input aria-label="Arguments" placeholder="-y @modelcontextprotocol/server-github" value={argLine} onChange={(e) => setArgLine(e.target.value)} spellCheck={false} /></label>
          <label className="abl-field">
            <span>Name</span>
            <input aria-label="Name" placeholder="github" value={shownName} maxLength={24} aria-invalid={shownName !== '' && !nameOk} onChange={(e) => { setNamed(true); setName(e.target.value); }} spellCheck={false} />
          </label>
        </div>
        {shownName !== '' && !nameOk && <p className="field-error">Use lowercase letters, digits and _, starting with a letter.</p>}
        <div className="abl-keys" role="group" aria-label="Keys">
          <div className="abl-group-head"><span className="abl-group-title">Keys</span><button type="button" className="btn" onClick={() => setKeys((k) => [...k, { key: '', value: '' }])}>Add a key</button></div>
          {keys.length === 0 ? <p className="abl-note abl-keys-empty">Some servers need a key or token, such as GITHUB_TOKEN, named as the server’s page says. They are kept in mcp.json on this computer.</p> : (
            <ul className="abl-list settings-card" role="list">
              {keys.map((k, i) => (
                <li key={i} className="abl-row abl-key">
                  <input aria-label={`Key ${i + 1} name`} placeholder="Name" value={k.key} spellCheck={false} onChange={(e) => setKeys((all) => all.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                  <input aria-label={`Key ${i + 1} value`} type="password" placeholder="Value" value={k.value} onChange={(e) => setKeys((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <button type="button" className="strip-btn" aria-label="Remove key" title="Remove key" onClick={() => setKeys((all) => all.filter((_, j) => j !== i))}>×</button>
                </li>
              ))}
            </ul>
          )}
          {!keysOk && <p className="field-error">A key’s name uses letters, digits and _, such as API_KEY.</p>}
        </div>
        <p className="camera-note">It starts the next time Mobius opens, and each of its tools asks before it is used.</p>
        {problem && <p className="field-error" role="alert">{problem}</p>}
        <div className="camera-actions">
          <button type="button" className="btn abl-link" onClick={() => void window.mobius.app.openDataFolder()}>Edit mcp.json yourself…</button>
          <span className="abl-spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!ready}>Add</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
