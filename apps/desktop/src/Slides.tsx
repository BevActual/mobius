import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { readBefore } from './readBefore';
import { NotesSidebar, newItemIn, type SidebarWords } from './NotesSidebar';
import { EmptyState } from './EmptyState';
import { SLIDE_STYLES, TRANSITIONS, blankSlide, type Transition, changedSlides, parseDeck, writeDeck, type Slide, type SlideStyle } from './slides-format';
import { LAYOUTS, clock, layoutOf, playOrder, dropIndex, jumpTarget, moveSlide, movedTo, talkMinutes, type Layout } from './slides-view';
import type { NotesState } from './useNotes';
import { ReviewActions, WhyThis } from './ReviewBar';
import { onCommand } from './commands';
import { Menu, PanelLayout, PanelTab, ToolbarControls, type PanelSpec } from './ui';
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
const TRANSITION_NAMES: Record<Transition, string> = { none: 'None', dissolve: 'Dissolve', push: 'Push', 'move-in': 'Move in' };
const PANE_KEY = 'mobius.slides.pane';
type Pane = 'slide' | 'deck';
const PANES: { id: Pane; name: string }[] = [{ id: 'slide', name: 'Slide' }, { id: 'deck', name: 'Deck' }];

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>;
const ICON = {
  add: 'M10 4v12M4 10h12',
  chevron: 'm6 8 4 4 4-4',
  duplicate: 'M7 7h9v9H7zM4 13V4h9',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10',
  play: 'M6 4.5v11l9-5.5z',
  skipped: 'M3 10s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5zM8 10a2 2 0 1 0 4 0 2 2 0 1 0-4 0M3 3l14 14',
  picture: 'M3 5h14v10H3zM3 13l4-4 3 3 2-2 5 5M13 8.5a1 1 0 1 0 0-.01',
};

/** The open deck's path, so a slide's picture is read from the files kept beside it. */
const DeckPath = createContext<string | null>(null);
/** Pictures read once per deck and link, so drawing a slide again (or its thumbnail) does not read them again. */
const pictures = new Map<string, Promise<string | null>>();
function slidePicture(deck: string, ref: string): Promise<string | null> {
  if (/^(https:|data:image\/)/i.test(ref)) return Promise.resolve(ref);
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/')) return Promise.resolve(null);
  const key = `${deck}\n${ref}`;
  let got = pictures.get(key);
  if (!got) {
    const read = window.mobius.slides?.asset;
    got = read ? read(deck, ref).then((r) => ('dataUrl' in r ? r.dataUrl : null)).catch(() => null) : Promise.resolve(null);
    pictures.set(key, got);
    void got.then((v) => { if (v === null) pictures.delete(key); });
  }
  return got;
}
function usePicture(ref: string): string | null {
  const deck = useContext(DeckPath);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (ref && deck) void slidePicture(deck, ref).then((v) => { if (live) setSrc(v); });
    return () => { live = false; };
  }, [deck, ref]);
  return src;
}
/** How a slide's picture sits: beside the words when there are any, filling the slide when there are none. */
const pictureFit = (s: Slide) => (!s.picture ? undefined : s.title.trim() || s.kicker.trim() || s.text.trim() || s.bullets.some((b) => b.trim()) ? 'side' : 'full');

