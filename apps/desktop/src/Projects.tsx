import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { conversationIdFor, type Bot, type ConversationInfo, type Message, type ProjectDetails, type ProjectHealth, type ProjectInfo, type ProjectUpdate, type ProjectUpdateText, type ProjectLevel, type ProjectStatus, type TaskListInfo, type WikiChange } from '@mobius/shared';
import { appName, isInstalled, type AppId } from './apps';
import { APP_ICONS } from './Rail';
import { ActionIcon, ContextMenu } from './ContextMenu';
import { assignEntries, projectAssignment } from './assign';
import { AppMenu, AppSidebar, Menu, SidebarRow, SidebarSearch, SidebarSection, ToolbarControls } from './ui';
import { SideNew } from './SideNew';
import { changesSince, draftAsk, groupByStatus, healthName, latestUpdate, parseDraft, PROJECT_HEALTHS, PROJECT_STATUSES, progressOf, projectSummary, projectThreads, ruleApps, statusName, targetLine, threadLine, updateDue } from './projects-view';
import { askInline, type InlineAnswer } from './launcher-ask';
import { ChangeBar, TryAnotherContext } from './ReviewBar';
import { MobiusMark } from './MobiusMark';
import { relativeTime } from './relative-time';
import './projects.css';
import type { WikiIncoming } from './Wiki';
import { changeTarget } from './actions';
import { EmptyState } from './EmptyState';

/** The empty page's New project opens the sidebar's naming field. */
const NEW_PROJECT = 'mobius-projects-new';

/** The apps a project can set a level for, as Settings lists them. Levels use the composer's Permission names. */
const RULE_APPS: readonly AppId[] = ['notes', 'docs', 'sheets', 'slides', 'tasks', 'calendar', 'mail', 'browser', 'research', 'reader', 'code', 'database', 'design', 'canvas', 'photo', 'studio', 'video', 'skills'];
const LEVELS: readonly { id: ProjectLevel | 'follow'; name: string }[] = [
  { id: 'follow', name: 'As in Settings' },
  { id: 'ask', name: 'Ask each time' },
  { id: 'propose', name: 'Review changes' },
  { id: 'act', name: 'Auto' },
];

/** A project's name being changed, or its deletion being confirmed, on the page. */
interface Asking { id: string; kind: 'rename' | 'delete' }

