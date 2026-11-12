import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { NotesSidebar, newItemIn, type SidebarWords } from './NotesSidebar';
import { EmptyState } from './EmptyState';
import { BEATS_PER_BAR, DRUMS, INSTRUMENTS, INSTRUMENT_NAMES, KEYS, changedTracks, freshTrackId, keyPitches, noteName, parseSong, writeSong, type Instrument, type Song, type SongNote, type Track } from './song-format';
import { play, previewNote, type Player } from './studio-audio';
import { GRIDS, addNote, duplicateNotes, fitTracks, nudgeVelocity, isBlack, moveNotes, notesIn, pasteNotes, position, quantizeNotes, removeNotes, setVelocity, snap, stretchNotes, type Picked } from './studio-view';
import { useFileReview } from './useFileReview';
import type { NotesState } from './useNotes';
import { ReviewActions, WhyThis } from './ReviewBar';
import { onCommand } from './commands';
import './studio.css';

export const STUDIO_WORDS: SidebarWords = { app: 'Music', group: 'folder', groups: 'Folders', item: 'song', items: 'songs', about: 'Songs are kept as JSON files in your workspace: tracks of notes, never audio, so the agent can read and write them like a score.', defaultGroup: 'Songs' };

export function StudioSidebar(props: { songs: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; starts?: readonly import('./SideNew').Start[]; onStart?: (prompt: string) => void }) {
  const { songs, ...rest } = props;
  return <NotesSidebar notes={songs} words={STUDIO_WORDS} {...rest} />;
}

const BEAT_W = 28;
const LANE_H = 48;
const HEAD_W = 248;
const ROLL_BEAT_W = 40;
const KEYS_W = 64;
const ROW_H = 14;
const MELODY_TOP = 84;
const MELODY_BOTTOM = 36;
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];
/** Drums get taller rows and room for their names, since there are only a few of them. */
const DRUM_ROW_H = 26;
const DRUM_KEYS_W = 96;
/** The velocity lane under the roll. */
const VEL_H = 64;
/** The least room left for the note editor when the track list is made taller. */
const EDITOR_MIN = 200;

const Icon = ({ d, fill }: { d: string; fill?: boolean }) => <svg viewBox="0 0 20 20" aria-hidden="true" data-fill={fill || undefined}><path d={d} /></svg>;
const ICONS = {
  start: 'M5 4.5v11M15 4.5 8 10l7 5.5z',
  play: 'M6.5 4.2v11.6L15.8 10z',
  stop: 'M5.5 5.5h9v9h-9z',
  loop: 'M4 9V8a3 3 0 0 1 3-3h8l-2.2-2.2M16 11v1a3 3 0 0 1-3 3H5l2.2 2.2',
  click: 'M8 3.5h4l3 13H5zM10 13l4.5-7',
  dup: 'M7 7h9v9H7zM4 13V4h9',
  trash: 'M4.5 6h11M8 6V4.5h4V6M6 6l.8 10h6.4L14 6',
};

/** A track's notes in small, along its lane in the arrangement. */
function Lane({ track, bars, proposed, zoom }: { track: Track; bars: number; proposed: boolean; zoom: number }) {
  const pitches = track.notes.map((n) => n.pitch);
  const lo = Math.min(...pitches, 127), hi = Math.max(...pitches, 0);
  const span = Math.max(1, hi - lo);
  const bw = BEAT_W * zoom;
  return (
    <div className="studio-lane" data-proposed={proposed || undefined} data-instrument={track.instrument} style={{ width: bars * BEATS_PER_BAR * bw, ["--beat" as string]: `${bw}px` }}>
      <span className="studio-region" style={{ width: bars * BEATS_PER_BAR * bw }} aria-hidden="true" />
      {Array.from({ length: bars }, (_, b) => <span key={b} className="studio-bar-line" style={{ left: b * BEATS_PER_BAR * bw }} />)}
      {track.notes.map((n, i) => (
        <span key={i} className="studio-mini" data-instrument={track.instrument} style={{ left: n.start * bw, width: Math.max(2, n.length * bw - 1), top: 8 + (1 - (n.pitch - lo) / span) * (LANE_H - 20) }} />
      ))}
    </div>
  );
}

/** How the piano roll is being pressed on: a note moved or stretched, a box drawn, or a click that may add a note. */
type Gesture =
  | { kind: 'move'; x: number; y: number; db: number; dr: number; moved: boolean; hit: number; wasPicked: boolean; shift: boolean }
  | { kind: 'stretch'; x: number; dl: number; these: Picked }
  | { kind: 'empty'; x: number; y: number; beat: number; row: number; box: boolean; shift: boolean };

