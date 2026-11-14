import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectorStatus } from '@mobius/shared';
import { InstallDialog } from './Skills';
import type { SkillsState } from './useSkills';
import { APP_GROUPS, APPS, CORE_APPS, isInstalled, withApp, type AppId, type AppInfo } from './apps';
import { APP_ICONS } from './Rail';
import { usePreferences } from './usePreferences';
import { ContextMenu } from './ContextMenu';
import { FromMobius } from './FromMobius';
import { RowMark } from './RowMark';
import { AppSidebar, Menu, SidebarRow, SidebarSearch, SidebarSection, ToolbarControls, UndoToast } from './ui';
import { isConnectorName, splitArgs, suggestName } from './connector-form';
import { dateTimeLabel } from './dates';
import { EmptyState } from './EmptyState';
import './abilities.css';

/**
 * The places in Abilities, as plain rows in its sidebar: the apps that are installed and the ones that can be added,
 * then the skills and connectors that give Mobius more to work with. Adding anything starts from its place: Add on an
 * available app, New skill in the sidebar's head, Add a connector in the toolbar.
 */
export type ExtensionPlace = 'installed' | 'available' | 'skills' | 'connectors';
const PLACE_NAMES: Record<ExtensionPlace, string> = { installed: 'Installed', available: 'Available', skills: 'Skills', connectors: 'Connectors' };
/** The toolbar's title for a place (a skill that is open names itself). */
export const abilitiesTitle = (place: ExtensionPlace): string => PLACE_NAMES[place];

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

const matches = (q: string, ...words: (string | undefined)[]) => { const t = q.trim().toLowerCase(); return t === '' || words.some((w) => w?.toLowerCase().includes(t)); };
/** Whether an app is found by the search: by its name, its other names or what it is for. */
export const appMatches = (q: string, app: AppInfo) => matches(q, app.name, app.also, APP_PURPOSE[app.id]);