/** The projects, and the one open. */
export function useProjects() {
  const api = window.mobius.projects;
  const [list, setList] = useState<ProjectInfo[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(async () => {
    const got = await api?.list().catch(() => null);
    if (Array.isArray(got)) setList(got);
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => api?.onChanged(() => void load()), [api, load]);
  // A bot's side thread that finishes reports back: its last answer is kept for the thread it was asked from.
  const sides = useRef(list);
  sides.current = list;
  useEffect(() => window.mobius.agent.onNotification((n) => {
    if (n.method !== 'agent.event' || !['done', 'failed'].includes(n.params.event.kind)) return;
    const side = sides.current.flatMap((p) => p.sides ?? []).find((s) => s.conversation === n.params.conversation && !s.report);
    if (!side) return;
    void window.mobius.agent.history(side.conversation).then((history: Message[]) => {
      const last = history.findLast((m) => m.role === 'assistant' && m.text.trim() !== '');
      const text = last && last.role === 'assistant' ? last.text : n.params.event.kind === 'failed' ? 'It could not finish.' : 'Done.';
      return api?.report(side.conversation, text);
    }).then(() => load()).catch(() => undefined);
  }), [api, load]);
  const failed = (r: unknown): string | null => (r && typeof r === 'object' && 'ok' in r && (r as { ok: unknown }).ok === false ? String((r as { message?: unknown }).message ?? 'That could not be done.') : null);
  const create = async (name: string) => {
    const r = await api?.create(name).catch(() => null);
    const why = r ? failed(r) : 'Projects are not available here.';
    setProblem(why);
    if (!why && r && 'id' in r) { await load(); setOpenId(r.id); }
    return why === null;
  };
  /** Its status, target day or task list (an empty string clears one). */
  const setDetails = async (id: string, details: ProjectDetails) => {
    const r = await api?.setDetails?.(id, details).catch(() => null);
    setProblem(r ? failed(r) : 'That cannot be set here.');
    await load();
  };
  /** Post an update, change one (`update` is its id) or delete one; true when it was done. */
  const postUpdate = async (id: string, text: ProjectUpdateText, update?: string) => {
    const r = await (update ? api?.editUpdate?.(id, update, text) : api?.addUpdate?.(id, text))?.catch(() => null);
    const why = r ? failed(r) : 'Updates are not available here.';
    setProblem(why);
    await load();
    return why === null;
  };
  const removeUpdate = async (id: string, update: string) => { const r = await api?.removeUpdate?.(id, update).catch(() => null); setProblem(r ? failed(r) : 'Updates are not available here.'); await load(); };
  const setRule = async (id: string, app: AppId, level: ProjectLevel | 'follow') => { setProblem(failed(await api?.setRule(id, app, level).catch(() => null))); await load(); };
  const addThread = async (id: string, conversation: string) => { const r = await api?.addThread(id, conversation).catch(() => null); setProblem(failed(r)); await load(); return failed(r) === null; };
  /** A thread leaves the project (with the side threads asked from it); the conversation itself is kept. */
  const removeThread = async (id: string, conversation: string) => {
    const r = await api?.removeThread?.(id, conversation).catch(() => null);
    const why = r ? failed(r) : 'That cannot be done here.';
    setProblem(why);
    await load();
    return why === null;
  };
  const rename = async (id: string, name: string) => { const r = await api?.rename(id, name).catch(() => null); const why = r ? failed(r) : 'Projects are not available here.'; setProblem(why); await load(); return why === null; };
  /** Ask a bot, from a project thread, to do something on the side: a conversation of its own, under the project's rules. */
  const askBot = async (project: ProjectInfo, parent: string, bot: Bot, ask: string) => {
    const conversation = conversationIdFor(bot.id, crypto.randomUUID());
    const r = await api?.addSide(project.id, parent, conversation, bot.id, bot.name, ask).catch(() => null);
    const why = r ? failed(r) : 'Projects are not available here.';
    setProblem(why);
    if (why) return false;
    await load();
    const sent = await window.mobius.agent.send(conversation, ask).catch(() => null);
    if (!sent || !sent.ok) { setProblem(sent && !sent.ok ? sent.error : 'The agent could not be asked.'); return false; }
    return true;
  };
  /** Delete the project only: its threads, its folder in Files and its memory page in Knowledge are kept. */
  const remove = async (id: string) => {
    const r = await api?.remove(id).catch(() => null);
    const why = r ? failed(r) : 'Projects are not available here.';
    setProblem(why);
    if (!why) { setOpenId(null); setAsking(null); }
    await load();
    return why === null;
  };
  // Rename and Delete are asked for from the page's More menu or a sidebar row's menu, and answered on the page.
  const [asking, setAsking] = useState<Asking | null>(null);
  const ask = (id: string, kind: Asking['kind']) => { setOpenId(id); setProblem(null); setAsking({ id, kind }); };
  const open = list.find((p) => p.id === openId) ?? list[0] ?? null;
  return { available: api !== undefined, list, open, setOpenId, create, rename, setRule, setDetails, postUpdate, removeUpdate, addThread, removeThread, askBot, remove, problem, asking, ask, stopAsking: () => setAsking(null) };
}
export type ProjectsState = ReturnType<typeof useProjects>;

const Chevron = () => <svg className="proj-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>;
const ThreadGlyph = () => <svg className="proj-glyph" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3h0A1.5 1.5 0 0 1 4 11.5z" /></svg>;
/** An app's line glyph in a row: colour tiles are only for the launcher. */
const AppTile = ({ app }: { app: string }) => <svg className="proj-glyph" viewBox="0 0 20 20" aria-hidden="true">{APP_ICONS[app]}</svg>;

/**
 * A project's status as Linear draws it: a dashed ring for Backlog, a ring for Planned, a half-filled ring In progress,
 * two bars Paused, a tick Completed and a cross Canceled. Grey, except the work moving (ink) and done (ink, filled).
 */
export function StatusIcon({ status }: { status: ProjectStatus | undefined }) {
  const ring = <circle cx="10" cy="10" r="6.5" />;
  return (
    <svg className="proj-status-icon" data-status={status ?? 'none'} viewBox="0 0 20 20" aria-hidden="true">
      {(!status || status === 'backlog') && <circle cx="10" cy="10" r="6.5" strokeDasharray="2.6 2.4" />}
      {status === 'planned' && ring}
      {status === 'started' && <>{ring}<path className="fill" d="M10 5.5a4.5 4.5 0 0 1 0 9z" /></>}
      {status === 'paused' && <>{ring}<path d="M8.5 7.5v5M11.5 7.5v5" /></>}
      {status === 'completed' && <><circle className="fill" cx="10" cy="10" r="7" /><path className="on-fill" d="m7 10.2 2 2 4-4.4" /></>}
      {status === 'canceled' && <>{ring}<path d="m7.8 7.8 4.4 4.4m0-4.4-4.4 4.4" /></>}
    </svg>
  );
}

/**
 * Under the project's line, as Linear's project properties: its status, its target day and its progress from a Tasks
 * list (done out of all, with a bar). Each is set in place; a list opens in Tasks.
 */
/** The Tasks lists, kept current: a project's progress is counted from its own. */
function useTaskLists() {
  const [lists, setLists] = useState<TaskListInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void window.mobius.tasks?.lists().then((got) => { if (live && Array.isArray(got)) setLists(got); }).catch(() => undefined);
    load();
    const off = window.mobius.tasks?.onChanged?.(load);
    return () => { live = false; off?.(); };
  }, []);
  return lists;
}

/** How far a project has come, from its linked list: null without one (or before the lists are read). */
const projectProgress = (project: ProjectInfo, lists: readonly TaskListInfo[] | null) => progressOf(project.list ? lists?.find((l) => l.name === project.list) : undefined);

/** A project's health as Linear marks it: a filled dot, green On track, amber At risk, red Off track. */
const HealthDot = ({ health }: { health: ProjectHealth }) => <span className="proj-health-dot" data-health={health} aria-hidden="true" />;

