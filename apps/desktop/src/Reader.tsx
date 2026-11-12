import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import { NotesSidebar, type SidebarWords } from './NotesSidebar';
import { RichText } from './RichText';
import { useFileReview } from './useFileReview';
import { ARCHIVE, READING_LIST, addHighlight, articleFile, articleTitle, highlightsOf, keepLook, keepPlace, parseArticle, readLook, readPlace, neighbour, removeHighlight, savedWhen, stepSize, timeLeft, type ReadingLook, type ReadingTheme } from './reader-format';
import { clipToNotes } from './clip';
import type { NotesState } from './useNotes';
import { ReviewActions, WhyThis } from './ReviewBar';
import { EmptyState } from './EmptyState';
import './reader.css';

export const READER_WORDS: SidebarWords = { app: 'Reader', group: 'list', groups: 'Lists', item: 'article', items: 'articles', about: 'Articles are kept as Markdown files in your workspace, so the agent can read them with you.', defaultGroup: READING_LIST };

export function ReaderSidebar(props: { reading: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; starts?: readonly import('./SideNew').Start[]; onStart?: (prompt: string) => void }) {
  const { reading, ...rest } = props;
  return <NotesSidebar notes={reading} words={READER_WORDS} {...rest} />;
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
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
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
  /** Read: moved to the Archive list, out of the way but still searchable, and the next article opens. */
  const archive = async () => {
    const api = window.mobius.reading;
    if (!api || !page) return;
    const folder = reading.notebooks.find((nb) => nb.name === ARCHIVE)?.name ?? (await reading.createNotebook(ARCHIVE));
    if (!folder) return;
    const text = reading.text;
    const old = page.path;
    const next = neighbour(listOf(old), old, 1) ?? neighbour(listOf(old), old, -1);
    const made = await reading.createPage(folder, page.title || article.title || 'Article', text);
    if (!made) { setMessage('It could not be moved to the archive.'); return; }
    await reading.remove(old);
    if (next) await reading.open(next.path, next.title);
  };

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

  const saveBar = (
    <form className="reader-save" onSubmit={submit} aria-label="Save to read later" onKeyDown={(e) => { if (e.key === 'Escape' && page) { e.preventDefault(); setAdding(false); setLink(''); setMessage(''); } }}>
      <input ref={field} aria-label="Link to save" placeholder="Paste a link to read later" value={link} maxLength={2000} onChange={(e) => setLink(e.target.value)} disabled={saving} />
      <button type="submit" className="btn primary" disabled={!link.trim() || saving}>{saving ? 'Saving…' : 'Save'}</button>
      {tab && /^https?:/i.test(tab.url) && <button type="button" className="btn" disabled={saving} title={tab.url} onClick={() => void save(tab.url)}>Save this tab</button>}
      {page && <button type="button" className="btn" onClick={() => { setAdding(false); setLink(''); setMessage(''); }}>Cancel</button>}
    </form>
  );

  if (!page) {
    return (
      <section className="reader-page" aria-label="Reader" data-theme={look.theme}>
        {saveBar}
        {message && <p className="reader-message" role="alert">{message}</p>}
        <EmptyState app="reader" label="No article open" title={reading.notebooks.some((n) => n.pages.length) ? 'No article open' : 'Nothing saved yet'}
          line="Paste a link above and Reader keeps just its words: no menus, no adverts, nothing that loads while you read." />
      </section>
    );
  }
  const changed = review && before !== undefined && before !== reading.text;
  return (
    <section className="reader-page" aria-label="Reader" data-theme={look.theme}>
      {adding ? saveBar : (
        <div className="reader-bar" role="toolbar" aria-label="Article">
          <span className="reader-meta">
            {article.url && <a href={article.url} title={article.url} onClick={(e) => { e.preventDefault(); void window.mobius.browser.open(article.url!); }}>{article.site}</a>}
            {article.saved && <span>Saved {savedWhen(article.saved)}</span>}
            <span className="reader-left" aria-live="off">{timeLeft(article.minutes, read)}</span>
          </span>
          <span className="reader-gap" />
          <button type="button" className="strip-btn" aria-label="Save a link" title="Save a link to read later" onClick={() => { setAdding(true); window.setTimeout(() => field.current?.focus(), 0); }}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9" /><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" /></svg>
          </button>
          <LookPanel look={look} onChange={setLook} />
          {!inArchive && <button type="button" className="btn" title="Move it to Archive (E)" onClick={() => void archive()}>Done reading</button>}
        </div>
      )}
      {message && <p className="reader-message" role="alert">{message}</p>}
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
          {highlights.length > 0 && (
            <section className="reader-highlights" aria-label="Highlights">
              <div className="reader-highlights-head">
                <h2>{highlights.length === 1 ? '1 highlight' : `${highlights.length} highlights`}</h2>
                <button type="button" className="btn" onClick={() => void toNotes()}>Copy to Notes</button>
              </div>
              <ul>{highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
            </section>
          )}
        </article>
      </div>
    </section>
  );
}
