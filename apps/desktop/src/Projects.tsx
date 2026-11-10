import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ConversationInfo, ProjectInfo, ProjectLevel, WikiChange } from '@mobius/shared';
import { appName, type AppId } from './apps';
import type { WikiIncoming } from './Wiki';

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
  const remove = async (id: string) => { await api?.remove(id).catch(() => null); setOpenId(null); await load(); };
  const open = list.find((p) => p.id === openId) ?? list[0] ?? null;
  return { available: api !== undefined, list, open, setOpenId, create, setRule, addThread, remove, problem };
}
export type ProjectsState = ReturnType<typeof useProjects>;

export function ProjectsSidebar({ projects, pin, conversations }: { projects: ProjectsState; pin?: ReactNode; conversations: readonly ConversationInfo[] }) {
  const [naming, setNaming] = useState(false);
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
      {projects.list.length === 0 && !naming && <div className="side-empty notes-empty"><p>A project is a place for one piece of work: its threads, its rules, its memory and its files.</p><button type="button" className="btn primary" onClick={() => setNaming(true)}>New project</button></div>}
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
      <p className="wiki-private">What this project knows, as a page in the Wiki that you and Mobius both read.</p>
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
      <button type="button" className="btn" onClick={onOpen}>Open in Wiki</button>
    </section>
  );
}

/**
 * A project as a place: what waits on you, its rules (how much Mobius may do in each app there), its memory (a wiki
 * page), its threads and what was made in it (a Files folder).
 */
export function ProjectPage({ projects, conversations, incoming, onOpenThread, onNewThread, onOpenMemory, onOpenFiles }: {
  projects: ProjectsState;
  incoming: WikiIncoming;
  conversations: readonly ConversationInfo[];
  onOpenThread: (conversation: string) => void;
  onNewThread: (project: string) => void;
  onOpenMemory: (project: ProjectInfo) => void;
  onOpenFiles: (project: ProjectInfo) => void;
}) {
  const p = projects.open;
  if (!projects.available) return <section className="skills-page empty" aria-label="Projects"><p className="note-empty">Projects are not available here.</p></section>;
  if (!p) return <section className="skills-page empty" aria-label="Projects"><p className="note-empty">Make a project on the left.</p></section>;
  const threads = p.threads.map((id) => ({ id, info: conversations.find((c) => c.id === id) }));
  const waiting = threads.filter((t) => (t.info?.waiting ?? 0) > 0);
  return (
    <section className="skills-page project-page" aria-label={p.name}>
      <h1 className="ext-title">{p.name}</h1>
      {waiting.length > 0 && (
        <section className="project-card project-waiting" aria-label="Waiting on you">
          <h2 className="ext-heading">Waiting on you</h2>
          <ul className="clist" role="list">
            {waiting.map((t) => <li key={t.id}><button type="button" className="files-row" onClick={() => onOpenThread(t.id)}><span className="ext-name">{t.info?.title || 'A thread'}</span><span className="ext-state">{t.info?.waiting === 1 ? '1 question' : `${t.info?.waiting} questions`}</span></button></li>)}
          </ul>
        </section>
      )}
      <section className="project-card" aria-label="Rules for this project">
        <h2 className="ext-heading">Rules for this project</h2>
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
      </section>
      <ProjectMemory project={p} incoming={incoming} onOpen={() => onOpenMemory(p)} />
      <section className="project-card" aria-label="Chat and threads">
        <h2 className="ext-heading">Chat and threads</h2>
        {threads.length === 0 && <p className="note-empty">No threads yet.</p>}
        <ul className="clist" role="list" aria-label="Threads">
          {threads.map((t) => <li key={t.id}><button type="button" className="files-row" onClick={() => onOpenThread(t.id)}><span className="ext-name">{t.info?.title || 'New thread'}</span>{t.info && <span className="ext-state">{t.info.messages === 1 ? '1 message' : `${t.info.messages} messages`}</span>}</button></li>)}
        </ul>
        <button type="button" className="btn primary" onClick={() => onNewThread(p.id)}>New thread</button>
      </section>
      <section className="project-card" aria-label="Made in this project">
        <h2 className="ext-heading">Made in this project</h2>
        <button type="button" className="btn" onClick={() => onOpenFiles(p)}>Open in Files</button>
      </section>
    </section>
  );
}
