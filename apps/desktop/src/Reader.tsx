import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { onCommand, sendCommand } from './commands';
import { RichText } from './RichText';
import { useFileReview } from './useFileReview';
import { ARCHIVE, READING_LIST, addHighlight, articleFile, articleTitle, highlightsOf, keepLook, keepPlace, parseArticle, readLook, readPlace, neighbour, removeHighlight, savedWhen, stepSize, timeLeft, type ReadingLook, type ReadingTheme } from './reader-format';
import { clipToNotes } from './clip';
import type { NotesState } from './useNotes';
import { ReviewActions, WhyThis } from './ReviewBar';
import { EmptyState } from './EmptyState';
import { SideNew } from './SideNew';
import { AppSidebar, PanelTab, PointMenu, SidebarRow, SidebarSearch, SidebarSection, ToolbarControls, UndoToast } from './ui';
import './reader.css';

/** The toolbar's grey line for the open article: the site it came from, which opens the original in the Browser. */
export function readerSub(text: string): ReactNode {
  const { site, url } = parseArticle(text);
  if (!site) return undefined;
  if (!url) return site;
  return <a className="reader-source" href={url} title={`Open the original: ${url}`} onClick={(e) => { e.preventDefault(); void window.mobius.browser.open(url); }}>{site}</a>;
}

/** When an article was last touched, said the way its eyebrow says when it was saved. */
const when = (ms: number) => { const d = new Date(ms); return savedWhen(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).replace(/^./, (c) => c.toUpperCase()); };

/**
 * Reader's sidebar, as plain rows like Mail's: the Reading list, any lists of your own, the Archive, then what Mobius
 * changed. New article saves a link.
 */
export function ReaderSidebar({ reading, pin, changed }: { reading: NotesState; pin?: ReactNode; changed?: ReadonlySet<string>; starts?: readonly import('./SideNew').Start[]; onStart?: (prompt: string) => void }) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; title: string } | null>(null);
  const q = query.trim().toLowerCase();
  const order = (name: string) => (name === READING_LIST ? 0 : name === ARCHIVE ? 2 : 1);
  const lists = [...reading.notebooks].sort((x, y) => order(x.name) - order(y.name) || x.name.localeCompare(y.name));
  const proposed = [...(changed ?? [])];
  const remove = async (path: string) => { await reading.remove(path); };
  return (
    <AppSidebar label="Reader sidebar">
      <SideNew item="article" onNew={() => sendCommand('save-link')} title="Save a link to read later" />
      <SidebarSearch label="Search articles" value={query} onChange={setQuery} />
      {lists.map((nb, i) => {
        const pages = [...nb.pages].sort((x, y) => y.modified - x.modified).filter((pg) => !q || pg.title.toLowerCase().includes(q));
        if (q && pages.length === 0) return null;
        return (
          <SidebarSection key={nb.name} title={nb.name} {...(i === 0 && pin ? { action: pin } : {})} foldable={nb.name === ARCHIVE} defaultOpen={nb.name !== ARCHIVE || !!q}>
            {pages.length === 0 && <li className="side-empty">{nb.name === ARCHIVE ? 'Articles you finish go here.' : 'Nothing saved yet.'}</li>}
            {pages.map((pg) => (
              <SidebarRow key={pg.path} label={pg.title} sub={when(pg.modified)} current={reading.page?.path === pg.path} proposed={changed?.has(pg.path) ?? false}
                onSelect={() => void reading.open(pg.path, pg.title)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, path: pg.path, title: pg.title }); }} />
            ))}
          </SidebarSection>
        );
      })}
      <SidebarSection title="From Mobius">
        <SidebarRow label="Changed by Mobius" sub={proposed.length === 0 ? 'Nothing to review' : `${proposed.length} to review`}
          onSelect={() => { const first = proposed[0]; if (first) void reading.open(first, first.split('/').pop()?.replace(/\.md$/, '') ?? ''); }} />
      </SidebarSection>
      {menu && <PointMenu x={menu.x} y={menu.y} label={menu.title} onClose={() => setMenu(null)} entries={[
        { label: 'Open', run: () => void reading.open(menu.path, menu.title) },
        { label: 'Delete article', danger: true, run: () => void remove(menu.path) },
      ]} />}
    </AppSidebar>
  );
}

