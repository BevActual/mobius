import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { NotesSidebar, newItemIn, type SidebarWords } from './NotesSidebar';
import { EmptyState } from './EmptyState';
import { SLIDE_STYLES, blankSlide, changedSlides, parseDeck, writeDeck, type Slide, type SlideStyle } from './slides-format';
import { LAYOUTS, clock, dropIndex, jumpTarget, moveSlide, movedTo, talkMinutes, type Layout } from './slides-view';
import type { NotesState } from './useNotes';
import { ReviewActions, WhyThis } from './ReviewBar';
import { onCommand } from './commands';
import './slides.css';

export const SLIDES_WORDS: SidebarWords = { app: 'Slides', group: 'folder', groups: 'Folders', item: 'deck', items: 'decks', about: 'Decks are kept as Markdown files in your workspace, a slide between each line of ---, so other apps and the agent can open them too.', defaultGroup: 'Presentations' };

export function SlidesSidebar(props: { slides: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; starts?: readonly import('./SideNew').Start[]; onStart?: (prompt: string) => void }) {
  const { slides, ...rest } = props;
  return <NotesSidebar notes={slides} words={SLIDES_WORDS} {...rest} />;
}

/** Things to ask Mobius about the deck: each is a request, and what it changes comes back as dashed slides. */
export type SlidesTool = 'notes' | 'rehearse' | 'from-doc' | 'tighten';
const TOOLS: { id: SlidesTool; label: string }[] = [
  { id: 'notes', label: 'Write presenter notes' },
  { id: 'tighten', label: 'Tighten the wording' },
  { id: 'from-doc', label: 'Make slides from a document…' },
  { id: 'rehearse', label: 'Rehearse with me' },
];
const STYLE_NAMES: Record<SlideStyle, string> = { light: 'Light', dark: 'Dark', warm: 'Warm', accent: 'Accent' };
const FORMAT_KEY = 'mobius.slides.format';

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>;
const ICON = {
  add: 'M10 4v12M4 10h12',
  chevron: 'm6 8 4 4 4-4',
  duplicate: 'M7 7h9v9H7zM4 13V4h9',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10',
  play: 'M6 4.5v11l9-5.5z',
  format: 'M3 4h14v12H3zM12 4v12',
};

