import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import type { TaskItem } from '@mobius/shared';
import { DEFAULT_LIST_NAME, dueLabel, isoDay, smartView, splitDone, type SmartView } from './tasks-view';
import type { TasksState } from './useTasks';
import { ReviewActions, WhyThis } from './ReviewBar';
import { keepTurn, turnId } from './ReviewStrip';
import { tasksIn } from './tasks-view';
import { SideNew, type Start } from './SideNew';

const SMART: { id: SmartView; name: string }[] = [
  { id: 'today', name: 'Today' },
  { id: 'scheduled', name: 'Scheduled' },
];

/** The lists: two views across every list, then each list with how many tasks are still open. */
/** `changed`: lists the agent's last turn changed. */
export function TasksSidebar({ tasks, pin, changed, pinned, onPin, starts, onStart }: { tasks: TasksState; pin: ReactNode; changed?: ReadonlySet<string>; pinned?: ReadonlySet<string>; onPin?: (name: string) => void; starts?: readonly Start[]; onStart?: (prompt: string) => void }) {
  const [naming, setNaming] = useState(false);
  // The menus' New list opens the same naming field.
  useEffect(() => onCommand('new-list', () => setNaming(true)), []);
  const [name, setName] = useState('');
  const now = new Date();
  const count = (id: SmartView) => smartView(id, tasks.all, now).length;
  const current = (kind: 'list' | 'smart', id: string) => (tasks.view.kind === kind && (tasks.view.kind === 'list' ? tasks.view.name : tasks.view.id) === id ? 'page' : undefined);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await tasks.createList(name.trim() || 'List')) { setNaming(false); setName(''); }
  };
  return (
    <aside className="side tasks-side" aria-label="Tasks sidebar">
      <div className="side-head">
        <span className="side-title">Lists</span>
        <span className="side-actions">
          {pin}
        </span>
      </div>
      <nav className="task-lists" aria-label="Lists">
        <SideNew item="list" onNew={() => setNaming(true)} {...(starts ? { starts } : {})} {...(onStart ? { onStart } : {})} />
        <ul role="list">
          {SMART.map((v) => (
            <li key={v.id}>
              <button type="button" className="list-row" aria-current={current('smart', v.id)} onClick={() => tasks.setView({ kind: 'smart', id: v.id })}>
                <span className="list-name">{v.name}</span>
                <span className="list-count">{count(v.id) || ''}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="list-divider" role="separator" />
        <ul role="list" aria-label="My lists">
          {tasks.lists.map((l) => (
            <li key={l.name}>
              <button type="button" className="list-row" data-proposed={changed?.has(l.name) || undefined} aria-current={current('list', l.name)} onClick={() => tasks.setView({ kind: 'list', name: l.name })}>
                <span className="list-name">{l.name}</span>
                {changed?.has(l.name) && <span className="changed-mark" role="img" aria-label="Changed by the agent" title="Changed by the agent in its last turn" />}
                <span className="list-count">{l.open || ''}</span>
              </button>
              {onPin && <button type="button" className="list-pin" aria-pressed={pinned?.has(l.name) ?? false} aria-label={pinned?.has(l.name) ? `Unpin ${l.name}` : `Pin ${l.name} to the sidebar`} title={pinned?.has(l.name) ? 'Unpin from the sidebar' : 'Pin to the sidebar'} onClick={() => onPin(l.name)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h6M8 3v6l-3 4h10l-3-4V3M10 13v4" /></svg>
              </button>}
            </li>
          ))}
        </ul>
        {naming && (
          <form className="notes-name" onSubmit={(e) => void submit(e)}>
            <input autoFocus aria-label="List name" placeholder="List name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
            <button type="submit" className="btn primary">Create</button>
          </form>
        )}
      </nav>
    </aside>
  );
}

function Due({ due, now }: { due: string; now: Date }) {
  const { text, tone } = dueLabel(due, now);
  return <span className="task-due" data-tone={tone}>{text}</span>;
}

function TaskRow({ tasks, list, task, showList, now, proposed = false }: { tasks: TasksState; list: string; task: TaskItem; showList: boolean; now: Date; proposed?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState(task.text);
  const [dating, setDating] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) field.current?.select(); }, [editing]);
  const finish = (keep: boolean) => {
    setEditing(false);
    const next = words.trim();
    if (keep && next && next !== task.text) void tasks.change(list, task, { text: next });
    else setWords(task.text);
  };
  return (
    <li className="task" data-done={task.done || undefined} data-fresh={tasks.isFresh(list, task) || undefined} data-proposed={proposed || undefined}>
      <button type="button" role="checkbox" aria-checked={task.done} aria-label={task.text} className="task-check" onClick={() => void tasks.change(list, task, { done: !task.done })}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5 7 11l5-6" /></svg>
      </button>
      <div className="task-body">
        {editing ? (
          <input ref={field} className="task-edit" aria-label={`Edit ${task.text}`} value={words} maxLength={500} onChange={(e) => setWords(e.target.value)} onBlur={() => finish(true)} onKeyDown={(e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }} />
        ) : (
          <button type="button" className="task-text" title="Click to change" onClick={() => { setWords(task.text); setEditing(true); }}>{task.text}</button>
        )}
        {(task.due || showList) && (
          <span className="task-meta">
            {task.due && <Due due={task.due} now={now} />}
            {showList && <span className="task-list">{list}</span>}
          </span>
        )}
      </div>
      <span className="task-tools">
        {dating ? (
          <input type="date" className="task-date" aria-label={`Due date for ${task.text}`} autoFocus defaultValue={task.due ?? ''}
            onChange={(e) => { setDating(false); void tasks.change(list, task, { due: e.target.value || null }); }} onBlur={() => setDating(false)} onKeyDown={(e) => { if (e.key === 'Escape') setDating(false); }} />
        ) : (
          <button type="button" className="strip-btn" aria-label={`Set a due date for ${task.text}`} title="Due date" onClick={() => setDating(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4.5" width="13" height="12" rx="1.5" /><path d="M3.5 8h13M7 3v3M13 3v3" /></svg>
          </button>
        )}
        {task.due && !dating && (
          <button type="button" className="strip-btn" aria-label={`Clear the due date for ${task.text}`} title="Clear due date" onClick={() => void tasks.change(list, task, { due: null })}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
          </button>
        )}
        <button type="button" className="strip-btn" aria-label={`Delete ${task.text}`} title="Delete" onClick={() => void tasks.remove(list, task)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2M6.5 6l.7 10h5.6l.7-10" /></svg>
        </button>
      </span>
    </li>
  );
}

/**
 * What Mobius's last turn did to a list, while it waits to be kept: the tasks it added (dashed until kept), and the
 * review bar's answers. Discard puts the list back as it was before that turn.
 */
function useListReview(conversation: string | null, list: string | null) {
  // The tasks the list had before the turn; null until read. A list the turn made had none.
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null);
  const [turn, setTurn] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setProblem(null);
    if (!conversation || !list) { setBefore(null); setTurn(null); return undefined; }
    let live = true;
    void (async () => {
      const last = await window.mobius.changes?.lastTurn(conversation).catch(() => null);
      const before = await window.mobius.changes?.before(conversation, `tasks/${list}.md`).catch(() => null);
      if (!live) return;
      setTurn(last && 'checkpoint' in last ? turnId(conversation, last.checkpoint) : null);
      setBefore(before && before.ok ? tasksIn(before.text ?? '') : null);
    })();
    return () => { live = false; };
  }, [conversation, list]);
  return {
    /** A task Mobius added in that turn. */
    isNew: (text: string) => before !== null && !before.has(text),
    problem,
    keep: () => { if (turn) keepTurn(turn); },
    discard: async () => {
      if (!conversation || !list) return null;
      const result = await window.mobius.changes.undoFile(conversation, `tasks/${list}.md`).catch(() => ({ ok: false as const, error: 'That could not be put back.' }));
      if (!result.ok) { setProblem(result.error); return result.error; }
      if (turn) keepTurn(turn);
      return null;
    },
  };
}

/** The open list or view: a field to add to it at the top, the open tasks, and the completed ones folded away. */
export function TasksPage({ tasks, focusToken = 0, review = null }: { tasks: TasksState; focusToken?: number; /** Mobius's last turn changed the open list, and it waits to be kept. */ review?: { conversation: string } | null }) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [showDone, setShowDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusToken) input.current?.focus(); }, [focusToken]);
  const now = new Date();
  const view = tasks.view;
  const title = view.kind === 'list' ? view.name : SMART.find((s) => s.id === view.id)!.name;
  // A task typed in Today is due today; anything typed outside a list lands in the Inbox.
  const target = view.kind === 'list' ? view.name : DEFAULT_LIST_NAME;
  const rows = view.kind === 'list'
    ? (tasks.all[view.name] ?? []).map((task) => ({ list: view.name, task }))
    : smartView(view.id, tasks.all, now);
  const { open, done } = view.kind === 'list' ? (() => { const s = splitDone(rows.map((r) => r.task)); return { open: s.open.map((task) => ({ list: view.name, task })), done: s.done.map((task) => ({ list: view.name, task })) }; })() : { open: rows, done: [] };

  const proposal = useListReview(review?.conversation ?? null, review && view.kind === 'list' ? view.name : null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (!words) return;
    const date = due || (view.kind === 'smart' && view.id === 'today' ? isoDay(now) : null);
    if (await tasks.add(target, words, date)) { setText(''); setDue(''); input.current?.focus(); }
  };

  return (
    <section className="tasks-page" aria-label={title}>
      {review && view.kind === 'list' && (
        <div className="note-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">Mobius changed this list in its last turn.<WhyThis conversation={review.conversation} /></span>
          <ReviewActions onKeep={proposal.keep} onDiscard={proposal.discard} discardTitle="Put this list back as it was before that turn" keepTitle="Keep what Mobius changed in that turn" />
          {proposal.problem && <span className="review-problem" role="alert">{proposal.problem}</span>}
        </div>
      )}
      <form className="task-new" data-typing={text !== '' || due !== '' || undefined} onSubmit={(e) => void submit(e)}>
        <span className="task-check ghost" aria-hidden="true" />
        <input ref={input} aria-label="New task" placeholder={view.kind === 'list' ? `Add to ${view.name}` : view.id === 'today' ? 'Add something for today' : `Add to ${DEFAULT_LIST_NAME}`} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
        <input type="date" className="task-date" aria-label="Due date for the new task" value={due} onChange={(e) => setDue(e.target.value)} />
      </form>
      {tasks.message && <p className="tasks-message" role="alert">{tasks.message}</p>}
      <ul className="task-items" role="list" aria-label="To do">
        {open.map(({ list, task }) => <TaskRow key={`${list}:${task.line}:${task.text}`} tasks={tasks} list={list} task={task} showList={view.kind === 'smart'} now={now} proposed={review !== null && view.kind === 'list' && proposal.isNew(task.text)} />)}
      </ul>
      {open.length === 0 && done.length === 0 && (
        <p className="tasks-empty">{view.kind === 'smart' ? (view.id === 'today' ? 'Nothing is due today.' : 'Nothing has a date yet.') : 'Type above to add a task, or ask the agent to plan it with you.'}</p>
      )}
      {done.length > 0 && (
        <div className="tasks-done">
          <div className="tasks-done-head">
            <button type="button" className="notebook-toggle" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
              <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>
              <span>Completed · {done.length}</span>
            </button>
            {showDone && view.kind === 'list' && <button type="button" className="btn" onClick={() => void tasks.clearDone(view.name)}>Clear</button>}
          </div>
          {showDone && (
            <ul className="task-items" role="list" aria-label="Completed">
              {done.map(({ list, task }) => <TaskRow key={`${list}:${task.line}:${task.text}`} tasks={tasks} list={list} task={task} showList={false} now={now} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
