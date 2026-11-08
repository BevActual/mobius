import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { NotesSidebar, type SidebarWords } from './NotesSidebar';
import { SLIDE_STYLES, blankSlide, changedSlides, parseDeck, writeDeck, type Slide, type SlideStyle } from './slides-format';
import type { NotesState } from './useNotes';

export const SLIDES_WORDS: SidebarWords = { app: 'Slides', group: 'folder', groups: 'Folders', item: 'deck', items: 'decks', about: 'Decks are kept as Markdown files in your workspace, a slide between each line of ---, so other apps and the agent can open them too.', defaultGroup: 'Presentations' };

export function SlidesSidebar(props: { slides: NotesState; pin: ReactNode; changed?: ReadonlySet<string> }) {
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

function Play({ slides, start, onClose }: { slides: Slide[]; start: number; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const [notes, setNotes] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { setAt((n) => Math.min(slides.length - 1, n + 1)); e.preventDefault(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { setAt((n) => Math.max(0, n - 1)); e.preventDefault(); }
      else if (e.key === 'Escape') { onClose(); e.preventDefault(); }
      else if (e.key.toLowerCase() === 'n') setNotes((v) => !v);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [slides.length, onClose]);
  const slide = slides[at] ?? blankSlide();
  return createPortal(
    <div className="slide-play" role="dialog" aria-modal="true" aria-label={`Playing slide ${at + 1} of ${slides.length}`} onClick={() => setAt((n) => Math.min(slides.length - 1, n + 1))}>
      <div className="slide-play-stage"><SlideFace slide={slide} /></div>
      {notes && slide.notes && <p className="slide-play-notes">{slide.notes}</p>}
      <span className="slide-play-hint">{at + 1} / {slides.length} · arrows to move · N for notes · Esc to stop</span>
    </div>,
    document.body,
  );
}

/** The open deck: slides down the side, the one chosen to edit, its presenter notes, and Play. */
export function SlidesEditor({ slides: deck, review, onTool, busy = false }: { slides: NotesState; review?: { conversation: string } | null; onTool?: (tool: SlidesTool, slide: number) => void; busy?: boolean }) {
  const path = deck.page?.path ?? null;
  const slides = useMemo(() => parseDeck(deck.text), [deck.text]);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const saved = slides[Math.min(at, slides.length - 1)]!;
  // The slide being typed in, as typed: an empty new bullet line stays until the person leaves the slide.
  const [draft, setDraft] = useState<Slide | null>(null);
  const current = draft ?? saved;
  useEffect(() => { setDraft(null); }, [at, path]);
  useEffect(() => setAt(0), [path]);
  useEffect(() => { if (at > slides.length - 1) setAt(slides.length - 1); }, [slides.length, at]);
  const save = (next: Slide[]) => deck.edit(writeDeck(next));
  const change = (patch: Partial<Slide>) => {
    const next = { ...current, ...patch };
    setDraft(next);
    save(slides.map((s, i) => (i === at ? next : s)));
  };
  const insert = (slide: Slide) => { save([...slides.slice(0, at + 1), slide, ...slides.slice(at + 1)]); setAt(at + 1); };
  const remove = () => { if (slides.length > 1) { save(slides.filter((_, i) => i !== at)); setAt(Math.max(0, at - 1)); } };
  const move = (by: -1 | 1) => {
    const to = at + by;
    if (to < 0 || to >= slides.length) return;
    const next = [...slides];
    [next[at], next[to]] = [next[to]!, next[at]!];
    save(next);
    setAt(to);
  };

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
  const bulletsField = useRef<HTMLTextAreaElement>(null);

  if (!deck.page) {
    return (
      <section className="slides-page empty" aria-label="Deck">
        <p className="note-empty">{deck.notebooks.length ? 'Choose a deck, or make a new one.' : 'Make a deck to start: New deck in the sidebar.'}</p>
      </section>
    );
  }
  const proposing = review && !kept && changed.size > 0;
  return (
    <section className="slides-page" aria-label={`Deck: ${deck.page.title}`}>
      {deck.status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <span>This deck was changed somewhere else while you were editing it.</span>
          <button type="button" className="btn" onClick={() => void deck.resolve(false)}>Use that version</button>
          <button type="button" className="btn primary" onClick={() => void deck.resolve(true)}>Keep mine</button>
        </div>
      )}
      <div className="doc-toolbar" role="toolbar" aria-label="Slides">
        <button type="button" className="doc-tool text" onClick={() => insert(blankSlide())}>+ Slide</button>
        <button type="button" className="doc-tool text" onClick={() => insert({ ...current })}>Duplicate</button>
        <button type="button" className="doc-tool" aria-label="Move slide up" title="Move up" disabled={at === 0} onClick={() => move(-1)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 12 5-5 5 5" /></svg>
        </button>
        <button type="button" className="doc-tool" aria-label="Move slide down" title="Move down" disabled={at === slides.length - 1} onClick={() => move(1)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
        </button>
        <button type="button" className="doc-tool text" disabled={slides.length <= 1} onClick={remove}>Delete slide</button>
        <span className="doc-tool-sep" />
        <select aria-label="Slide style" value={current.style} onChange={(e) => change({ style: e.target.value as SlideStyle })}>
          {SLIDE_STYLES.map((s) => <option key={s} value={s}>{STYLE_NAMES[s]}</option>)}
        </select>
        <span className="spacer" />
        {onTool && (
          <div className="doc-writing">
            <button type="button" className="doc-tool text mobius" aria-haspopup="menu" aria-expanded={toolsOpen} disabled={busy} onClick={() => setToolsOpen((o) => !o)}>Ask Mobius</button>
            {toolsOpen && createPortal(
              <>
                <div className="doc-writing-scrim" onMouseDown={() => setToolsOpen(false)} />
                <div className="doc-writing-menu" role="menu" aria-label="Ask Mobius" style={{ top: 96, right: 16, left: 'auto' }}>
                  <p className="doc-writing-sees">Sees: this deck</p>
                  {TOOLS.map((t) => <button key={t.id} type="button" role="menuitem" onClick={() => { setToolsOpen(false); onTool(t.id, at); }}>{t.label}</button>)}
                </div>
              </>,
              document.body,
            )}
          </div>
        )}
        <button type="button" className="btn primary slides-play-btn" onClick={() => setPlaying(true)}>▶ Play</button>
      </div>
      {proposing && (
        <div className="note-review sheet-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">{`Mobius ${changed.size === 1 ? 'changed one slide' : `changed ${changed.size} slides`}, dashed in the navigator. Click one to look before keeping.`}</span>
          <button type="button" className="review-btn" onClick={() => void discardAll()}>Discard</button>
          <button type="button" className="review-btn" data-kind="keep" onClick={() => void keepAll()}>Keep All</button>
        </div>
      )}
      <div className="slides-body">
        <nav className="slides-nav" aria-label="Slides">
          {slides.map((s, i) => (
            <button key={i} type="button" className="slides-thumb" aria-current={i === at ? 'true' : undefined} data-proposed={proposing && changed.has(i) ? true : undefined} aria-label={`Slide ${i + 1}: ${s.title || 'Untitled'}${proposing && changed.has(i) ? ' (proposed by Mobius)' : ''}`} onClick={() => setAt(i)}>
              <span className="slides-num">{i + 1}</span>
              <SlideFace slide={s} />
            </button>
          ))}
        </nav>
        <main className="slides-main">
          <div className="slides-canvas" data-proposed={proposing && changed.has(at) ? true : undefined} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDraft(null); }}>
            <SlideFace slide={current}>
              <input className="slide-kicker" aria-label="Kicker" placeholder="Kicker" value={current.kicker} onChange={(e) => change({ kicker: e.target.value })} />
              <textarea className="slide-title" aria-label="Title" placeholder="Title" rows={1} value={current.title} onChange={(e) => change({ title: e.target.value.replace(/\n/g, ' ') })} />
              <textarea ref={bulletsField} className="slide-bullets-edit" aria-label="Bullets, one a line" placeholder="Bullets, one a line" rows={Math.max(2, current.bullets.length + 1)} value={current.bullets.join('\n')} onChange={(e) => change({ bullets: e.target.value.split('\n') })} />
            </SlideFace>
          </div>
          <label className="slides-notes"><span>Presenter notes</span>
            <textarea aria-label="Presenter notes" rows={3} value={current.notes} placeholder="What to say on this slide" onChange={(e) => change({ notes: e.target.value })} />
          </label>
        </main>
      </div>
      {playing && <Play slides={slides} start={at} onClose={() => setPlaying(false)} />}
    </section>
  );
}
