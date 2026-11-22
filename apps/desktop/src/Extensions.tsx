import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectorStatus } from '@mobius/shared';
import { InstallDialog } from './Skills';
import type { SkillsState } from './useSkills';
import { APP_GROUPS, APPS, CORE_APPS, isInstalled, isListed, withApp, type AppId, type AppInfo } from './apps';
import { APP_ICONS } from './Rail';
import { usePreferences } from './usePreferences';
import { ContextMenu } from './ContextMenu';
import { FromMobius } from './FromMobius';
import { RowMark } from './RowMark';
import { AppSidebar, Menu, SidebarRow, SidebarSearch, SidebarSection, ToolbarControls, UndoToast } from './ui';
import { addressName, connectorDisplayName, connectorProblem, isConnectorName, splitArgs, suggestName } from './connector-form';
import { dateTimeLabel } from './dates';
import { EmptyState } from './EmptyState';
import './abilities.css';

/**
 * Store's categories, down its left panel: Apps (a grid of cards, each opening its own page), Skills and Connectors,
 * the tools that give Mobius more to work with. Adding anything starts from its place: Add on an app's card or page,
 * New skill in the panel's head, Add a connector in the toolbar.
 */
export type ExtensionPlace = 'apps' | 'skills' | 'connectors';
const PLACE_NAMES: Record<ExtensionPlace, string> = { apps: 'Apps', skills: 'Skills', connectors: 'Connectors' };
/** The title row's title: the open app's name on its page, otherwise Store (a skill that is open names itself). */
export const abilitiesTitle = (item: AppId | null): string => (item ? APPS.find((a) => a.id === item)?.name ?? 'Store' : 'Store');

/** The Settings page that holds an app's own options, for "Adjust in Settings". */
export type AdjustSection = 'browser' | 'mail' | 'calendar' | 'messages';
const ADJUST_IN: Partial<Record<AppId, AdjustSection>> = { browser: 'browser', mail: 'mail', calendar: 'calendar', messages: 'messages' };

/** What an app can reach, in plain words, for its page in Store. Every app reaches Mobius only when you ask. */
const APP_REACH: Partial<Record<AppId, string[]>> = {
  browser: ['The web, with its own history, favourites and downloads on this computer'],
  mail: ['The mail accounts you add in Settings › Accounts'],
  messages: ['The chat accounts you add in Settings › Accounts', 'Your own Mobius space, run on this computer'],
  calendar: ['The calendars you add in Settings › Accounts', 'Tasks with a due date'],
  research: ['The web, to search and read pages for a report'],
  code: ['Projects in your workspace, and git'],
  terminal: ['Commands in a folder of your workspace'],
};
const reachOf = (id: AppId): string[] => [...(APP_REACH[id] ?? ['Its own files in your workspace, on this computer']), 'Mobius, only when you ask it'];

/** One sentence on what each app is for, shown in the library under its name. */
const APP_PURPOSE: Partial<Record<AppId, string>> = {
  browser: 'A full web browser with tabs, favourites and downloads.',
  mail: 'Your mail on this computer, sorted, with drafts in your tone.',
  messages: 'Slack, Matrix, Teams and Telegram in one place, with a catch-up when you come back.',
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

/** Small signals between the shell and Abilities' own parts, which App.tsx does not hold. */
function signal<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => { value = next; listeners.forEach((l) => l()); },
    use: (): T => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => value),
  };
}
/** What is typed in the sidebar's search: it narrows the apps, the skills and the connectors. */
const query = signal('');
export function useAbilitiesQuery(): [string, (next: string) => void] { return [query.use(), query.set]; }
/** Each New skill (the sidebar head's New) opens the naming field in the Skills section. */
const newSkill = signal(0);
export const requestNewSkill = (): void => newSkill.set(newSkill.get() + 1);
/** Whether Add a connector's sheet is open. */
const addingConnector = signal(false);
/** The app whose page is open in Store's Apps; null shows the grid. */
const storeItem = signal<AppId | null>(null);
export const useStoreItem = (): AppId | null => storeItem.use();
export const openStoreItem = (id: AppId | null): void => storeItem.set(id);