/** One slide drawn at any size: the same picture in the navigator, the editor and Play. */
function SlideFace({ slide, children }: { slide: Slide; children?: ReactNode }) {
  const src = usePicture(slide.picture);
  return (
    <div className="slide-face" data-style={slide.style} data-picture={pictureFit(slide)}>
      {slide.picture && (src ? <img className="slide-picture" src={src} alt="" draggable={false} /> : <span className="slide-picture missing" aria-hidden="true" />)}
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
  // The slides that play, by their number in the deck: skipped ones are left out (all of them play if every one is skipped).
  const shown = useMemo(() => { const s = playOrder(slides); return s.length ? s : slides.map((_, i) => i); }, [slides]);
  const [at, setAtRaw] = useState(() => shown.find((i) => i >= start) ?? shown[shown.length - 1] ?? 0);
  // The slide going away and how, while the next one comes in.
  const [leaving, setLeaving] = useState<{ slide: Slide; move: Transition; back: boolean; key: number } | null>(null);
  const reduce = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
  const atNow = useRef(at);
  const setAt = useCallback((next: number | ((n: number) => number)) => {
    const n = atNow.current;
    const to = typeof next === 'function' ? next(n) : next;
    if (to === n) return;
    const back = to < n;
    const kind: Transition = reduce ? 'none' : ((back ? slides[to] : slides[n])?.transition ?? 'dissolve');
    setLeaving(kind === 'push' || kind === 'move-in' ? { slide: slides[n] ?? blankSlide(), move: kind, back, key: Date.now() } : null);
    setMove({ kind, back });
    atNow.current = to;
    setAtRaw(to);
  }, [slides, reduce]);
  const [move, setMove] = useState<{ kind: Transition; back: boolean }>({ kind: 'none', back: false });
  const [presenter, setPresenter] = useState(false);
  const [black, setBlack] = useState(false);
  const [typed, setTyped] = useState('');
  const [began] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [idle, setIdle] = useState(false);
  const pos = Math.max(0, shown.indexOf(at));
  const first = shown[0] ?? 0;
  const last = shown[shown.length - 1] ?? 0;
  const go = useCallback((by: number) => {
    setBlack(false);
    setAt((n) => { const i = shown.indexOf(n); return shown[Math.max(0, Math.min(shown.length - 1, (i < 0 ? 0 : i) + by))] ?? n; });
  }, [shown, setAt]);
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
      else if (k === 'Home') { setAt(first); e.preventDefault(); }
      else if (k === 'End') { setAt(last); e.preventDefault(); }
      else if (k === 'Escape') { onClose(); e.preventDefault(); }
      else if (k.toLowerCase() === 'b') { setBlack((v) => !v); e.preventDefault(); }
      else if (k.toLowerCase() === 'p') { setPresenter((v) => !v); e.preventDefault(); }
      e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [slides.length, first, last, go, onClose, typed, setAt]);
  const slide = slides[at] ?? blankSlide();
  const next = slides[shown[pos + 1] ?? -1];
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
              <button type="button" onClick={() => go(-1)} disabled={at === first}>Back</button>
              <button type="button" onClick={() => go(1)} disabled={at === last}>Next</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="slide-play-frame">
          {leaving && <div className="slide-play-stage leaving" key={`out-${leaving.key}`} data-move={leaving.move} data-back={leaving.back || undefined} onAnimationEnd={() => setLeaving(null)}><SlideFace slide={leaving.slide} /></div>}
          <div className="slide-play-stage" key={at} data-move={move.kind} data-back={move.back || undefined}><SlideFace slide={slide} /></div>
        </div>
      )}
      {black && <div className="slide-play-black" aria-label="Screen blacked out" />}
      {typed && <span className="slide-play-typed" role="status">Go to slide {typed}</span>}
      <div className="slide-play-progress" aria-hidden="true"><span style={{ width: `${((pos + 1) / shown.length) * 100}%` }} /></div>
      <span className="slide-play-hint">{pos + 1} / {shown.length} · arrows to move · P presenter view · B black · Esc to stop</span>
    </div>,
    document.body,
  );
}

/**
 * The Format inspector, as Keynote's: one segmented control at the top (Slide | Deck), and only what belongs to that
 * choice below it. It is a tab in the right panel, before Mobius.
 */
