import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { MemoryCategory, MemoryItem, WikiChange, WikiVersion } from '@mobius/shared';
import type { NotesState } from './useNotes';
import type { Item } from './conversation';
import { createPortal } from 'react-dom';
import { ContextMenu } from './ContextMenu';
import { EmptyState } from './EmptyState';
import { SideNew } from './SideNew';
import { relativeTime } from './relative-time';
import { DocEditor } from './Docs';
import { dayLabel, nearDayLabel, timeLabel } from './dates';
import { diffCounts, diffLines } from './line-diff';
import { readable } from './knowledge-lines';
import './knowledge.css';

/** The kinds of things Mobius remembers. */
export const MEMORY_KINDS: { id: MemoryCategory; name: string }[] = [
  { id: 'you', name: 'About you' },
  { id: 'prefs', name: 'Preferences' },
  { id: 'work', name: 'Projects' },
  { id: 'people', name: 'People' },
  { id: 'skills', name: 'Learned skills' },
];

/** A line's kind; a line from an older memory.md without one counts as About you, so it is never hidden. */
const kindOf = (m: MemoryItem): MemoryCategory => (MEMORY_KINDS.some((k) => k.id === m.category) ? m.category : 'you');

/** Where the Wiki is: your own How I work page, the changes waiting for this wiki, or one of its pages. */
export type WikiPlace = { kind: 'mine' } | { kind: 'shared' } | { kind: 'page' };