function ProjectProps({ projects, project, lists, onOpenList }: { projects: ProjectsState; project: ProjectInfo; lists: TaskListInfo[] | null; onOpenList: (list: string) => void }) {
  const set = (details: ProjectDetails) => void projects.setDetails(project.id, details);
  const target = targetLine(project.target, project.status, new Date());
  const progress = projectProgress(project, lists);
  const dateField = useRef<HTMLInputElement>(null);
  const latest = latestUpdate(project);
  return (
    <div className="proj-props" role="group" aria-label="Project details">
      <Menu label="Status" entries={PROJECT_STATUSES.map((st) => ({ label: st.name, icon: <StatusIcon status={st.id} />, checked: project.status === st.id, run: () => set({ status: project.status === st.id ? '' : st.id }) }))}
        trigger={<button type="button" className="proj-prop" aria-label={`Status: ${statusName(project.status)}`}><StatusIcon status={project.status} /><span>{statusName(project.status)}</span></button>} />
      <label className="proj-prop proj-target" data-late={target?.late || undefined} title={target?.late ? 'The target day has passed' : 'Target day'}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6.5h12v9H4zM4 9h12M7.5 4.5v3M12.5 4.5v3" /></svg>
        <span>{target ? target.text : 'Target day'}</span>
        <input ref={dateField} type="date" className="proj-target-field" aria-label={`Target day${target ? `, ${target.text}` : ''}${target?.late ? ', late' : ''}`} value={project.target ?? ''} onChange={(e) => set({ target: e.target.value })} onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* the field itself takes the day */ } }} />
      </label>
      {project.target && <button type="button" className="proj-prop proj-clear" aria-label="Clear the target day" title="Clear the target day" onClick={() => set({ target: '' })}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 7 6 6m0-6-6 6" /></svg></button>}
      {project.list ? (
        <span className="proj-progress">
          <button type="button" className="proj-prop" title={`Open ${project.list} in Tasks`} onClick={() => onOpenList(project.list!)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M5 10h10M5 14h6" /></svg><span>{project.list}</span>
          </button>
          {progress && (
            <span className="proj-progress-bar" role="meter" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext={`${progress.done} of ${progress.total} tasks done`}>
              <span style={{ width: `${progress.percent}%` }} />
            </span>
          )}
          <span className="proj-progress-text">{progress ? `${progress.done} of ${progress.total} done · ${progress.percent}%` : lists ? 'That list is not there' : ''}</span>
          <Menu label="Task list" align="end" entries={[
            ...(lists ?? []).filter((l) => l.name !== project.list).map((l) => ({ label: l.name, run: () => set({ list: l.name }) })),
            { label: 'Unlink the task list', separated: true, run: () => set({ list: '' }) },
          ]} trigger={<button type="button" className="proj-prop proj-more" aria-label="Change the task list"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6.5 8.5 3.5 3.5 3.5-3.5" /></svg></button>} />
        </span>
      ) : lists && lists.length > 0 ? (
        <Menu label="Link a task list" entries={lists.map((l) => ({ label: l.name, run: () => set({ list: l.name }) }))}
          trigger={<button type="button" className="proj-prop"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M5 10h10M5 14h6" /></svg><span>Link a task list</span></button>} />
      ) : null}
      {/* Its health from the latest update, as Linear shows it beside the project's properties; a click goes to Updates. */}
      {latest && (
        <a className="proj-prop proj-health" href="#project-updates" title={`From the update ${relativeTime(latest.at, Date.now()).toLowerCase()}`}
          onClick={(e) => { e.preventDefault(); document.getElementById('project-updates')?.scrollIntoView({ block: 'start' }); }}>
          <HealthDot health={latest.health} /><span>{healthName(latest.health)}</span>
        </a>
      )}
    </div>
  );
}

/** Keys for a project, shown beside their menu rows and working on a focused sidebar row. */
const RENAME_KEYS = 'F2';
const DELETE_KEYS = 'Delete';

/** The project a sidebar row is for, found from the row's name (names are unique). */
const rowProject = (projects: ProjectsState, target: EventTarget | null) => {
  const row = (target as HTMLElement | null)?.closest?.('button.list-row');
  const name = row?.querySelector('.ui-side-name')?.textContent;
  return name ? projects.list.find((p) => p.name === name) ?? null : null;
};

export function ProjectsSidebar({ projects, pin, conversations }: { projects: ProjectsState; pin?: ReactNode; conversations: readonly ConversationInfo[] }) {
  const [naming, setNaming] = useState(false);
  useEffect(() => { const go = () => setNaming(true); window.addEventListener(NEW_PROJECT, go); return () => window.removeEventListener(NEW_PROJECT, go); }, []);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; project: ProjectInfo; row?: HTMLElement } | null>(null);
  const waiting = (p: ProjectInfo) => conversations.filter((c) => p.threads.includes(c.id)).reduce((n, c) => n + c.waiting, 0);
  const shown = projects.list.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <AppSidebar label="Projects" className="projects-side"
      // Double-click renames, as in Finder; F2 renames and Delete asks to delete the focused project.
      onDoubleClick={(e) => { const p = rowProject(projects, e.target); if (p) projects.ask(p.id, 'rename'); }}
      onKeyDown={(e) => {
        if (e.key !== 'F2' && e.key !== 'Delete') return;
        const p = rowProject(projects, e.target);
        if (!p) return;
        e.preventDefault();
        projects.ask(p.id, e.key === 'F2' ? 'rename' : 'delete');
      }}>
      <SidebarSearch label="Search projects" value={query} onChange={setQuery} />
      <SideNew item="project" onNew={() => setNaming(true)} />
      {naming && (
        <form className="notes-name" onSubmit={(e) => { e.preventDefault(); void projects.create(name).then((ok) => { if (ok) { setNaming(false); setName(''); } }); }}>
          <input autoFocus aria-label="Project name" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
        </form>
      )}
      {naming && projects.problem && <p className="field-error" role="alert">{projects.problem}</p>}
      <nav aria-label="Projects">
        {/* Grouped by status once any project has one, as Linear's projects list: open work first, done and canceled last. */}
        {/* No heading over nothing: with no projects yet, the page itself says how to start. */}
        {groupByStatus(shown).filter((g) => g.projects.length > 0).map((g, i) => (
          <SidebarSection key={g.title} title={g.title} {...(pin && i === 0 ? { action: pin } : {})}>
            {g.projects.map((p) => (
              <SidebarRow key={p.id} icon={p.status ? <StatusIcon status={p.status} /> : <svg className="proj-side-icon" viewBox="0 0 20 20" aria-hidden="true">{APP_ICONS.projects}</svg>}
                label={p.name} count={waiting(p)} current={projects.open?.id === p.id} onSelect={() => projects.setOpenId(p.id)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, project: p, row: e.currentTarget }); }} />
            ))}
          </SidebarSection>
        ))}
      </nav>
      {projects.list.length > 0 && shown.length === 0 && <p className="side-empty">No projects match.</p>}
      {menu && createPortal(
        <ContextMenu x={menu.x} y={menu.y} label={menu.project.name} onClose={() => setMenu(null)} items={[
          { action: 'open', run: () => projects.setOpenId(menu.project.id) },
          { action: 'rename', label: 'Rename…', keys: RENAME_KEYS, run: () => projects.ask(menu.project.id, 'rename') },
          // Assign to Mobius (marked; assign.ts): its next steps run in a chat of their own and come back to the Inbox.
          ...assignEntries(() => projectAssignment(menu.project), () => menu.row),
          { action: 'delete', label: 'Delete project…', keys: DELETE_KEYS, danger: true, separated: true, run: () => projects.ask(menu.project.id, 'delete') },
        ]} />,
        document.body,
      )}
    </AppSidebar>
  );
}

