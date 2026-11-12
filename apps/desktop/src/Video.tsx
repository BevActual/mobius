import { RowMark } from './RowMark';
import { FromMobius } from './FromMobius';
import { EmptyState } from './EmptyState';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { changedShots, cutLength, locate, parseCut, shotLength, shotStart, timecode, type Cut, type Shot } from './cut-format';
import { useFileReview } from './useFileReview';
import type { VideoState } from './useVideo';
import { ReviewActions, WhyThis } from './ReviewBar';
import { onCommand } from './commands';
import { emptyHistory, recorded, redone, undone, type History } from './photo-view';
import { dropIndex, filmstrip, insertClip, moveShot, nextEdit, removeShot, rulerLabel, rulerMarks, splitAt, trimShot } from './video-view';
import './video.css';

const Icon = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" data-fill={fill || undefined}><path d={d} /></svg>
);
const PLUS = 'M10 4v12M4 10h12';
const PLAY = 'M6.5 4.5v11l9-5.5z';
const PAUSE = 'M6 4.5h3v11H6zM11 4.5h3v11h-3z';
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);
const CLIP_TYPE = 'application/x-mobius-clip';
const SHOT_TYPE = 'application/x-mobius-shot';
const FRAME_W = 80;
const FPS = 30;

/**
 * Frames from the clips, for the filmstrips and the footage list: read once with a hidden player, a clip at a time,
 * and kept while the window is open.
 */
const FRAMES = new Map<string, string>();
const WANTED = new Map<string, number[]>();
const BUSY = new Set<string>();
let listeners: (() => void)[] = [];
function useFrames(video: VideoState): (clip: string, t: number) => string | undefined {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    listeners.push(bump);
    return () => { listeners = listeners.filter((l) => l !== bump); };
  }, []);
  const project = video.project;
  const read = useCallback(async (key: string, clip: string) => {
    if (BUSY.has(key)) return;
    BUSY.add(key);
    const el = document.createElement('video');
    el.muted = true;
    el.preload = 'auto';
    const canvas = document.createElement('canvas');
    try {
      el.setAttribute('src', await video.playable(clip));
      await new Promise<void>((ok, fail) => { el.onloadeddata = () => ok(); el.onerror = () => fail(new Error('unreadable')); });
      while ((WANTED.get(key) ?? []).length > 0) {
        const t = WANTED.get(key)!.shift()!;
        const name = `${key}@${t}`;
        if (FRAMES.has(name)) continue;
        el.currentTime = t;
        await new Promise<void>((ok) => { el.onseeked = () => ok(); window.setTimeout(ok, 1500); });
        const w = 160, h = Math.round(160 * (el.videoHeight || 9) / (el.videoWidth || 16));
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')?.drawImage(el, 0, 0, w, h);
        try { FRAMES.set(name, canvas.toDataURL('image/jpeg', 0.7)); } catch { FRAMES.set(name, ''); }
        listeners.forEach((l) => l());
      }
    } catch {
      for (const t of WANTED.get(key) ?? []) FRAMES.set(`${key}@${t}`, '');
      WANTED.set(key, []);
    } finally {
      el.removeAttribute('src');
      BUSY.delete(key);
    }
  }, [video]);
  return (clip, t) => {
    if (!project) return undefined;
    const key = `${project}/${clip}`;
    const name = `${key}@${t}`;
    const got = FRAMES.get(name);
    if (got !== undefined) return got || undefined;
    const want = WANTED.get(key) ?? [];
    if (!want.includes(t)) { want.push(t); WANTED.set(key, want); }
    void read(key, clip);
    return undefined;
  };
}