const matches = (q: string, ...words: (string | undefined)[]) => { const t = q.trim().toLowerCase(); return t === '' || words.some((w) => w?.toLowerCase().includes(t)); };
/** Whether an app is found by the search: by its name, its other names or what it is for. */
export const appMatches = (q: string, app: AppInfo) => matches(q, app.name, app.also, APP_PURPOSE[app.id]);

/** The apps the library lists: every app that can be added, leaving out Mobius's own apps, which are always there. */
const LIBRARY = APPS.filter((a) => a.available && isListed(a) && !(CORE_APPS as readonly string[]).includes(a.id));

/** The added apps, from the preferences, so a change shows at once everywhere. */
function useInstalled(): { installed: AppInfo[]; available: AppInfo[]; change: (id: AppId, add: boolean) => Promise<boolean> } {
  const preferences = usePreferences();
  const list = preferences.value.installedApps;
  const added = (a: AppInfo) => (Array.isArray(list) ? list.includes(a.id) : isInstalled(a.id));
  const change = async (id: AppId, add: boolean) => {
    try { await preferences.set({ installedApps: withApp(id, add) }); return true; } catch { return false; }
  };
  return { installed: LIBRARY.filter(added), available: LIBRARY.filter((a) => !added(a)), change };
}

/** The connectors Mobius started, kept in one place so the sidebar's count, the toolbar and the page agree. */
const connectors = signal<ConnectorStatus | null>(null);
const loadConnectors = () => { void window.mobius.extensions?.connectors().then(connectors.set).catch(() => undefined); };
function useConnectors(): { status: ConnectorStatus | null; reload: () => void } {
  const status = connectors.use();
  // Servers start in the background: look now, and again once they have had a moment.
  useEffect(() => { loadConnectors(); const t = window.setTimeout(loadConnectors, 3000); return () => window.clearTimeout(t); }, []);
  return { status, reload: loadConnectors };
}
const connectorCount = (s: ConnectorStatus | null) => (s ? s.running.length + s.failed.length + (s.waiting?.length ?? 0) - (s.leaving?.length ?? 0) : 0);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The toolbar's grey line beside the title: how many there are in the place showing. */
export function AbilitiesSub({ place, skills }: { place: ExtensionPlace; skills: SkillsState }) {
  const { installed, available } = useInstalled();
  const { status } = useConnectors();
  const [q] = useAbilitiesQuery();
  // While searching, how many of them match: "4 of 21 apps".
  const of = (list: readonly AppInfo[]) => { const n = list.filter((a) => appMatches(q, a)).length; return `${n} of ${plural(list.length, 'app')}`; };
  const item = storeItem.use();
  if (place === 'apps' && item) return <>Store</>;
  if (place === 'apps') return <>{q.trim() ? of([...installed, ...available]) : `${installed.length} added${available.length ? ` · ${available.length} to add` : ''}`}</>;
  if (place === 'connectors') return <>{plural(connectorCount(status), 'connector')}</>;
  return skills.open ? <>{`Version ${skills.open.version}${skills.saved ? '' : ' · Saving…'}`}</> : <>{plural(skills.list.length, 'skill')}</>;
}

