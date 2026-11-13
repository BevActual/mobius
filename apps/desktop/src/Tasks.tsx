import { RowMark } from './RowMark';
import { createPortal } from 'react-dom';
import { ContextMenu } from './ContextMenu';
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import type { TaskItem } from '@mobius/shared';
import { byDay, byList, DEFAULT_LIST_NAME, dueLabel, isoDay, listColor, nest, parseWhen, searchTasks, SMART_VIEWS, smartName, smartView, splitDone, type Located, type SmartView } from './tasks-view';
import type { TasksState } from './useTasks';
import { ReviewActions, WhyThis } from './ReviewBar';
import { keepTurn, turnId } from './ReviewStrip';
import { tasksIn } from './tasks-view';
import { SideNew, type Start } from './SideNew';
import { FromMobius } from './FromMobius';
import { dayLabel } from './dates';
import './tasks.css';

/** A task being dragged: which list it is in and where. */
const DRAG = 'application/x-mobius-task';
interface Dragged { list: string; line: number; text: string }
const dragged = (e: DragEvent): Dragged | null => { try { return JSON.parse(e.dataTransfer.getData(DRAG)) as Dragged; } catch { return null; } };
const isTaskDrag = (e: DragEvent) => e.dataTransfer.types.includes(DRAG);
const findTask = (tasks: TasksState, d: Dragged) => (tasks.all[d.list] ?? []).find((t) => t.line === d.line && t.text === d.text) ?? null;
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** Moves the keyboard to the task row before or after this one on the page (or back to the add field from the first). */
function stepRow(from: HTMLElement, by: 1 | -1) {
  const page = from.closest('.tasks-main');
  if (!page) return;
  const rows = [...page.querySelectorAll<HTMLElement>('.task-line[tabindex]')];
  const at = rows.indexOf(from);
  const next = rows[at + by];
  if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
  else if (by === -1) page.querySelector<HTMLInputElement>('.task-new input[aria-label="New task"]')?.focus();
}

/** The smart lists' marks: a white glyph on a coloured circle, as in Apple's Reminders. */
function SmartIcon({ id }: { id: SmartView }) {
  const glyph: Record<SmartView, ReactNode> = {
    today: <><rect x="5" y="6" width="10" height="9" rx="1.5" /><path d="M5 9h10M8 4.5v3M12 4.5v3" /></>,
    scheduled: <><rect x="5" y="6" width="10" height="9" rx="1.5" /><path d="M5 9h10M8 11.5h1M11 11.5h1M8 13.5h1" /></>,
    all: <><path d="M5.5 6.5h9M5.5 10h9M5.5 13.5h9" /></>,
    flagged: <path d="M7 15.5V5.2c2.4-1.3 4 1 6.5-.2v5.6c-2.5 1.2-4.1-1.1-6.5.2" />,
    completed: <path d="M6 10.3 8.8 13 14 7.2" />,
  };
  return <span className="smart-icon" data-view={id} aria-hidden="true"><svg viewBox="0 0 20 20">{glyph[id]}</svg></span>;
}

function ListIcon({ name }: { name: string }) {
  return <span className="list-icon" data-color={listColor(name)} aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M7.5 7h6M7.5 10h6M7.5 13h6" /><circle cx="5.3" cy="7" r=".6" /><circle cx="5.3" cy="10" r=".6" /><circle cx="5.3" cy="13" r=".6" /></svg></span>;
}