/** Video projects, and the open project's footage: clips to add to the cut, or to drag into it. */
export function VideoSidebar({ video, pin, changed }: { video: VideoState; pin?: ReactNode; changed?: ReadonlySet<string> }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const frame = useFrames(video);
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await video.createProject(name.trim() || 'Project')) { setNaming(false); setName(''); } };
  const addShot = (clip: string) => video.change(insertClip(video.cut, clip, video.lengthOf(clip)));
  return (
    <aside className="side video-side" aria-label="Video sidebar">
      <div className="side-head">
        <span className="side-title">Projects</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New project" title="New project" onClick={() => setNaming(true)}><Icon d={PLUS} /></button>
        </span>
      </div>
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Project name" placeholder="Project name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      <nav className="task-lists" aria-label="Video projects">
        {video.projects.length === 0 && !naming && <p className="side-empty">No projects yet.</p>}
        <ul role="list">
          {video.projects.map((p) => (
            <li key={p.name}>
              <button type="button" className="list-row" aria-current={video.project === p.name ? 'page' : undefined} onClick={() => void video.open(p.name)}>
                <span className="list-name">{p.name}</span>
                <RowMark changed={changed?.has(p.name) === true} changedTitle="Cut changed by Mobius in its last turn" />
                <span className="list-count">{p.clips.length || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {video.project && (
        <section className="video-footage" aria-label="Footage">
          <div className="video-footage-head">
            <span>Footage</span>
            <button type="button" className="strip-btn" aria-label="Show folder" title="Show the project’s folder" onClick={() => void video.showFolder()}><Icon d="M3 6.5V15h14V8H9.5L8 6.5zM3 6.5V5h5l1.5 1.5" /></button>
          </div>
          {video.clips.length === 0 && <p className="video-footage-hint">Drop clips on the window, or copy them into the project’s folder.</p>}
          <ul role="list">
            {video.clips.map((c) => {
              const len = video.lengthOf(c.name);
              const poster = c.kind === 'video' && len ? frame(c.name, Math.round(Math.min(len / 2, 1) * 4) / 4) : undefined;
              return (
                <li key={c.name} className="video-clip" draggable title={`${c.name}\nDrag into the timeline, or add it to the end`}
                  onDragStart={(e) => { e.dataTransfer.setData(CLIP_TYPE, c.name); e.dataTransfer.effectAllowed = 'copy'; }}>
                  <span className="video-clip-thumb" data-kind={c.kind} aria-hidden="true">{poster ? <img src={poster} alt="" draggable={false} /> : null}</span>
                  <span className="video-clip-text">
                    <span className="video-clip-name">{c.name}</span>
                    <span className="video-clip-len">{len ? timecode(len) : c.kind === 'audio' ? 'Sound' : ''}</span>
                  </span>
                  <button type="button" className="strip-btn" aria-label={`Add ${c.name} to the cut`} title="Add to the end of the cut" onClick={() => addShot(c.name)}><Icon d={PLUS} /></button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <FromMobius items={video.projects.filter((p) => changed?.has(p.name)).map((p) => ({ key: p.name, name: p.name, current: video.project === p.name, onOpen: () => void video.open(p.name) }))} />
    </aside>
  );
}

/** One shot in the timeline: its filmstrip, its title above it, and handles at its ends to trim it. */
function ShotBlock({ shot, index, width, selected, playing, proposed, frame, onSelect, onTrim, onDragStart }: {
  shot: Shot; index: number; width: number; selected: boolean; playing: boolean; proposed: boolean;
  frame: (clip: string, t: number) => string | undefined;
  onSelect: () => void; onTrim: (edge: 'in' | 'out') => (e: ReactPointerEvent) => void; onDragStart: (e: DragEvent) => void;
}) {
  const times = filmstrip(shot, width, FRAME_W);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`Shot ${index + 1}: ${shot.clip}, ${timecode(shotLength(shot))}${shot.title ? `, titled ${shot.title}` : ''}`}
      className="video-shot"
      data-proposed={proposed || undefined}
      data-playing={playing || undefined}
      style={{ width }}
      draggable
      onDragStart={onDragStart}
      onClick={onSelect}
    >
      <span className="video-shot-film" aria-hidden="true">
        {times.map((t, i) => { const src = frame(shot.clip, t); return <span key={i} className="video-shot-frame">{src ? <img src={src} alt="" draggable={false} /> : null}</span>; })}
      </span>
      {shot.title && <span className="video-shot-title" aria-hidden="true">{shot.title}</span>}
      <span className="video-shot-label" aria-hidden="true">{width > 70 ? shot.clip.replace(/\.[^.]+$/, '') : ''}</span>
      {selected && <>
        <span className="video-trim" data-edge="in" title="Drag to trim the start" onPointerDown={onTrim('in')} />
        <span className="video-trim" data-edge="out" title="Drag to trim the end" onPointerDown={onTrim('out')} />
      </>}
    </button>
  );
}

/** The cut: a viewer that plays its shots in order, the shots as a timeline to trim, split and arrange, and the chosen shot's details. */
export function VideoEditor({ video, review }: { video: VideoState; review?: { conversation: string } | null }) {
  const player = useRef<HTMLVideoElement>(null);
  const page = useRef<HTMLElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [unplayable, setUnplayable] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [width, setWidth] = useState(900);
  const frame = useFrames(video);
  const { cut } = video;
  const file = video.project ? `video/${video.project}/cut.json` : null;
  const { before, keep, discard } = useFileReview(review, file, video.base);
  const changed = useMemo(() => (before === undefined ? new Set<string>() : changedShots(before === null ? null : parseCut(before), cut)), [before, cut]);
  const total = cutLength(cut);
  const shot: Shot | undefined = cut.shots[index];

  // Undo for the cut, as long as the project is open. Typing in a field or dragging a handle undoes as one.
  const history = useRef<History<Cut>>(emptyHistory());
  const [, setVersion] = useState(0);
  const edit = (next: Cut, tag = '') => {
    if (next === cut) return;
    history.current = recorded(history.current, cut, tag, Date.now());
    setVersion((v) => v + 1);
    video.change(next);
  };
  const undo = () => { const got = undone(history.current, live.current.cut); if (got) { history.current = got.history; setVersion((v) => v + 1); video.change(got.value); } };
  const redo = () => { const got = redone(history.current, live.current.cut); if (got) { history.current = got.history; setVersion((v) => v + 1); video.change(got.value); } };
  const live = useRef({ cut, undo, redo });
  live.current = { cut, undo, redo };

  // Show a shot at a time in its clip.
  const cue = (i: number, clipTime: number, play: boolean) => {
    const el = player.current;
    const s = cut.shots[i];
    if (!el || !s) return;
    setIndex(i);
    void video.playable(s.clip).then((src) => {
      const go = () => { el.currentTime = clipTime; if (play) void el.play().catch(() => setPlaying(false)); };
      if (el.getAttribute('src') === src && el.readyState >= 1) { go(); return; }
      if (el.getAttribute('src') !== src) el.setAttribute('src', src);
      el.addEventListener('loadedmetadata', go, { once: true });
    });
  };
  useEffect(() => {
    setIndex(0); setT(0); setPlaying(false); setSelected(null); player.current?.pause();
    history.current = emptyHistory();
    if (cut.shots[0]) cue(0, cut.shots[0].in, false);
  }, [video.project]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!playing && cut.shots.length > 0) { const at = locate(cut, Math.min(t, total)); if (at) cue(at.index, at.clipTime, false); } }, [cut]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTime = () => {
    const el = player.current;
    if (!el || !shot) return;
    setT(shotStart(cut, index) + Math.max(0, el.currentTime - shot.in));
    if (el.currentTime >= shot.out - 0.04) {
      if (index + 1 < cut.shots.length) cue(index + 1, cut.shots[index + 1]!.in, playing);
      else { el.pause(); setPlaying(false); }
    }
  };
  const toggle = () => {
    const el = player.current;
    if (!el || !shot) return;
    if (playing) { el.pause(); setPlaying(false); return; }
    setPlaying(true);
    const at = t >= total - 0.05 ? { index: 0, clipTime: cut.shots[0]!.in } : locate(cut, t);
    if (at) cue(at.index, at.clipTime, true);
  };
  const seek = (to: number) => { const at = Math.max(0, Math.min(total, to)); const where = locate(cut, at); setT(at); if (where) cue(where.index, where.clipTime, playing); };
  const split = () => { const got = splitAt(cut, t); if (got) { edit(got.cut); setSelected(got.id); } };
  const remove = (id: string) => { edit(removeShot(cut, id)); setSelected(null); };
  const setShot = (id: string, tag: string, fn: (s: Shot) => void) => edit({ ...cut, shots: cut.shots.map((s) => { if (s.id !== id) return s; const n = { ...s }; fn(n); n.out = Math.max(n.in + 0.1, n.out); return n; }) }, `${tag}:${id}`);
  const playheadIn = (id: string) => cut.shots[index]?.id === id && player.current ? Math.round(player.current.currentTime * 100) / 100 : null;

  // Keys, as in other editors: Space plays, arrows step a frame (a second with Shift), Up and Down go between edits.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e) => {
    if (!page.current?.isConnected || e.defaultPrevented || typing(e.target) || document.querySelector('[aria-modal="true"]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key === 'y') { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;
    const sel = selected && cut.shots.find((s) => s.id === selected);
    if (e.key === ' ' || e.key === 'k') { if (e.target instanceof HTMLButtonElement && e.key === ' ') return; e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / FPS)); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const to = nextEdit(cut, t, e.key === 'ArrowDown' ? 1 : -1); if (to !== null) seek(to); }
    else if (e.key === 'Home') { e.preventDefault(); seek(0); }
    else if (e.key === 'End') { e.preventDefault(); seek(total); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); split(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(sel.id); }
    else if ((e.key === 'i' || e.key === 'o') && sel) { const at = playheadIn(sel.id); if (at !== null) { e.preventDefault(); setShot(sel.id, e.key, (s) => { if (e.key === 'i') s.in = at; else s.out = at; }); } }
    else if (e.key === 'Escape' && sel) setSelected(null);
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', down);
    const stopUndo = onCommand('undo', () => { if (page.current?.isConnected) live.current.undo(); });
    const stopRedo = onCommand('redo', () => { if (page.current?.isConnected) live.current.redo(); });
    return () => { window.removeEventListener('keydown', down); stopUndo(); stopRedo(); };
  }, []);

  // The timeline fits the cut until zoomed.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const look = () => setWidth(el.clientWidth);
    look();
    const watch = new ResizeObserver(look);
    watch.observe(el);
    return () => watch.disconnect();
  }, [video.project, video.available]);
  const fit = total > 0 ? Math.max(14, Math.min(160, (width - 32) / total)) : 40;
  const pxPerSec = zoom ?? fit;

  // Scrubbing: the ruler, or the playhead itself.
  const scrub = useRef(false);
  const timeAt = (clientX: number) => { const box = strip.current?.querySelector('.video-track')?.getBoundingClientRect(); return box ? (clientX - box.left) / pxPerSec : 0; };
  const scrubDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrub.current = true;
    if (playing) { player.current?.pause(); setPlaying(false); }
    seek(timeAt(e.clientX));
  };
  const scrubMove = (e: ReactPointerEvent) => { if (scrub.current) seek(timeAt(e.clientX)); };
  const scrubUp = () => { scrub.current = false; };

  // Trimming: a handle drags one end of the chosen shot.
  const trimming = useRef<{ id: string; edge: 'in' | 'out'; x: number; start: Cut; from: number; tag: string } | null>(null);
  const trimDown = (id: string) => (edge: 'in' | 'out') => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const s = cut.shots.find((x) => x.id === id);
    if (!s) return;
    trimming.current = { id, edge, x: e.clientX, start: cut, from: edge === 'in' ? s.in : s.out, tag: `trim-${Date.now()}` };
  };
  const trimMove = (e: ReactPointerEvent) => {
    const d = trimming.current;
    if (!d) return;
    const s = d.start.shots.find((x) => x.id === d.id);
    if (!s) return;
    edit(trimShot(d.start, d.id, d.edge, d.from + (e.clientX - d.x) / pxPerSec, video.lengthOf(s.clip)), d.tag);
  };
  const trimUp = () => { trimming.current = null; };

  // Dragging: shots to rearrange, clips from Footage to add, files from outside to bring in.
  const dragOver = (e: DragEvent) => {
    const types = [...e.dataTransfer.types];
    if (!types.includes(CLIP_TYPE) && !types.includes(SHOT_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = types.includes(SHOT_TYPE) ? 'move' : 'copy';
    setDropAt(dropIndex(cut, timeAt(e.clientX) * pxPerSec, pxPerSec));
  };
  const dropOnTimeline = (e: DragEvent) => {
    const at = dropIndex(cut, timeAt(e.clientX) * pxPerSec, pxPerSec);
    setDropAt(null);
    const clip = e.dataTransfer.getData(CLIP_TYPE);
    const id = e.dataTransfer.getData(SHOT_TYPE);
    if (!clip && !id) return;
    e.preventDefault();
    e.stopPropagation();
    if (clip) edit(insertClip(cut, clip, video.lengthOf(clip), at));
    else { const from = cut.shots.findIndex((s) => s.id === id); edit(moveShot(cut, id, from >= 0 && from < at ? at - 1 : at)); }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /^(video|audio)\//.test(f.type));
    if (files.length) void video.addFiles(files);
  };

  if (!video.available) return <section className="video-page empty" aria-label="Video"><EmptyState app="video" title="Video is not available here" /></section>;
  if (!video.project) return <section className="video-page empty" aria-label="Video"><EmptyState app="video" label="No project open" title={video.projects.length ? 'No project open' : 'No projects yet'} line="A project is a folder of clips and its cut. The clips are never changed." action={{ label: 'New project', run: () => void video.createProject('Project') }} /></section>;
  const sel = cut.shots.find((s) => s.id === selected) ?? null;
  const selIndex = sel ? cut.shots.indexOf(sel) : -1;
  const names = [...changed].map((id) => { const i = cut.shots.findIndex((s) => s.id === id); return i >= 0 ? `shot ${i + 1}` : id; });
  const ruler = rulerMarks(Math.max(total, width / pxPerSec), pxPerSec);
  const canSplit = splitAt(cut, t) !== null;
  return (
    <section ref={page} className="video-page" aria-label="Video" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="video-top">
        <div className="video-viewer">
          <div className="video-screen">
            <video ref={player} className="video-player" aria-label="Viewer" playsInline onTimeUpdate={onTime} onEnded={onTime} onError={() => setUnplayable(true)} onLoadedMetadata={() => setUnplayable(false)} onClick={toggle} />
            {shot?.title && <div className="video-title">{shot.title}</div>}
            {cut.shots.length === 0 && <p className="video-empty">Drag clips from Footage into the timeline to start the cut, or ask Mobius for a rough cut.</p>}
            {unplayable && <p className="video-empty" role="status">This clip cannot be played in this window. Its file is untouched, and the cut still works.</p>}
          </div>
          <div className="video-hud glass" role="toolbar" aria-label="Transport">
            <button type="button" className="strip-btn" aria-label="Previous edit" title="Previous edit (↑)" disabled={!shot} onClick={() => { const to = nextEdit(cut, t, -1); seek(to ?? 0); }}><Icon d="M4.5 5h2v10h-2zM16 5l-8.5 5 8.5 5z" fill /></button>
            <button type="button" className="video-play" aria-label={playing ? 'Pause' : 'Play'} title={`${playing ? 'Pause' : 'Play'} (Space)`} disabled={!shot} onClick={toggle}><Icon d={playing ? PAUSE : PLAY} fill /></button>
            <button type="button" className="strip-btn" aria-label="Next edit" title="Next edit (↓)" disabled={!shot} onClick={() => { const to = nextEdit(cut, t, 1); if (to !== null) seek(to); }}><Icon d="M13.5 5h2v10h-2zM4 5l8.5 5L4 15z" fill /></button>
            <span className="video-time" aria-label="Time">{`${timecode(t)} / ${timecode(total)}`}</span>
          </div>
        </div>
        <aside className="video-inspector" aria-label="Shot">
          {sel ? (
            <>
              <header className="video-inspector-head">
                <h2>{`Shot ${selIndex + 1}`}</h2>
                <span title={sel.clip}>{sel.clip}</span>
              </header>
              <section className="video-group" aria-label="Trim">
                <h3>Trim</h3>
                <div className="video-fields">
                  <label className="video-field"><span>In</span><input aria-label="In" type="number" step={0.1} min={0} value={sel.in} onChange={(e) => setShot(sel.id, 'in', (s) => { s.in = Math.max(0, Number(e.target.value) || 0); })} /></label>
                  <label className="video-field"><span>Out</span><input aria-label="Out" type="number" step={0.1} min={0} value={sel.out} onChange={(e) => setShot(sel.id, 'out', (s) => { s.out = Math.min(video.lengthOf(s.clip) || Infinity, Number(e.target.value) || 0); })} /></label>
                </div>
                <div className="video-pair">
                  <button type="button" className="btn" disabled={playheadIn(sel.id) === null} title="Start the shot at the playhead (I)" onClick={() => { const at = playheadIn(sel.id); if (at !== null) setShot(sel.id, 'in', (s) => { s.in = at; }); }}>Start here</button>
                  <button type="button" className="btn" disabled={playheadIn(sel.id) === null} title="End the shot at the playhead (O)" onClick={() => { const at = playheadIn(sel.id); if (at !== null) setShot(sel.id, 'out', (s) => { s.out = at; }); }}>End here</button>
                </div>
                <p className="video-note">{`${timecode(shotLength(sel))} of ${video.lengthOf(sel.clip) ? timecode(video.lengthOf(sel.clip)!) : 'the clip'}`}</p>
              </section>
              <section className="video-group" aria-label="Title">
                <h3>Title</h3>
                <input className="video-text" aria-label="Title" value={sel.title} maxLength={200} placeholder="None" onChange={(e) => setShot(sel.id, 'title', (s) => { s.title = e.target.value; })} />
              </section>
              <section className="video-group" aria-label="Order">
                <h3>Order</h3>
                <div className="video-pair">
                  <button type="button" className="btn" disabled={selIndex <= 0} onClick={() => edit(moveShot(cut, sel.id, selIndex - 1))}>Earlier</button>
                  <button type="button" className="btn" disabled={selIndex >= cut.shots.length - 1} onClick={() => edit(moveShot(cut, sel.id, selIndex + 1))}>Later</button>
                </div>
              </section>
              <button type="button" className="video-remove" onClick={() => remove(sel.id)}>Remove shot</button>
            </>
          ) : (
            <div className="video-inspector-empty">
              <p>Choose a shot to trim it, title it or move it. The clips themselves are never changed.</p>
              <dl className="video-keys">
                <dt>Space</dt><dd>Play or pause</dd>
                <dt>S</dt><dd>Split at the playhead</dd>
                <dt>↑ ↓</dt><dd>Previous or next edit</dd>
                <dt>← →</dt><dd>A frame back or on</dd>
                <dt>I, O</dt><dd>Start or end the shot here</dd>
              </dl>
            </div>
          )}
        </aside>
      </div>
      {video.message && <p className="tasks-message" role="alert">{video.message}</p>}
      {changed.size > 0 && (
        <div className="studio-review" role="group" aria-label="Mobius's change">
          <span className="review-dot" aria-hidden="true" />
          <span>{`Mobius ${before === null ? 'made the cut' : `changed ${names.join(', ')}`}; dashed below. The clips are untouched.`}{review && <WhyThis conversation={review.conversation} />}</span>
          <ReviewActions onKeep={keep} onDiscard={discard} />
        </div>
      )}
      <div className="video-tools" role="toolbar" aria-label="Edit">
        <div className="cap-group">
          <button type="button" className="strip-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={history.current.past.length === 0} onClick={undo}><Icon d="M7.5 6 4 9.5 7.5 13M4.5 9.5H12a4 4 0 0 1 0 8h-2" /></button>
          <button type="button" className="strip-btn" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={history.current.future.length === 0} onClick={redo}><Icon d="M12.5 6 16 9.5 12.5 13M15.5 9.5H8a4 4 0 0 0 0 8h2" /></button>
        </div>
        <div className="cap-group">
          <button type="button" className="strip-btn" aria-label="Split at the playhead" title="Split at the playhead (S)" disabled={!canSplit} onClick={split}><Icon d="M10 3v14M6 6l-3 4 3 4M14 6l3 4-3 4" /></button>
          <button type="button" className="strip-btn" aria-label="Remove shot" title="Remove the chosen shot (Delete)" disabled={!sel} onClick={() => sel && remove(sel.id)}><Icon d="M5 6h10M8 6V4.5h4V6M6.5 6l.7 9.5h5.6l.7-9.5" /></button>
        </div>
        <span className="video-meta">{`${cut.shots.length} ${cut.shots.length === 1 ? 'shot' : 'shots'}${video.saved ? '' : ' · Saving…'}`}</span>
        <label className="video-zoom" title="Zoom the timeline">
          <Icon d="M4 10h12" />
          <input type="range" aria-label="Zoom" min={10} max={240} step={1} value={Math.round(pxPerSec)} onChange={(e) => setZoom(Number(e.target.value))} />
          <Icon d="M4 10h12M10 4v12" />
        </label>
        <button type="button" className="btn" disabled={zoom === null} onClick={() => setZoom(null)} title="Fit the cut to the timeline">Fit</button>
      </div>
      <div ref={strip} className="video-timeline" onDragOver={dragOver} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null); }} onDrop={dropOnTimeline}
        onPointerMove={(e) => { scrubMove(e); trimMove(e); }} onPointerUp={() => { scrubUp(); trimUp(); }} onPointerCancel={() => { scrubUp(); trimUp(); }}>
        <div className="video-track-wrap" style={{ width: Math.max(total * pxPerSec, width - 32) + 1 }}>
          <div className="video-ruler" aria-hidden="true" onPointerDown={scrubDown}>
            {ruler.marks.map((m) => <span key={m} className="video-mark" style={{ left: m * pxPerSec }}>{rulerLabel(m)}</span>)}
          </div>
          <div className="video-track" role="listbox" aria-label="Timeline" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
            {cut.shots.map((s, i) => (
              <ShotBlock key={s.id} shot={s} index={i} width={Math.max(12, shotLength(s) * pxPerSec)} selected={selected === s.id} playing={index === i} proposed={changed.has(s.id)} frame={frame}
                onSelect={() => { setSelected(s.id); seek(shotStart(cut, i)); }}
                onTrim={trimDown(s.id)}
                onDragStart={(e) => { e.dataTransfer.setData(SHOT_TYPE, s.id); e.dataTransfer.effectAllowed = 'move'; }} />
            ))}
            {dropAt !== null && <span className="video-drop" style={{ left: shotStart(cut, dropAt) * pxPerSec }} aria-hidden="true" />}
          </div>
          <span className="video-playhead" style={{ left: t * pxPerSec }} aria-hidden="true" onPointerDown={scrubDown} />
        </div>
      </div>
    </section>
  );
}
