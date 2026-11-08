import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { MemoryCategory, MemoryItem } from '@mobius/shared';
import type { Item } from './conversation';

export const MEMORY_CATEGORIES: { id: MemoryCategory; name: string; color: string }[] = [
  { id: 'you', name: 'About you', color: '#5856d6' },
  { id: 'prefs', name: 'Preferences', color: '#ff9f0a' },
  { id: 'work', name: 'Projects', color: '#34c759' },
  { id: 'people', name: 'People', color: '#30b0c7' },
  { id: 'skills', name: 'Learned skills', color: '#af52de' },
];
const nameOf = (c: MemoryCategory) => MEMORY_CATEGORIES.find((x) => x.id === c)?.name ?? 'About you';
const colorOf = (c: MemoryCategory) => MEMORY_CATEGORIES.find((x) => x.id === c)?.color ?? '#5856d6';

export type JourneyFilter = MemoryCategory | 'all';

/** What Mobius remembers, read again whenever it changes (the agent, Settings or this app). */
export function useJourney() {
  const api = window.mobius.memory;
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [filter, setFilter] = useState<JourneyFilter>('all');
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(() => { void api?.items().then(setItems).catch(() => setItems([])); }, [api]);
  useEffect(() => { load(); return api?.onChange(load); }, [api, load]);
  const done = (r: { ok: true } | { ok: false; error: string }) => { setProblem(r.ok ? null : r.error); load(); return r.ok; };
  return {
    available: api !== undefined, items, filter, setFilter, query, setQuery, problem,
    add: async (text: string, category: MemoryCategory) => done(await api!.add(text, category)),
    edit: async (old: string, text: string, category: MemoryCategory) => done(await api!.edit(old, text, category)),
    forget: async (text: string) => done(await api!.forget(text)),
  };
}
export type JourneyState = ReturnType<typeof useJourney>;

/** The kinds of memory, with how many of each. */
export function JourneySidebar({ journey }: { journey: JourneyState }) {
  const count = (c: JourneyFilter) => (c === 'all' ? journey.items.length : journey.items.filter((i) => i.category === c).length);
  return (
    <aside className="side journey-side" aria-label="Journey sidebar">
      <div className="side-head"><span className="side-title">What Mobius knows</span></div>
      <nav className="task-lists" aria-label="Kinds">
        <ul role="list">
          {[{ id: 'all' as const, name: 'Everything', color: '#8e8e93' }, ...MEMORY_CATEGORIES].map((c) => (
            <li key={c.id}>
              <button type="button" className="list-row" aria-current={journey.filter === c.id ? 'page' : undefined} onClick={() => journey.setFilter(c.id)}>
                <span className="journey-dot" style={{ background: c.color }} aria-hidden="true" />
                <span className="list-name">{c.name}</span>
                <span className="list-count">{count(c.id) || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <p className="calendar-side-note">Kept in memory.md in the data folder, as plain text you can edit. Forget here and the line is gone.</p>
    </aside>
  );
}

function Memory({ journey, item }: { journey: JourneyState; item: MemoryItem }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [category, setCategory] = useState(item.category);
  const save = async (e: FormEvent) => { e.preventDefault(); if (await journey.edit(item.text, text, category)) setEditing(false); };
  if (editing) {
    return (
      <li className="journey-item">
        <form className="journey-edit" onSubmit={(e) => void save(e)}>
          <input aria-label="Memory" value={text} maxLength={300} autoFocus onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }} />
          <select aria-label="Kind" value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)}>{MEMORY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </form>
      </li>
    );
  }
  return (
    <li className="journey-item" aria-label={item.text}>
      <span className="journey-cat" style={{ color: colorOf(item.category) }}>{nameOf(item.category)}</span>
      <span className="journey-text">{item.text}</span>
      <span className="journey-from">{item.source ? `From ${item.source}` : 'From an earlier conversation'}</span>
      <span className="journey-actions">
        <button type="button" className="btn" onClick={() => { setText(item.text); setCategory(item.category); setEditing(true); }}>Edit</button>
        <button type="button" className="btn" aria-label={`Forget: ${item.text}`} onClick={() => void journey.forget(item.text)}>Forget</button>
      </span>
    </li>
  );
}

/**
 * Journey: everything Mobius remembers, by kind, with where it was noticed; what it would like to remember waits here
 * too, to be kept or not.
 */
export function JourneyPage({ journey, asking, onAnswer }: { journey: JourneyState; asking: Item[]; onAnswer: (requestId: number, approve: boolean) => void }) {
  const [adding, setAdding] = useState('');
  const [addKind, setAddKind] = useState<MemoryCategory>('you');
  const shown = useMemo(() => {
    const q = journey.query.trim().toLowerCase();
    return journey.items.filter((i) => (journey.filter === 'all' || i.category === journey.filter) && (!q || i.text.toLowerCase().includes(q)));
  }, [journey.items, journey.filter, journey.query]);
  const waiting = asking.filter((i): i is Extract<Item, { kind: 'tool' }> => i.kind === 'tool' && i.name === 'memory.remember' && i.status === 'waiting' && i.requestId !== undefined);
  const add = async (e: FormEvent) => { e.preventDefault(); if (adding.trim() && (await journey.add(adding.trim(), addKind))) setAdding(''); };
  if (!journey.available) return <section className="journey-page empty" aria-label="Journey"><p className="note-empty">Memory is not available here.</p></section>;
  return (
    <section className="journey-page" aria-label="Journey">
      <header className="journey-head">
        <h2>What Mobius knows</h2>
        <span>{journey.items.length === 1 ? '1 memory' : `${journey.items.length} memories`} · stored on this computer</span>
      </header>
      {waiting.map((w) => {
        const args = (w.args ?? {}) as { text?: string; source?: string };
        return (
          <div key={w.callId} className="journey-ask" role="group" aria-label="Mobius would like to remember">
            <span className="journey-ask-head">Mobius would like to remember</span>
            <span className="journey-ask-text">“{args.text ?? ''}”</span>
            {args.source && <span className="journey-from">Noticed in {args.source}</span>}
            <span className="journey-actions">
              <button type="button" className="btn" onClick={() => onAnswer(w.requestId!, false)}>Don’t</button>
              <button type="button" className="btn primary" onClick={() => onAnswer(w.requestId!, true)}>Remember</button>
            </span>
          </div>
        );
      })}
      <div className="journey-tools">
        <input className="side-search" type="search" aria-label="Search memories" placeholder="Search" value={journey.query} onChange={(e) => journey.setQuery(e.target.value)} />
        <form className="journey-add" onSubmit={(e) => void add(e)}>
          <input aria-label="Something for Mobius to remember" placeholder="Something for Mobius to remember" value={adding} maxLength={300} onChange={(e) => setAdding(e.target.value)} />
          <select aria-label="Kind of memory" value={addKind} onChange={(e) => setAddKind(e.target.value as MemoryCategory)}>{MEMORY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button type="submit" className="btn primary" disabled={!adding.trim()}>Add</button>
        </form>
      </div>
      {journey.problem && <p className="tasks-message" role="alert">{journey.problem}</p>}
      <ul className="journey-list" role="list" aria-label="Memories">
        {shown.map((i) => <Memory key={i.text} journey={journey} item={i} />)}
      </ul>
      {shown.length === 0 && <p className="note-empty">{journey.items.length === 0 ? 'Nothing yet. When Mobius notices something worth keeping, such as a preference you mention, it asks to remember it.' : 'Nothing matches.'}</p>}
    </section>
  );
}