/** The lists: a search field, the views across every list as tiles, then each list with how many tasks are open. */
/** `changed`: lists the agent's last turn changed. */
export function TasksSidebar({ tasks, pin, changed, pinned, onPin, starts, onStart }: { tasks: TasksState; pin: ReactNode; changed?: ReadonlySet<string>; pinned?: ReadonlySet<string>; onPin?: (name: string) => void; starts?: readonly Start[]; onStart?: (prompt: string) => void }) {
  const [naming, setNaming] = useState(false);
  // The menus' New list opens the same naming field.
  useEffect(() => onCommand('new-list', () => setNaming(true)), []);
  // The page's own Mobius starts fill the message box the same way.
  useEffect(() => { if (onStart) tasks.ask.current = onStart; }, [onStart, tasks.ask]);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const now = new Date();
  const count = (id: SmartView) => (id === 'completed' ? 0 : smartView(id, tasks.all, now).length);
  const searching = tasks.query.trim() !== '';
  const current = (kind: 'list' | 'smart', id: string) => (!searching && tasks.view.kind === kind && (tasks.view.kind === 'list' ? tasks.view.name : tasks.view.id) === id ? 'page' : undefined);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await tasks.createList(name.trim() || 'List')) { setNaming(false); setName(''); }
  };
  const drop = (list: string) => ({
    onDragOver: (e: DragEvent) => { if (isTaskDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropOn(list); } },
    onDragLeave: () => setDropOn((d) => (d === list ? null : d)),
    onDrop: (e: DragEvent) => {
      setDropOn(null);
      const d = dragged(e);
      const task = d && findTask(tasks, d);
      if (d && task && d.list !== list) { e.preventDefault(); void tasks.move(d.list, task, list); }
    },
  });
  const deletingInfo = tasks.lists.find((l) => l.name === deleting);
  return (
    <aside className="side tasks-side" aria-label="Tasks sidebar">
      <input className="side-search" type="search" aria-label="Search tasks" placeholder="Search" value={tasks.query} onChange={(e) => tasks.setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') tasks.setQuery(''); }} />
      <SideNew item="list" onNew={() => setNaming(true)} {...(starts ? { starts } : {})} {...(onStart ? { onStart } : {})} />
      <div className="side-head">
        <span className="side-title">Lists</span>
        <span className="side-actions">
          {pin}
        </span>
      </div>
      <nav className="task-lists" aria-label="Lists">
        <ul role="list" className="smart-tiles" aria-label="Views">
          {SMART_VIEWS.map((v) => (
            <li key={v.id}>
              <button type="button" className="smart-tile" aria-current={current('smart', v.id)} onClick={() => tasks.setView({ kind: 'smart', id: v.id })}>
                <SmartIcon id={v.id} />
                <span className="list-name">{v.name}</span>
                <span className="smart-count">{v.id === 'completed' ? '' : count(v.id) || ''}</span>
              </button>
            </li>
          ))}
        </ul>
        <h2 className="tasks-side-heading">My Lists</h2>
        {naming && (
          <form className="notes-name" onSubmit={(e) => void submit(e)}>
            <input autoFocus aria-label="List name" placeholder="List name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
            <button type="submit" className="btn primary">Create</button>
          </form>
        )}
        <ul role="list" aria-label="My lists">
          {tasks.lists.map((l) => (
            <li key={l.name} className="list-item" data-drop={dropOn === l.name || undefined} {...drop(l.name)}>
              {renaming === l.name ? (
                <form className="notes-name list-rename" onSubmit={(e) => { e.preventDefault(); const to = new FormData(e.currentTarget).get('name'); void tasks.renameList(l.name, String(to ?? '')).then((ok) => { if (ok) setRenaming(null); }); }}>
                  <input autoFocus name="name" aria-label={`New name for ${l.name}`} defaultValue={l.name} maxLength={80} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} />
                  <button type="submit" className="btn primary">Rename</button>
                </form>
              ) : (
                <>
                  <button type="button" className="list-row" data-proposed={changed?.has(l.name) || undefined} aria-current={current('list', l.name)} onClick={() => tasks.setView({ kind: 'list', name: l.name })}
                    onContextMenu={(e) => { if (l.name !== DEFAULT_LIST_NAME) { e.preventDefault(); setMenu({ name: l.name, x: e.clientX, y: e.clientY }); } }}>
                    <ListIcon name={l.name} />
                    <span className="list-name">{l.name}</span>
                    <RowMark changed={changed?.has(l.name) === true} changedTitle="Changed by Mobius in its last turn" />
                    {!changed?.has(l.name) && <span className="list-count">{l.open || ''}</span>}
                  </button>
                  {onPin && <button type="button" className="list-pin" aria-pressed={pinned?.has(l.name) ?? false} aria-label={pinned?.has(l.name) ? `Unpin ${l.name}` : `Pin ${l.name} to the sidebar`} title={pinned?.has(l.name) ? 'Unpin from the sidebar' : 'Pin to the sidebar'} onClick={() => onPin(l.name)}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h6M8 3v6l-3 4h10l-3-4V3M10 13v4" /></svg>
                  </button>}
                  {l.name !== DEFAULT_LIST_NAME && (
                    <button type="button" className="list-more" aria-label={`More for ${l.name}`} aria-haspopup="menu" aria-expanded={menu?.name === l.name} title="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu((m) => (m?.name === l.name ? null : { name: l.name, x: r.left, y: r.bottom + 4 })); }}>
                      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="1.2" /><circle cx="10" cy="10" r="1.2" /><circle cx="15" cy="10" r="1.2" /></svg>
                    </button>
                  )}
                  {menu?.name === l.name && createPortal(
                    <ContextMenu x={menu.x} y={menu.y} label={l.name} onClose={() => setMenu((m) => (m?.name === l.name ? null : m))} items={[
                      { action: 'rename', label: 'Rename…', run: () => setRenaming(l.name) },
                      { action: 'delete', label: 'Delete list…', danger: true, separated: true, run: () => setDeleting(l.name) },
                    ]} />,
                    document.body,
                  )}
                </>
              )}
              {deleting === l.name && deletingInfo && (
                <div className="list-confirm" role="alertdialog" aria-label={`Delete ${l.name}?`}>
                  <p>Delete “{l.name}”{deletingInfo.open + deletingInfo.done > 0 ? ` and its ${deletingInfo.open + deletingInfo.done} ${deletingInfo.open + deletingInfo.done === 1 ? 'task' : 'tasks'}` : ''}?</p>
                  <div className="list-confirm-actions">
                    <button type="button" className="btn" autoFocus onClick={() => setDeleting(null)}>Cancel</button>
                    <button type="button" className="btn danger" onClick={() => { setDeleting(null); void tasks.deleteList(l.name); }}>Delete</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        <FromMobius items={tasks.lists.filter((l) => changed?.has(l.name)).map((l) => ({ key: l.name, name: l.name, current: current('list', l.name) === 'page', onOpen: () => tasks.setView({ kind: 'list', name: l.name }) }))} />
      </nav>
    </aside>
  );
}

function Due({ due, now }: { due: string; now: Date }) {
  const { text, tone } = dueLabel(due, now);
  return <span className="task-due" data-tone={tone}>{text}</span>;
}

const FlagGlyph = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 16.5V4.5c2.6-1.4 4.6 1.1 7.5-.2v6.4c-2.9 1.3-4.9-1.2-7.5.2" /></svg>;

const HOLD_MS = 1000;
/**
 * Completing a task, as Reminders does: the check fills and the row stays a moment, so a second click takes it back,
 * then the row folds away and the task is marked done. Under Reduce Motion the row only fades.
 */
function useCompleting(commit: () => Promise<unknown> | void) {
  const [on, setOn] = useState(false);
  const row = useRef<HTMLLIElement>(null);
  const timer = useRef<number | null>(null);
  const done = useRef(commit);
  done.current = commit;
  const pending = useRef(false);
  const finish = () => {
    if (!pending.current) return;
    pending.current = false;
    // If the row is still shown once saved (a view that keeps completed tasks), show it again.
    void Promise.resolve(done.current()).finally(() => {
      const li = row.current;
      if (!li) return;
      li.getAnimations().forEach((a) => { a.onfinish = null; a.oncancel = null; a.cancel(); });
      li.style.overflow = '';
      setOn(false);
    });
  };
  const leave = () => {
    timer.current = null;
    const li = row.current;
    if (!li || typeof li.animate !== 'function') return finish();
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const slow = parseFloat(getComputedStyle(li).getPropertyValue('--dur-med')) || 0;
    const frames: Keyframe[] = still
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [{ height: `${li.offsetHeight}px`, opacity: 1, transform: 'none' }, { height: '0px', opacity: 0, transform: 'translateX(24px)' }];
    li.style.overflow = 'hidden';
    const a = li.animate(frames, { duration: still ? 200 : Math.max(slow, 1) * 1.5, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' });
    a.onfinish = finish;
    a.oncancel = finish;
  };
  const toggle = () => {
    if (pending.current) {
      pending.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      row.current?.getAnimations().forEach((a) => { a.onfinish = null; a.oncancel = null; a.cancel(); });
      if (row.current) row.current.style.overflow = '';
      setOn(false);
      return;
    }
    pending.current = true;
    setOn(true);
    timer.current = window.setTimeout(leave, HOLD_MS);
  };
  // Leaving the view mid-way still completes the task.
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); finish(); }, []);
  return { on, row, toggle };
}

interface RowProps {
  tasks: TasksState; list: string; task: TaskItem; subtasks?: TaskItem[]; showList: boolean; now: Date; proposed?: boolean;
  /** Dragging rows to reorder: only in a list, only top-level tasks. */
  reorder?: boolean;
  /** The heading above already names the day, so the row need not say it again. */
  hideDue?: boolean;
}

function TaskRow({ tasks, list, task, subtasks = [], showList, now, proposed = false, reorder = false, hideDue = false }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState(task.text);
  const [dating, setDating] = useState(false);
  const [dropBefore, setDropBefore] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const completing = useCompleting(() => tasks.change(list, task, { done: true }));
  useEffect(() => { if (editing) field.current?.select(); }, [editing]);
  const finish = (keep: boolean) => {
    setEditing(false);
    const next = words.trim();
    if (keep && next && next !== task.text) void tasks.change(list, task, { text: next });
    else setWords(task.text);
  };
  const isPicked = tasks.picked?.list === list && tasks.picked.task.line === task.line;
  const tick = () => { if (task.done) void tasks.change(list, task, { done: false }); else completing.toggle(); };
  const details = () => tasks.pick(isPicked ? null : { list, text: task.text });
  const setDue = (due: string | null) => void tasks.change(list, task, { due });
  const remove = () => { stepRow(line.current!, 1); void tasks.remove(list, task); };
  // The row's own keys, as in Reminders: arrows between tasks, Space ticks, Enter renames, ⌘I details, Delete deletes.
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); stepRow(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === ' ') { e.preventDefault(); tick(); }
    else if (e.key === 'Enter') { e.preventDefault(); setWords(task.text); setEditing(true); }
    else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); details(); }
    else if (e.key === 'Delete' || (e.key === 'Backspace' && mod)) { e.preventDefault(); remove(); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + 40, y: r.bottom - 4 }); }
  };
  const days = quickDays(now);
  const others = tasks.lists.filter((l) => l.name !== list);
  const menuItems = [
    { label: isPicked ? 'Hide Details' : 'Show Details', keys: `${MOD}I`, run: details },
    ...days.map((q, i) => ({ label: `Due ${q.label.replace(/\b\w/g, (c) => c.toUpperCase())}`, separated: i === 0, disabled: task.due === q.day, run: () => setDue(q.day) })),
    ...(task.due ? [{ label: 'No Due Date', run: () => setDue(null) }] : []),
    { label: task.flagged ? 'Unflag' : 'Flag', separated: true, run: () => void tasks.change(list, task, { flagged: !task.flagged }) },
    ...others.map((l, i) => ({ action: 'move' as const, label: `Move to ${l.name}`, separated: i === 0, run: () => void tasks.move(list, task, l.name) })),
    { action: 'delete' as const, label: 'Delete', danger: true, separated: true, keys: 'Del', run: remove },
  ];
  const note = (task.notes ?? '').split('\n')[0] ?? '';
  const subsDone = subtasks.filter((s) => s.done).length;
  return (
    <li ref={completing.row} className="task" data-done={task.done || completing.on || undefined} data-fresh={tasks.isFresh(list, task) || undefined} data-proposed={proposed || undefined} data-picked={isPicked || undefined}
      data-color={listColor(list)} data-sub={task.parent != null || undefined} data-drop={dropBefore || undefined}
      draggable={reorder && !editing && !dating}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG, JSON.stringify({ list, line: task.line, text: task.text })); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={reorder ? (e) => { if (isTaskDrag(e)) { e.preventDefault(); e.stopPropagation(); setDropBefore(true); } } : undefined}
      onDragLeave={() => setDropBefore(false)}
      onDrop={reorder ? (e) => {
        setDropBefore(false);
        const d = dragged(e);
        const moving = d && findTask(tasks, d);
        if (d && moving) { e.preventDefault(); e.stopPropagation(); void tasks.move(d.list, moving, list, task); }
      } : undefined}>
      <div ref={line} className="task-line" tabIndex={-1} aria-label={task.text} data-menu={menu ? true : undefined} onKeyDown={onKey}
        onMouseDown={(e) => { if (e.target === e.currentTarget) e.currentTarget.focus(); }}
        onContextMenu={(e) => { if ((e.target as HTMLElement).closest('input, textarea')) return; e.preventDefault(); e.currentTarget.focus(); setMenu({ x: e.clientX, y: e.clientY }); }}>
        <button type="button" role="checkbox" aria-checked={task.done || completing.on} aria-label={task.text} className="task-check"
          onClick={tick}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5 7 11l5-6" /></svg>
        </button>
        <div className="task-body">
          {editing ? (
            <input ref={field} className="task-edit" aria-label={`Edit ${task.text}`} value={words} maxLength={500} onChange={(e) => setWords(e.target.value)} onBlur={() => finish(true)} onKeyDown={(e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }} />
          ) : (
            <button type="button" className="task-text" title="Click to change" onClick={() => { setWords(task.text); setEditing(true); }}>{task.text}</button>
          )}
          {note && <span className="task-note">{note}</span>}
          {((task.due && !hideDue) || showList || subtasks.length > 0) && (
            <span className="task-meta">
              {task.due && !hideDue && <Due due={task.due} now={now} />}
              {showList && <span className="task-list">{list}</span>}
              {subtasks.length > 0 && <span className="task-subcount">{subsDone} of {subtasks.length}</span>}
            </span>
          )}
        </div>
        {task.flagged && <span className="task-flagged" role="img" aria-label="Flagged" title="Flagged"><FlagGlyph /></span>}
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
          <button type="button" className="strip-btn" aria-pressed={task.flagged ?? false} aria-label={task.flagged ? `Unflag ${task.text}` : `Flag ${task.text}`} title={task.flagged ? 'Unflag' : 'Flag'} onClick={() => void tasks.change(list, task, { flagged: !task.flagged })}>
            <FlagGlyph />
          </button>
          <button type="button" className="strip-btn task-info" aria-pressed={isPicked} aria-label={`Details for ${task.text}`} title={`Details (${MOD}I)`} onClick={details}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 9v5M10 6.4v.2" /></svg>
          </button>
        </span>
        {menu && createPortal(
          <ContextMenu x={menu.x} y={menu.y} label={task.text} items={menuItems} onClose={() => { setMenu(null); line.current?.focus(); }} />,
          document.body,
        )}
      </div>
      {subtasks.length > 0 && (
        <ul className="task-items task-subtasks" role="list" aria-label={`Subtasks of ${task.text}`}>
          {subtasks.map((s) => <TaskRow key={`${s.line}:${s.text}`} tasks={tasks} list={list} task={s} showList={false} now={now} />)}
        </ul>
      )}
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
    keep: () => { if (turn) keepTurn(turn, 'tasks'); },
    discard: async () => {
      if (!conversation || !list) return null;
      const result = await window.mobius.changes.undoFile(conversation, `tasks/${list}.md`).catch(() => ({ ok: false as const, error: 'That could not be put back.' }));
      if (!result.ok) { setProblem(result.error); return result.error; }
      if (turn) keepTurn(turn, 'tasks');
      return null;
    },
  };
}