/** Fetches a page and keeps it as an article in the reading list. Gives the article's path, or why it could not. */
export async function saveToReader(reading: NotesState, url: string, list = READING_LIST): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const api = window.mobius.reading;
  if (!api) return { ok: false, message: 'Reader is not available.' };
  const got = await api.fetch(url.trim());
  if (!got.ok) return { ok: false, message: `That page could not be saved: ${got.message}.` };
  const folder = reading.notebooks.find((nb) => nb.name === list)?.name ?? (await reading.createNotebook(list));
  if (!folder) return { ok: false, message: 'The reading list could not be made.' };
  const path = await reading.createPage(folder, articleTitle(got.title, got.url), articleFile(got));
  return path ? { ok: true, path } : { ok: false, message: 'The article could not be kept.' };
}

const THEMES: { id: ReadingTheme; label: string }[] = [{ id: 'auto', label: 'Match Mobius' }, { id: 'sepia', label: 'Sepia' }, { id: 'grey', label: 'Grey' }, { id: 'night', label: 'Night' }];
const FACES: { id: ReadingLook['face']; label: string }[] = [{ id: 'sans', label: 'Sans serif' }, { id: 'serif', label: 'Serif' }];

/** Aa, as in Safari Reader: text size, typeface and page colour in one panel. */
function LookPanel({ look, onChange }: { look: ReadingLook; onChange: (next: ReadingLook) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); button.current?.focus(); } };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  const set = (change: Partial<ReadingLook>) => onChange({ ...look, ...change });
  return (
    <div className="reader-aa" ref={wrap}>
      <button ref={button} type="button" className="strip-btn reader-aa-btn" aria-label="Text and page" title="Text size, font and page colour" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">Aa</span>
      </button>
      {open && (
        <div className="reader-aa-panel glass" role="dialog" aria-label="Text and page" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
          <div className="reader-aa-sizes" role="group" aria-label="Text size">
            <button type="button" data-size="down" aria-label="Smaller" disabled={look.size === 'xs'} onClick={() => set({ size: stepSize(look.size, -1) })}>A</button>
            <button type="button" data-size="up" aria-label="Larger" disabled={look.size === 'xl'} onClick={() => set({ size: stepSize(look.size, 1) })}>A</button>
          </div>
          <div className="reader-aa-faces" role="group" aria-label="Font">
            {FACES.map((f) => (
              <button key={f.id} type="button" data-face={f.id} aria-pressed={look.face === f.id} onClick={() => set({ face: f.id })}>
                <span>{f.label}</span>
                {look.face === f.id && <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3.2 3L15 6.5" /></svg>}
              </button>
            ))}
          </div>
          <div className="reader-aa-themes" role="group" aria-label="Page colour">
            {THEMES.map((t) => <button key={t.id} type="button" data-theme={t.id} aria-label={t.label} title={t.label} aria-pressed={look.theme === t.id} onClick={() => set({ theme: t.id })} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Reader: pages kept to read later, shown as plain readable text, with where each came from. */
export function ReaderPage({ reading, review, tab, onAsk }: { reading: NotesState; review?: { conversation: string } | null; tab: { url: string; title: string } | null; /** Starts a message to Mobius with this text; the open article goes with it. */ onAsk?: (prompt: string) => void }) {
  const [link, setLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [look, setLook] = useState<ReadingLook>(readLook);
  const field = useRef<HTMLInputElement>(null);
  // The link field shows only when nothing is open, or when asked for: the article has the page to itself.
  const [adding, setAdding] = useState(false);
  // The New button's Save a link shows the link field with the cursor in it.
  useEffect(() => onCommand('save-link', () => { setAdding(true); window.setTimeout(() => field.current?.focus(), 0); }), []);
  useEffect(() => keepLook(look), [look]);
  const page = reading.page;
  const article = useMemo(() => parseArticle(reading.text), [reading.text]);
  const file = page ? `reading/${page.path}` : null;
  const { before, keep, discard } = useFileReview(review, file, page?.base);
  const inArchive = page?.path.split('/')[0] === ARCHIVE;
  // With nothing open, the newest article in the reading list opens, as Apple Books opens what you are reading.
  const newest = reading.notebooks.find((nb) => nb.name === READING_LIST)?.pages.reduce<{ path: string; title: string; modified: number } | undefined>((best, pg) => (!best || pg.modified > best.modified ? pg : best), undefined);
  useEffect(() => { if (!page && newest) reading.openIfIdle(newest.path, newest.title); }, [page, newest?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // How far through the article you are: shown as a line and minutes left, and kept so it opens where you stopped.
  const scroller = useRef<HTMLDivElement>(null);
  const [read, setRead] = useState(0);
  const placed = useRef<string | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!page || !el || placed.current === page.path || !reading.text) return;
    placed.current = page.path;
    const at = readPlace(page.path);
    el.scrollTop = at * Math.max(0, el.scrollHeight - el.clientHeight);
    setRead(at);
  });
  const onScroll = () => {
    const el = scroller.current;
    if (!el || !page) return;
    const room = el.scrollHeight - el.clientHeight;
    const at = room <= 0 ? 1 : el.scrollTop / room;
    setRead(at);
    keepPlace(page.path, at);
  };

  const save = async (url: string) => {
    setSaving(true);
    setMessage('');
    const done = await saveToReader(reading, url);
    setSaving(false);
    if (!done.ok) { setMessage(done.message); return; }
    setLink('');
    setAdding(false);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (link.trim()) void save(/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`); };
  /** The articles beside this one in its list, for J and K. */
  const listOf = (path: string) => reading.notebooks.find((nb) => nb.name === path.split('/')[0])?.pages ?? [];
  const step = (by: 1 | -1) => {
    if (!page) return;
    const next = neighbour(listOf(page.path), page.path, by);
    if (next) void reading.open(next.path, next.title);
  };
  /** Read: moved to the Archive list, out of the way but still searchable, and the next article opens. Undo puts it back. */
  const [undo, setUndo] = useState<{ text: string; run: () => void } | null>(null);
  const moveTo = async (path: string, list: string, title: string, text: string): Promise<string | null> => {
    const folder = reading.notebooks.find((nb) => nb.name === list)?.name ?? (await reading.createNotebook(list));
    if (!folder) return null;
    const made = await reading.createPage(folder, title, text);
    if (made) await reading.remove(path);
    return made;
  };
  const archive = async () => {
    if (!window.mobius.reading || !page) return;
    const old = page.path;
    const from = old.split('/')[0]!;
    const title = page.title || article.title || 'Article';
    const text = reading.text;
    const next = neighbour(listOf(old), old, 1) ?? neighbour(listOf(old), old, -1);
    const made = await moveTo(old, ARCHIVE, title, text);
    if (!made) { setMessage('It could not be moved to the archive.'); return; }
    if (next) await reading.open(next.path, next.title);
    setUndo({ text: `Moved “${title}” to Archive`, run: () => { setUndo(null); void moveTo(made, from, title, text); } });
  };
  useEffect(() => { if (!undo) return; const t = window.setTimeout(() => setUndo(null), 8000); return () => window.clearTimeout(t); }, [undo]);

  // Highlights, as in Readwise Reader: select a passage and press Highlight (or H); click one to take it off.
  const body = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<{ text: string; top: number; left: number } | null>(null);
  const [marked, setMarked] = useState<{ text: string; top: number; left: number } | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => { setPicked(null); setMarked(null); setNotice(''); setAdding(false); }, [page?.path]);
  const highlights = useMemo(() => highlightsOf(reading.text), [reading.text]);
  const place = (rect: DOMRect) => { const box = body.current?.getBoundingClientRect(); return box ? { top: rect.top - box.top - 40, left: Math.max(0, rect.left - box.left + rect.width / 2) } : { top: 0, left: 0 }; };
  const readSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!sel || sel.rangeCount === 0 || text.length < 2 || !body.current?.contains(sel.anchorNode)) { setPicked(null); return; }
    setMarked(null);
    setPicked({ text, ...place(sel.getRangeAt(0).getBoundingClientRect()) });
  };
  const highlight = (text = picked?.text) => {
    if (!text) return;
    const next = addHighlight(reading.text, text);
    setPicked(null);
    window.getSelection()?.removeAllRanges();
    if (next === null) { setNotice('That passage could not be marked as written. Try a shorter part of one paragraph.'); return; }
    setNotice('');
    reading.edit(next);
  };
  const unmark = (text: string) => { reading.edit(removeHighlight(reading.text, text)); setMarked(null); };
  const toNotes = async () => {
    const done = await clipToNotes({ kind: 'page', title: article.title || page?.title || 'Article', source: article.url ?? `reading/${page?.path ?? ''}`, text: highlights.join('\n\n') });
    setNotice(done.ok ? `Highlights copied to Notes (${done.path.replace(/\.md$/, '')}).` : done.error);
  };
  /** Ask Mobius about a passage: the message starts with it quoted, and the article goes with it. */
  const ask = (text: string) => {
    if (!onAsk) return;
    setPicked(null);
    setMarked(null);
    window.getSelection()?.removeAllRanges();
    // Asking from the Highlights tab: bring Mobius's tab forward so the message is in view.
    document.getElementById('panel-tab-mobius')?.click();
    onAsk(`About this passage:\n\n> ${text.replace(/\s+/g, ' ').trim()}\n\n`);
  };
  const keys = useRef({ highlight, archive, picked, inArchive, step });
  keys.current = { highlight, archive, picked, inArchive, step };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) return;
      if (!t?.closest('.reader-page') && t !== document.body) return;
      if (e.key === 'h' && keys.current.picked) { e.preventDefault(); keys.current.highlight(); }
      else if (e.key === 'e' && !keys.current.inArchive) { e.preventDefault(); void keys.current.archive(); }
      else if (e.key === 'j') { e.preventDefault(); keys.current.step(1); }
      else if (e.key === 'k') { e.preventDefault(); keys.current.step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startAdding = () => { setAdding(true); window.setTimeout(() => field.current?.focus(), 0); };
  const saveBar = (
    <form className="reader-save" onSubmit={submit} aria-label="Save to read later" onKeyDown={(e) => { if (e.key === 'Escape' && page) { e.preventDefault(); setAdding(false); setLink(''); setMessage(''); } }}>
      <input ref={field} aria-label="Link to save" placeholder="Paste a link to read later" value={link} maxLength={2000} onChange={(e) => setLink(e.target.value)} disabled={saving} />
      <button type="submit" className="btn primary" disabled={!link.trim() || saving}>{saving ? 'Saving…' : 'Save'}</button>
      {tab && /^https?:/i.test(tab.url) && <button type="button" className="btn" disabled={saving} title={tab.url} onClick={() => void save(tab.url)}>Save this tab</button>}
      {page && <button type="button" className="btn" onClick={() => { setAdding(false); setLink(''); setMessage(''); }}>Cancel</button>}
    </form>
  );
  const toast = undo && <UndoToast text={undo.text} onUndo={undo.run} onDismiss={() => setUndo(null)} />;

  if (!page) {
    return (
      <section className="reader-page" aria-label="Reader" data-theme={look.theme}>
        <ToolbarControls label="Reader">
          <button type="button" className="strip-btn" aria-label="Save a link" title="Save a link to read later" onClick={startAdding}><LinkGlyph /></button>
        </ToolbarControls>
        {saveBar}
        {message && <p className="reader-message" role="alert">{message}</p>}
        <EmptyState app="reader" label="No article open" title={reading.notebooks.some((n) => n.pages.length) ? 'No article open' : 'Nothing saved yet'}
          line="Paste a link above and Reader keeps just its words: no menus, no adverts, nothing that loads while you read." />
        {toast}
      </section>
    );
  }
  const changed = review && before !== undefined && before !== reading.text;
  const eyebrow = [article.saved ? `Saved ${savedWhen(article.saved)}` : null, timeLeft(article.minutes, read)].filter(Boolean).join(' · ');
  return (
    <section className="reader-page" aria-label="Reader" data-theme={look.theme}>
      <ToolbarControls label="Reader">
        <button type="button" className="strip-btn" aria-label="Save a link" title="Save a link to read later" onClick={startAdding}><LinkGlyph /></button>
        <LookPanel look={look} onChange={setLook} />
        {!inArchive && <button type="button" className="strip-btn" aria-label="Done reading" title="Done reading: move it to Archive (E)" aria-keyshortcuts="E" onClick={() => void archive()}><ArchiveGlyph /></button>}
      </ToolbarControls>
      {adding && saveBar}
      {message && <p className="reader-message" role="alert">{message}</p>}
      {/* Highlights: a tab in the right panel, before Mobius. */}
      <PanelTab id="highlights" name="Highlights">
        <div className="reader-notes" role="region" aria-label="Highlights">
          {highlights.length === 0
            ? <p className="reader-notes-empty">Select a passage and press Highlight (H). Your highlights collect here.</p>
            : <>
              <ul>{highlights.map((h, i) => <li key={i}><span>{h}</span>{onAsk && <button type="button" className="btn link" onClick={() => ask(h)}>Ask Mobius</button>}</li>)}</ul>
              <button type="button" className="btn" onClick={() => void toNotes()}>Copy to Notes</button>
            </>}
        </div>
      </PanelTab>
      <div className="reader-main">
        <div className="reader-progress" role="progressbar" aria-label="Read so far" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(read * 100)}><span style={{ transform: `scaleX(${read})` }} /></div>
        <div className="reader-scroll" ref={scroller} onScroll={onScroll}>
          <article className="reader-article" aria-label="Article" data-size={look.size} data-face={look.face}>
            {changed && (
              <div className="note-review" role="status">
                <span className="review-dot" aria-hidden="true" />
                <span className="note-review-text">Mobius changed this article in its last turn.{review && <WhyThis conversation={review.conversation} />}</span>
                <ReviewActions onKeep={keep} onDiscard={discard} />
              </div>
            )}
            <p className="reader-eyebrow" aria-live="off">{eyebrow}</p>
            <h1 className="reader-title">{article.title || page.title}</h1>
            {notice && <p className="reader-notice" role="status">{notice}</p>}
            <div
              className="reader-body"
              ref={body}
              onMouseUp={() => window.setTimeout(readSelection, 0)}
              onKeyUp={readSelection}
              onClick={(e) => { const m = (e.target as HTMLElement).closest('mark'); if (m && !window.getSelection()?.toString()) setMarked({ text: m.textContent ?? '', ...place(m.getBoundingClientRect()) }); else if (!m) setMarked(null); }}
            >
              <RichText text={article.body} />
              {picked && <div className="selection-bar reader-mark-bar" role="toolbar" aria-label="Selected text" style={{ top: picked.top, left: picked.left }}><button type="button" className="selection-btn" onPointerDown={(e) => e.preventDefault()} onClick={() => highlight()}>Highlight <kbd>H</kbd></button>{onAsk && <button type="button" className="selection-btn" onPointerDown={(e) => e.preventDefault()} onClick={() => ask(picked.text)}>Ask Mobius</button>}</div>}
              {marked && <div className="selection-bar reader-mark-bar" role="toolbar" aria-label="Highlight" style={{ top: marked.top, left: marked.left }}><button type="button" className="selection-btn" onClick={() => unmark(marked.text)}>Remove highlight</button>{onAsk && <button type="button" className="selection-btn" onClick={() => ask(marked.text)}>Ask Mobius</button>}</div>}
            </div>
          </article>
        </div>
      </div>
      {toast}
    </section>
  );
}

const LinkGlyph = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9" /><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" /></svg>;
const ArchiveGlyph = () => <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="4" rx="1" /><path d="M4.5 8v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8M8 11h4" /></svg>;