/** Abilities' sidebar: Search, then Apps (Installed, Available), Mobius (Skills, Connectors), the skills, From Mobius. */
export function ExtensionsSidebar({ place, onPlace, skills, pin, changed }: { place: ExtensionPlace; onPlace: (p: ExtensionPlace) => void; skills: SkillsState; pin?: ReactNode; changed?: ReadonlySet<string> }) {
  const [q, setQ] = useAbilitiesQuery();
  const { installed, available } = useInstalled();
  const { status } = useConnectors();
  const nameToken = newSkill.use();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  useEffect(() => { if (nameToken > 0) { setNaming(true); onPlace('skills'); } }, [nameToken]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async (e: FormEvent) => { e.preventDefault(); if (await skills.create(name.trim() || 'New skill', about)) { setNaming(false); setName(''); setAbout(''); onPlace('skills'); } };
  const shownSkills = skills.list.filter((s) => matches(q, s.name, s.description));
  const item = storeItem.use();
  const row = (p: ExtensionPlace, count: number, icon: ReactNode) => <SidebarRow label={PLACE_NAMES[p]} icon={<svg viewBox="0 0 20 20" aria-hidden="true" className="store-cat-icon">{icon}</svg>} {...(count ? { count } : {})} current={place === p && !(p === 'skills' && skills.open) && !(p === 'apps' && item)} onSelect={() => { onPlace(p); storeItem.set(null); if (p === 'skills') skills.close(); }} />;
  return (
    <AppSidebar label="Store">
      <SidebarSearch label="Search Store" value={q} onChange={setQ} />
      <SidebarSection title="Categories" action={pin}>
        {row('apps', installed.length + available.length, <><rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2" /><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2" /><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2" /><rect x="11" y="11" width="5.5" height="5.5" rx="1.2" /></>)}
        {row('skills', skills.available ? skills.list.length : 0, <path d="M10 3.5 11.8 8.2 16.5 10l-4.7 1.8L10 16.5l-1.8-4.7L3.5 10l4.7-1.8z" />)}
        {row('connectors', connectorCount(status), <><path d="M8 3.5v3M12 3.5v3M6.5 6.5h7v3a3.5 3.5 0 0 1-7 0z" /><path d="M10 13v3.5" /></>)}
      </SidebarSection>
      {(skills.list.length > 0 || naming) && (
        <SidebarSection title="Skills" action={<button type="button" className="strip-btn" aria-label="New skill" title="New skill (Ctrl+N)" onClick={() => setNaming(true)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg></button>}>
          {naming && (
            <li>
              <form className="skill-new" onSubmit={(e) => void create(e)}>
                <input autoFocus aria-label="Skill name" placeholder="Compare stays" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
                <input aria-label="When to use it" placeholder="When to use it, in one sentence" value={about} maxLength={300} onChange={(e) => setAbout(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
                <span className="skill-new-actions">
                  <button type="button" className="btn" onClick={() => setNaming(false)}>Cancel</button>
                  <button type="submit" className="btn primary">Create</button>
                </span>
              </form>
            </li>
          )}
          {shownSkills.map((s) => (
            <SidebarRow key={s.name} label={`/${s.name}`} current={place === 'skills' && skills.open?.name === s.name} proposed={changed?.has(s.name) === true} onSelect={() => { onPlace('skills'); void skills.openSkill(s.name); }}
              trail={changed?.has(s.name) ? <RowMark changed changedTitle="Changed by Mobius in its last turn" /> : undefined} />
          ))}
        </SidebarSection>
      )}
      <FromMobius items={skills.list.filter((s) => changed?.has(s.name)).map((s) => ({ key: s.name, name: `/${s.name}`, current: skills.open?.name === s.name, onOpen: () => { onPlace('skills'); void skills.openSkill(s.name); } }))} />
    </AppSidebar>
  );
}

/** Store's page for Apps (the grid, or one app's page) and Connectors (Skills has its own editor). */
export function ExtensionsPage({ place, onOpenApp, onAdjust }: { place: Exclude<ExtensionPlace, 'skills'>; onOpenApp?: (id: AppId) => void; /** Opens an app's own page in Settings. */ onAdjust?: (section: AdjustSection) => void }) {
  const item = storeItem.use();
  const open = place === 'apps' && item ? LIBRARY.find((a) => a.id === item) : undefined;
  return (
    <section className="skills-page abl-page" aria-label={open ? open.name : PLACE_NAMES[place]}>
      <div className="abl-scroll">{place === 'connectors' ? <Connectors /> : <AppLibrary item={open} onOpenApp={onOpenApp} onAdjust={onAdjust} />}</div>
    </section>
  );
}

/** Skills with none open: each skill as a plain row, its name and when it runs; a row opens it. */
export function SkillList({ skills }: { skills: SkillsState }) {
  const [q] = useAbilitiesQuery();
  const shown = skills.list.filter((s) => matches(q, s.name, s.description));
  return (
    <section className="skills-page abl-page" aria-label="Skills">
      {!skills.available && <p className="abl-empty">Skills are not available here.</p>}
      {skills.available && skills.list.length === 0 && <EmptyState title="No skills yet" line="A skill is steps Mobius follows when you ask for it." action={{ label: 'New skill', run: requestNewSkill }} />}
      {skills.list.length > 0 && shown.length === 0 && <p className="abl-empty">No skills match “{q.trim()}”.</p>}
      {shown.length > 0 && (
        <ul role="list" className="abl-rows" aria-label="Skills">
          {shown.map((s) => (
            <li key={s.name} className="abl-item">
              <button type="button" className="abl-main" aria-label={`Open /${s.name}`} onClick={() => void skills.openSkill(s.name)}>
                <svg viewBox="0 0 20 20" aria-hidden="true" className="abl-icon"><path d="M6 4.5h8M6 8.5h8M6 12.5h5" /><path d="M4 16h12" /></svg>
                <span className="abl-text"><span className="abl-name">/{s.name}</span><span className="abl-sub">{s.description || dateTimeLabel(s.modified)}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The toolbar's controls while Skills shows: New skill, Install a skill, and for an open skill Run and Delete. */
export function SkillsToolbar({ skills, onRun }: { skills: SkillsState; onRun: (name: string) => void }) {
  const [shared, setShared] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pick = () => picker.current?.click();

  const open = skills.open;
  return (
    <ToolbarControls label="Skills">
      {open && <button type="button" className="strip-btn abl-tool" onClick={() => onRun(open.name)} title={`Run /${open.name}`}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5.5v9l7-4.5z" /></svg><span>Run</span></button>}
      {open && <button type="button" className="strip-btn abl-tool" onClick={() => void skills.remove()} aria-label="Delete skill" title={`Delete /${open.name}`}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" /></svg></button>}
      <button type="button" className="strip-btn abl-tool" onClick={pick} disabled={!skills.available} title="Install a skill from a file"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v8M6.5 8.5 10 12l3.5-3.5M4.5 13.5v2h11v-2" /></svg><span>Install a skill…</span></button>
      <input ref={picker} type="file" accept=".md,text/markdown,text/plain" hidden aria-label="Choose a SKILL.md" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void f.text().then(setShared); }} />
      {shared !== null && <InstallDialog text={shared} skills={skills} onClose={() => setShared(null)} />}
    </ToolbarControls>
  );
}

function MoreGlyph() {
  return <svg viewBox="0 0 20 20" aria-hidden="true" className="abl-more-glyph"><circle cx="5" cy="10" r="1.3" /><circle cx="10" cy="10" r="1.3" /><circle cx="15" cy="10" r="1.3" /></svg>;
}

/** What was just done, and how to take it back, for the one UndoToast at the foot of the page. */
interface Undoable { text: string; undo: () => void }
function useUndo(): [Undoable | null, (u: Undoable | null) => void] {
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  useEffect(() => { if (!undoable) return undefined; const t = window.setTimeout(() => setUndoable(null), 10_000); return () => window.clearTimeout(t); }, [undoable]);
  return [undoable, setUndoable];
}

/**
 * The app library, as a grid of cards by group: each card opens the app's page; an added app opens from its Open and
 * is removed from its ⋯ menu (its files are kept, and Undo puts it back); one not added yet has Add.
 */
function AppLibrary({ item, onOpenApp, onAdjust }: { item: AppInfo | undefined; onOpenApp?: ((id: AppId) => void) | undefined; onAdjust?: ((section: AdjustSection) => void) | undefined }) {
  const { installed, change } = useInstalled();
  const [q] = useAbilitiesQuery();
  const [problem, setProblem] = useState<string | null>(null);
  const [undoable, setUndoable] = useUndo();
  const [menu, setMenu] = useState<{ app: AppInfo; x: number; y: number } | null>(null);
  const added = (app: AppInfo) => installed.some((a) => a.id === app.id);
  const list = LIBRARY.filter((a) => appMatches(q, a));
  const groups = APP_GROUPS.map((group) => ({ group, members: list.filter((a) => a.group === group) })).filter((g) => g.members.length > 0);
  const set = async (app: AppInfo, add: boolean) => {
    setProblem(null);
    if (!(await change(app.id, add))) { setProblem('That could not be changed.'); return; }
    setUndoable({ text: add ? `Added ${app.name}` : `Removed ${app.name}. Its files are kept.`, undo: () => { void change(app.id, !add); setUndoable(null); } });
  };
  const adjust = (app: AppInfo) => { const at = ADJUST_IN[app.id]; return at && onAdjust ? () => onAdjust(at) : undefined; };
  const entries = (app: AppInfo) => [
    { label: 'Open', keys: 'Enter', run: () => onOpenApp?.(app.id), disabled: !onOpenApp },
    ...(adjust(app) ? [{ label: 'Adjust in Settings', run: adjust(app)! }] : []),
    { label: 'Remove', keys: 'Delete', danger: true, separated: true, run: () => void set(app, false) },
  ];
  const icon = (app: AppInfo, size = 20) => <svg viewBox="0 0 20 20" aria-hidden="true" className="abl-icon" style={{ width: size, height: size }}>{APP_ICONS[app.id]}</svg>;
  const more = (app: AppInfo) => <Menu label={`${app.name} actions`} align="end" entries={entries(app)} trigger={<button type="button" className="strip-btn abl-more" aria-label={`More for ${app.name}`} title="More actions"><MoreGlyph /></button>} />;
  const toast = (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} label={menu.app.name} onClose={() => setMenu(null)} items={entries(menu.app)} />}
      {undoable && <UndoToast text={undoable.text} onUndo={undoable.undo} onDismiss={() => setUndoable(null)} />}
    </>
  );
  if (item) {
    const on = added(item);
    const fix = adjust(item);
    return (
      <article className="store-item" aria-label={item.name}>
        <button type="button" className="store-back" onClick={() => storeItem.set(null)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 5 7 10l5 5" /></svg>Apps</button>
        <header className="store-item-head">
          <span className="store-item-icon">{icon(item, 32)}</span>
          <span className="store-item-title">
            <h1>{item.name}</h1>
            <span className="store-item-group">{item.group}</span>
          </span>
          <span className="store-item-actions">
            {on
              ? <>{onOpenApp && <button type="button" className="btn primary" aria-label={`Open ${item.name}`} onClick={() => onOpenApp(item.id)}>Open</button>}{more(item)}</>
              : <button type="button" className="btn primary" aria-label={`Add ${item.name}`} onClick={() => void set(item, true)}>Add</button>}
          </span>
        </header>
        {problem && <p className="field-error abl-problem" role="alert">{problem}</p>}
        <p className="store-item-about">{APP_PURPOSE[item.id]}</p>
        {on && <p className="store-item-state">Added{fix && <> · <button type="button" className="store-link" onClick={fix}>Adjust in Settings</button></>}</p>}
        <section className="store-item-section" aria-label="What it can reach">
          <h2>What it can reach</h2>
          <ul>{reachOf(item.id).map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
        {toast}
      </article>
    );
  }
  return (
    <>
      {problem && <p className="field-error abl-problem" role="alert">{problem}</p>}
      {list.length === 0 && <p className="abl-empty">{q.trim() ? `No apps match “${q.trim()}”.` : 'No apps to show.'}</p>}
      {groups.map(({ group, members }) => (
        <section key={group} className="store-group" aria-label={group}>
          <h2 className="store-group-title">{group}</h2>
          <ul role="list" className="store-grid">
            {members.map((app) => {
              const on = added(app);
              return (
                <li key={app.id} className="store-card" data-added={on || undefined}
                  onKeyDown={(e) => { if (on && e.key === 'Delete' && e.target === e.currentTarget.querySelector('.store-card-main')) { e.preventDefault(); void set(app, false); } }}
                  onContextMenu={(e) => { if (!on) return; e.preventDefault(); setMenu({ app, x: e.clientX, y: e.clientY }); }}>
                  <button type="button" className="store-card-main" aria-label={`About ${app.name}`} onClick={() => storeItem.set(app.id)}>
                    {icon(app, 22)}
                    <span className="store-card-name">{app.name}</span>
                    <span className="store-card-line">{APP_PURPOSE[app.id]}</span>
                  </button>
                  <span className="store-card-foot">
                    {on
                      ? <><span className="store-card-state">Added</span>{onOpenApp && <button type="button" className="btn" aria-label={`Open ${app.name}`} onClick={() => onOpenApp(app.id)}>Open</button>}{more(app)}</>
                      : <button type="button" className="btn abl-add" aria-label={`Add ${app.name}`} onClick={() => void set(app, true)}>Add</button>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {toast}
    </>
  );
}

/** Two grey rows while the connectors load: no spinner in content. */
function ConnectorsLoading() {
  return (
    <ul className="abl-rows abl-loading" role="list" aria-label="Loading connectors" aria-busy="true">
      {[40, 56].map((w) => (
        <li key={w} className="abl-item"><span className="abl-main"><span className="abl-bar abl-bar-icon" /><span className="abl-text"><span className="abl-bar" style={{ width: `${w}%` }} /><span className="abl-bar" style={{ width: `${w - 16}%` }} /></span></span></li>
      ))}
    </ul>
  );
}

/** The MCP servers Mobius starts from mcp.json, as plain rows: what each is doing, and Remove in its ⋯ menu. */
function Connectors() {
  const api = window.mobius.extensions;
  const { status, reload } = useConnectors();
  const [q] = useAbilitiesQuery();
  const adding = addingConnector.use();
  const [problem, setProblem] = useState<string | null>(null);
  const [undoable, setUndoable] = useUndo();
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  // The connector being started now: its row says so until the server answers (up to 20 seconds).
  const [starting, setStarting] = useState<string | null>(null);
  const start = async (name: string) => {
    setProblem(null);
    setStarting(name);
    const done = await api?.startConnector?.(name).catch(() => null);
    setStarting(null);
    if (done?.status) connectors.set(done.status);
    else reload();
    if (!done) setProblem('That connector could not be started.');
  };
  // A connector at an address that asked for a sign-in: the page opens in the browser, and the row says it waits.
  const signIn = async (name: string) => {
    setProblem(null);
    const done = await api?.connectorSignIn?.(name).catch(() => null);
    if (!done || !done.ok) { setProblem(done && !done.ok ? done.error : 'The sign-in could not start.'); return; }
    connectors.set(done.status);
    void window.mobius.browser.open(done.url);
  };
  useEffect(() => api?.onSignIn?.((done) => {
    reload();
    if (!done.ok) setProblem(`${connectorDisplayName(done.server)}: ${done.message}`);
  }), [api, reload]);
  const leaving = new Set(status?.leaving ?? []);
  const rows: { name: string; state: 'on' | 'failed' | 'waiting' | 'signin'; error?: string; signingIn?: boolean }[] = [
    ...(status?.running ?? []).map((name) => ({ name, state: 'on' as const })),
    ...(status?.failed ?? []).map((f) => (f.signIn ? { name: f.server, state: 'signin' as const, signingIn: f.signingIn ?? false } : { name: f.server, state: 'failed' as const, error: f.error })),
    ...(status?.waiting ?? []).map((name) => ({ name, state: 'waiting' as const })),
  ].filter((r) => !leaving.has(r.name));
  const shown = rows.filter((r) => matches(q, r.name));
  const remove = async (name: string) => {
    setProblem(null);
    const done = await api?.removeConnector?.(name).catch(() => null);
    if (!done || !done.ok) { setProblem(done && !done.ok ? done.error : 'That connector could not be removed.'); return; }
    reload();
    const was = done.removed;
    setUndoable({
      text: `Removed ${name}`,
      undo: () => {
        setUndoable(null);
        if (!was) return;
        void api?.addConnector?.({ name, command: was.url ?? was.command ?? '', args: was.args ?? [], env: was.env ?? {} }).then((back) => { if (back && !back.ok) setProblem(back.error); reload(); });
      },
    });
  };
  const sub = (r: (typeof rows)[number]) => (starting === r.name ? 'Starting…' : r.state === 'signin' ? (r.signingIn ? 'Waiting for you to sign in, in the browser…' : 'Sign in to use it') : r.state === 'waiting' ? 'Not started' : r.state === 'failed' ? `Couldn’t start: ${connectorProblem(r.error)}` : 'Connected');
  // Start it now (one added by hand in mcp.json), again after it failed, or restart one that runs. Remove stops it.
  const startLabel = (state: (typeof rows)[number]['state']) => (state === 'on' ? 'Restart' : state === 'failed' || state === 'signin' ? 'Start again' : 'Start now');
  const entries = (name: string) => {
    const state = rows.find((r) => r.name === name)?.state ?? 'waiting';
    return [
      ...(state === 'signin' && api?.connectorSignIn ? [{ label: 'Sign in…', run: () => void signIn(name) }] : []),
      ...(api?.startConnector ? [{ label: startLabel(state), disabled: starting !== null, run: () => void start(name) }] : []),
      { label: 'Remove', keys: 'Delete', danger: true, separated: true, run: () => void remove(name) },
    ];
  };
  return (
    <>
      {api?.addConnector && (
        <ToolbarControls label="Connectors">
          <button type="button" className="strip-btn abl-tool" onClick={() => addingConnector.set(true)} title="Add a connector"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg><span>Add a connector…</span></button>
        </ToolbarControls>
      )}
      {!api && <p className="abl-empty">Only the desktop app runs connectors.</p>}
      {status?.problem && <p className="field-error abl-problem" role="alert">{status.problem}</p>}
      {problem && <p className="field-error abl-problem" role="alert">{problem}</p>}
      {api && !status && <ConnectorsLoading />}
      {api && status && rows.length === 0 && <EmptyState title="No connectors yet" line="A connector gives Mobius another app’s tools." {...(api.addConnector ? { action: { label: 'Add a connector…', run: () => addingConnector.set(true) } } : {})} />}
      {rows.length > 0 && shown.length === 0 && <p className="abl-empty">No connectors match “{q.trim()}”.</p>}
      {shown.length > 0 && (
        <ul className="abl-rows" role="list" aria-label="Connectors">
          {shown.map((r) => (
            <li key={r.name} className="abl-item" aria-label={r.name} tabIndex={api?.removeConnector ? 0 : undefined} onKeyDown={(e) => { if (e.key === 'Delete' && e.target === e.currentTarget && api?.removeConnector) { e.preventDefault(); void remove(r.name); } }} onContextMenu={(e) => { if (!api?.removeConnector) return; e.preventDefault(); setMenu({ name: r.name, x: e.clientX, y: e.clientY }); }}>
              <span className="abl-main">
                <span className="abl-icon-wrap"><svg viewBox="0 0 20 20" aria-hidden="true" className="abl-icon"><path d="M8 3.5v3M12 3.5v3M6.5 6.5h7v3a3.5 3.5 0 0 1-7 0z" /><path d="M10 13v3.5" /></svg>{(r.state !== 'on' || starting === r.name) && <span className="abl-dot" data-state={starting === r.name || r.state === 'signin' ? 'waiting' : r.state} aria-hidden="true" />}</span>
                <span className="abl-text"><span className="abl-name" title={connectorDisplayName(r.name) === r.name ? undefined : r.name}>{connectorDisplayName(r.name)}</span><span className={r.state === 'failed' && starting !== r.name ? 'abl-sub abl-error' : 'abl-sub'}>{sub(r)}</span></span>
              </span>
              {r.state === 'signin' && api?.connectorSignIn && <button type="button" className="btn" onClick={() => void signIn(r.name)}>{r.signingIn ? 'Open sign-in again' : 'Sign in…'}</button>}
              {api?.removeConnector && <Menu label={`${r.name} actions`} align="end" entries={entries(r.name)} trigger={<button type="button" className="strip-btn abl-more" aria-label={`More for ${r.name}`} title="More actions"><MoreGlyph /></button>} />}
            </li>
          ))}
        </ul>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} label={menu.name} onClose={() => setMenu(null)} items={entries(menu.name)} />}
      {adding && <AddConnectorSheet onClose={() => addingConnector.set(false)} onAdded={reload} />}
      {undoable && <UndoToast text={undoable.text} onUndo={undoable.undo} onDismiss={() => setUndoable(null)} />}
    </>
  );
}

/**
 * Add a Connector: the server's command, its arguments and any keys it needs, written to mcp.json for you and started
 * at once (one that cannot start is still saved, and its row says why); editing the file yourself stays one click away.
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
  // An address is a connector over HTTP: no arguments or keys; it signs in instead, if it asks.
  const remote = /^https?:\/\//i.test(command.trim());
  const args = remote ? [] : splitArgs(argLine);
  const shownName = named ? name : remote ? addressName(command) : suggestName(command, args);
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
    const env = remote ? {} : Object.fromEntries(keys.filter((k) => k.key.trim() !== '').map((k) => [k.key.trim(), k.value]));
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
        <p className="camera-note">A connector is an MCP server: it gives Mobius tools from another app, such as GitHub or Linear. Its maker’s page gives the command that runs it, or its address on the web.</p>
        <div className="abl-fields settings-card">
          <label className="abl-field"><span>Command or address</span><input autoFocus aria-label="Command or address" placeholder="npx, or https://…" value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} /></label>
          {!remote && <label className="abl-field"><span>Arguments</span><input aria-label="Arguments" placeholder="-y @modelcontextprotocol/server-github" value={argLine} onChange={(e) => setArgLine(e.target.value)} spellCheck={false} /></label>}
          <label className="abl-field">
            <span>Name</span>
            <input aria-label="Name" placeholder="github" value={shownName} maxLength={24} aria-invalid={shownName !== '' && !nameOk} onChange={(e) => { setNamed(true); setName(e.target.value); }} spellCheck={false} />
          </label>
        </div>
        {shownName !== '' && !nameOk && <p className="field-error">Use lowercase letters, digits and _, starting with a letter.</p>}
        {remote ? <p className="camera-note">If it asks you to sign in, its row offers Sign in, and the sign-in is kept in this computer’s secret store.</p> : <div className="abl-keys" role="group" aria-label="Keys">
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
        </div>}
        <p className="camera-note">It starts as soon as it is added, and each of its tools asks before it is used.</p>
        {problem && <p className="field-error" role="alert">{problem}</p>}
        <div className="camera-actions">
          <button type="button" className="btn abl-link" onClick={() => void window.mobius.app.openDataFolder()}>Edit mcp.json yourself…</button>
          <span className="abl-spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!ready}>{saving ? 'Starting…' : 'Add'}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