/** A due date for the details panel: "Tomorrow, 13 Nov" near now, else "Fri 20 Nov", in the computer's format. */
function longDue(due: string, now: Date): string {
  const [y, m, d] = due.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  const near = dueLabel(due, now).text;
  return ['Today', 'Tomorrow', 'Yesterday'].includes(near) ? `${near}, ${dayLabel(date, { now })}` : dayLabel(date, { now, weekday: 'short' });
}

/** Quick days for a due date: today, tomorrow, the next Monday. */
function quickDays(now: Date): { label: string; day: string }[] {
  const plus = (n: number) => isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  return [{ label: 'Today', day: plus(0) }, { label: 'Tomorrow', day: plus(1) }, { label: 'Next week', day: plus(((8 - now.getDay()) % 7) || 7) }];
}

/** A task's details beside the list: words, notes, when, the flag, which list, its subtasks, and Mobius's starts. */
function TaskInspector({ tasks, list, task, onAsk }: { tasks: TasksState; list: string; task: TaskItem; onAsk?: ((prompt: string) => void) | undefined }) {
  const now = new Date();
  const [title, setTitle] = useState(task.text);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [sub, setSub] = useState('');
  const dateField = useRef<HTMLInputElement>(null);
  useEffect(() => { setTitle(task.text); }, [task.text]);
  useEffect(() => { setNotes(task.notes ?? ''); }, [task.notes, task.line]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea')) tasks.pick(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [tasks]);
  const subtasks = (tasks.all[list] ?? []).filter((t) => t.parent === task.line);
  const parent = task.parent != null ? (tasks.all[list] ?? []).find((t) => t.line === task.parent) : undefined;
  const keepTitle = () => { const next = title.trim(); if (next && next !== task.text) void tasks.change(list, task, { text: next }); else setTitle(task.text); };
  const keepNotes = () => { if (notes !== (task.notes ?? '')) void tasks.change(list, task, { notes }); };
  const addSub = async (e: FormEvent) => {
    e.preventDefault();
    const words = sub.trim();
    if (words && await tasks.add(list, words, null, { under: { line: task.line, expect: task.text } })) setSub('');
  };
  const ask = (prompt: string) => onAsk?.(prompt);
  return (
    <aside className="task-inspector" aria-label="Details" data-color={listColor(list)}>
      <header className="task-inspector-head">
        <span className="task-inspector-where">{parent ? `${list} · under “${parent.text}”` : list}</span>
        <button type="button" className="btn" onClick={() => tasks.pick(null)}>Done</button>
      </header>
      <textarea className="task-inspector-title" aria-label="Task" rows={2} value={title} maxLength={500} onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))} onBlur={keepTitle} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
      <textarea className="task-inspector-notes" aria-label="Notes" placeholder="Add notes" rows={2} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} onBlur={keepNotes} />
      <section className="inspector-group" aria-label="When">
        <div className="inspector-row">
          <span className="inspector-label">Due</span>
          {/* A pop-up button with the date in words; the system's date picker opens from it. */}
          <span className="inspector-date" data-tone={task.due ? dueLabel(task.due, now).tone : undefined}>
            <button type="button" className="inspector-date-btn" aria-hidden="true" tabIndex={-1} onClick={() => { try { dateField.current?.showPicker(); } catch { dateField.current?.focus(); } }}>
              {task.due ? longDue(task.due, now) : 'None'}
            </button>
            <input ref={dateField} type="date" className="inspector-date-input" aria-label="Due date" value={task.due ?? ''} onChange={(e) => void tasks.change(list, task, { due: e.target.value || null })} />
          </span>
        </div>
        <div className="inspector-chips">
          {quickDays(now).map((q) => <button key={q.label} type="button" className="chip" aria-pressed={task.due === q.day} onClick={() => void tasks.change(list, task, { due: q.day })}>{q.label}</button>)}
          {task.due && <button type="button" className="chip" onClick={() => void tasks.change(list, task, { due: null })}>No date</button>}
        </div>
      </section>
      <section className="inspector-group">
        <label className="inspector-row inspector-switch">
          <span className="inspector-label"><span className="task-flagged"><FlagGlyph /></span>Flagged</span>
          <input type="checkbox" role="switch" aria-label="Flagged" checked={task.flagged ?? false} onChange={(e) => void tasks.change(list, task, { flagged: e.target.checked })} />
        </label>
        <label className="inspector-row">
          <span className="inspector-label">List</span>
          <select aria-label="List" value={list} onChange={(e) => void tasks.move(list, task, e.target.value)}>
            {tasks.lists.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </label>
      </section>
      {task.parent == null && (
        <section className="inspector-group" aria-label="Subtasks">
          <h3 className="inspector-heading">Subtasks</h3>
          {subtasks.length > 0 && (
            <ul className="inspector-subtasks" role="list">
              {subtasks.map((s) => (
                <li key={s.line} data-done={s.done || undefined}>
                  <button type="button" role="checkbox" aria-checked={s.done} aria-label={s.text} className="task-check" onClick={() => void tasks.change(list, s, { done: !s.done })}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5 7 11l5-6" /></svg>
                  </button>
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
          )}
          <form className="inspector-add" onSubmit={(e) => void addSub(e)}>
            <span className="task-check ghost" aria-hidden="true" />
            <input aria-label="New subtask" placeholder="Add a subtask" value={sub} maxLength={500} onChange={(e) => setSub(e.target.value)} />
          </form>
        </section>
      )}
      {onAsk && (
        <section className="inspector-group inspector-mobius" aria-label="Start with Mobius">
          <button type="button" className="side-start" onClick={() => ask(`Break “${task.text}” (in my ${list} list) into a few subtasks I can tick off.`)}>Break it into steps</button>
          <button type="button" className="side-start" onClick={() => ask(`Help me get “${task.text}” done${task.due ? ` by ${task.due}` : ''}: what do I need, and what should I do first?`)}>Help me do it</button>
        </section>
      )}
      <footer className="task-inspector-foot">
        <button type="button" className="btn danger" onClick={() => void tasks.remove(list, task)}>Delete task</button>
      </footer>
    </aside>
  );
}

/** The add field: a date said at the end ("tomorrow", "by fri") becomes the due date, shown as a chip to take back. */
function NewTask({ tasks, placeholder, target, defaultDue, focusToken }: { tasks: TasksState; placeholder: string; target: string; defaultDue: string | null; focusToken: number }) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [literal, setLiteral] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const typing = useRef(text);
  typing.current = text;
  // A task added where it will not show (Today, for one due tomorrow) says where it went, with a way there.
  const [went, setWent] = useState<{ text: string; when: string } | null>(null);
  useEffect(() => { if (!went) return; const t = window.setTimeout(() => setWent(null), 6000); return () => window.clearTimeout(t); }, [went]);
  useEffect(() => { if (focusToken) input.current?.focus(); }, [focusToken]);
  const now = new Date();
  const said = literal || due ? null : parseWhen(text, now);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const words = (said ? said.text : text).trim();
    if (!words) return;
    const date = due || said?.due || defaultDue;
    // Cleared at once, so the next task can be typed while this one is written; put back only if it was refused and nothing new was typed.
    const typed = { text, due, literal };
    setText(''); setDue(''); setLiteral(false);
    input.current?.focus();
    const added = await tasks.add(target, words, date);
    if (!added && typing.current === '') { setText(typed.text); setDue(typed.due); setLiteral(typed.literal); }
    if (added && tasks.view.kind === 'smart' && tasks.view.id === 'today' && date && date > isoDay(now)) setWent({ text: words, when: dueLabel(date, now).text });
  };
  return (
    <form className="task-new" data-typing={text !== '' || due !== '' || undefined} onSubmit={(e) => void submit(e)}>
      <span className="task-check ghost" aria-hidden="true" />
      <input ref={input} aria-label="New task" placeholder={placeholder} value={text} maxLength={500} onChange={(e) => { setText(e.target.value); if (!e.target.value) setLiteral(false); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { const first = e.currentTarget.closest('.tasks-main')?.querySelector<HTMLElement>('.task-line[tabindex]'); if (first) { e.preventDefault(); first.focus(); } } }} />
      {said && (
        <button type="button" className="chip task-when" title={`“${said.phrase}” sets the due date. Click to keep it as words.`} aria-label={`Due ${dueLabel(said.due, now).text}. Keep “${said.phrase}” as words instead`} onClick={() => { setLiteral(true); input.current?.focus(); }}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4.5" width="13" height="12" rx="1.5" /><path d="M3.5 8h13" /></svg>
          {dueLabel(said.due, now).text}
          <span aria-hidden="true" className="chip-x">×</span>
        </button>
      )}
      <input type="date" className="task-date" aria-label="Due date for the new task" value={due} onChange={(e) => setDue(e.target.value)} />
      {went && (
        <p className="task-went" role="status">
          <span>{`“${went.text}” is due ${went.when}, so it is in Scheduled.`}</span>
          <button type="button" className="review-btn" onClick={() => { setWent(null); tasks.setView({ kind: 'smart', id: 'scheduled' }); }}>Show</button>
        </p>
      )}
    </form>
  );
}