/** One song: transport, tracks laid out by bar, and the chosen track's notes on a piano roll to draw, move and stretch. */
export function StudioEditor({ songs, review }: { songs: NotesState; review?: { conversation: string } | null }) {
  const parsed = useMemo(() => (songs.page ? parseSong(songs.text) : null), [songs.page, songs.text]);
  const song = parsed && 'song' in parsed ? parsed.song : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(new Set());
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [click, setClick] = useState(false);
  const [beat, setBeat] = useState(0);
  const [grid, setGrid] = useState(0.25);
  const [drawLength, setDrawLength] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  // The gesture is read back from a ref as well, so a pointer-up that comes before React has drawn the last move still
  // sees where the drag got to.
  const gestureRef = useRef<Gesture | null>(null);
  const setGesture = useCallback((g: Gesture | null) => { gestureRef.current = g; setGestureState(g); }, []);
  // The last press on a note, so a second press on it soon after takes it out. A double-click event is not used, since
  // with the pointer captured by the roll it does not reach the note in every engine.
  const lastPress = useRef<{ i: number; t: number; x: number; y: number } | null>(null);
  const [box, setBox] = useState<{ b0: number; b1: number; r0: number; r1: number } | null>(null);
  // How tall the track list is, once its divider has been dragged; until then it fits its tracks.
  const [arrangeH, setArrangeH] = useState<number | null>(null);
  const [scrollX, setScrollX] = useState(0);
  // A drag on the velocity lane: which notes, and how much louder or softer so far.
  const [velDrag, setVelDrag] = useState<{ these: Picked; y: number; by: number } | null>(null);
  const page = useRef<HTMLElement>(null);
  const [pageH, setPageH] = useState(840);
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    // The room under the transport, which can wrap onto two lines in a narrow window.
    const measure = () => setPageH(el.clientHeight - (el.querySelector<HTMLElement>('.studio-transport')?.offsetHeight ?? 52));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const bar = el.querySelector('.studio-transport');
    if (bar) ro.observe(bar);
    measure();
    return () => ro.disconnect();
  }, [song !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, setTick] = useState(0);
  const player = useRef<Player | null>(null);
  const roll = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const copied = useRef<SongNote[]>([]);
  const history = useRef(new Map<string, { undo: string[]; redo: string[]; tag: string; at: number }>());
  const file = songs.page ? `studio/${songs.page.path}` : null;
  const { before, keep, discard } = useFileReview(review, file, songs.page?.base);
  const changed = useMemo(() => {
    if (!song || before === undefined) return new Set<string>();
    const was = before === null ? null : parseSong(before);
    return changedTracks(was && 'song' in was ? was.song : null, song);
  }, [song, before]);
  const path = songs.page?.path ?? '';
  const steps = history.current.get(path) ?? { undo: [], redo: [], tag: '', at: 0 };
  history.current.set(path, steps);

  /** A change to the song, kept for undo; quick changes of one kind (typing a name) undo together. */
  const change = useCallback((fn: (s: Song) => void, tag = '') => {
    if (!song) return;
    const next = structuredClone(song);
    fn(next);
    const text = writeSong(next);
    if (text === songs.text) return;
    const now = Date.now();
    if (!(tag && tag === steps.tag && now - steps.at < 1200)) { steps.undo.push(songs.text); if (steps.undo.length > 200) steps.undo.shift(); }
    steps.redo = [];
    steps.tag = tag;
    steps.at = now;
    setTick((t) => t + 1);
    songs.edit(text);
  }, [song, songs, steps]);
  const undo = useCallback(() => {
    const was = steps.undo.pop();
    if (was === undefined) return;
    steps.redo.push(songs.text);
    steps.tag = '';
    setPicked(new Set());
    setTick((t) => t + 1);
    songs.edit(was);
  }, [songs, steps]);
  const redo = useCallback(() => {
    const next = steps.redo.pop();
    if (next === undefined) return;
    steps.undo.push(songs.text);
    steps.tag = '';
    setPicked(new Set());
    setTick((t) => t + 1);
    songs.edit(next);
  }, [songs, steps]);
  useEffect(() => onCommand('undo', undo), [undo]);
  useEffect(() => onCommand('redo', redo), [redo]);

  const stop = useCallback(() => { player.current?.stop(); player.current = null; setPlaying(false); }, []);
  const startAt = useCallback((from: number) => {
    if (!song) return;
    player.current?.stop();
    player.current = play(song, from >= song.bars * BEATS_PER_BAR ? 0 : from, loop, click);
    setPlaying(true);
  }, [song, loop, click]);
  const start = useCallback(() => startAt(Math.floor(beat)), [startAt, beat]);
  const seek = useCallback((to: number) => {
    setBeat(to);
    if (playing && song) { player.current?.stop(); player.current = play(song, to, loop, click); }
  }, [playing, song, loop, click]);
  // While playing, the playhead follows; a change to the notes is heard from the next time round.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => {
      const p = player.current;
      if (!p || !song) return;
      const b = p.beat();
      if (!loop && b >= song.bars * BEATS_PER_BAR) { stop(); setBeat(0); return; }
      setBeat(Math.max(0, b));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, song, loop, stop]);
  useEffect(() => () => player.current?.stop(), []);
  useEffect(() => { stop(); setBeat(0); setSelected(null); setPicked(new Set()); }, [songs.page?.path, stop]);
  useEffect(() => { setPicked(new Set()); }, [selected]);
  // Restart from where it is when the notes or the loop and click change, so what is heard is what is shown.
  useEffect(() => {
    if (playing && song) { const b = player.current?.beat() ?? 0; player.current?.stop(); player.current = play(song, Math.floor(b), loop, click); }
  }, [songs.text, loop, click]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys anywhere on the page: Space plays and stops, Return goes back to the start, Ctrl+Z and Ctrl+Y undo and redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.studio-page') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === ' ' && t.tagName !== 'BUTTON') { e.preventDefault(); if (playing) stop(); else start(); } else if (e.key === 'Enter' && t.tagName !== 'BUTTON' && !mod) { e.preventDefault(); seek(0); } else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); } else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, start, stop, seek, undo, redo]);

  // The piano roll opens on the chosen track's highest notes.
  const shownTrack = song ? (song.tracks.find((t) => t.id === selected) ?? song.tracks[0] ?? null) : null;
  useEffect(() => {
    if (!roll.current || !shownTrack || shownTrack.instrument === 'drums' || shownTrack.notes.length === 0) return;
    const top = Math.max(...shownTrack.notes.map((n) => n.pitch));
    roll.current.scrollTop = Math.max(0, (MELODY_TOP - top) * ROW_H - 2 * ROW_H);
  }, [shownTrack?.id, songs.page?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!songs.page) {
    return (
      <section className="studio-page empty" aria-label="Music">
        <EmptyState app="studio" label="No song open" title={songs.notebooks.some((n) => n.pages.length) ? 'No song open' : 'No songs yet'} line="Songs are notes, never audio, so Mobius can read and write them like a score." action={{ label: 'New song', run: () => newItemIn(songs, null, STUDIO_WORDS.defaultGroup) }} />
      </section>
    );
  }
  if (!song) return <section className="studio-page empty" aria-label="Music"><p className="note-empty">This song could not be read ({parsed && 'error' in parsed ? parsed.error : 'unknown'}).</p></section>;

  const track = song.tracks.find((t) => t.id === selected) ?? song.tracks[0] ?? null;
  const total = song.bars * BEATS_PER_BAR;
  const inKey = keyPitches(song.key);
  const drums = track?.instrument === 'drums';
  // Drum rows grow to fill the editor (there are only six), up to a comfortable pad size.
  const listFor = Math.max(96, Math.min(arrangeH ?? fitTracks(song.tracks.length), Math.max(96, pageH - EDITOR_MIN)));
  const rowH = drums ? Math.max(DRUM_ROW_H, Math.min(40, Math.floor((pageH - listFor - 1 - 38 - VEL_H - 2) / DRUMS.length))) : ROW_H;
  const keysW = drums ? DRUM_KEYS_W : KEYS_W;
  const rows = drums ? DRUMS.map((d) => ({ pitch: d.pitch, label: d.name, shade: false, black: false, c: true })) : Array.from({ length: MELODY_TOP - MELODY_BOTTOM + 1 }, (_, i) => MELODY_TOP - i).map((p) => ({ pitch: p, label: noteName(p), shade: !inKey.has(p % 12), black: isBlack(p), c: p % 12 === 0 }));
  const rowOf = (pitch: number) => rows.findIndex((r) => r.pitch === pitch);
  const rbw = ROLL_BEAT_W * zoom;
  const bw = BEAT_W * zoom;
  const notes = track?.notes ?? [];
  const pickedNotes = notes.filter((_, i) => picked.has(i));

  const setNotes = (fn: (n: SongNote[]) => { notes: SongNote[]; picked: Set<number> } | SongNote[], tag = '') => {
    if (!track) return;
    const after: { picked: Set<number> | null } = { picked: null };
    change((s) => {
      const t = s.tracks.find((x) => x.id === track.id);
      if (!t) return;
      const out = fn(t.notes);
      if (Array.isArray(out)) t.notes = out; else { t.notes = out.notes; after.picked = out.picked; }
    }, tag);
    if (after.picked) setPicked(after.picked);
  };
  /** Moves by rows rather than semitones, so drums step from one drum to the next. */
  const moveByRows = (db: number, dr: number) => setNotes((n) => {
    const moved = moveNotes(n, picked, db, 0, total);
    if (dr === 0) return moved;
    const can = moved.notes.every((x, i) => !moved.picked.has(i) || (rowOf(x.pitch) + dr >= 0 && rowOf(x.pitch) + dr < rows.length));
    if (!can) return moved;
    return { notes: moved.notes.map((x, i) => (moved.picked.has(i) ? { ...x, pitch: rows[rowOf(x.pitch) + dr]!.pitch } : x)), picked: moved.picked };
  });
  const addTrack = (instrument: Instrument) => change((s) => {
    const id = freshTrackId(s);
    s.tracks.push({ id, name: INSTRUMENT_NAMES[instrument], instrument, volume: 0.8, muted: false, solo: false, notes: [] });
    setSelected(id);
  });
  const setTrack = (id: string, fn: (t: Track) => void, tag = '') => change((s) => { const t = s.tracks.find((x) => x.id === id); if (t) fn(t); }, tag);
  const duplicateTrack = (id: string) => change((s) => {
    const i = s.tracks.findIndex((x) => x.id === id);
    if (i < 0) return;
    const copy = { ...structuredClone(s.tracks[i]!), id: freshTrackId(s), name: `${s.tracks[i]!.name} copy`.slice(0, 60) };
    s.tracks.splice(i + 1, 0, copy);
    setSelected(copy.id);
  });
  const deleteTrack = (id: string) => change((s) => { s.tracks = s.tracks.filter((x) => x.id !== id); if (selected === id) setSelected(null); });
  const names = [...changed].map((id) => song.tracks.find((t) => t.id === id)?.name ?? id);
  const pos = position(beat, song.tempo);

  // ---------- The piano roll's pointer ----------
  const at = (e: { clientX: number; clientY: number }) => {
    const r = inner.current!.getBoundingClientRect();
    return { beat: Math.max(0, Math.min(total - 1e-6, (e.clientX - r.left - keysW) / rbw)), row: Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientY - r.top) / rowH))) };
  };
  const onRollDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !track) return;
    const target = e.target as HTMLElement;
    if (target.closest('.studio-key')) return;
    roll.current?.focus({ preventScroll: true });
    const noteEl = target.closest<HTMLElement>('.studio-note');
    e.currentTarget.setPointerCapture(e.pointerId);
    if (noteEl) {
      const i = Number(noteEl.dataset.i);
      const n = notes[i]!;
      const last = lastPress.current;
      if (last && last.i === i && e.timeStamp - last.t < 450 && Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) < 6) {
        lastPress.current = null;
        setGesture(null);
        setNotes((ns) => removeNotes(ns, new Set([i])));
        setPicked(new Set());
        return;
      }
      lastPress.current = { i, t: e.timeStamp, x: e.clientX, y: e.clientY };
      const r = noteEl.getBoundingClientRect();
      const wasPicked = picked.has(i);
      if (!wasPicked) setPicked(e.shiftKey ? new Set([...picked, i]) : new Set([i]));
      if (target.closest('.studio-note-end') || (e.clientX > r.right - 6 && r.width > 10)) { const these = wasPicked ? picked : new Set([i]); setPicked(these); setGesture({ kind: 'stretch', x: e.clientX, dl: 0, these }); return; }
      previewNote(track.instrument, n.pitch, n.velocity);
      setGesture({ kind: 'move', x: e.clientX, y: e.clientY, db: 0, dr: 0, moved: false, hit: i, wasPicked, shift: e.shiftKey });
      return;
    }
    const p = at(e);
    setGesture({ kind: 'empty', x: e.clientX, y: e.clientY, beat: p.beat, row: p.row, box: false, shift: e.shiftKey });
  };
  const onRollMove = (e: { clientX: number; clientY: number }) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === 'move') {
      const db = Math.round((e.clientX - g.x) / rbw / grid) * grid;
      const dr = Math.round((e.clientY - g.y) / rowH);
      if (db !== g.db || dr !== g.dr || (!g.moved && Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 3)) setGesture({ ...g, db, dr, moved: g.moved || Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 3 });
    } else if (g.kind === 'stretch') {
      const dl = Math.round((e.clientX - g.x) / rbw / grid) * grid;
      if (dl !== g.dl) setGesture({ ...g, dl });
    } else {
      const far = Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 4;
      if (far || g.box) {
        const p = at(e);
        if (!g.box) setGesture({ ...g, box: true });
        setBox({ b0: g.beat, b1: p.beat, r0: g.row, r1: p.row });
      }
    }
  };
  const onRollUp = (e: { clientX: number; clientY: number }) => {
    // Where the pointer let go counts too, in case its last move was never drawn.
    onRollMove(e);
    const g = gestureRef.current;
    setGesture(null);
    if (!g || !track) return;
    if (g.kind === 'move') {
      if (g.moved) lastPress.current = null;
      if (g.moved && (g.db !== 0 || g.dr !== 0)) moveByRows(g.db, g.dr);
      else if (!g.moved && g.wasPicked && g.shift) setPicked(new Set([...picked].filter((i) => i !== g.hit)));
      else if (!g.moved && g.wasPicked && !g.shift) setPicked(new Set([g.hit]));
    } else if (g.kind === 'stretch') {
      if (g.dl !== 0) setNotes((n) => stretchNotes(n, g.these, g.dl, total, Math.min(grid, 0.25)));
    } else if (g.box) {
      const p = at(e);
      const box = { b0: g.beat, b1: p.beat, r0: g.row, r1: p.row };
      const pitches = [rows[box.r0]!.pitch, rows[box.r1]!.pitch];
      const inside = drums
        ? new Set(notes.flatMap((n, i) => { const r = rowOf(n.pitch); const [a, b] = box.r0 < box.r1 ? [box.r0, box.r1] : [box.r1, box.r0]; return r >= a && r <= b && n.start < Math.max(box.b0, box.b1) && n.start + n.length > Math.min(box.b0, box.b1) ? [i] : []; }))
        : notesIn(notes, box.b0, box.b1, pitches[0]!, pitches[1]!);
      setPicked(g.shift ? new Set([...picked, ...inside]) : inside);
      setBox(null);
    } else if (picked.size > 0 && !g.shift) {
      // A click on empty space with notes picked lets them go first, as in other editors.
      setPicked(new Set());
    } else {
      const pitch = rows[g.row]!.pitch;
      const length = drums ? Math.min(grid, 0.25) : drawLength;
      setNotes((n) => addNote(n, { pitch, start: snap(g.beat, grid), length: Math.min(length, total - snap(g.beat, grid)), velocity: 0.8 }));
      previewNote(track.instrument, pitch);
    }
  };
  const onRollKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!track) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if ((k === 'Delete' || k === 'Backspace') && picked.size) { setNotes((n) => removeNotes(n, picked)); setPicked(new Set()); } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (!picked.size) return;
      const d = (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? BEATS_PER_BAR : grid);
      if (e.altKey) setNotes((n) => stretchNotes(n, picked, d, total, Math.min(grid, 0.25))); else moveByRows(d, 0);
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (!picked.size) return;
      const dir = k === 'ArrowUp' ? -1 : 1;
      if (drums) moveByRows(0, dir);
      else setNotes((n) => moveNotes(n, picked, 0, -dir * (e.shiftKey ? 12 : 1), total));
    } else if (mod && k.toLowerCase() === 'a') { setPicked(new Set(notes.map((_, i) => i))); } else if (mod && k.toLowerCase() === 'd') { setNotes((n) => duplicateNotes(n, picked, total)); } else if (mod && k.toLowerCase() === 'c') { copied.current = pickedNotes; } else if (mod && k.toLowerCase() === 'x') { copied.current = pickedNotes; setNotes((n) => removeNotes(n, picked)); setPicked(new Set()); } else if (mod && k.toLowerCase() === 'v') { const from = snap(beat, grid); setNotes((n) => pasteNotes(n, copied.current, from, total)); } else if (!mod && k.toLowerCase() === 'q') { setNotes((n) => quantizeNotes(n, picked, grid, total)); } else if (k === 'Escape') { setPicked(new Set()); } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // While a note is dragged, the picked notes are drawn where they would land.
  const dragShift = gesture?.kind === 'move' && gesture.moved ? { db: gesture.db, dr: gesture.dr } : null;
  const dragStretch = gesture?.kind === 'stretch' ? gesture.dl : 0;
  // The track list fits its tracks unless its divider was dragged, and always leaves the editor some room.
  const room = pageH - EDITOR_MIN;
  const listH = listFor;
  const onDividerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const y = e.clientY, h = listH;
    const el = e.currentTarget;
    const move = (m: PointerEvent) => setArrangeH(Math.max(96, Math.min(h + m.clientY - y, Math.max(96, room))));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  /** A press on a note's velocity bar: drag up for louder, down for softer; picked notes move together. */
  const onVelDown = (e: ReactPointerEvent<HTMLElement>, i: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const these = picked.has(i) ? picked : new Set([i]);
    if (!picked.has(i)) setPicked(e.shiftKey ? new Set([...picked, i]) : these);
    e.currentTarget.setPointerCapture(e.pointerId);
    setVelDrag({ these: e.shiftKey && !picked.has(i) ? new Set([...picked, i]) : these, y: e.clientY, by: 0 });
  };
  const onVelMove = (e: ReactPointerEvent<HTMLElement>) => { if (velDrag) setVelDrag({ ...velDrag, by: Math.round(((velDrag.y - e.clientY) / (VEL_H - 8)) * 100) / 100 }); };
  const onVelUp = () => {
    if (!velDrag) return;
    if (velDrag.by !== 0) setNotes((n) => nudgeVelocity(n, velDrag.these, velDrag.by), 'velocity');
    setVelDrag(null);
  };
  const shownVelocity = (j: number, v: number) => (velDrag && velDrag.these.has(j) ? Math.max(0, Math.min(1, v + velDrag.by)) : v);

  const velocity = pickedNotes.length ? pickedNotes.reduce((a, n) => a + n.velocity, 0) / pickedNotes.length : null;

  return (
    <section className="studio-page" aria-label="Music" ref={page}>
      <div className="studio-transport" role="toolbar" aria-label="Transport">
        <div className="studio-buttons">
          <button type="button" className="studio-tbtn" aria-label="Go to start" title="Go to start (Return)" onClick={() => seek(0)}><Icon d={ICONS.start} fill /></button>
          <button type="button" className="studio-tbtn studio-play" aria-label={playing ? 'Stop' : 'Play'} title={playing ? 'Stop (Space)' : 'Play (Space)'} data-on={playing || undefined} onClick={() => (playing ? stop() : start())}><Icon d={playing ? ICONS.stop : ICONS.play} fill /></button>
          <button type="button" className="studio-tbtn" aria-label="Loop" title="Loop the song" aria-pressed={loop} onClick={() => setLoop((l) => !l)}><Icon d={ICONS.loop} /></button>
          <button type="button" className="studio-tbtn" aria-label="Metronome" title="Metronome" aria-pressed={click} onClick={() => setClick((c) => !c)}><Icon d={ICONS.click} /></button>
        </div>
        <div className="studio-lcd" role="group" aria-label="Song">
          <span className="studio-lcd-cell"><span className="studio-pos" aria-label="Position">{pos.bars}</span><small>BAR</small></span>
          <span className="studio-lcd-cell"><span className="studio-time" aria-label="Time">{pos.time}</span><small>TIME</small></span>
          <label className="studio-lcd-cell"><input aria-label="Tempo" type="number" min={30} max={300} value={song.tempo} onChange={(e) => { const v = Number(e.target.value); if (v >= 30 && v <= 300) change((s) => { s.tempo = Math.round(v); }, 'tempo'); }} /><small>TEMPO</small></label>
          <label className="studio-lcd-cell"><select aria-label="Key" value={song.key} onChange={(e) => change((s) => { s.key = e.target.value; })}>{KEYS.map((k) => <option key={k}>{k}</option>)}</select><small>KEY</small></label>
          <label className="studio-lcd-cell"><input aria-label="Bars" type="number" min={1} max={512} value={song.bars} onChange={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 512) change((s) => { s.bars = Math.round(v); }, 'bars'); }} /><small>BARS</small></label>
        </div>
        <span className="studio-gap" />
        <div className="studio-buttons">
          <button type="button" className="studio-tbtn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={steps.undo.length === 0} onClick={undo}><Icon d="M7.5 5.5 4 9l3.5 3.5M4.5 9H12a4 4 0 0 1 0 8h-2" /></button>
          <button type="button" className="studio-tbtn" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={steps.redo.length === 0} onClick={redo}><Icon d="M12.5 5.5 16 9l-3.5 3.5M15.5 9H8a4 4 0 0 0 0 8h2" /></button>
        </div>
        <label className="studio-zoom" title="Zoom">
          <span className="sr-only">Zoom</span>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 4a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM12 12l4 4" /></svg>
          <input type="range" aria-label="Zoom" min={0} max={ZOOMS.length - 1} step={1} value={ZOOMS.indexOf(zoom)} onChange={(e) => setZoom(ZOOMS[Number(e.target.value)] ?? 1)} />
        </label>
        <label className="studio-add">
          <span className="sr-only">Add a track</span>
          <select aria-label="Add a track" value="" onChange={(e) => { if (e.target.value) addTrack(e.target.value as Instrument); }}>
            <option value="">Add track…</option>
            {INSTRUMENTS.map((i) => <option key={i} value={i}>{INSTRUMENT_NAMES[i]}</option>)}
          </select>
        </label>
      </div>
      <div className="studio-arrange" data-empty={song.tracks.length === 0 || undefined} style={{ ['--head' as string]: `${HEAD_W}px`, height: listH }}>
        <div className="studio-ruler-row">
          <div className="studio-ruler-head">{song.tracks.length === 1 ? '1 track' : `${song.tracks.length} tracks`}</div>
          <div
            className="studio-ruler"
            role="slider"
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Math.floor(beat)}
            aria-valuetext={`Bar ${pos.bars}`}
            tabIndex={0}
            style={{ width: total * bw }}
            onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(Math.max(0, Math.min(total - 1, Math.floor((e.clientX - r.left) / bw)))); }}
            onKeyDown={(e) => { if (e.key === 'ArrowRight') seek(Math.min(total - 1, Math.floor(beat) + (e.shiftKey ? 1 : BEATS_PER_BAR))); else if (e.key === 'ArrowLeft') seek(Math.max(0, Math.floor(beat) - (e.shiftKey ? 1 : BEATS_PER_BAR))); else return; e.preventDefault(); }}
          >
            {loop && <span className="studio-cycle" style={{ width: total * bw }} aria-hidden="true" />}
            {Array.from({ length: song.bars }, (_, b) => <span key={b} className="studio-ruler-bar" style={{ left: b * BEATS_PER_BAR * bw }}>{(zoom >= 0.75 || b % 2 === 0) ? b + 1 : ''}</span>)}
            <span className="studio-playhead-cap" style={{ left: beat * bw }} aria-hidden="true" />
          </div>
        </div>
        <div className="studio-tracks" role="list" aria-label="Tracks">
          {song.tracks.length === 0 && <p className="studio-none">No tracks yet. Add one, or ask Mobius for a part: “a bass line that follows the chords”.</p>}
          {song.tracks.map((t) => (
            <div key={t.id} role="listitem" aria-label={t.name} className="studio-track" aria-current={track?.id === t.id || undefined} data-instrument={t.instrument} data-muted={(t.muted || (song.tracks.some((x) => x.solo) && !t.solo)) || undefined} onClick={() => setSelected(t.id)}>
              <div className="studio-track-head" data-proposed={changed.has(t.id) || undefined}>
                <span className="studio-track-color" aria-hidden="true" />
                <div className="studio-track-main">
                  <input className="studio-track-name" aria-label="Track name" value={t.name} maxLength={60} onChange={(e) => setTrack(t.id, (x) => { x.name = e.target.value; }, `name:${t.id}`)} />
                  <div className="studio-track-row">
                    <select aria-label="Instrument" value={t.instrument} onChange={(e) => setTrack(t.id, (x) => { x.instrument = e.target.value as Instrument; })}>{INSTRUMENTS.map((i) => <option key={i} value={i}>{INSTRUMENT_NAMES[i]}</option>)}</select>
                    <input type="range" className="studio-volume" aria-label={`Volume of ${t.name}`} min={0} max={1} step={0.01} value={t.volume} onClick={(e) => e.stopPropagation()} onChange={(e) => setTrack(t.id, (x) => { x.volume = Number(e.target.value); }, `vol:${t.id}`)} />
                  </div>
                </div>
                <div className="studio-track-buttons">
                  <button type="button" className="studio-ms" aria-label={`Mute ${t.name}`} title="Mute" aria-pressed={t.muted} onClick={(e) => { e.stopPropagation(); setTrack(t.id, (x) => { x.muted = !x.muted; }); }}>M</button>
                  <button type="button" className="studio-ms" aria-label={`Solo ${t.name}`} title="Solo" aria-pressed={t.solo} onClick={(e) => { e.stopPropagation(); setTrack(t.id, (x) => { x.solo = !x.solo; }); }}>S</button>
                  <button type="button" className="studio-track-act" aria-label={`Duplicate ${t.name}`} title="Duplicate track" onClick={(e) => { e.stopPropagation(); duplicateTrack(t.id); }}><Icon d={ICONS.dup} /></button>
                  <button type="button" className="studio-track-act" aria-label={`Delete ${t.name}`} title="Delete track (Undo brings it back)" onClick={(e) => { e.stopPropagation(); deleteTrack(t.id); }}><Icon d={ICONS.trash} /></button>
                </div>
              </div>
              <div className="studio-lane-wrap">
                <Lane track={t} bars={song.bars} proposed={changed.has(t.id)} zoom={zoom} />
                <span className="studio-playhead" style={{ left: beat * bw }} aria-hidden="true" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {changed.size > 0 && (
        <div className="studio-review" role="group" aria-label="Mobius's change">
          <span className="review-dot" aria-hidden="true" />
          <span>{`Mobius ${before === null ? 'made' : 'changed'} ${names.join(', ')}. Notes, never audio: each is yours to edit.`}{review && <WhyThis conversation={review.conversation} />}</span>
          <ReviewActions onKeep={keep} onDiscard={discard} />
        </div>
      )}
      <div
        className="studio-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize tracks and notes"
        aria-valuemin={96}
        aria-valuemax={Math.max(96, room)}
        aria-valuenow={Math.round(listH)}
        tabIndex={0}
        title="Drag to show more tracks or more notes"
        onPointerDown={onDividerDown}
        onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setArrangeH(Math.max(96, Math.min(listH + (e.key === 'ArrowUp' ? -24 : 24), Math.max(96, room)))); } else if (e.key === 'Home') { e.preventDefault(); setArrangeH(null); } }}
      />
      {track && (
        <div className="studio-editor" data-instrument={track.instrument}>
          <div className="studio-roll-bar" role="toolbar" aria-label="Notes">
            <span className="studio-roll-title"><span className="studio-track-color" aria-hidden="true" />{track.name}</span>
            <label className="studio-field"><span>Grid</span><select aria-label="Grid" value={grid} onChange={(e) => setGrid(Number(e.target.value))}>{GRIDS.map((g) => <option key={g.beats} value={g.beats}>{g.label}</option>)}</select></label>
            {!drums && <label className="studio-field"><span>Draw</span><select aria-label="Note length" value={drawLength} onChange={(e) => setDrawLength(Number(e.target.value))}>{GRIDS.map((g) => <option key={g.beats} value={g.beats}>{g.label}</option>)}</select></label>}
            <button type="button" className="studio-chip" title="Line notes up to the grid (Q)" onClick={() => setNotes((n) => quantizeNotes(n, picked, grid, total))}>Quantize</button>
            <span className="studio-gap" />
            {velocity !== null ? (
              <>
                <span className="studio-picked">{pickedNotes.length === 1 ? `${drums ? (DRUMS.find((d) => d.pitch === pickedNotes[0]!.pitch)?.name ?? '') : noteName(pickedNotes[0]!.pitch)} at ${position(pickedNotes[0]!.start, song.tempo).bars}` : `${pickedNotes.length} notes`}</span>
                <label className="studio-field studio-velocity"><span>Velocity</span><input type="range" aria-label="Velocity" min={0} max={1} step={0.01} value={velocity} onChange={(e) => setNotes((n) => setVelocity(n, picked, Number(e.target.value)), 'velocity')} /><output>{Math.round(velocity * 127)}</output></label>
                <button type="button" className="studio-chip" aria-label="Delete notes" title="Delete (Delete key)" onClick={() => { setNotes((n) => removeNotes(n, picked)); setPicked(new Set()); }}>Delete</button>
              </>
            ) : <span className="studio-hint">Click to draw a note, drag to move it, drag its end to stretch it.</span>}
          </div>
          <div className="studio-roll" ref={roll} role="grid" aria-label={`Notes of ${track.name}`} aria-multiselectable="true" tabIndex={0} onKeyDown={onRollKey} onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}>
            <div
              className="studio-roll-inner"
              ref={inner}
              style={{ width: keysW + total * rbw, height: rows.length * rowH, ['--row' as string]: `${rowH}px`, ['--keys' as string]: `${keysW}px` }}
              onPointerDown={onRollDown}
              onPointerMove={onRollMove}
              onPointerUp={onRollUp}
              onPointerCancel={() => { setGesture(null); setBox(null); }}
            >
              {rows.map((r, i) => (
                <div key={r.pitch} className="studio-row" role="row" data-shade={r.shade || undefined} data-black={r.black || undefined} style={{ top: i * rowH, height: rowH }}>
                  <span className="studio-key" role="rowheader" data-black={r.black || undefined} data-c={r.c || undefined} data-drum={drums || undefined} onPointerDown={(e) => { e.stopPropagation(); previewNote(track.instrument, r.pitch); }}>{r.label}</span>
                  <div
                    className="studio-row-cells"
                    role="gridcell"
                    aria-label={`${r.label} row`}
                    style={{ width: total * rbw, backgroundSize: `${rbw * grid}px 100%, ${rbw}px 100%, ${rbw * BEATS_PER_BAR}px 100%` }}
                  >
                    {notes.map((n, j) => {
                      if (n.pitch !== r.pitch) return null;
                      const isPicked = picked.has(j);
                      const left = n.start * rbw + (isPicked && dragShift ? dragShift.db * rbw : 0);
                      const width = Math.max(4, (n.length + (isPicked ? dragStretch : 0)) * rbw - 1);
                      return (
                        <span
                          key={j}
                          className="studio-note"
                          data-i={j}
                          data-picked={isPicked || undefined}
                          data-instrument={track.instrument}
                          role="button"
                          aria-pressed={isPicked}
                          aria-label={`${r.label} at beat ${n.start + 1}, ${n.length} beats`}
                          style={{ left, width, transform: isPicked && dragShift ? `translateY(${dragShift.dr * rowH}px)` : undefined, ['--vel' as string]: n.velocity }}
                        >{width > 10 && <span className="studio-note-end" aria-hidden="true" />}</span>
                      );
                    })}
                  </div>
                </div>
              ))}
              {box && (() => {
                const [b0, b1] = box.b0 < box.b1 ? [box.b0, box.b1] : [box.b1, box.b0];
                const [r0, r1] = box.r0 < box.r1 ? [box.r0, box.r1] : [box.r1, box.r0];
                return <span className="studio-box" style={{ left: keysW + b0 * rbw, width: (b1 - b0) * rbw, top: r0 * rowH, height: (r1 - r0 + 1) * rowH }} aria-hidden="true" />;
              })()}
              <span className="studio-playhead" style={{ left: keysW + beat * rbw }} aria-hidden="true" />
            </div>
          </div>
          <div className="studio-vel" role="group" aria-label={`Velocity of ${track.name}`} style={{ height: VEL_H, ['--keys' as string]: `${keysW}px` }}>
            <span className="studio-vel-label" aria-hidden="true">Velocity</span>
            <div className="studio-vel-inner" style={{ width: total * rbw, transform: `translateX(${-scrollX}px)`, backgroundSize: `${rbw}px 100%, ${rbw * BEATS_PER_BAR}px 100%` }} onPointerMove={onVelMove} onPointerUp={onVelUp} onPointerCancel={() => setVelDrag(null)}>
              {notes.map((n, j) => {
                const v = shownVelocity(j, n.velocity);
                const label = drums ? (DRUMS.find((d) => d.pitch === n.pitch)?.name ?? noteName(n.pitch)) : noteName(n.pitch);
                return (
                  <span
                    key={j}
                    className="studio-vel-bar"
                    role="slider"
                    tabIndex={-1}
                    aria-label={`Velocity of ${label} at beat ${n.start + 1}`}
                    aria-valuemin={0}
                    aria-valuemax={127}
                    aria-valuenow={Math.round(v * 127)}
                    data-picked={picked.has(j) || undefined}
                    style={{ left: n.start * rbw, height: `${Math.max(2, v * (VEL_H - 8))}px` }}
                    onPointerDown={(e) => onVelDown(e, j)}
                    onKeyDown={(e) => { if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault(); e.stopPropagation(); setNotes((ns) => nudgeVelocity(ns, picked.has(j) ? picked : new Set([j]), (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.1 : 1 / 127)), 'velocity'); }}
                  />
                );
              })}
              <span className="studio-playhead" style={{ left: beat * rbw }} aria-hidden="true" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