/** Move a conversation that is in no project into this one: from then on, the project's rules count in it. */
function MoveHere({ projects, project, conversations }: { projects: ProjectsState; project: ProjectInfo; conversations: readonly ConversationInfo[] }) {
  const taken = new Set(projects.list.flatMap((x) => x.threads));
  const free = conversations.filter((c) => !taken.has(c.id) && c.messages > 0);
  if (free.length === 0) return null;
  return (
    <select className="popup proj-move" aria-label={`Move a conversation into ${project.name}`} value="" onChange={(e) => { if (e.target.value) void projects.addThread(project.id, e.target.value); }}>
      <option value="">Move a conversation here…</option>
      {free.map((c) => <option key={c.id} value={c.id}>{c.title || 'A conversation'}</option>)}
    </select>
  );
}

/**
 * In a project thread, above the conversation: the bots asked from it to do something on the side, and what each
 * reported back. Ask a bot starts one.
 */
export function SideThreads({ projects, conversation, bots, onOpen }: { projects: ProjectsState; conversation: string; bots: readonly Bot[]; onOpen: (conversation: string) => void }) {
  const project = projects.list.find((p) => p.threads.includes(conversation));
  const [bot, setBot] = useState('');
  const [ask, setAsk] = useState('');
  const helpers = bots.filter((b) => b.id !== 'main');
  if (!project) return null;
  const sides = (project.sides ?? []).filter((s) => s.parent === conversation);
  if (helpers.length === 0 && sides.length === 0) return null;
  const chosen = helpers.find((b) => b.id === bot) ?? helpers[0];
  return (
    <section className="side-threads" aria-label="Side threads">
      {sides.map((s) => (
        <div key={s.conversation} className="side-thread" role="group" aria-label={`From ${s.botName}`} data-working={s.report ? undefined : true}>
          <span className="side-thread-head">{s.report ? `From ${s.botName}` : `${s.botName} is working on it`} · “{s.ask}”</span>
          {s.report && <p className="side-thread-report">{s.report}</p>}
          <button type="button" className="review-btn" onClick={() => onOpen(s.conversation)}>Open</button>
        </div>
      ))}
      {chosen && (
        <form className="side-thread-ask" onSubmit={(e) => { e.preventDefault(); const t = ask.trim(); if (t) void projects.askBot(project, conversation, chosen, t).then((ok) => { if (ok) setAsk(''); }); }}>
          <select aria-label="Agent" value={chosen.id} onChange={(e) => setBot(e.target.value)}>{helpers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <input aria-label="Ask an agent" placeholder={`Ask ${chosen.name} to do something on the side`} value={ask} onChange={(e) => setAsk(e.target.value)} />
        </form>
      )}
    </section>
  );
}

/**
 * The top of a project's page: one quiet line about it. Its name is the toolbar's title; New thread is in the toolbar,
 * and Rename, the folder, the memory page and Delete are in the toolbar's ⋯. Renaming and the delete check take the
 * line's place.
 */
function ProjectHead({ projects, project, summary, lists, onNewThread, onOpenFiles, onOpenMemory, onOpenList }: {
  projects: ProjectsState; project: ProjectInfo; summary: string; lists: TaskListInfo[] | null; onNewThread: () => void; onOpenFiles: () => void; onOpenMemory: () => void; onOpenList: (list: string) => void;
}) {
  const asking = projects.asking?.id === project.id ? projects.asking.kind : null;
  const [naming, setNaming] = useState(project.name);
  useEffect(() => { if (asking === 'rename') setNaming(project.name); }, [asking, project.name]);
  const tools = (
    <>
      <ToolbarControls label="Project">
        <button type="button" className="btn" title="New thread" onClick={onNewThread}>New thread</button>
      </ToolbarControls>
      <AppMenu label="Project" entries={[
        { label: 'Rename…', icon: <ActionIcon action="rename" />, keys: RENAME_KEYS, run: () => projects.ask(project.id, 'rename') },
        { label: 'Show the folder in Files', icon: <ActionIcon action="reveal" />, run: onOpenFiles },
        { label: 'Open memory in Knowledge', icon: <ActionIcon action="open" />, run: onOpenMemory },
        { label: 'Delete project…', icon: <ActionIcon action="delete" />, keys: DELETE_KEYS, danger: true, separated: true, run: () => projects.ask(project.id, 'delete') },
      ]} />
    </>
  );
  if (asking === 'rename') {
    return (
      <form className="proj-head" aria-label="Rename the project" onSubmit={(e) => { e.preventDefault(); void projects.rename(project.id, naming).then((ok) => { if (ok) projects.stopAsking(); }); }}>
        {tools}
        <input className="proj-name-field" autoFocus aria-label="Project name" value={naming} maxLength={60} onChange={(e) => setNaming(e.target.value)} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => { if (e.key === 'Escape') projects.stopAsking(); }} />
        <span className="proj-head-actions">
          <button type="button" className="btn" onClick={() => projects.stopAsking()}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </span>
        {projects.problem && <p className="field-error proj-head-note" role="alert">{projects.problem}</p>}
      </form>
    );
  }
  if (asking === 'delete') {
    return (
      <div className="proj-head proj-confirm" role="alertdialog" aria-label={`Delete ${project.name}?`}>
        {tools}
        <p className="proj-confirm-text"><b>Delete “{project.name}”?</b> Its threads, its folder in Files and its memory page in Knowledge are kept. Only the project and its rules go.</p>
        <span className="proj-head-actions">
          <button type="button" className="btn" autoFocus onClick={() => projects.stopAsking()}>Cancel</button>
          <button type="button" className="btn danger" onClick={() => void projects.remove(project.id)}>Delete</button>
        </span>
        {projects.problem && <p className="field-error proj-head-note" role="alert">{projects.problem}</p>}
      </div>
    );
  }
  return (
    <div className="proj-head">
      {tools}
      <p className="proj-summary">{summary}</p>
      <ProjectProps projects={projects} project={project} lists={lists} onOpenList={onOpenList} />
    </div>
  );
}