/** One slide drawn at any size: the same picture in the navigator, the editor and Play. */
function SlideFace({ slide, children }: { slide: Slide; children?: ReactNode }) {
  return (
    <div className="slide-face" data-style={slide.style}>
      {children ?? (
        <>
          {slide.kicker && <span className="slide-kicker">{slide.kicker}</span>}
          <span className="slide-title">{slide.title || ' '}</span>
          {slide.bullets.length > 0 && <ul className="slide-bullets">{slide.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
          {slide.text && <p className="slide-text">{slide.text}</p>}
        </>
      )}
    </div>
  );
}

/**
 * Play, as Keynote plays: the slide full screen, fading from one to the next. Arrows, Space and a click go on (a click
 * on the left third goes back), a number and Return jumps, B blacks the screen, P shows the presenter's view with the
 * next slide, the notes and the clock, and Esc stops.
 */
function Play({ slides, start, onClose }: { slides: Slide[]; start: number; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const [presenter, setPresenter] = useState(false);
  const [black, setBlack] = useState(false);
  const [typed, setTyped] = useState('');
  const [began] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [idle, setIdle] = useState(false);
  const last = slides.length - 1;
  const go = useCallback((by: number) => { setBlack(false); setAt((n) => Math.max(0, Math.min(last, n + by))); }, [last]);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  // The hint and the pointer go after a moment without the mouse moving, as in Keynote.
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => { setIdle(false); window.clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 2500); };
    window.addEventListener('mousemove', wake);
    return () => { window.clearTimeout(timer); window.removeEventListener('mousemove', wake); };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = e.key;
      if (/^\d$/.test(k)) { setTyped((t) => (t + k).slice(-3)); e.preventDefault(); return; }
      if (k === 'Enter' && typed) { const to = jumpTarget(typed, slides.length); if (to !== null) { setBlack(false); setAt(to); } setTyped(''); e.preventDefault(); return; }
      setTyped('');
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n'].includes(k)) { go(1); e.preventDefault(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { go(-1); e.preventDefault(); }
      else if (k === 'Home') { setAt(0); e.preventDefault(); }
      else if (k === 'End') { setAt(last); e.preventDefault(); }
      else if (k === 'Escape') { onClose(); e.preventDefault(); }
      else if (k.toLowerCase() === 'b') { setBlack((v) => !v); e.preventDefault(); }
      else if (k.toLowerCase() === 'p') { setPresenter((v) => !v); e.preventDefault(); }
      e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [slides.length, last, go, onClose, typed]);
  const slide = slides[at] ?? blankSlide();
  const next = slides[at + 1];
  return createPortal(
    <div className="slide-play" role="dialog" aria-modal="true" aria-label={`Playing slide ${at + 1} of ${slides.length}`} data-idle={idle || undefined} data-presenter={presenter || undefined}
      onClick={(e) => { if (presenter) return; go(e.clientX < window.innerWidth / 3 ? -1 : 1); }}>
      {presenter ? (
        <div className="slide-presenter">
          <div className="slide-presenter-now"><span className="slide-presenter-label">Now · {at + 1} of {slides.length}</span><div className="slide-play-stage"><SlideFace slide={slide} /></div></div>
          <div className="slide-presenter-side">
            <span className="slide-presenter-clock" aria-label="Time presenting">{clock(now - began)}</span>
            <span className="slide-presenter-label">Next</span>
            {next ? <div className="slide-presenter-next"><SlideFace slide={next} /></div> : <p className="slide-presenter-end">End of the deck</p>}
            <span className="slide-presenter-label">Notes</span>
            <p className="slide-presenter-notes">{slide.notes || 'No notes on this slide.'}</p>
            <div className="slide-presenter-go">
              <button type="button" onClick={() => go(-1)} disabled={at === 0}>Back</button>
              <button type="button" onClick={() => go(1)} disabled={at === last}>Next</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="slide-play-stage" key={at}><SlideFace slide={slide} /></div>
      )}
      {black && <div className="slide-play-black" aria-label="Screen blacked out" />}
      {typed && <span className="slide-play-typed" role="status">Go to slide {typed}</span>}
      <div className="slide-play-progress" aria-hidden="true"><span style={{ width: `${((at + 1) / slides.length) * 100}%` }} /></div>
      <span className="slide-play-hint">{at + 1} / {slides.length} · arrows to move · P presenter view · B black · Esc to stop</span>
    </div>,
    document.body,
  );
}

/** The menu of layouts a new slide starts from. */
function LayoutMenu({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (l: Layout) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return createPortal(
    <>
      <div className="slides-scrim" onMouseDown={onClose} />
      <div className="slides-menu slides-layouts" role="menu" aria-label="Slide layouts" style={{ top: anchor.bottom + 6, left: anchor.left }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { onClose(); return; }
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }}>
        {LAYOUTS.map((l, i) => (
          <button key={l.id} ref={i === 0 ? first : undefined} type="button" role="menuitem" onClick={() => onPick(l)}>
            <span className="slides-layout-face"><SlideFace slide={l.make()} /></span>
            <span>{l.name}</span>
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);

/** The open deck: slides down the side, the one chosen to edit at 16:9, its presenter notes, a Format inspector, and Play. */
export function SlidesEditor({ slides: deck, review, onTool, busy = false }: { slides: NotesState; review?: { conversation: string } | null; onTool?: (tool: SlidesTool, slide: number) => void; busy?: boolean }) {
  const path = deck.page?.path ?? null;
  const slides = useMemo(() => parseDeck(deck.text), [deck.text]);
  // The slide shown. If the deck is briefly shorter (read again from disk mid-edit), the choice is kept, not moved.
  const [chosen, setAt] = useState(0);
  const at = Math.max(0, Math.min(chosen, slides.length - 1));
  const [playing, setPlaying] = useState<number | null>(null);
  const [layoutsAt, setLayoutsAt] = useState<DOMRect | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; i: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [formatOpen, setFormatOpen] = useState(() => { try { return localStorage.getItem(FORMAT_KEY) !== '0'; } catch { return true; } });
  const saved = slides[Math.min(at, slides.length - 1)]!;
  // The slide being typed in, as typed: an empty new bullet line stays until the person leaves the slide.
  // It belongs to one slide of one deck: once another slide is shown, it no longer stands in for that one.
  const [drafted, setDrafted] = useState<{ path: string | null; at: number; slide: Slide } | null>(null);
  const draft = drafted && drafted.path === path && drafted.at === at ? drafted.slide : null;
  const setDraft = (slide: Slide | null) => setDrafted(slide ? { path, at, slide } : null);
  const current = draft ?? saved;
  const navRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(null); }, [at, path]);
  useEffect(() => setAt(0), [path]);
  useEffect(() => { try { localStorage.setItem(FORMAT_KEY, formatOpen ? '1' : '0'); } catch { /* the choice is only for this session */ } }, [formatOpen]);

  // Undo and redo for the whole deck; a run of typing in one field undoes together.
  const history = useRef(new Map<string, { undo: string[]; redo: string[]; tag: string; when: number }>());
  const steps = () => {
    const key = path ?? '';
    let s = history.current.get(key);
    if (!s) { s = { undo: [], redo: [], tag: '', when: 0 }; history.current.set(key, s); }
    return s;
  };
  const save = (next: Slide[], tag = '') => {
    const text = writeDeck(next);
    if (text === deck.text) return;
    const s = steps();
    const now = Date.now();
    if (!(tag && tag === s.tag && now - s.when < 1200)) { s.undo.push(deck.text); if (s.undo.length > 200) s.undo.shift(); }
    s.redo = [];
    s.tag = tag;
    s.when = now;
    deck.edit(text);
  };
  const undo = () => { const s = steps(); const was = s.undo.pop(); if (was === undefined) return; s.redo.push(deck.text); s.tag = ''; setDraft(null); deck.edit(was); };
  const redo = () => { const s = steps(); const next = s.redo.pop(); if (next === undefined) return; s.undo.push(deck.text); s.tag = ''; setDraft(null); deck.edit(next); };
  const undoRef = useRef(undo); undoRef.current = undo;
  const redoRef = useRef(redo); redoRef.current = redo;
  useEffect(() => onCommand('undo', () => undoRef.current()), []);
  useEffect(() => onCommand('redo', () => redoRef.current()), []);

  const change = (patch: Partial<Slide>, tag = '') => {
    const next = { ...current, ...patch };
    setDraft(next);
    save(slides.map((s, i) => (i === at ? next : s)), tag);
  };
  const insertAt = (i: number, slide: Slide) => { save([...slides.slice(0, i), slide, ...slides.slice(i)]); setAt(i); };
  const insert = (slide: Slide) => insertAt(at + 1, slide);
  const duplicate = (i = at) => insertAt(i + 1, { ...slides[i]! });
  const remove = (i = at) => { if (slides.length > 1) { save(slides.filter((_, j) => j !== i)); setAt(Math.max(0, Math.min(at > i ? at - 1 : at, slides.length - 2))); } };
  const moveTo = (from: number, to: number) => {
    const next = moveSlide(slides, from, to);
    if (writeDeck(next) === deck.text) return;
    save(next);
    setAt(movedTo(from, to));
  };
  const pickLayout = (l: Layout) => { setLayoutsAt(null); insert(l.make()); window.setTimeout(() => titleRef.current?.select(), 0); };

  // What the agent's last turn changed, dashed in the navigator until kept or discarded.
  const [changed, setChanged] = useState<Set<number>>(new Set());
  const [kept, setKept] = useState(false);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns().includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
    // Checked again when the page changes: a new turn's change is not kept yet.
  }, [review?.conversation, path, deck.page?.base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!review || kept || !path) { setChanged(new Set()); return; }
    void window.mobius.changes.before(review.conversation, `slides/${path}`).then((was) => {
      if (!live || !was || !was.ok) return;
      setChanged(changedSlides(was.text === null ? [] : parseDeck(was.text), slides));
    }).catch(() => {});
    return () => { live = false; };
  }, [review?.conversation, kept, path, deck.text]); // eslint-disable-line react-hooks/exhaustive-deps
  const keepAll = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id);
    setKept(true);
  };
  const discardAll = async () => {
    if (!review || !path) return;
    await window.mobius.changes.undoFile(review.conversation, `slides/${path}`).catch(() => null);
    setChanged(new Set());
  };

  // The picked thumbnail stays in view as the selection moves.
  useEffect(() => { navRef.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' }); }, [at]);
  const focusThumb = (i: number) => window.setTimeout(() => navRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus(), 0);

  const onNavKey = (e: ReactKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      const by = k === 'ArrowDown' ? 1 : -1;
      if (e.altKey) { const to = at + by; if (to >= 0 && to < slides.length) { moveTo(at, by > 0 ? at + 2 : at - 1); focusThumb(to); } return; }
      const to = Math.max(0, Math.min(slides.length - 1, at + by));
      setAt(to); focusThumb(to);
    } else if (k === 'Home' || k === 'End') { e.preventDefault(); const to = k === 'Home' ? 0 : slides.length - 1; setAt(to); focusThumb(to); }
    else if ((k === 'Delete' || k === 'Backspace') && slides.length > 1) { e.preventDefault(); remove(); focusThumb(Math.max(0, at - 1)); }
    else if (mod && k.toLowerCase() === 'd') { e.preventDefault(); duplicate(); focusThumb(at + 1); }
    else if (k === 'Enter' && !mod) { e.preventDefault(); titleRef.current?.focus(); }
  };
  const onPageKey = (e: ReactKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); setPlaying(at); return; }
    if (typing(e.target)) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  };

  const dragOver = (e: ReactDragEvent<HTMLElement>, i: number) => {
    if (dragFrom === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    setDropAt(dropIndex(i, e.clientY, r.top, r.height));
  };
  const endDrag = () => { setDragFrom(null); setDropAt(null); };

  if (!deck.page) {
    return (
      <section className="slides-page empty" aria-label="Deck">
        <EmptyState app="slides" label="No deck open" title={deck.notebooks.some((n) => n.pages.length) ? 'No deck open' : 'No decks yet'} line="Choose one on the left, or start a new one." action={{ label: 'New deck', run: () => newItemIn(deck, null, SLIDES_WORDS.defaultGroup) }} />
      </section>
    );
  }
  const proposing = review && !kept && changed.size > 0;
  const menuFor = (i: number): ContextMenuItem[] => [
    { label: 'New slide', run: () => insertAt(i + 1, LAYOUTS[1]!.make()) },
    { action: 'duplicate', keys: 'Ctrl+D', run: () => duplicate(i) },
    { label: 'Move up', keys: 'Alt+↑', disabled: i === 0, run: () => moveTo(i, i - 1), separated: true },
    { label: 'Move down', keys: 'Alt+↓', disabled: i === slides.length - 1, run: () => moveTo(i, i + 2) },
    { label: 'Play from here', run: () => setPlaying(i) },
    { action: 'delete', label: 'Delete slide', keys: 'Delete', danger: true, disabled: slides.length <= 1, run: () => remove(i), separated: true },
  ];
  return (
    <section className="slides-page" aria-label={`Deck: ${deck.page.title}`} onKeyDown={onPageKey}>
      {deck.status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <span>This deck was changed somewhere else while you were editing it.</span>
          <button type="button" className="btn" onClick={() => void deck.resolve(false)}>Use that version</button>
          <button type="button" className="btn primary" onClick={() => void deck.resolve(true)}>Keep mine</button>
        </div>
      )}
      <div className="slides-bar" role="toolbar" aria-label="Slides">
        <div className="slides-add">
          <button type="button" className="slides-tool" aria-label="Add slide" title="Add a slide like this one's layout" onClick={() => insert({ ...blankSlide(), style: current.style })}>
            <Icon d={ICON.add} /><span>Add slide</span>
          </button>
          <button type="button" className="slides-tool slides-add-more" aria-label="Choose a layout" aria-haspopup="menu" aria-expanded={layoutsAt !== null} onClick={(e) => setLayoutsAt(e.currentTarget.parentElement!.getBoundingClientRect())}>
            <Icon d={ICON.chevron} />
          </button>
        </div>
        <button type="button" className="slides-tool icon" aria-label="Duplicate slide" title="Duplicate (Ctrl+D)" onClick={() => duplicate()}><Icon d={ICON.duplicate} /></button>
        <button type="button" className="slides-tool icon" aria-label="Delete slide" title="Delete slide" disabled={slides.length <= 1} onClick={() => remove()}><Icon d={ICON.trash} /></button>
        <span className="spacer" />
        <button type="button" className="slides-tool icon" aria-label="Format" title="Format" aria-pressed={formatOpen} onClick={() => setFormatOpen((o) => !o)}><Icon d={ICON.format} /></button>
        <button type="button" className="slides-play-btn" title="Play from this slide (Ctrl+Enter)" onClick={() => setPlaying(at)}><Icon d={ICON.play} /><span>Play</span></button>
      </div>
      {proposing && (
        <div className="note-review sheet-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">{`Mobius ${changed.size === 1 ? 'changed one slide' : `changed ${changed.size} slides`}, dashed in the navigator. Click one to look before keeping.`}{review && <WhyThis conversation={review.conversation} />}</span>
          <ReviewActions onKeep={keepAll} onDiscard={discardAll} keepTitle="Keep every slide Mobius changed" />
        </div>
      )}
      <div className="slides-body">
        <nav ref={navRef} className="slides-nav" aria-label="Slides" onKeyDown={onNavKey} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null); }}>
          {slides.map((s, i) => (
            <button key={i} type="button" className="slides-thumb" data-i={i} tabIndex={i === at ? 0 : -1}
              aria-current={i === at ? 'true' : undefined}
              data-proposed={proposing && changed.has(i) ? true : undefined}
              data-dragging={dragFrom === i || undefined}
              data-drop={dropAt === i ? 'before' : dropAt === i + 1 && i === slides.length - 1 ? 'after' : undefined}
              aria-label={`Slide ${i + 1}: ${s.title || 'Untitled'}${proposing && changed.has(i) ? ' (proposed by Mobius)' : ''}`}
              draggable
              onDragStart={(e) => { setDragFrom(i); setAt(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i + 1)); }}
              onDragOver={(e) => dragOver(e, i)}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && dropAt !== null) moveTo(dragFrom, dropAt); endDrag(); }}
              onDragEnd={endDrag}
              onContextMenu={(e) => { e.preventDefault(); setAt(i); setMenu({ x: e.clientX, y: e.clientY, i }); }}
              onDoubleClick={() => titleRef.current?.focus()}
              onClick={() => setAt(i)}>
              <span className="slides-num">{i + 1}</span>
              <SlideFace slide={s} />
            </button>
          ))}
        </nav>
        <main className="slides-main">
          <div className="slides-stage">
            <div className="slides-canvas" data-proposed={proposing && changed.has(at) ? true : undefined} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDraft(null); }}>
              <SlideFace slide={current}>
                <input className="slide-kicker" aria-label="Kicker" placeholder="Kicker" value={current.kicker} onChange={(e) => change({ kicker: e.target.value }, 'kicker')} />
                <textarea ref={titleRef} className="slide-title" aria-label="Title" placeholder="Title" rows={1} value={current.title} onChange={(e) => change({ title: e.target.value.replace(/\n/g, ' ') }, 'title')} />
                <textarea className="slide-bullets-edit" aria-label="Bullets, one a line" placeholder="Bullets, one a line" rows={Math.max(2, current.bullets.length + 1)} value={current.bullets.join('\n')} onChange={(e) => change({ bullets: e.target.value.split('\n') }, 'bullets')} />
                <textarea className="slide-text-edit" aria-label="Body text" placeholder="Body text" rows={Math.max(1, current.text.split('\n').length)} value={current.text} onChange={(e) => change({ text: e.target.value }, 'text')} />
              </SlideFace>
            </div>
          </div>
          <label className="slides-notes"><span>Presenter notes</span>
            <textarea aria-label="Presenter notes" rows={3} value={current.notes} placeholder="What to say on this slide" onChange={(e) => change({ notes: e.target.value }, 'notes')} />
          </label>
        </main>
        {formatOpen && (
          <aside className="slides-format" aria-label="Format">
            <div className="slides-format-title">Slide {at + 1}</div>
            <section className="slides-section">
              <div className="slides-section-title">Style</div>
              <div className="slides-swatches" role="radiogroup" aria-label="Slide style">
                {SLIDE_STYLES.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={current.style === s} aria-label={STYLE_NAMES[s]} className="slides-swatch" onClick={() => change({ style: s })}>
                    <span className="slide-face" data-style={s}><span className="slide-title">Aa</span></span>
                    <span className="slides-swatch-name">{STYLE_NAMES[s]}</span>
                  </button>
                ))}
              </div>
            </section>
            {onTool && (
              <section className="slides-section" aria-label="Ask Mobius">
                {/* The one place in the deck to hand Mobius a job; anything else goes in the Ask field above. */}
                <div className="slides-section-title">Ask Mobius to</div>
                <div className="slides-layout-list">
                  {TOOLS.map((t) => <button key={t.id} type="button" className="slides-chip" disabled={busy} onClick={() => onTool(t.id, at)}>{t.label}</button>)}
                </div>
              </section>
            )}
            <section className="slides-section">
              <div className="slides-section-title">Start again from a layout</div>
              <div className="slides-layout-list">
                {LAYOUTS.map((l) => <button key={l.id} type="button" className="slides-chip" onClick={() => change(l.make())}>{l.name}</button>)}
              </div>
            </section>
            <section className="slides-section">
              <div className="slides-section-title">Deck</div>
              <p className="slides-deck-facts">{slides.length === 1 ? '1 slide' : `${slides.length} slides`} · about {talkMinutes(slides)} min</p>
              <button type="button" className="btn" onClick={() => setPlaying(0)}>Play from the start</button>
            </section>
            <section className="slides-section slides-keys">
              <div className="slides-section-title">Keys</div>
              <dl>
                <dt>↑ ↓</dt><dd>Pick a slide</dd>
                <dt>Alt ↑ ↓</dt><dd>Move it</dd>
                <dt>Ctrl D</dt><dd>Duplicate</dd>
                <dt>Ctrl Enter</dt><dd>Play</dd>
                <dt>P · B</dt><dd>Presenter view, black, while playing</dd>
              </dl>
            </section>
          </aside>
        )}
      </div>
      {layoutsAt && <LayoutMenu anchor={layoutsAt} onPick={pickLayout} onClose={() => setLayoutsAt(null)} />}
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} label={`Slide ${menu.i + 1}`} items={menuFor(menu.i)} onClose={() => setMenu(null)} />, document.body)}
      {playing !== null && <Play slides={slides} start={Math.min(playing, slides.length - 1)} onClose={() => setPlaying(null)} />}
    </section>
  );
}