/** The open list or view: a field to add to it at the top, the open tasks, and the completed ones folded away. */
export function TasksPage({ tasks, focusToken = 0, review = null, onAsk }: { tasks: TasksState; focusToken?: number; /** Mobius's last turn changed the open list, and it waits to be kept. */ review?: { conversation: string } | null; onAsk?: (prompt: string) => void }) {
  const [showDone, setShowDone] = useState(false);
  const [dropEnd, setDropEnd] = useState(false);
  const now = new Date();
  const view = tasks.view;
  const query = tasks.query.trim();
  // Undo from the menus puts back the task just deleted.
  useEffect(() => onCommand('undo', () => { if (tasks.deleted) void tasks.undoDelete(); }), [tasks]);
  useEffect(() => { setShowDone(false); }, [view]);
  const ask = onAsk ?? tasks.ask.current ?? undefined;
  // A task typed in Today is due today; anything typed outside a list lands in the Inbox.
  const target = view.kind === 'list' ? view.name : DEFAULT_LIST_NAME;
  const proposal = useListReview(review?.conversation ?? null, review && view.kind === 'list' ? view.name : null);
  const picked = tasks.picked;

  const row = ({ list, task }: Located, opts: { showList: boolean; reorder?: boolean; subtasks?: TaskItem[]; hideDue?: boolean }) => (
    <TaskRow key={`${list}:${task.line}:${task.text}`} tasks={tasks} list={list} task={task} showList={opts.showList} now={now} reorder={opts.reorder ?? false} subtasks={opts.subtasks ?? []} hideDue={opts.hideDue ?? false}
      proposed={review !== null && view.kind === 'list' && proposal.isNew(task.text)} />
  );

  // In a view across lists, a subtask whose task is there too sits under it.
  const withSubtasks = (rows: Located[]) => rows
    .filter((r) => r.task.parent == null || !rows.some((p) => p.list === r.list && p.task.line === r.task.parent))
    .map((at) => ({ at, subtasks: rows.filter((r) => r.list === at.list && r.task.parent === at.task.line).map((r) => r.task) }));

  let body: ReactNode;
  let empty = '';
  if (query) {
    const found = searchTasks(query, tasks.all);
    body = byList(found).map((g) => (
      <section key={g.list} className="tasks-group" data-color={listColor(g.list)} aria-label={g.list}>
        <h2 className="tasks-group-head">{g.list}</h2>
        <ul className="task-items" role="list" aria-label="To do">{g.rows.map((r) => row(r, { showList: false }))}</ul>
      </section>
    ));
    if (found.length === 0) empty = `Nothing matches “${query}”.`;
  } else if (view.kind === 'list') {
    const list = tasks.all[view.name] ?? [];
    const { open, done } = splitDone(nest(list).map((n) => n.task));
    const subsOf = (t: TaskItem) => list.filter((s) => s.parent === t.line && s !== t);
    body = (
      <>
        <ul className="task-items" role="list" aria-label="To do">
          {open.map((task) => row({ list: view.name, task }, { showList: false, reorder: true, subtasks: subsOf(task) }))}
        </ul>
        <div className="task-drop-end" data-drop={dropEnd || undefined}
          onDragOver={(e) => { if (isTaskDrag(e)) { e.preventDefault(); setDropEnd(true); } }} onDragLeave={() => setDropEnd(false)}
          onDrop={(e) => { setDropEnd(false); const d = dragged(e); const t = d && findTask(tasks, d); if (d && t) { e.preventDefault(); void tasks.move(d.list, t, view.name); } }} />
        {done.length > 0 && (
          <div className="tasks-done">
            <div className="tasks-done-head">
              <button type="button" className="notebook-toggle" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>
                <span>Completed · {done.length}</span>
              </button>
              {showDone && <button type="button" className="btn" onClick={() => void tasks.clearDone(view.name)}>Clear</button>}
            </div>
            {showDone && (
              <ul className="task-items" role="list" aria-label="Completed">
                {done.map((task) => row({ list: view.name, task }, { showList: false, subtasks: subsOf(task) }))}
              </ul>
            )}
          </div>
        )}
      </>
    );
    if (open.length === 0 && done.length === 0) empty = 'Type above to add a task, or ask Mobius to plan it with you.';
    else if (open.length === 0) empty = 'All done.';
  } else {
    const rows = smartView(view.id, tasks.all, now);
    if (view.id === 'all' || view.id === 'completed') {
      body = byList(rows).map((g) => (
        <section key={g.list} className="tasks-group" data-color={listColor(g.list)} aria-label={g.list}>
          <h2 className="tasks-group-head"><button type="button" onClick={() => tasks.setView({ kind: 'list', name: g.list })}>{g.list}</button></h2>
          <ul className="task-items" role="list" aria-label={view.id === 'completed' ? 'Completed' : 'To do'}>{withSubtasks(g.rows).map(({ at, subtasks }) => row(at, { showList: false, subtasks }))}</ul>
        </section>
      ));
    } else if (view.id === 'scheduled') {
      body = byDay(rows, now).map((g) => (
        <section key={g.key} className="tasks-group tasks-day" data-overdue={g.key === 'overdue' || undefined} aria-label={g.label}>
          <h2 className="tasks-group-head">{g.label}</h2>
          <ul className="task-items" role="list" aria-label="To do">{g.rows.map((r) => row(r, { showList: true, hideDue: g.exact }))}</ul>
        </section>
      ));
    } else {
      body = <ul className="task-items" role="list" aria-label="To do">{rows.map((r) => row(r, { showList: true }))}</ul>;
    }
    if (rows.length === 0) empty = { today: 'Nothing is due today.', scheduled: 'Nothing has a date yet.', flagged: 'No flagged tasks. Flag one to keep it in sight.', all: 'No open tasks.', completed: 'Nothing is completed yet.' }[view.id];
  }

  const title = view.kind === 'list' ? view.name : smartName(view.id);
  return (
    <section className="tasks-page" aria-label={query ? 'Search results' : title} data-inspecting={picked ? true : undefined}>
      <div className="tasks-main">
        {review && view.kind === 'list' && (
          <div className="note-review" role="status">
            <span className="review-dot" aria-hidden="true" />
            <span className="note-review-text">Mobius changed this list in its last turn.<WhyThis conversation={review.conversation} /></span>
            <ReviewActions onKeep={proposal.keep} onDiscard={proposal.discard} discardTitle="Put this list back as it was before that turn" keepTitle="Keep what Mobius changed in that turn" />
            {proposal.problem && <span className="review-problem" role="alert">{proposal.problem}</span>}
          </div>
        )}
        {query && <p className="tasks-searching">Results for “{query}” <button type="button" className="btn" onClick={() => tasks.setQuery('')}>Clear</button></p>}
        {!query && view.kind === 'smart' && view.id === 'completed' ? null : !query && (
          <NewTask tasks={tasks} target={target} focusToken={focusToken} defaultDue={view.kind === 'smart' && view.id === 'today' ? isoDay(now) : null}
            placeholder={view.kind === 'list' ? `Add to ${view.name}` : view.id === 'today' ? 'Add something for today' : `Add to ${DEFAULT_LIST_NAME}`} />
        )}
        {tasks.message && <p className="tasks-message" role="alert">{tasks.message}</p>}
        {body}
        {empty && <p className="tasks-empty">{empty}</p>}
      </div>
      {picked && <TaskInspector key={`${picked.list}:${picked.task.text}`} tasks={tasks} list={picked.list} task={picked.task} onAsk={ask} />}
      {tasks.deleted && (
        <div className="tasks-undo" role="status">
          <span>{tasks.deleted.kind === 'list' ? 'Deleted the list' : 'Deleted'} “{(tasks.deleted.kind === 'list' ? tasks.deleted.list : tasks.deleted.text).replace(/^(.{39}).{2,}$/, '$1…')}”</span>
          <button type="button" className="btn" onClick={() => void tasks.undoDelete()}>Undo</button>
          <button type="button" className="tasks-undo-x" aria-label="Dismiss" onClick={tasks.dismissDeleted}>×</button>
        </div>
      )}
    </section>
  );
}