/** The changes offered to the wiki, kept here so the sidebar can count them and the page can act on them. */
export function useWikiIncoming() {
  const api = window.mobius.wiki;
  const [waiting, setWaiting] = useState<WikiChange[]>([]);
  const load = useCallback(async () => {
    const got = await api?.incoming?.().catch(() => null);
    setWaiting(Array.isArray(got) ? got : []);
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => api?.onChanged(() => void load()), [api, load]);
  return { waiting, load };
}
export type WikiIncoming = ReturnType<typeof useWikiIncoming>;

export function WikiSidebar({ wiki, place, onPlace, incoming, pin }: { wiki: NotesState; place: WikiPlace; onPlace: (p: WikiPlace) => void; incoming: WikiIncoming; pin?: ReactNode }) {
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const create = async () => {
    const name = title.trim() || 'New page';
    if (!wiki.notebooks.some((n) => n.name === 'Pages')) await wiki.createNotebook('Pages');
    await wiki.createPage('Pages', name);
    setNaming(false); setTitle(''); onPlace({ kind: 'page' });
  };
  const row = (label: string, current: boolean, onClick: () => void, count?: number) => (
    <li>
      <button type="button" className="list-row" aria-current={current ? 'page' : undefined} onClick={onClick}>
        <span className="list-name">{label}</span>
        {count ? <span className="list-count">{count}</span> : null}
      </button>
    </li>
  );
  return (
    <aside className="side wiki-side" aria-label="Knowledge sidebar">
      <div className="side-head">
        <span className="side-title">Knowledge</span>
        {pin && <span className="side-actions">{pin}</span>}
      </div>
      {/* New first, then Search, then the places and the pages: the order every app's sidebar has. */}
      <SideNew item="page" onNew={() => setNaming(true)} />
      <input className="side-search" type="search" aria-label="Search knowledge" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      {naming && (
        <form className="notes-name" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input autoFocus aria-label="Page title" placeholder="Page title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
        </form>
      )}
      <nav className="task-lists" aria-label="Knowledge">
        <ul role="list">
          {row('How I work', place.kind === 'mine', () => onPlace({ kind: 'mine' }))}
          {row('Suggested changes', place.kind === 'shared', () => onPlace({ kind: 'shared' }), incoming.waiting.length)}
        </ul>
      </nav>
      <nav className="task-lists wiki-pages" aria-label="Pages">
        {sections(wiki.notebooks, query).map((nb) => (
          <section key={nb.name} className="kn-side-section" aria-label={nb.name}>
            <h2 className="kn-side-heading">{nb.name}</h2>
            <ul role="list">
              {nb.pages.map((pg) => (
                <li key={pg.path}>
                  <button type="button" className="list-row" aria-current={place.kind === 'page' && wiki.page?.path === pg.path ? 'page' : undefined} onClick={() => { void wiki.open(pg.path, pg.title); onPlace({ kind: 'page' }); }}>
                    <span className="list-name">{pg.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </aside>
  );
}

/**
 * Your wiki: How I work, the page only you and your Mobius see. It is what Mobius remembers about you, from the same
 * store Mobius reads before every turn (memory.md): what Mobius learned is dashed until you Keep it, or say Not true (it is forgotten). A line can
 * be shared to this wiki, where it waits like any other change.
 */
export function HowIWork({ asking = [], onAnswer }: { asking?: readonly Item[]; onAnswer?: (requestId: number, approve: boolean) => void }) {
  const api = window.mobius.memory;
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [kind, setKind] = useState<MemoryCategory>('you');
  const [editing, setEditing] = useState<{ old: string; text: string; category: MemoryCategory } | null>(null);
  // What Mobius would like to remember waits here too, as it waits in the conversation.
  const waiting = asking.filter((i): i is Extract<Item, { kind: 'tool' }> => i.kind === 'tool' && i.name === 'memory.remember' && i.status === 'waiting' && i.requestId !== undefined);
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<unknown> } | null>(null);
  const [adding, setAdding] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ text: string; x: number; y: number } | null>(null);
  const load = useCallback(async () => { setItems(await api?.items().catch(() => []) ?? []); }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => api?.onChange(() => void load()), [api, load]);
  if (!api) return <section className="skills-page empty" aria-label="How I work"><p className="note-empty">Knowledge is not available here.</p></section>;
  const done = async (r: { ok: boolean; error?: string } | undefined, next: { label: string; run: () => Promise<unknown> } | null) => {
    if (r && !r.ok) { setProblem(r.error ?? 'That could not be done.'); return; }
    setProblem(null); setUndo(next); await load();
  };
  const keep = (m: MemoryItem) => api.keep?.(m.text, true).then((r) => done(r, { label: `Kept “${m.text}”.`, run: () => api.keep!(m.text, false) }));
  const notTrue = (m: MemoryItem) => api.forget(m.text).then((r) => done(r, { label: `Forgot “${m.text}”.`, run: () => api.restore!(m.text, m.category, m.source) }));
  const share = async (m: MemoryItem) => {
    const r = await window.mobius.wiki?.offer?.('your knowledge', m.text).catch(() => null);
    if (!r || ('ok' in r && r.ok === false)) { setProblem('That line could not be shared.'); return; }
    setUndo({ label: `Shared “${m.text}” with Knowledge. It waits there until it is kept.`, run: async () => { if ('id' in r) await window.mobius.wiki?.declineChange?.(r.id); } });
  };
  const learned = items.filter((m) => m.learned);
  const forget = (m: MemoryItem) => api.forget(m.text).then((r) => done(r, { label: `Forgot “${m.text}”.`, run: () => api.restore!(m.text, m.category, m.source) }));
  const line = (m: MemoryItem) => (
    <li key={m.text} className="wiki-line" data-proposed={m.learned || undefined} data-editing={editing?.old === m.text || undefined} aria-label={m.learned ? `${m.text}, Mobius learned this` : m.text}
      onContextMenu={(e) => { if (editing?.old === m.text) return; e.preventDefault(); setMenu({ text: m.text, x: e.clientX, y: e.clientY }); }}
      onKeyDown={(e) => { if (e.key === 'F10' && e.shiftKey && editing?.old !== m.text) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ text: m.text, x: r.left + 24, y: r.bottom - 4 }); } }}>
      {editing?.old === m.text ? (
        <form className="wiki-edit" onSubmit={(e) => { e.preventDefault(); void api.edit(editing.old, editing.text, editing.category).then((r) => done(r, null)).then(() => setEditing(null)); }}>
          <input autoFocus aria-label="Line" value={editing.text} maxLength={300} onChange={(e) => setEditing({ ...editing, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }} />
          <span className="kn-popup"><select aria-label="Kind" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as MemoryCategory })}>{MEMORY_KINDS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></span>
          <button type="button" className="review-btn" onClick={() => setEditing(null)}>Cancel</button>
          <button type="submit" className="review-btn" data-kind="keep">Save</button>
        </form>
      ) : (
        <>
          <span className="wiki-line-body">
            <span className="wiki-line-text">{m.text}</span>
            {m.learned
              ? <span className="wiki-learned">Mobius learned this{m.source ? ` · ${m.source}` : ''}</span>
              : m.source && m.source !== 'you added it' && <span className="wiki-from-line">From {m.source}</span>}
          </span>
          {m.learned ? (
            <span className="wiki-line-actions" data-always>
              <button type="button" className="review-btn" onClick={() => void notTrue(m)}>Not true</button>
              <button type="button" className="review-btn" data-kind="keep" onClick={() => void keep(m)}>Keep</button>
            </span>
          ) : (
            <span className="wiki-line-actions">
              <button type="button" className="review-btn" onClick={() => setEditing({ old: m.text, text: m.text, category: m.category })}>Edit</button>
              <button type="button" className="review-btn" title="Offer this line to the Knowledge others share" onClick={() => void share(m)}>Share</button>
              <button type="button" className="review-btn" data-kind="danger" aria-label={`Forget: ${m.text}`} title="Forget this line (you can undo it)" onClick={() => void forget(m)}>Forget</button>
            </span>
          )}
        </>
      )}
      {menu?.text === m.text && createPortal(
        <ContextMenu x={menu.x} y={menu.y} label={m.text} onClose={() => setMenu((x) => (x?.text === m.text ? null : x))} items={m.learned ? [
          { label: 'Keep', run: () => void keep(m) },
          { label: 'Not true', run: () => void notTrue(m) },
        ] : [
          { action: 'rename', label: 'Edit', run: () => setEditing({ old: m.text, text: m.text, category: m.category }) },
          { action: 'share', label: 'Share', run: () => void share(m) },
          { action: 'delete', label: 'Forget', danger: true, separated: true, run: () => void forget(m) },
        ]} />,
        document.body,
      )}
    </li>
  );
  const asks = onAnswer ? waiting : [];
  return (
    <section className="skills-page wiki-page" aria-label="How I work">
      <header className="kn-head">
        <h1>How I work</h1>
        <p className="wiki-private">Only you and your Mobius see this page. Mobius reads it before every reply.</p>
      </header>
      {undo && (
        <p className="cal-undo" role="status">
          <span>{undo.label}</span>
          <button type="button" className="review-btn" onClick={() => { const u = undo; setUndo(null); void u.run().then(load); }}>Undo</button>
        </p>
      )}
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {(asks.length > 0 || learned.length > 0) && (
        <section className="kn-group" aria-label="Waiting for you" data-waiting>
          <h2 className="kn-group-head">Waiting for you <span className="kn-badge" aria-label={`${asks.length + learned.length} waiting`}>{asks.length + learned.length}</span></h2>
          {asks.map((w) => {
            const args = (w.args ?? {}) as { text?: string; source?: string };
            return (
              <div key={w.callId} className="wiki-line wiki-ask" data-proposed role="group" aria-label="Mobius would like to remember">
                <span className="wiki-line-body">
                  <span className="wiki-line-text">“{args.text ?? ''}”</span>
                  {args.source && <span className="wiki-learned">Noticed in {args.source}</span>}
                </span>
                <span className="wiki-line-actions" data-always>
                  <button type="button" className="review-btn" onClick={() => onAnswer!(w.requestId!, false)}>Don’t</button>
                  <button type="button" className="review-btn" data-kind="keep" onClick={() => onAnswer!(w.requestId!, true)}>Remember</button>
                </span>
              </div>
            );
          })}
          {learned.length > 0 && <ul className="wiki-lines" role="list" aria-label="Mobius learned">{learned.map(line)}</ul>}
        </section>
      )}
      {items.length === 0 && asks.length === 0 && (
        <EmptyState app="wiki" title="Nothing here yet" line="Add how you work below. What Mobius learns waits here until you keep it." label="Nothing here yet" />
      )}
      {MEMORY_KINDS.map((k) => {
        const these = items.filter((m) => !m.learned && kindOf(m) === k.id);
        if (these.length === 0) return null;
        return (
          <section key={k.id} className="kn-group" aria-label={k.name}>
            <h2 className="kn-group-head">{k.name}</h2>
            <ul className="wiki-lines" role="list" aria-label={k.name}>{these.map(line)}</ul>
          </section>
        );
      })}
      <form className="wiki-add" onSubmit={(e) => { e.preventDefault(); const t = adding.trim(); if (!t) return; void api.add(t, kind).then((r) => done(r, null)).then(() => setAdding('')); }}>
        <span className="wiki-add-plus" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></svg></span>
        <input aria-label="Add a line" placeholder="Add how you work, in one line" value={adding} maxLength={300} onChange={(e) => setAdding(e.target.value)} />
        <span className="kn-popup"><select aria-label="Kind of line" value={kind} onChange={(e) => setKind(e.target.value as MemoryCategory)}>{MEMORY_KINDS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></span>
        <button type="submit" className="review-btn" data-kind="keep" disabled={!adding.trim()}>Add</button>
      </form>
    </section>
  );
}

/** Suggested changes to this wiki: changes offered by people, your own wiki and Mobius, each Decline / Edit first / Keep, then Undo. */
export function SharedQueue({ incoming }: { incoming: WikiIncoming }) {
  const api = window.mobius.wiki;
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [undo, setUndo] = useState<{ label: string; change: WikiChange; line: string | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!api?.incoming) return <section className="skills-page empty" aria-label="Suggested changes"><p className="note-empty">Knowledge is not available here.</p></section>;
  const keep = async (c: WikiChange, text?: string) => {
    const r = await api.keepChange!(c.id, text).catch(() => null);
    if (!r || !r.ok) { setProblem(r && !r.ok ? r.message : 'That could not be kept.'); return; }
    setEditing(null); setProblem(null);
    setUndo({ label: `Kept on ${pageName(c.page)}.`, change: c, line: r.line });
    await incoming.load();
  };
  const decline = async (c: WikiChange) => {
    const r = await api.declineChange!(c.id).catch(() => null);
    if (!r || !r.ok) { setProblem(r && !r.ok ? r.message : 'That could not be declined.'); return; }
    setUndo({ label: 'Declined.', change: c, line: null });
    await incoming.load();
  };
  const undoLast = async () => {
    if (!undo) return;
    await api.undoChange!(undo.change, undo.line).catch(() => null);
    setUndo(null);
    await incoming.load();
  };
  const at = Date.now();
  return (
    <section className="skills-page wiki-page" aria-label="Suggested changes">
      <header className="kn-head">
        <h1>Suggested changes</h1>
        <p className="wiki-private">Lines offered by people, by your own How I work and by Mobius. Nothing reaches a page until you keep it.</p>
      </header>
      {undo && <p className="cal-undo" role="status"><span>{undo.label}</span><button type="button" className="review-btn" onClick={() => void undoLast()}>Undo</button></p>}
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {incoming.waiting.length === 0 && <EmptyState app="wiki" title="Nothing is waiting" line="When someone, or Mobius, offers a line for a page, it waits here for you." label="Nothing is waiting" />}
      {incoming.waiting.length > 0 && (
        <ul className="wiki-lines kn-changes" role="list" aria-label="Waiting">
          {incoming.waiting.map((c) => (
            <li key={c.id} className="wiki-line wiki-change" data-proposed aria-label={`From ${fromName(c.from)}: ${c.text}`}>
              <span className="wiki-from">From {fromName(c.from)} · for {pageName(c.page)}{c.whenMs ? ` · ${relativeTime(c.whenMs, at)}` : ''}</span>
              {editing?.id === c.id ? (
                <form className="wiki-edit" onSubmit={(e) => { e.preventDefault(); void keep(c, editing.text); }}>
                  <input autoFocus aria-label="Edit the line" value={editing.text} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }} />
                  <button type="button" className="review-btn" onClick={() => setEditing(null)}>Cancel</button>
                  <button type="submit" className="review-btn" data-kind="keep">Keep</button>
                </form>
              ) : (
                <>
                  <span className="wiki-line-text">{c.text}</span>
                  <span className="wiki-line-actions" data-always>
                    <button type="button" className="review-btn" onClick={() => void decline(c)}>Decline</button>
                    <button type="button" className="review-btn" onClick={() => setEditing({ id: c.id, text: c.text })}>Edit first</button>
                    <button type="button" className="review-btn" data-kind="keep" onClick={() => void keep(c)}>Keep</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The sidebar's sections: Pages first, then each project's memory, then what is shared, then any other folder. Empty ones are left out. */
function sections(notebooks: NotesState['notebooks'], query = ''): NotesState['notebooks'] {
  const order = ['Pages', 'Projects', 'Shared'];
  const rank = (name: string) => { const i = order.indexOf(name); return i < 0 ? order.length : i; };
  const q = query.trim().toLowerCase();
  return notebooks
    .map((nb) => (q ? { ...nb, pages: nb.pages.filter((pg) => pg.title.toLowerCase().includes(q)) } : nb))
    .filter((nb) => nb.pages.length > 0)
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

const pageName = (path: string) => path.split('/').pop()?.replace(/\.md$/, '') ?? path;

/**
 * A Knowledge page: the shared document editor, with Versions as one more button at the end of its toolbar. Versions
 * opens in place of the page, as History does in Docs and Notes.
 */
export function WikiPage({ wiki, autoFocus, busy }: { wiki: NotesState; autoFocus: boolean; busy: boolean }) {
  const path = wiki.page?.path ?? null;
  const [open, setOpen] = useState(false);
  // The last version put back, so it can be undone: the page as it was, and when the version was from.
  const [putBack, setPutBack] = useState<{ was: string; label: string } | null>(null);
  useEffect(() => { setOpen(false); setPutBack(null); }, [path]);
  const canLook = Boolean(path && window.mobius.wiki?.versions);
  const button = canLook ? (
    <button type="button" className="doc-tool" aria-label="Versions" aria-pressed={open} title="Earlier versions of this page" onClick={() => setOpen((o) => !o)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10a6 6 0 1 0 1.8-4.3M4 4v3.5h3.5M10 6.5V10l2.5 1.5" /></svg>
    </button>
  ) : null;
  return (
    <div className="wiki-doc">
      <DocEditor docs={wiki} autoFocus={autoFocus} busy={busy} toolbarEnd={button} />
      {putBack && !open && (
        <div className="kn-put-back" role="status">
          <span>Put back the version from {putBack.label}.</span>
          <button type="button" className="btn" onClick={() => { wiki.edit(putBack.was); setPutBack(null); }}>Undo</button>
          <button type="button" className="kn-put-back-x" aria-label="Dismiss" onClick={() => setPutBack(null)}>×</button>
        </div>
      )}
      {open && path && <WikiVersions path={path} text={wiki.text} onPutBack={(v) => { setPutBack({ was: wiki.text, label: whenLabel(v.whenMs) }); wiki.edit(v.content); setOpen(false); }} onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * A page's earlier versions, from the workspace checkpoints, newest first under their day. The chosen one is shown as
 * what putting it back would change: lines that come back, and lines that go.
 */
function WikiVersions({ path, text, onPutBack, onClose }: { path: string; text: string; onPutBack: (version: WikiVersion) => void; onClose: () => void }) {
  const [versions, setVersions] = useState<WikiVersion[] | null>(null);
  const [shown, setShown] = useState<WikiVersion | null>(null);
  useEffect(() => {
    let live = true;
    void window.mobius.wiki?.versions?.(path).then((v) => { if (live) setVersions(Array.isArray(v) ? v : []); }).catch(() => { if (live) setVersions([]); });
    return () => { live = false; };
  }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const now = Date.now();
  const days: { day: string; versions: WikiVersion[] }[] = [];
  for (const v of versions ?? []) {
    const day = nearDayLabel(v.whenMs, now) ?? dayLabel(v.whenMs, { weekday: 'long', now });
    const last = days[days.length - 1];
    if (last?.day === day) last.versions.push(v); else days.push({ day, versions: [v] });
  }
  const lines = shown ? diffLines(text, shown.content) : [];
  const counts = diffCounts(lines);
  return (
    <section className="kn-versions" aria-label="Versions">
      <header className="kn-versions-head">
        <h2>Versions</h2>
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </header>
      <div className="kn-versions-body">
        <nav className="kn-versions-list" aria-label="Earlier versions">
          {versions === null && <p className="note-empty">Looking…</p>}
          {versions?.length === 0 && <p className="note-empty">No earlier versions yet. A version is kept each time Mobius starts a turn.</p>}
          {days.map((d) => (
            <div key={d.day} className="kn-versions-day">
              <h3 className="kn-side-heading">{d.day}</h3>
              <ul role="list">
                {d.versions.map((v) => (
                  <li key={v.checkpoint}>
                    <button type="button" className="list-row" aria-current={shown?.checkpoint === v.checkpoint ? 'true' : undefined} onClick={() => setShown(v)}>
                      <span className="list-name">{timeLabel(v.whenMs)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="kn-version">
          {!shown && versions && versions.length > 0 && <p className="note-empty">Choose a version to see how it differs from the page now.</p>}
          {shown && (
            <>
              <div className="kn-version-bar">
                <span className="kn-version-sum">{summary(counts)} You can undo it afterwards.</span>
                <button type="button" className="btn primary" onClick={() => onPutBack(shown)}>Put this version back</button>
              </div>
              <div className="kn-diff" aria-label="That version" role="document">
                {lines.map((l, i) => { const r = readable(l.text); return <div key={i} className="kn-diff-line" data-kind={l.kind} data-block={r.block}><span className="kn-diff-mark" aria-hidden="true">{l.kind === 'added' ? '+' : l.kind === 'removed' ? '−' : ''}</span><span className="kn-diff-text">{r.text || ' '}</span></div>; })}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** "Today, 10:06 PM" or "12 Nov, 10:06 PM": when a version is from. */
function whenLabel(ms: number): string {
  return `${nearDayLabel(ms) ?? dayLabel(ms)}, ${timeLabel(ms)}`;
}

/** What putting a version back changes, in words: "1 line comes back, 1 line goes". */
function summary({ added, removed }: { added: number; removed: number }): string {
  const parts = [
    added ? `${added} ${added === 1 ? 'line comes' : 'lines come'} back` : '',
    removed ? `${removed} ${removed === 1 ? 'line goes' : 'lines go'}` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(', ')}.` : 'The same as the page now.';
}

/** Who offered a change, in today's words: lines shared before Knowledge was renamed say they came from "your wiki". */
function fromName(from: string): string {
  return from === 'your wiki' ? 'your knowledge' : from;
}