/** The apps the library lists: every app that can be added, leaving out Mobius's own apps, which are always there. */
const LIBRARY = APPS.filter((a) => a.available && !(CORE_APPS as readonly string[]).includes(a.id));

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
  if (place === 'installed') return <>{plural(installed.length, 'app')}</>;
  if (place === 'available') return <>{available.length === 0 ? 'Every app is installed' : plural(available.length, 'app')}</>;
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
  const row = (p: ExtensionPlace, count: number) => <SidebarRow label={PLACE_NAMES[p]} {...(count ? { count } : {})} current={place === p && !(p === 'skills' && skills.open)} onSelect={() => { onPlace(p); if (p === 'skills') skills.close(); }} />;
  return (
    <AppSidebar label="Abilities sidebar">
      <SidebarSearch label="Search abilities" value={q} onChange={setQ} />
      <SidebarSection title="Apps" action={pin}>
        {row('installed', installed.length)}
        {row('available', available.length)}
      </SidebarSection>
      <SidebarSection title="Tools">
        {row('skills', skills.available ? skills.list.length : 0)}
        {row('connectors', connectorCount(status))}
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

/** Abilities' page for Installed, Available and Connectors (Skills has its own editor). */
export function ExtensionsPage({ place, onOpenApp }: { place: Exclude<ExtensionPlace, 'skills'>; onOpenApp?: (id: AppId) => void }) {
  return (
    <section className="skills-page abl-page" aria-label={PLACE_NAMES[place]}>
      <div className="abl-scroll">{place === 'connectors' ? <Connectors /> : <AppLibrary which={place} onOpenApp={onOpenApp} />}</div>
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
 * The app library, as plain rows: an installed app opens from its row and is removed from its ⋯ menu (its files are
 * kept, and Undo puts it back); an available app has Add.
 */
function AppLibrary({ which, onOpenApp }: { which: 'installed' | 'available'; onOpenApp?: ((id: AppId) => void) | undefined }) {
  const { installed, available, change } = useInstalled();
  const [q] = useAbilitiesQuery();
  const [problem, setProblem] = useState<string | null>(null);
  const [undoable, setUndoable] = useUndo();
  const [menu, setMenu] = useState<{ app: AppInfo; x: number; y: number } | null>(null);
  const list = (which === 'installed' ? installed : available).filter((a) => appMatches(q, a));
  const groups = APP_GROUPS.map((group) => ({ group, members: list.filter((a) => a.group === group) })).filter((g) => g.members.length > 0);
  const set = async (app: AppInfo, add: boolean) => {
    setProblem(null);
    if (!(await change(app.id, add))) { setProblem('That could not be changed.'); return; }
    setUndoable({ text: add ? `Added ${app.name}` : `Removed ${app.name}. Its files are kept.`, undo: () => { void change(app.id, !add); setUndoable(null); } });
  };
  const entries = (app: AppInfo) => [
    { label: 'Open', keys: 'Enter', run: () => onOpenApp?.(app.id), disabled: !onOpenApp },
    { label: 'Remove', keys: 'Delete', danger: true, separated: true, run: () => void set(app, false) },
  ];
  const icon = (app: AppInfo) => <svg viewBox="0 0 20 20" aria-hidden="true" className="abl-icon">{APP_ICONS[app.id]}</svg>;
  return (
    <>
      {problem && <p className="field-error abl-problem" role="alert">{problem}</p>}
      {list.length === 0 && <p className="abl-empty">{q.trim() ? `No apps match “${q.trim()}”.` : which === 'available' ? 'Every app is installed.' : 'No apps are installed.'}</p>}
      {groups.map(({ group, members }) => (
        <section key={group} className="abl-group" aria-label={group}>
          <h2 className="abl-group-title">{group}</h2>
          <ul role="list" className="abl-rows">
            {members.map((app) => (
              <li key={app.id} className="abl-item" onKeyDown={(e) => { if (which === 'installed' && e.key === 'Delete' && e.target === e.currentTarget.querySelector('.abl-main')) { e.preventDefault(); void set(app, false); } }} onContextMenu={(e) => { if (which !== 'installed') return; e.preventDefault(); setMenu({ app, x: e.clientX, y: e.clientY }); }}>
                {which === 'installed' && onOpenApp
                  ? <button type="button" className="abl-main" aria-label={`Open ${app.name}`} onClick={() => onOpenApp(app.id)}>{icon(app)}<span className="abl-text"><span className="abl-name">{app.name}</span><span className="abl-sub">{APP_PURPOSE[app.id]}</span></span></button>
                  : <span className="abl-main">{icon(app)}<span className="abl-text"><span className="abl-name">{app.name}</span><span className="abl-sub">{APP_PURPOSE[app.id]}</span></span></span>}
                {which === 'installed'
                  ? <Menu label={`${app.name} actions`} align="end" entries={entries(app)} trigger={<button type="button" className="strip-btn abl-more" aria-label={`More for ${app.name}`} title="More actions"><MoreGlyph /></button>} />
                  : <button type="button" className="btn abl-add" aria-label={`Add ${app.name}`} onClick={() => void set(app, true)}>Add</button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {menu && <ContextMenu x={menu.x} y={menu.y} label={menu.app.name} onClose={() => setMenu(null)} items={entries(menu.app)} />}
      {undoable && <UndoToast text={undoable.text} onUndo={undoable.undo} onDismiss={() => setUndoable(null)} />}
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
  const leaving = new Set(status?.leaving ?? []);
  const rows: { name: string; state: 'on' | 'failed' | 'waiting'; error?: string }[] = [
    ...(status?.running ?? []).map((name) => ({ name, state: 'on' as const })),
    ...(status?.failed ?? []).map((f) => ({ name: f.server, state: 'failed' as const, error: f.error })),
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
        void api?.addConnector?.({ name, command: was.command, args: was.args ?? [], env: was.env ?? {} }).then((back) => { if (back && !back.ok) setProblem(back.error); reload(); });
      },
    });
  };
  const sub = (r: (typeof rows)[number]) => (r.state === 'waiting' ? 'Starts when Mobius reopens' : r.state === 'failed' ? `Couldn’t start: ${r.error ?? 'unknown problem'}` : 'Connected');
  const entries = (name: string) => [{ label: 'Remove', keys: 'Delete', danger: true, run: () => void remove(name) }];
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
                <span className="abl-icon-wrap"><svg viewBox="0 0 20 20" aria-hidden="true" className="abl-icon"><path d="M8 3.5v3M12 3.5v3M6.5 6.5h7v3a3.5 3.5 0 0 1-7 0z" /><path d="M10 13v3.5" /></svg>{r.state !== 'on' && <span className="abl-dot" data-state={r.state} aria-hidden="true" />}</span>
                <span className="abl-text"><span className="abl-name">{r.name}</span><span className={r.state === 'failed' ? 'abl-sub abl-error' : 'abl-sub'}>{sub(r)}</span></span>
              </span>
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