/**
 * Project updates, as Linear's: how the work is going (On track, At risk, Off track) and what to say, with what changed
 * since the last update (status, target day, progress) added by itself. The latest shows first; the earlier ones fold.
 * Write with Mobius drafts one from where the project stands and its threads, dashed until kept; Mobius never posts.
 */
function ProjectUpdates({ projects, project, progress, threads, onForget }: { projects: ProjectsState; project: ProjectInfo; progress: { done: number; total: number; percent: number } | null; threads: string[]; onForget: (conversation: string) => void }) {
  const updates = project.updates ?? [];
  const latest = updates.at(-1);
  const [writing, setWriting] = useState<{ update?: ProjectUpdate } | null>(null);
  const [health, setHealth] = useState<ProjectHealth>('on_track');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<InlineAnswer | null>(null);
  const [earlier, setEarlier] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const now = Date.now();
  const standing = { status: project.status, target: project.target, done: progress?.done, total: progress?.total };
  const pending = changesSince(latest, standing, new Date(now));
  const due = updateDue(project, now);
  // A draft is asked in a conversation of its own, deleted once the draft is kept or dropped: it is not a thread.
  const forget = onForget;
  const start = (update?: ProjectUpdate) => {
    setWriting(update ? { update } : {});
    setHealth(update?.health ?? latest?.health ?? 'on_track');
    setText(update?.text ?? '');
    setDeleting(null);
    requestAnimationFrame(() => field.current?.focus());
  };
  const close = () => { stop.current?.(); if (draft) forget(draft.conversation); setDraft(null); setWriting(null); };
  const write = () => {
    stop.current?.();
    if (draft) forget(draft.conversation);
    const reports = (project.sides ?? []).filter((x) => x.report).map((x) => `${x.botName}: ${x.report}`);
    const target = targetLine(project.target, project.status, new Date(now))?.text ?? null;
    const ask = draftAsk(project, { changes: pending, threads, reports, progress: progress ? `${progress.done} of ${progress.total} tasks done (${progress.percent}%)` : null, target });
    stop.current = askInline(ask, setDraft, 'projects');
  };
  const drafted = draft ? parseDraft(draft.text) : null;
  const keepDraft = () => {
    if (!draft || !drafted) return;
    if (drafted.health) setHealth(drafted.health);
    setText(drafted.text);
    stop.current?.();
    forget(draft.conversation);
    setDraft(null);
    requestAnimationFrame(() => field.current?.focus());
  };
  const discardDraft = () => { stop.current?.(); if (draft) forget(draft.conversation); setDraft(null); };
  const post = async () => {
    if (!text.trim() || !writing) return;
    const ok = await projects.postUpdate(project.id, { health, text, ...(progress ? { done: progress.done, total: progress.total } : {}) }, writing.update?.id);
    if (ok) { setWriting(null); setText(''); }
  };
  const shown = earlier ? [...updates].reverse() : latest ? [latest] : [];
  const form = writing && (
    <form className="proj-update-form" aria-label={writing.update ? 'Edit the update' : 'New update'} onSubmit={(e) => { e.preventDefault(); void post(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !draft) { e.stopPropagation(); close(); } }}>
      {/* One Tab stop; the arrows choose, as a radio group does. */}
      <div className="proj-health-pick" role="radiogroup" aria-label="Health"
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const at = PROJECT_HEALTHS.findIndex((h) => h.id === health);
          const next = PROJECT_HEALTHS[(at + step + PROJECT_HEALTHS.length) % PROJECT_HEALTHS.length]!;
          setHealth(next.id);
          e.currentTarget.querySelector<HTMLElement>(`[data-health-id="${next.id}"]`)?.focus();
        }}>
        {PROJECT_HEALTHS.map((h) => (
          <button key={h.id} type="button" role="radio" aria-checked={health === h.id} tabIndex={health === h.id ? 0 : -1} data-health-id={h.id} className="proj-prop" onClick={() => setHealth(h.id)}><HealthDot health={h.id} /><span>{h.name}</span></button>
        ))}
      </div>
      {draft ? (
        <section className="proj-update-draft" aria-label="Update drafted by Mobius" aria-busy={draft.state === 'asking'}>
          {drafted?.health && <p className="proj-update-head"><HealthDot health={drafted.health} /><b>{healthName(drafted.health)}</b></p>}
          <p className="proj-update-text">{drafted?.text || (draft.state === 'asking' ? 'Mobius is writing…' : '')}</p>
          {draft.state === 'failed' && <p className="field-error" role="alert">{draft.error ?? 'Mobius could not write it.'}</p>}
          {draft.state === 'done' && (
            <TryAnotherContext.Provider value={write}>
              <ChangeBar who={<span className="proj-update-who"><MobiusMark size={14} />Mobius drafted this</span>} onDiscard={discardDraft} onKeep={keepDraft}
                keepText="Keep and edit" keepTitle="Put it in the update, to change before you post" discardTitle="Drop this draft" />
            </TryAnotherContext.Provider>
          )}
          {draft.state !== 'done' && <button type="button" className="review-btn" onClick={discardDraft}>{draft.state === 'asking' ? 'Stop' : 'Close'}</button>}
        </section>
      ) : (
        <textarea ref={field} className="proj-update-field" aria-label="Update" rows={4} placeholder="What moved, what is at risk, and what comes next" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void post(); } }} />
      )}
      {!writing.update && pending.length > 0 && (
        <ul className="proj-update-changes" aria-label="Added by itself: changes since the last update">{pending.map((c) => <li key={c}>{c}</li>)}</ul>
      )}
      <div className="proj-update-bar">
        {!writing.update && !draft && <button type="button" className="btn proj-write-mobius" onClick={write}><MobiusMark size={14} /><span>Write with Mobius</span></button>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!text.trim() || !!draft} title="Post (Ctrl+Enter)">{writing.update ? 'Save' : 'Post update'}</button>
      </div>
      {projects.problem && <p className="field-error" role="alert">{projects.problem}</p>}
    </form>
  );
  return (
    <Group id="project-updates" label="Project updates" heading="Updates" {...(writing ? {} : { link: { label: 'Write an update', run: () => start() } })}>
      {form && !writing?.update && form}
      {!writing && due && (
        <p className="proj-update-due" role="status">{latest ? `An update is due: the last was ${relativeTime(latest.at, now).toLowerCase()}.` : 'No update yet. Say how this is going.'}</p>
      )}
      {updates.length === 0 && !writing && !due && <p className="proj-empty">No updates yet. Post one to say how the work is going.</p>}
      {shown.map((u) => {
        const i = updates.indexOf(u);
        if (writing?.update?.id === u.id) return <div key={u.id}>{form}</div>;
        const changes = changesSince(updates[i - 1], u, new Date(now));
        return (
          <article key={u.id} className="proj-update" aria-label={`${healthName(u.health)} update, ${relativeTime(u.at, now).toLowerCase()}`}>
            <p className="proj-update-head">
              <HealthDot health={u.health} /><b>{healthName(u.health)}</b>
              <span className="proj-update-when">{relativeTime(u.at, now)}{u.edited ? ' · edited' : ''}</span>
              <span className="spacer" />
              <Menu label="Update" align="end" entries={[
                { label: 'Edit update', run: () => start(u) },
                { label: 'Delete update…', separated: true, run: () => setDeleting(u.id) },
              ]} trigger={<button type="button" className="proj-prop proj-more" aria-label="More for this update"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h.01M10 10h.01M15 10h.01" /></svg></button>} />
            </p>
            <p className="proj-update-text">{u.text}</p>
            {changes.length > 0 && <ul className="proj-update-changes" aria-label="Changes since the update before">{changes.map((c) => <li key={c}>{c}</li>)}</ul>}
            {deleting === u.id && (
              <div className="proj-update-bar" role="alertdialog" aria-label="Delete this update?">
                <span>Delete this update?</span><span className="spacer" />
                <button type="button" className="btn" autoFocus onClick={() => setDeleting(null)}>Cancel</button>
                <button type="button" className="btn danger" onClick={() => { setDeleting(null); void projects.removeUpdate(project.id, u.id); }}>Delete</button>
              </div>
            )}
          </article>
        );
      })}
      {updates.length > 1 && (
        <button type="button" className="btn link proj-update-more" aria-expanded={earlier} onClick={() => setEarlier((v) => !v)}>
          {earlier ? 'Show only the latest' : `Show ${updates.length - 1} earlier ${updates.length === 2 ? 'update' : 'updates'}`}
        </button>
      )}
    </Group>
  );
}

