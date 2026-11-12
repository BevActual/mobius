import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { conversationIdFor, type Bot, type ConversationInfo, type Message, type ProjectInfo, type ProjectLevel, type WikiChange } from '@mobius/shared';
import { appName, type AppId } from './apps';
import type { WikiIncoming } from './Wiki';
import { changeTarget } from './actions';
import { EmptyState } from './EmptyState';

/** The empty page's New project opens the sidebar's naming field. */
const NEW_PROJECT = 'mobius-projects-new';

/** The apps a project can set a level for, as Settings lists them. */
const RULE_APPS: readonly AppId[] = ['notes', 'docs', 'sheets', 'slides', 'tasks', 'calendar', 'mail', 'browser', 'research', 'reader', 'code', 'database', 'design', 'canvas', 'photo', 'studio', 'video', 'skills'];
const LEVELS: readonly { id: ProjectLevel | 'follow'; name: string }[] = [
  { id: 'follow', name: 'As in Settings' },
  { id: 'ask', name: 'Ask first' },
  { id: 'propose', name: 'Propose' },
  { id: 'act', name: 'Act' },
];

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
  const setRule = async (id: string, app: AppId, level: ProjectLevel | 'follow') => { setProblem(failed(await api?.setRule(id, app, level).catch(() => null))); await load(); };
  const addThread = async (id: string, conversation: string) => { const r = await api?.addThread(id, conversation).catch(() => null); setProblem(failed(r)); await load(); return failed(r) === null; };
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
  const remove = async (id: string) => { await api?.remove(id).catch(() => null); setOpenId(null); await load(); };
  const open = list.find((p) => p.id === openId) ?? list[0] ?? null;
  return { available: api !== undefined, list, open, setOpenId, create, rename, setRule, addThread, askBot, remove, problem };
}
export type ProjectsState = ReturnType<typeof useProjects>;