function SlidesFormat({ slides, at, current, change, toggleSkip, adding, onReplace, onPlay, onTool, busy }: {
  slides: readonly Slide[]; at: number; current: Slide; change: (patch: Partial<Slide>) => void; toggleSkip: () => void;
  adding: boolean; onReplace: () => void; onPlay: (from: number) => void; onTool?: ((tool: SlidesTool, slide: number) => void) | undefined; busy: boolean;
}) {
  const [pane, setPane] = useState<Pane>(() => { try { return localStorage.getItem(PANE_KEY) === 'deck' ? 'deck' : 'slide'; } catch { return 'slide'; } });
  useEffect(() => { try { localStorage.setItem(PANE_KEY, pane); } catch { /* the choice is only for this session */ } }, [pane]);
  return (
    <aside className="slides-format" aria-label="Format">
      <div className="segmented slides-panes" role="radiogroup" aria-label="Show">
        {PANES.map((p) => <button key={p.id} type="button" role="radio" aria-checked={pane === p.id} onClick={() => setPane(p.id)}>{p.name}</button>)}
      </div>
      {pane === 'slide' ? (
        <>
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
          <section className="slides-section">
            <div className="slides-section-title">Layout</div>
            <div className="slides-layout-grid">
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" className="slides-layout-pick" aria-pressed={layoutOf(current) === l.id} title={`Start slide ${at + 1} again as ${l.name}`} onClick={() => change({ ...l.make(), skip: current.skip, transition: current.transition, picture: current.picture })}>
                  <span className="slides-layout-face"><SlideFace slide={l.make()} /></span>
                  <span>{l.name}</span>
                </button>
              ))}
            </div>
          </section>
          {current.picture && (
            <section className="slides-section" aria-label="Picture">
              <div className="slides-section-title">Picture</div>
              <div className="slides-pair">
                <button type="button" className="btn" disabled={adding} onClick={() => onReplace()}>Replace…</button>
                <button type="button" className="btn" onClick={() => change({ picture: '' })}>Remove</button>
              </div>
            </section>
          )}
          <section className="slides-section">
            <div className="slides-section-title">In Play</div>
            <label className="slides-row"><span>Transition</span>
              <select className="slides-popup" aria-label="Transition" value={current.transition} onChange={(e) => change({ transition: e.target.value as Transition })}>
                {TRANSITIONS.map((t) => <option key={t} value={t}>{TRANSITION_NAMES[t]}</option>)}
              </select>
            </label>
            <label className="slides-row switch-line"><span>Skip this slide</span>
              <input type="checkbox" role="switch" className="slides-switch" aria-label="Skip this slide" checked={current.skip} onChange={() => toggleSkip()} />
            </label>
          </section>
        </>
      ) : (
        <>
          <section className="slides-section">
            <div className="slides-section-title">Length</div>
            <p className="slides-deck-facts">{slides.length === 1 ? '1 slide' : `${slides.length} slides`} · about {talkMinutes(slides)} min</p>
            <button type="button" className="btn" title="Play from slide 1" onClick={() => onPlay(0)}>Play from the start</button>
          </section>
          {onTool && (
            <section className="slides-section" aria-label="Ask Mobius">
              {/* The one place in the deck to hand Mobius a job; anything else goes in the Ask field above. */}
              <div className="slides-section-title">Ask Mobius to</div>
              <div className="slides-tool-list">
                {TOOLS.map((t) => <button key={t.id} type="button" className="slides-ask" disabled={busy} onClick={() => onTool(t.id, at)}>{t.label}</button>)}
              </div>
            </section>
          )}
        </>
      )}
    </aside>
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
  const [menu, setMenu] = useState<{ x: number; y: number; i: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [dropPicture, setDropPicture] = useState(false);
  const saved = slides[Math.min(at, slides.length - 1)]!;
  // The slide being typed in, as typed: an empty new bullet line stays until the person leaves the slide.
  // It belongs to one slide of one deck: once another slide is shown, it no longer stands in for that one.
  const [drafted, setDrafted] = useState<{ path: string | null; at: number; slide: Slide } | null>(null);
  const draft = drafted && drafted.path === path && drafted.at === at ? drafted.slide : null;
  const setDraft = (slide: Slide | null) => setDrafted(slide ? { path, at, slide } : null);
  const current = draft ?? saved;
  const navRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesView = useRef<ReactNode>(null);
  const NOTES_PANEL = useMemo<PanelSpec[]>(() => [{ id: 'notes', name: 'Presenter notes', dock: 'bottom', shown: true, size: 120, render: () => notesView.current }], []);
  useEffect(() => { setDraft(null); }, [at, path]);
  useEffect(() => setAt(0), [path]);

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
  // A picture added to the slide: kept beside the deck, in `<deck> files/`, and written into the slide as an image line.
  const picker = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [pictureProblem, setPictureProblem] = useState<string | null>(null);
  const canPicture = !!window.mobius.slides?.attach;
  const addPicture = async (file: File | undefined) => {
    const attach = window.mobius.slides?.attach;
    if (!file || !path || !attach) return;
    setPictureProblem(null);
    if (!file.type.startsWith('image/')) { setPictureProblem(`${file.name} is not a picture.`); return; }
    if (file.size > 20 * 1024 * 1024) { setPictureProblem(`${file.name} is too big to add (20 MB at most).`); return; }
    setAdding(true);
    try {
      const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
      const got = await attach(path, file.name || 'Pasted.png', data);
      if ('ref' in got) change({ picture: got.ref });
      else setPictureProblem(`${file.name} could not be added: ${got.message}.`);
    } catch { setPictureProblem(`${file.name} could not be read.`); }
    finally { setAdding(false); }
  };
  const pictureIn = (list: DataTransferItemList | FileList | null | undefined) => {
    const files = list instanceof FileList ? [...list] : [...(list ?? [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
    return files.find((f) => f.type.startsWith('image/'));
  };
  const toggleSkip = (i = at) => { if (i === at) change({ skip: !current.skip }); else save(slides.map((s, j) => (j === i ? { ...s, skip: !s.skip } : s))); };
  const pickLayout = (l: Layout) => { insert(l.make()); window.setTimeout(() => titleRef.current?.select(), 0); };

  // What the agent's last turn changed, dashed in the navigator until kept or discarded.
  const [changed, setChanged] = useState<Set<number>>(new Set());
  const [kept, setKept] = useState(false);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns('slides').includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
    // Checked again when the page changes: a new turn's change is not kept yet.
  }, [review?.conversation, path, deck.page?.base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!review || kept || !path) { setChanged(new Set()); return; }
    return readBefore(review.conversation, `slides/${path}`, (text) => setChanged(changedSlides(text === null ? [] : parseDeck(text), slides)));
  }, [review?.conversation, kept, path, deck.text]); // eslint-disable-line react-hooks/exhaustive-deps
  const keepAll = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id, 'slides');
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
  // Ctrl+Enter plays from the picked slide wherever focus is, unless it is typing somewhere else (the composer sends with it).
  const atRef = useRef(at); atRef.current = at;
  const pageRef = useRef<HTMLElement>(null);
  const playingRef = useRef(false); playingRef.current = playing !== null;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.defaultPrevented || playingRef.current) return;
      // Undo with nothing focused (after a control that removed itself, such as the picture's Remove) still undoes here.
      const k = e.key.toLowerCase();
      if ((k === 'z' || k === 'y') && (e.target === document.body || e.target === document.documentElement)) {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) redoRef.current(); else undoRef.current();
        return;
      }
      if (e.key !== 'Enter') return;
      const inPage = e.target instanceof Node && !!pageRef.current?.contains(e.target);
      if (!inPage && (typing(e.target) || document.querySelector('[role="dialog"][aria-modal="true"]'))) return;
      e.preventDefault();
      setPlaying(atRef.current);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const onPageKey = (e: ReactKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
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
    { label: slides[i]?.skip ? "Don't skip slide" : 'Skip slide', run: () => toggleSkip(i) },
    { label: 'Play from here', keys: 'Ctrl+Enter', run: () => setPlaying(i) },
    { action: 'delete', label: 'Delete slide', keys: 'Delete', danger: true, disabled: slides.length <= 1, run: () => remove(i), separated: true },
  ];
  // The presenter notes sit in the bottom detail area under the slide, as in Keynote; the panel draws what is here.
  notesView.current = <textarea className="slides-notes" aria-label="Presenter notes" value={current.notes} placeholder="What to say on this slide" onChange={(e) => change({ notes: e.target.value }, 'notes')} />;

  return (
    <DeckPath.Provider value={path}>
    <section ref={pageRef} className="slides-page" aria-label={`Deck: ${deck.page.title}`} onKeyDown={onPageKey}>
      {deck.status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <span>This deck was changed somewhere else while you were editing it.</span>
          <button type="button" className="btn" onClick={() => void deck.resolve(false)}>Use that version</button>
          <button type="button" className="btn primary" onClick={() => void deck.resolve(true)}>Keep mine</button>
        </div>
      )}
      <ToolbarControls label="Slides">
        <span className="slides-tools-group">
          <button type="button" className="strip-btn" aria-label="Add slide" title="Add slide" onClick={() => insert({ ...blankSlide(), style: current.style })}><Icon d={ICON.add} /></button>
          <Menu label="Slide layouts" entries={LAYOUTS.map((l) => ({ label: l.name, icon: <span className="slides-layout-icon" aria-hidden="true"><SlideFace slide={l.make()} /></span>, run: () => pickLayout(l) }))}
            trigger={<button type="button" className="strip-btn slides-more" aria-label="Choose a layout" title="Add a slide from a layout"><Icon d={ICON.chevron} /></button>} />
        </span>
        <span className="slides-tools-group">
          <button type="button" className="strip-btn" aria-label="Duplicate slide" title="Duplicate slide (Ctrl+D)" aria-keyshortcuts="Control+D" onClick={() => duplicate()}><Icon d={ICON.duplicate} /></button>
          <button type="button" className="strip-btn" aria-label="Delete slide" title="Delete slide (Delete)" aria-keyshortcuts="Delete" disabled={slides.length <= 1} onClick={() => remove()}><Icon d={ICON.trash} /></button>
        </span>
        {canPicture && (
          <span className="slides-tools-group">
            <button type="button" className="strip-btn" aria-label="Insert picture" title={adding ? 'Adding a picture' : 'Insert picture'} aria-busy={adding || undefined} disabled={adding} onClick={() => picker.current?.click()}><Icon d={ICON.picture} /></button>
          </span>
        )}
        <button type="button" className="slides-play-btn" title="Play (Ctrl+Enter)" aria-keyshortcuts="Control+Enter" onClick={() => setPlaying(at)}><Icon d={ICON.play} /><span>Play</span></button>
      </ToolbarControls>
      <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => { void addPicture(e.target.files?.[0]); e.target.value = ''; }} />
      {pictureProblem && <p className="slides-problem" role="alert">{pictureProblem}<button type="button" className="slides-tool" onClick={() => setPictureProblem(null)}>OK</button></p>}
      {proposing && (
        <div className="note-review sheet-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">{`Mobius ${changed.size === 1 ? 'changed one slide' : `changed ${changed.size} slides`}, dashed in the navigator. Click one to look before keeping.`}{review && <WhyThis conversation={review.conversation} />}</span>
          <ReviewActions onKeep={keepAll} onDiscard={discardAll} keepTitle="Keep every slide Mobius changed" />
        </div>
      )}
      <div className="slides-body">
        <PanelLayout app="slides" panels={NOTES_PANEL}>
        <div className="slides-work">
        <nav ref={navRef} className="slides-nav" aria-label="Slides" onKeyDown={onNavKey} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null); }}>
          {slides.map((s, i) => (
            <button key={i} type="button" className="slides-thumb" data-i={i} tabIndex={i === at ? 0 : -1}
              aria-current={i === at ? 'true' : undefined}
              data-proposed={proposing && changed.has(i) ? true : undefined}
              data-dragging={dragFrom === i || undefined}
              data-skipped={s.skip || undefined}
              data-drop={dropAt === i ? 'before' : dropAt === i + 1 && i === slides.length - 1 ? 'after' : undefined}
              aria-label={`Slide ${i + 1}: ${s.title || 'Untitled'}${s.skip ? ' (skipped)' : ''}${proposing && changed.has(i) ? ' (proposed by Mobius)' : ''}`}
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
              {s.skip && <span className="slides-skipped" title="Skipped in Play" aria-hidden="true"><Icon d={ICON.skipped} /></span>}
            </button>
          ))}
        </nav>
        <main className="slides-main">
          <div className="slides-stage">
            <div className="slides-canvas" data-proposed={proposing && changed.has(at) ? true : undefined}
              data-dropping={dropPicture || undefined}
              onDragOver={(e) => { if (canPicture && dragFrom === null && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropPicture(true); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropPicture(false); }}
              onDrop={(e) => { const f = pictureIn(e.dataTransfer.files); setDropPicture(false); if (f) { e.preventDefault(); void addPicture(f); } }}
              onPaste={(e) => { const f = pictureIn(e.clipboardData?.items); if (f) { e.preventDefault(); void addPicture(f); } }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDraft(null); }}>
              <SlideFace slide={current}>
                <input className="slide-kicker" aria-label="Kicker" placeholder="Kicker" value={current.kicker} onChange={(e) => change({ kicker: e.target.value }, 'kicker')} />
                <textarea ref={titleRef} className="slide-title" aria-label="Title" placeholder="Title" rows={1} value={current.title} onChange={(e) => change({ title: e.target.value.replace(/\n/g, ' ') }, 'title')} />
                {/* The field sits over a list of the same lines, so each bullet keeps its dot as it is typed, as on the slide. */}
                <div className="slide-bullets-field" data-empty={current.bullets.length === 0 || undefined}>
                  <ul className="slide-bullets" aria-hidden="true">{current.bullets.map((b, i) => <li key={i}><span>{b || '\u200b'}</span></li>)}</ul>
                  <textarea className="slide-bullets-edit" aria-label="Bullets, one a line" placeholder="Bullets, one a line" rows={1} value={current.bullets.join('\n')} onChange={(e) => change({ bullets: e.target.value === '' ? [] : e.target.value.split('\n') }, 'bullets')} />
                </div>
                <textarea className="slide-text-edit" aria-label="Body text" placeholder="Body text" rows={Math.max(1, current.text.split('\n').length)} value={current.text} onChange={(e) => change({ text: e.target.value }, 'text')} />
              </SlideFace>
            </div>
          </div>
        </main>
        </div>
        </PanelLayout>
        <PanelTab id="format" name="Format"><SlidesFormat slides={slides} at={at} current={current} change={change} toggleSkip={toggleSkip} adding={adding} onReplace={() => picker.current?.click()} onPlay={setPlaying} onTool={onTool} busy={busy} /></PanelTab>
      </div>
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} label={`Slide ${menu.i + 1}`} items={menuFor(menu.i)} onClose={() => setMenu(null)} />, document.body)}
      {playing !== null && <Play slides={slides} start={Math.min(playing, slides.length - 1)} onClose={() => setPlaying(null)} />}
    </section>
    </DeckPath.Provider>
  );
}