/** The project's memory page, as Markdown in the Wiki. */
export const memoryPage = (project: ProjectInfo) => `Projects/${project.name.trim().replace(/\.+$/, '')}.md`;

/** While a list loads: three quiet placeholder bars, never a spinner. */
const Loading = ({ label }: { label: string }) => (
  <div className="proj-loading" role="status" aria-label={label}>
    <span /><span /><span />
  </div>
);

/** A section of the page, as in Apple's grouped lists: a heading outside, with one link at its right, and a card. */
function Group({ label, heading, link, children, tone, id }: { label: string; heading: string; link?: { label: string; run: () => void; expanded?: boolean }; children: ReactNode; tone?: 'attention'; id?: string }) {
  return (
    <section className="proj-group" aria-label={label} data-tone={tone} id={id}>
      <div className="proj-group-head">
        <h2 className="proj-group-title">{heading}</h2>
        {link && <button type="button" className="btn link" aria-expanded={link.expanded} onClick={link.run}>{link.label}</button>}
      </div>
      <div className="proj-card">{children}</div>
    </section>
  );
}

/**
 * What the project knows: its memory page's lines, and what Mobius proposed for it in the project's threads, dashed
 * until kept (Keep adds the line to the page; Discard drops it).
 */
function ProjectMemory({ project, incoming, onOpen }: { project: ProjectInfo; incoming: WikiIncoming; onOpen: () => void }) {
  const page = memoryPage(project);
  const [lines, setLines] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const proposed = incoming.waiting.filter((c) => c.page === page);
  const load = useCallback(async () => {
    const got = await window.mobius.wiki?.read(page).catch(() => null);
    const content = got && 'content' in got ? got.content : '';
    setLines(content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')).map((l) => l.replace(/^[-*]\s+/, '')));
  }, [page]);
  useEffect(() => { void load(); }, [load, incoming.waiting.length]);
  useEffect(() => window.mobius.wiki?.onChanged(() => void load()), [load]);
  const act = async (c: WikiChange, keep: boolean) => {
    const api = window.mobius.wiki;
    const r = await (keep ? api?.keepChange?.(c.id) : api?.declineChange?.(c.id))?.catch(() => null);
    setProblem(r && r.ok ? null : r && !r.ok ? r.message : 'That could not be done.');
    await incoming.load();
    await load();
  };
  return (
    <Group label="Project memory" heading="Memory" link={{ label: 'Open in Knowledge', run: onOpen }}>
      {problem && <p className="field-error proj-row-note" role="alert">{problem}</p>}
      <ul className="proj-rows" role="list" aria-label="What this project knows">
        {(lines ?? []).map((l, i) => <li key={`${i}-${l}`} className="proj-row proj-fact"><span className="proj-row-title">{l}</span></li>)}
        {proposed.map((c) => (
          <li key={c.id} className="proj-row proj-fact" data-proposed aria-label={`${c.text}, proposed by ${c.from}`}>
            <span className="proj-row-text"><span className="proj-row-title">{c.text}</span><span className="proj-row-sub">Proposed by {c.from}</span></span>
            <span className="proj-row-actions">
              <button type="button" className="btn" onClick={() => void act(c, false)}>Discard</button>
              <button type="button" className="btn primary" onClick={() => void act(c, true)}>Keep</button>
            </span>
          </li>
        ))}
      </ul>
      {lines === null && proposed.length === 0 && <Loading label="Loading what this project knows" />}
      {lines !== null && lines.length === 0 && proposed.length === 0 && <p className="proj-empty">Nothing yet. What Mobius learns in this project's threads waits here for you to keep.</p>}
    </Group>
  );
}

/** What the project's threads made or changed, newest first, each opening in its app. */
function ProjectMade({ items, onOpenMade, onOpenFiles }: { items: readonly { path: string; app: AppId }[] | null; onOpenMade: (path: string) => void; onOpenFiles: () => void }) {
  return (
    <Group label="Made in this project" heading="Made in this project" link={{ label: "Open the project's folder", run: onOpenFiles }}>
      {items === null && <Loading label="Loading what this project made" />}
      {items !== null && items.length === 0 && <p className="proj-empty">Nothing yet. What Mobius makes or changes in this project's threads shows here.</p>}
      {items !== null && items.length > 0 && (
        <ul className="proj-rows" role="list" aria-label="Made in this project">
          {items.map(({ path, app }) => (
            <li key={path}>
              <button type="button" className="proj-row" onClick={() => onOpenMade(path)}>
                <AppTile app={app} />
                <span className="proj-row-text"><span className="proj-row-title">{madeTitle(path)}</span><span className="proj-row-sub">{appName(app)}</span></span>
                <Chevron />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}

/** The paths the project's threads made, asked again when a thread grows, since a finished turn may have made something. */
function useMade(project: ProjectInfo, conversations: readonly ConversationInfo[]) {
  const [made, setMade] = useState<string[] | null>(null);
  const growth = conversations.filter((c) => project.threads.includes(c.id)).reduce((n, c) => n + c.messages, 0);
  // The page is keyed by the project, so a new project starts from nothing; a thread that grows asks again.
  useEffect(() => {
    let live = true;
    void window.mobius.projects?.made?.(project.id).then((got) => { if (live) setMade(Array.isArray(got) ? got : []); }).catch(() => { if (live) setMade([]); });
    return () => { live = false; };
  }, [project.id, growth]);
  return made === null ? null : made.map((path) => ({ path, target: changeTarget(path) })).filter((m) => m.target !== null).map((m) => ({ path: m.path, app: (m.target!.app === 'open' ? 'files' : m.target!.app) as AppId }));
}

/** A made item's name: the file's name without its kind, or the workbook for a sheet. */
export function madeTitle(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts[0] === 'sheets' && parts[1]) return parts[1];
  if (parts[0] === 'code' && parts[1]) return parts.slice(1).join('/');
  return (parts.pop() ?? path).replace(/\.(md|json|csv|sqlite)$/i, '');
}

/** The project's rules, folded into one line until asked for: most projects keep what Settings says. */
function ProjectRules({ projects, project: p }: { projects: ProjectsState; project: ProjectInfo }) {
  const apps = ruleApps(RULE_APPS, p.rules, isInstalled);
  const changed = apps.filter((app) => (p.rules[app] ?? 'follow') !== 'follow');
  const [open, setOpen] = useState(false);
  const summary = changed.length === 0 ? 'Every app as in Settings' : changed.map((app) => `${appName(app)}: ${LEVELS.find((l) => l.id === p.rules[app])?.name ?? ''}`).join(' · ');
  return (
    <Group label="Rules for this project" heading="Rules" link={{ label: open ? 'Done' : 'Change', run: () => setOpen((o) => !o), expanded: open }}>
      {!open && <p className="proj-row proj-rules-summary"><span className="proj-row-title">{summary}</span></p>}
      {open && (
        <>
          <p className="proj-row-note">How much Mobius may do in each app here. Paying, sending, deleting and commands always ask.</p>
          <ul className="proj-rows proj-rules" role="list">
            {apps.map((app) => (
              <li key={app} className="proj-row">
                <AppTile app={app} />
                <span className="proj-row-title">{appName(app)}</span>
                <select className="popup" aria-label={`${appName(app)} in ${p.name}`} value={p.rules[app] ?? 'follow'} onChange={(e) => void projects.setRule(p.id, app, e.target.value as ProjectLevel | 'follow')}>
                  {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}
    </Group>
  );
}

/**
 * A project as a place: what waits on you, its threads and what they made first, then its memory (a Knowledge page)
 * and its rules (how much Mobius may do in each app there), folded into one line.
 */
export function ProjectPage({ projects, conversations, incoming, onOpenThread, onNewThread, onOpenMemory, onOpenFiles, onOpenMade, onForget }: {
  projects: ProjectsState;
  /** Delete a conversation Mobius was asked in for a draft, and drop it from the lists. */
  onForget?: (conversation: string) => void;
  incoming: WikiIncoming;
  conversations: readonly ConversationInfo[];
  onOpenThread: (conversation: string) => void;
  onNewThread: (project: string) => void;
  onOpenMemory: (project: ProjectInfo) => void;
  onOpenFiles: (project: ProjectInfo) => void;
  onOpenMade: (path: string) => void;
}) {
  const p = projects.open;
  if (!projects.available) return <section className="skills-page empty" aria-label="Projects"><p className="note-empty">Projects are not available here.</p></section>;
  if (!p) {
    const none = projects.list.length === 0;
    return (
      <section className="skills-page empty" aria-label="Projects">
        <EmptyState app="projects" label="No project open" title={none ? 'No projects yet' : 'No project open'}
          line={none ? 'A project keeps one piece of work together: its threads, its rules, its memory and its files.' : 'Choose one on the left, or start a new one.'}
          action={{ label: 'New project', run: () => window.dispatchEvent(new Event(NEW_PROJECT)) }} />
      </section>
    );
  }
  return <OpenProject key={p.id} {...{ projects, conversations, incoming, onOpenThread, onNewThread, onOpenMemory, onOpenFiles, onOpenMade, onForget }} project={p} />;
}

function OpenProject({ projects, project: p, conversations, incoming, onOpenThread, onNewThread, onOpenMemory, onOpenFiles, onOpenMade, onForget }: Parameters<typeof ProjectPage>[0] & { project: ProjectInfo }) {
  const made = useMade(p, conversations);
  const lists = useTaskLists();
  const now = Date.now();
  const threads = projectThreads(p, conversations);
  const waiting = threads.filter((t) => (t.info?.waiting ?? 0) > 0);
  const sides = p.sides ?? [];
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number; id: string; title: string } | null>(null);
  return (
    <section className="skills-page project-page" aria-label={p.name}>
      <ProjectHead projects={projects} project={p} lists={lists} summary={projectSummary(p, conversations, made?.length ?? 0, now)}
        onNewThread={() => onNewThread(p.id)} onOpenFiles={() => onOpenFiles(p)} onOpenMemory={() => onOpenMemory(p)} onOpenList={(list) => onOpenMade(`tasks/${list}.md`)} />
      {waiting.length > 0 && (
        <Group label="Waiting on you" heading="Waiting on you" tone="attention">
          <ul className="proj-rows" role="list">
            {waiting.map((t) => (
              <li key={t.id}>
                <button type="button" className="proj-row" onClick={() => onOpenThread(t.id)}>
                  <span className="proj-dot" aria-hidden="true" />
                  <span className="proj-row-text"><span className="proj-row-title">{t.info?.title || 'A thread'}</span><span className="proj-row-sub">{t.info?.waiting === 1 ? '1 question' : `${t.info?.waiting} questions`}</span></span>
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
        </Group>
      )}
      <ProjectUpdates projects={projects} project={p} progress={projectProgress(p, lists)} threads={threads.map((t) => t.info?.title).filter((t): t is string => !!t)}
        onForget={onForget ?? ((c) => void window.mobius.agent.deleteConversation(c).catch(() => undefined))} />
      <Group label="Chat and threads" heading="Threads">
        {threads.length === 0 && (
          <div className="proj-empty proj-empty-new">
            <span>No threads yet.</span>
            <button type="button" className="btn" onClick={() => onNewThread(p.id)}>New thread</button>
          </div>
        )}
        <ul className="proj-rows" role="list" aria-label="Threads">
          {threads.map((t) => (
            <li key={t.id} onContextMenu={(e) => { e.preventDefault(); setThreadMenu({ x: e.clientX, y: e.clientY, id: t.id, title: t.info?.title || 'New thread' }); }}>
              <button type="button" className="proj-row" onClick={() => onOpenThread(t.id)}>
                <ThreadGlyph />
                <span className="proj-row-text"><span className="proj-row-title">{t.info?.title || 'New thread'}</span><span className="proj-row-sub">{threadLine(t.info, now)}</span></span>
                <Chevron />
              </button>
              {sides.filter((s) => s.parent === t.id).map((s) => (
                <button key={s.conversation} type="button" className="proj-row project-side" data-working={s.report ? undefined : true} onClick={() => onOpenThread(s.conversation)}>
                  <svg className="proj-glyph" viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="7" width="11" height="8.5" rx="2.5" /><path d="M10 7V4.5M8 11h.01M12 11h.01" /></svg>
                  <span className="proj-row-text"><span className="proj-row-title">{s.botName}</span><span className="proj-row-sub">{s.report ? 'Reported back' : 'Working'} · {s.ask}</span></span>
                  <Chevron />
                </button>
              ))}
            </li>
          ))}
        </ul>
        {projects.problem && !projects.asking && <p className="field-error proj-row-note" role="alert">{projects.problem}</p>}
        <MoveHere projects={projects} project={p} conversations={conversations} />
      </Group>
      {threadMenu && createPortal(
        <ContextMenu x={threadMenu.x} y={threadMenu.y} label={threadMenu.title} onClose={() => setThreadMenu(null)} items={[
          { action: 'open', run: () => onOpenThread(threadMenu.id) },
          { action: 'move', label: 'Remove from project', separated: true, run: () => void projects.removeThread(p.id, threadMenu.id) },
        ]} />,
        document.body,
      )}
      <ProjectMade items={made} onOpenMade={onOpenMade} onOpenFiles={() => onOpenFiles(p)} />
      <ProjectMemory project={p} incoming={incoming} onOpen={() => onOpenMemory(p)} />
      <ProjectRules projects={projects} project={p} />
    </section>
  );
}