export function ProjectsSidebar({ projects, pin, conversations }: { projects: ProjectsState; pin?: ReactNode; conversations: readonly ConversationInfo[] }) {
  const [naming, setNaming] = useState(false);
  useEffect(() => { const go = () => setNaming(true); window.addEventListener(NEW_PROJECT, go); return () => window.removeEventListener(NEW_PROJECT, go); }, []);
  const [name, setName] = useState('');
  const waiting = (p: ProjectInfo) => conversations.filter((c) => p.threads.includes(c.id)).reduce((n, c) => n + c.waiting, 0);
  return (
    <aside className="side projects-side" aria-label="Projects sidebar">
      <div className="side-head">
        <span className="side-title">Projects</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New project" title="New project" onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </span>
      </div>
      {naming && (
        <form className="notes-name" onSubmit={(e) => { e.preventDefault(); void projects.create(name).then((ok) => { if (ok) { setNaming(false); setName(''); } }); }}>
          <input autoFocus aria-label="Project name" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
        </form>
      )}
      {projects.problem && <p className="field-error" role="alert">{projects.problem}</p>}
      {projects.list.length === 0 && !naming && <p className="side-empty">No projects yet.</p>}
      <nav className="task-lists" aria-label="Projects">
        <ul role="list">
          {projects.list.map((p) => (
            <li key={p.id}>
              <button type="button" className="list-row" aria-current={projects.open?.id === p.id ? 'page' : undefined} onClick={() => projects.setOpenId(p.id)}>
                <span className="list-name">{p.name}</span>
                {waiting(p) > 0 && <span className="list-count" aria-label={`${waiting(p)} waiting for you`}>{waiting(p)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

/** Move a conversation that is in no project into this one: from then on, the project's rules count in it. */
function MoveHere({ projects, project, conversations }: { projects: ProjectsState; project: ProjectInfo; conversations: readonly ConversationInfo[] }) {
  const taken = new Set(projects.list.flatMap((x) => x.threads));
  const free = conversations.filter((c) => !taken.has(c.id) && c.messages > 0);
  if (free.length === 0) return null;
  return (
    <select aria-label={`Move a conversation into ${project.name}`} value="" onChange={(e) => { if (e.target.value) void projects.addThread(project.id, e.target.value); }}>
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

/** The project's name, and Rename: its folder in Files and its memory page in the Wiki follow the new name. */
function ProjectTitle({ projects, project }: { projects: ProjectsState; project: ProjectInfo }) {
  const [naming, setNaming] = useState<string | null>(null);
  if (naming === null) {
    return (
      <div className="project-title">
        <h1 className="ext-title">{project.name}</h1>
        <button type="button" className="review-btn" onClick={() => setNaming(project.name)}>Rename</button>
      </div>
    );
  }
  return (
    <form className="project-title" onSubmit={(e) => { e.preventDefault(); void projects.rename(project.id, naming).then((ok) => { if (ok) setNaming(null); }); }}>
      <input autoFocus aria-label="Project name" value={naming} maxLength={60} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null); }} />
      <button type="button" className="review-btn" onClick={() => setNaming(null)}>Cancel</button>
      <button type="submit" className="review-btn" data-kind="keep">Save</button>
      {projects.problem && <span className="field-error" role="alert">{projects.problem}</span>}
    </form>
  );
}

/** The project's memory page, as Markdown in the Wiki. */
export const memoryPage = (project: ProjectInfo) => `Projects/${project.name.trim().replace(/\.+$/, '')}.md`;

/**
 * What the project knows: its memory page's lines, and what Mobius proposed for it in the project's threads, dashed
 * until kept (Keep adds the line to the page; Discard drops it).
 */
function ProjectMemory({ project, incoming, onOpen }: { project: ProjectInfo; incoming: WikiIncoming; onOpen: () => void }) {
  const page = memoryPage(project);
  const [lines, setLines] = useState<string[]>([]);
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
    <section className="project-card" aria-label="Project memory">
      <h2 className="ext-heading">Memory</h2>
      <p className="wiki-private">What this project knows, as a page in Knowledge that you and Mobius both read.</p>
      {problem && <p className="field-error" role="alert">{problem}</p>}
      <ul className="wiki-lines" role="list" aria-label="What this project knows">
        {lines.map((l, i) => <li key={`${i}-${l}`} className="wiki-line"><span className="wiki-line-text">{l}</span></li>)}
        {proposed.map((c) => (
          <li key={c.id} className="wiki-line" data-proposed aria-label={`${c.text}, proposed by ${c.from}`}>
            <span className="wiki-line-text">{c.text}</span>
            <span className="wiki-line-actions">
              <span className="wiki-learned">Proposed by {c.from}</span>
              <button type="button" className="review-btn" onClick={() => void act(c, false)}>Discard</button>
              <button type="button" className="review-btn" data-kind="keep" onClick={() => void act(c, true)}>Keep</button>
            </span>
          </li>
        ))}
      </ul>
      {lines.length === 0 && proposed.length === 0 && <p className="note-empty">Nothing yet. What Mobius learns in this project's threads waits here for you to keep.</p>}
      <button type="button" className="btn" onClick={onOpen}>Open in Knowledge</button>
    </section>
  );
}

/** What the project's threads made or changed, newest first, each opening in its app. */
function ProjectMade({ project, conversations, onOpenMade, onOpenFiles }: { project: ProjectInfo; conversations: readonly ConversationInfo[]; onOpenMade: (path: string) => void; onOpenFiles: () => void }) {
  const [made, setMade] = useState<string[] | null>(null);
  // Asked again when a thread grows, since a finished turn may have made something.
  const growth = conversations.filter((c) => project.threads.includes(c.id)).reduce((n, c) => n + c.messages, 0);
  useEffect(() => {
    let live = true;
    void window.mobius.projects?.made?.(project.id).then((got) => { if (live) setMade(Array.isArray(got) ? got : []); }).catch(() => { if (live) setMade([]); });
    return () => { live = false; };
  }, [project.id, growth]);
  const items = (made ?? []).map((path) => ({ path, target: changeTarget(path) })).filter((m) => m.target !== null);
  return (
    <section className="project-card" aria-label="Made in this project">
      <h2 className="ext-heading">Made in this project</h2>
      {made !== null && items.length === 0 && <p className="note-empty">Nothing yet. What Mobius makes or changes in this project's threads shows here.</p>}
      {items.length > 0 && (
        <ul className="clist" role="list" aria-label="Made in this project">
          {items.map(({ path, target }) => (
            <li key={path}><button type="button" className="files-row" onClick={() => onOpenMade(path)}><span className="ext-name">{madeTitle(path)}</span><span className="ext-state">{appName(target!.app)}</span></button></li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" onClick={onOpenFiles}>Open the project's folder</button>
    </section>
  );
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
  const changed = RULE_APPS.filter((app) => (p.rules[app] ?? 'follow') !== 'follow');
  const [open, setOpen] = useState(false);
  const summary = changed.length === 0 ? 'As in Settings' : changed.map((app) => `${appName(app)}: ${LEVELS.find((l) => l.id === p.rules[app])?.name ?? ''}`).join(' · ');
  return (
    <section className="project-card" aria-label="Rules for this project">
      <div className="project-rules-head">
        <h2 className="ext-heading">Rules</h2>
        <span className="ext-state">{summary}</span>
        <button type="button" className="btn link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Done' : 'Change'}</button>
      </div>
      {open && (
        <>
          <p className="wiki-private">How much Mobius may do in each app here. Paying, sending, deleting and commands always ask.</p>
          <ul className="project-rules" role="list">
            {RULE_APPS.map((app) => (
              <li key={app} className="project-rule">
                <span>{appName(app)}</span>
                <select aria-label={`${appName(app)} in ${p.name}`} value={p.rules[app] ?? 'follow'} onChange={(e) => void projects.setRule(p.id, app, e.target.value as ProjectLevel | 'follow')}>
                  {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * A project as a place: what waits on you, its threads and what they made first, then its memory (a Knowledge page)
 * and its rules (how much Mobius may do in each app there), folded into one line.
 */
export function ProjectPage({ projects, conversations, incoming, onOpenThread, onNewThread, onOpenMemory, onOpenFiles, onOpenMade }: {
  projects: ProjectsState;
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
  const threads = p.threads.map((id) => ({ id, info: conversations.find((c) => c.id === id) }));
  const waiting = threads.filter((t) => (t.info?.waiting ?? 0) > 0);
  return (
    <section className="skills-page project-page" aria-label={p.name}>
      <ProjectTitle key={p.id} projects={projects} project={p} />
      {waiting.length > 0 && (
        <section className="project-card project-waiting" aria-label="Waiting on you">
          <h2 className="ext-heading">Waiting on you</h2>
          <ul className="clist" role="list">
            {waiting.map((t) => <li key={t.id}><button type="button" className="files-row" onClick={() => onOpenThread(t.id)}><span className="ext-name">{t.info?.title || 'A thread'}</span><span className="ext-state">{t.info?.waiting === 1 ? '1 question' : `${t.info?.waiting} questions`}</span></button></li>)}
          </ul>
        </section>
      )}
      <section className="project-card" aria-label="Chat and threads">
        <h2 className="ext-heading">Threads</h2>
        {threads.length === 0 && <p className="note-empty">No threads yet.</p>}
        <ul className="clist" role="list" aria-label="Threads">
          {threads.map((t) => (
            <li key={t.id}>
              <button type="button" className="files-row" onClick={() => onOpenThread(t.id)}><span className="ext-name">{t.info?.title || 'New thread'}</span>{t.info && <span className="ext-state">{t.info.messages === 1 ? '1 message' : `${t.info.messages} messages`}</span>}</button>
              {(p.sides ?? []).filter((s) => s.parent === t.id).map((s) => (
                <button key={s.conversation} type="button" className="files-row project-side" onClick={() => onOpenThread(s.conversation)}>
                  <span className="ext-name">{s.botName}</span><span className="ext-state">{s.report ? 'Reported back' : 'Working'} · {s.ask}</span>
                </button>
              ))}
            </li>
          ))}
        </ul>
        <div className="project-thread-actions">
          <button type="button" className="btn primary" onClick={() => onNewThread(p.id)}>New thread</button>
          <MoveHere projects={projects} project={p} conversations={conversations} />
        </div>
      </section>
      <ProjectMade project={p} conversations={conversations} onOpenMade={onOpenMade} onOpenFiles={() => onOpenFiles(p)} />
      <ProjectMemory project={p} incoming={incoming} onOpen={() => onOpenMemory(p)} />
      <ProjectRules projects={projects} project={p} />
    </section>
  );
}
