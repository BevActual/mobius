import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isNotesFailure, type BookmarkEntry, type ConversationInfo, type HistoryEntry, type NoteHit, type Notebook, type TaskItem } from '@mobius/shared';
import { relativeTime } from './relative-time';
import { FILTERS, hubResults, type HubFilter, type HubKind, type HubTarget } from './search-hub';
import { dueLabel } from './tasks-view';

const KIND_ICON: Record<HubKind, ReactNode> = {
  conversation: <path d="M4 5.5h12v7H9l-3 2.5v-2.5H4z" />,
  note: <><path d="M5.5 3h6l3 3v11h-9z" /><path d="M11.5 3v3h3" /></>,
  task: <><rect x="4" y="4" width="12" height="12" rx="2" /><path d="m7 10 2 2 4-4" /></>,
  page: <><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2.2 2 11.8 0 14M10 3c-2 2.2-2 11.8 0 14" /></>,
};

interface Props {
  conversations: ConversationInfo[];
  notebooks: Notebook[];
  tasks: Record<string, TaskItem[]>;
  onOpen: (target: HubTarget) => void;
  /** Ask the agent instead of looking things up. */
  onAsk: (question: string) => void;
  canAsk: boolean;
  focusToken: number;
}

/** Search: one box for everything Mobius keeps (conversations, notes, tasks and pages), or a question for the agent. */
export function SearchPage({ conversations, notebooks, tasks, onOpen, onAsk, canAsk, focusToken }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HubFilter>('all');
  const [noteHits, setNoteHits] = useState<NoteHit[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const field = useRef<HTMLInputElement>(null);
  const now = Date.now();

  useEffect(() => { field.current?.focus(); }, [focusToken]);
  useEffect(() => {
    let live = true;
    const q = query.trim();
    const t = window.setTimeout(() => {
      void (async () => {
        const [hits, hist, marks] = await Promise.all([
          q && window.mobius.notes ? window.mobius.notes.search(q) : Promise.resolve([] as NoteHit[]),
          window.mobius.history.get(q).catch(() => ({ enabled: false, entries: [] as HistoryEntry[] })),
          window.mobius.bookmarks.get(q).catch(() => [] as BookmarkEntry[]),
        ]);
        if (!live) return;
        setNoteHits(isNotesFailure(hits) ? [] : hits);
        setHistory(hist.entries.slice(0, 40));
        setBookmarks(marks.slice(0, 40));
      })();
    }, q ? 150 : 0);
    return () => { live = false; window.clearTimeout(t); };
  }, [query]);

  const results = useMemo(() => hubResults({ conversations, noteHits, notebooks, tasks, history, bookmarks }, query, filter), [conversations, noteHits, notebooks, tasks, history, bookmarks, query, filter]);
  const asking = query.trim();

  return (
    <section className="search-page" aria-label="Search">
      <div className="search-hero">
        <h1>Find anything</h1>
        <form className="search-box" role="search" onSubmit={(e) => { e.preventDefault(); const first = results[0]; if (first) onOpen(first.target); else if (asking && canAsk) onAsk(asking); }}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5" /><path d="m13 13 3.5 3.5" /></svg>
          <input ref={field} type="search" aria-label="Search everything" placeholder="Search conversations, notes, tasks and pages" value={query} onChange={(e) => setQuery(e.target.value)} />
        </form>
        <div className="search-filters" role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} className="search-filter" onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>
      <div className="search-results">
        {asking && canAsk && (
          <button type="button" className="search-row ask" onClick={() => onAsk(asking)}>
            <span className="search-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5l1.4 3.6 3.6 1.4-3.6 1.4L10 13.5 8.6 9.9 5 8.5l3.6-1.4z" /></svg></span>
            <span className="search-text"><span className="search-title">Ask Mobius “{asking}”</span><span className="search-where">The agent can look across all of it for you</span></span>
          </button>
        )}
        <ul role="list" aria-label={asking ? 'Results' : 'Recent'}>
          {results.map((r) => {
            const due = r.due ? dueLabel(r.due, new Date(now)) : null;
            const when = r.when ? relativeTime(r.when, now) : '';
            return (
              <li key={r.key}>
                <button type="button" className="search-row" data-kind={r.kind} data-done={r.done || undefined} onClick={() => onOpen(r.target)}>
                  <span className="search-icon"><svg viewBox="0 0 20 20" aria-hidden="true">{KIND_ICON[r.kind]}</svg></span>
                  <span className="search-text">
                    <span className="search-title">{r.title}</span>
                    <span className="search-where">
                      {[when, r.where].filter(Boolean).join(' · ')}
                      {due && <span className="task-due" data-tone={due.tone}> · {due.text}</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {results.length === 0 && <p className="search-empty">{asking ? 'Nothing matches. Ask Mobius instead?' : filter === 'all' ? 'Your conversations, notes, tasks and pages will show here.' : 'Nothing here yet.'}</p>}
      </div>
    </section>
  );
}
