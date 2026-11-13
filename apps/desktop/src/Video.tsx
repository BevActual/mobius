import { FromMobius } from './FromMobius';
import { EmptyState } from './EmptyState';
import { SideNew } from './SideNew';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { changedShots, cutLength, locate, parseCut, shotLength, shotStart, timecode, type Cut, type Shot } from './cut-format';
import { useFileReview } from './useFileReview';
import type { VideoState } from './useVideo';
import { ReviewActions, WhyThis } from './ReviewBar';
import { onCommand } from './commands';
import { emptyHistory, recorded, redone, undone, type History } from './photo-view';
import { dropIndex, duplicateShot, filmstrip, insertClip, moveShot, nextEdit, parseTimecode, removeShot, rulerLabel, rulerMarks, splitAt, trimShot } from './video-view';
import { exportFormat, exportName, renderCut, toBase64 } from './video-export';
import { isNotesFailure } from '@mobius/shared';
import { AppSidebar, PanelTab, SidebarRow, SidebarSection, ToolbarControls, useShowPanelTab } from './ui';
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
const MOD = () => (window.mobius?.platform === 'darwin' ? '⌘' : 'Ctrl+');
const FULL = 'M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4';
const EXIT_FULL = 'M8 4v4H4M12 4v4h4M8 16v-4H4M12 16v-4h4';
/** Sound clips take a colour from the shared content palette, so they read as the person's material, not the frame. */
const CLIP_COLOURS = ['var(--c-teal)', 'var(--c-blue)', 'var(--c-amber)', 'var(--c-green)', 'var(--c-pink)', 'var(--c-coral)'];

/** A menu where it was asked for, over everything (a glass sidebar would otherwise clip it). */
type MenuAt = { x: number; y: number; label: string; items: ContextMenuItem[] };
function Menu({ menu, onClose }: { menu: MenuAt | null; onClose: () => void }) {
  return menu ? createPortal(<ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onClose={onClose} />, document.body) : null;
}

/** A time in a shot, typed as timecode (1:05.3) or seconds: kept as typed until Enter or leaving the field, Escape puts it back. */
function TimeField({ label, value, title, onCommit }: { label: string; value: number; title: string; onCommit: (secs: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? timecode(value);
  const bad = draft !== null && parseTimecode(draft) === null;
  const commit = () => { if (draft === null) return; const got = parseTimecode(draft); setDraft(null); if (got !== null && got !== value) onCommit(got); };
  return (
    <label className="video-field" title={title}>
      <span>{label}</span>
      <input aria-label={label} inputMode="decimal" spellCheck={false} value={shown} aria-invalid={bad || undefined}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); } }} />
    </label>
  );
}

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
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const clipMenu = (clip: string) => (e: ReactMouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, label: clip, items: [
      { label: 'Add to the end of the cut', run: () => addShot(clip) },
      { action: 'reveal', label: 'Show in folder', run: () => void video.showFolder(), separated: true },
    ] });
  };
  const files = useRef<HTMLInputElement>(null);
  const addFootage = () => files.current?.click();
  return (
    <AppSidebar label="Video sidebar" className="video-side">
      <SideNew item="project" onNew={() => setNaming(true)} />
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Project name" placeholder="Project name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      <SidebarSection title="Projects" action={pin}>
        {video.projects.length === 0 && !naming && <li className="side-empty">No projects yet.</li>}
        {video.projects.map((p) => (
          <SidebarRow key={p.name} label={p.name} count={p.clips.length} current={video.project === p.name}
            proposed={changed?.has(p.name) === true} title={changed?.has(p.name) ? 'Cut changed by Mobius in its last turn' : undefined}
            onSelect={() => void video.open(p.name)} />
        ))}
      </SidebarSection>
      {video.project && (
        <SidebarSection title="Footage" action={<button type="button" className="strip-btn" aria-label="Add footage" title="Add footage" onClick={addFootage}><Icon d={PLUS} /></button>}>
          {video.clips.length === 0 && (
            <li className="side-empty">
              <span>No footage yet.</span>
              <button type="button" className="btn" onClick={addFootage}>Add footage…</button>
            </li>
          )}
          {video.clips.map((c, i) => {
            const len = video.lengthOf(c.name);
            const poster = c.kind === 'video' && len ? frame(c.name, Math.round(Math.min(len / 2, 1) * 4) / 4) : undefined;
            return (
              <li key={c.name} className="video-clip" draggable title={`${c.name}\nDrag into the timeline, or add it to the end`}
                onContextMenu={clipMenu(c.name)}
                onDragStart={(e) => { e.dataTransfer.setData(CLIP_TYPE, c.name); e.dataTransfer.effectAllowed = 'copy'; }}>
                <span className="video-clip-thumb" data-kind={c.kind} data-loading={c.kind === 'video' && !poster ? true : undefined} style={{ '--clip': CLIP_COLOURS[i % CLIP_COLOURS.length] } as CSSProperties} aria-hidden="true">{poster ? <img src={poster} alt="" draggable={false} /> : null}</span>
                <span className="video-clip-text">
                  <span className="video-clip-name">{c.name}</span>
                  <span className="video-clip-len">{len ? timecode(len) : c.kind === 'audio' ? 'Sound' : ''}</span>
                </span>
                <button type="button" className="strip-btn" aria-label={`Add ${c.name} to the cut`} title="Add to the end of the cut" onClick={() => addShot(c.name)}><Icon d={PLUS} /></button>
              </li>
            );
          })}
        </SidebarSection>
      )}
      <input ref={files} type="file" hidden multiple accept="video/*,audio/*" onChange={(e) => { const got = [...(e.target.files ?? [])]; e.target.value = ''; if (got.length) void video.addFiles(got); }} />
      <FromMobius items={video.projects.filter((p) => changed?.has(p.name)).map((p) => ({ key: p.name, name: p.name, current: video.project === p.name, onOpen: () => void video.open(p.name) }))} />
      <Menu menu={menu} onClose={() => setMenu(null)} />
    </AppSidebar>
  );
}

/** One shot in the timeline: its filmstrip, its title above it, and handles at its ends to trim it. */
function ShotBlock({ shot, index, width, selected, playing, proposed, frame, onSelect, onTrim, onDragStart, onMenu }: {
  shot: Shot; index: number; width: number; selected: boolean; playing: boolean; proposed: boolean;
  frame: (clip: string, t: number) => string | undefined;
  onSelect: () => void; onTrim: (edge: 'in' | 'out') => (e: ReactPointerEvent) => void; onDragStart: (e: DragEvent) => void;
  onMenu: (e: ReactMouseEvent) => void;
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
      onContextMenu={onMenu}
    >
      <span className="video-shot-film" aria-hidden="true">
        {times.map((t, i) => { const src = frame(shot.clip, t); return <span key={i} className="video-shot-frame">{src ? <img src={src} alt="" draggable={false} /> : null}</span>; })}
      </span>
      {shot.title && <span className="video-shot-title" aria-hidden="true">{shot.title}</span>}
      <span className="video-shot-label" aria-hidden="true"><span className="video-shot-num">{index + 1}</span>{width > 70 ? shot.clip.replace(/\.[^.]+$/, '') : ''}</span>
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
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [full, setFull] = useState(false);
  const [aspect, setAspect] = useState(16 / 9);
  const viewer = useRef<HTMLDivElement>(null);
  // Export: how far along (0 to 1) while the film is made, then where it was saved.
  const [exporting, setExporting] = useState<number | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [exportError, setExportError] = useState('');
  const stopExport = useRef<AbortController | null>(null);
  const titleField = useRef<HTMLInputElement>(null);
  // The chosen shot's details: a tab in the right panel, before Mobius.
  const showTab = useShowPanelTab();
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
  const format = useMemo(() => (typeof MediaRecorder === 'undefined' ? null : exportFormat((m) => MediaRecorder.isTypeSupported(m))), []);
  const exportFilm = async () => {
    if (!format || !video.project || exporting !== null) return;
    if (playing) { player.current?.pause(); setPlaying(false); }
    const stop = new AbortController();
    stopExport.current = stop;
    setExported(null); setExportError(''); setExporting(0);
    const project = video.project;
    try {
      const film = await renderCut(cut, video.playable, format, (done) => setExporting(done), stop.signal);
      const saved = await video.saveExport(exportName(project, format), await toBase64(film));
      if (!saved) throw new Error('Video is not available here.');
      if (isNotesFailure(saved)) throw new Error(saved.message);
      setExported(saved.file);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      stopExport.current = null;
      setExporting(null);
    }
  };
  useEffect(() => () => stopExport.current?.abort(), []);
  useEffect(() => { stopExport.current?.abort(); setExported(null); setExportError(''); }, [video.project]);
  const duplicate = (id: string) => { const got = duplicateShot(cut, id); if (got) { edit(got.cut); setSelected(got.id); } };
  const nameIt = (id: string) => { setSelected(id); window.requestAnimationFrame(() => titleField.current?.focus()); };
  // Full screen: the viewer with its transport, as QuickTime and iMovie play.
  const fullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void viewer.current?.requestFullscreen().catch(() => undefined);
  };
  useEffect(() => {
    const look = () => setFull(document.fullscreenElement !== null && document.fullscreenElement === viewer.current);
    document.addEventListener('fullscreenchange', look);
    return () => document.removeEventListener('fullscreenchange', look);
  }, []);
  /** A shot's right-click menu: the timeline's tools for that one shot, with their keys. */
  const shotMenu = (s: Shot, i: number) => (e: ReactMouseEvent) => {
    e.preventDefault();
    setSelected(s.id);
    const start = shotStart(cut, i);
    const inside = t > start && t < start + shotLength(s);
    setMenu({ x: e.clientX, y: e.clientY, label: `Shot ${i + 1}`, items: [
      { label: 'Split at the playhead', keys: 'S', disabled: !inside || splitAt(cut, t) === null, run: split },
      { action: 'rename', label: s.title ? 'Edit title' : 'Add title', run: () => nameIt(s.id) },
      { action: 'duplicate', keys: `${MOD()}D`, run: () => duplicate(s.id) },
      { label: 'Move earlier', disabled: i === 0, run: () => edit(moveShot(cut, s.id, i - 1)), separated: true },
      { label: 'Move later', disabled: i === cut.shots.length - 1, run: () => edit(moveShot(cut, s.id, i + 1)) },
      { action: 'delete', label: 'Remove shot', keys: 'Delete', danger: true, separated: true, run: () => remove(s.id) },
    ] });
  };
  const setShot = (id: string, tag: string, fn: (s: Shot) => void) => edit({ ...cut, shots: cut.shots.map((s) => { if (s.id !== id) return s; const n = { ...s }; fn(n); n.out = Math.max(n.in + 0.1, n.out); return n; }) }, `${tag}:${id}`);
  const playheadIn = (id: string) => cut.shots[index]?.id === id && player.current ? Math.round(player.current.currentTime * 100) / 100 : null;

  // Keys, as in other editors: Space plays, arrows step a frame (a second with Shift), Up and Down go between edits.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e) => {
    if (!page.current?.isConnected || e.defaultPrevented || typing(e.target) || document.querySelector('[aria-modal="true"]') || stopExport.current) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key === 'y') { e.preventDefault(); redo(); return; }
    const sel = selected && cut.shots.find((s) => s.id === selected);
    if (mod && (e.key === 'd' || e.key === 'D') && !e.shiftKey) { if (sel) { e.preventDefault(); duplicate(sel.id); } return; }
    if (mod || e.altKey) return;
    if (e.key === ' ' || e.key === 'k') { if (e.target instanceof HTMLButtonElement && e.key === ' ') return; e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / FPS)); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const to = nextEdit(cut, t, e.key === 'ArrowDown' ? 1 : -1); if (to !== null) seek(to); }
    else if (e.key === 'Home') { e.preventDefault(); seek(0); }
    else if (e.key === 'End') { e.preventDefault(); seek(total); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); split(); }
    else if (e.key === 'f' || e.key === 'F') { if (shot) { e.preventDefault(); fullScreen(); } }
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
  const shotLabel = (i: number) => `Shot ${i + 1}`;
  const inspector = (
    <section className="video-inspector" aria-label="Shot">
      {sel ? (
        <>
          <header className="video-inspector-head">
            <h2>{shotLabel(selIndex)}</h2>
            <span title={sel.clip}>{sel.clip}</span>
          </header>
          <section className="video-group" aria-label="Trim">
            <h3>Trim</h3>
            <div className="video-fields">
              <TimeField key={`in-${sel.id}`} label="In" value={sel.in} title="Where the shot starts in its clip: 0:02.5, or seconds" onCommit={(v) => setShot(sel.id, 'in', (s) => { s.in = Math.max(0, Math.min(v, s.out - 0.1)); })} />
              <TimeField key={`out-${sel.id}`} label="Out" value={sel.out} title="Where the shot ends in its clip: 0:06.0, or seconds" onCommit={(v) => setShot(sel.id, 'out', (s) => { s.out = Math.min(video.lengthOf(s.clip) || Infinity, v); })} />
            </div>
            <div className="video-pair">
              <button type="button" className="btn" disabled={playheadIn(sel.id) === null} title="Start the shot at the playhead (I)" onClick={() => { const at = playheadIn(sel.id); if (at !== null) setShot(sel.id, 'in', (s) => { s.in = at; }); }}>Start here</button>
              <button type="button" className="btn" disabled={playheadIn(sel.id) === null} title="End the shot at the playhead (O)" onClick={() => { const at = playheadIn(sel.id); if (at !== null) setShot(sel.id, 'out', (s) => { s.out = at; }); }}>End here</button>
            </div>
            <p className="video-note">{`${timecode(shotLength(sel))} of ${video.lengthOf(sel.clip) ? timecode(video.lengthOf(sel.clip)!) : 'the clip'}`}</p>
          </section>
          <section className="video-group" aria-label="Title">
            <h3>Title</h3>
            <input ref={titleField} className="video-text" aria-label="Title" value={sel.title} maxLength={200} placeholder="None" onChange={(e) => setShot(sel.id, 'title', (s) => { s.title = e.target.value; })} />
          </section>
          <section className="video-group" aria-label="Order">
            <h3>Order</h3>
            <div className="video-pair">
              <button type="button" className="btn" disabled={selIndex <= 0} title="Move the shot earlier" onClick={() => edit(moveShot(cut, sel.id, selIndex - 1))}>Earlier</button>
              <button type="button" className="btn" disabled={selIndex >= cut.shots.length - 1} title="Move the shot later" onClick={() => edit(moveShot(cut, sel.id, selIndex + 1))}>Later</button>
            </div>
          </section>
          <button type="button" className="video-remove" onClick={() => remove(sel.id)}>Remove shot</button>
        </>
      ) : (
        <p className="video-inspector-empty">No shot chosen.</p>
      )}
    </section>
  );
  const names = [...changed].map((id) => { const i = cut.shots.findIndex((s) => s.id === id); return i >= 0 ? `shot ${i + 1}` : id; });
  const ruler = rulerMarks(Math.max(total, width / pxPerSec), pxPerSec);
  const canSplit = splitAt(cut, t) !== null;
  const status = exported
    ? null
    : sel
      ? `${sel.clip} · in ${timecode(sel.in)} · out ${timecode(sel.out)} · ${timecode(shotLength(sel))}. Drag an edge to trim, S splits at the playhead.`
      : `${cut.shots.length} ${cut.shots.length === 1 ? 'shot' : 'shots'} · ${timecode(total)}${video.saved ? '' : ' · Saving…'}`;
  return (
    <section ref={page} className="video-page" aria-label="Video" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ToolbarControls label="Edit">
        <div className="ui-toolbar-group">
          <button type="button" className="strip-btn" aria-label="Undo" title={`Undo (${MOD()}Z)`} disabled={history.current.past.length === 0} onClick={undo}><Icon d="M7.5 6 4 9.5 7.5 13M4.5 9.5H12a4 4 0 0 1 0 8h-2" /></button>
          <button type="button" className="strip-btn" aria-label="Redo" title={`Redo (${MOD()}Y)`} disabled={history.current.future.length === 0} onClick={redo}><Icon d="M12.5 6 16 9.5 12.5 13M15.5 9.5H8a4 4 0 0 0 0 8h2" /></button>
        </div>
        <div className="ui-toolbar-group">
          <button type="button" className="strip-btn" aria-label="Split at the playhead" title="Split at the playhead (S)" disabled={!canSplit} onClick={split}><Icon d="M10 3v14M6 6l-3 4 3 4M14 6l3 4-3 4" /></button>
          <button type="button" className="strip-btn" aria-label="Duplicate shot" title={`Duplicate the chosen shot (${MOD()}D)`} disabled={!sel} onClick={() => sel && duplicate(sel.id)}><Icon d="M4 4h9v9H4zM7 7h9v9H7z" /></button>
          <button type="button" className="strip-btn" aria-label="Remove shot" title="Remove the chosen shot (Delete)" disabled={!sel} onClick={() => sel && remove(sel.id)}><Icon d="M5 6h10M8 6V4.5h4V6M6.5 6l.7 9.5h5.6l.7-9.5" /></button>
        </div>
        <div className="ui-toolbar-group">
          <label className="video-zoom" title="Zoom the timeline">
            <Icon d="M4 10h12" />
            <input type="range" aria-label="Zoom" min={10} max={240} step={1} value={Math.round(pxPerSec)} onChange={(e) => setZoom(Number(e.target.value))} />
            <Icon d="M4 10h12M10 4v12" />
          </label>
          <button type="button" className="btn" disabled={zoom === null} onClick={() => setZoom(null)} title="Fit the cut to the timeline">Fit</button>
        </div>
        <div className="ui-toolbar-group">
          {exporting === null ? (
            <button type="button" className="btn primary video-export" disabled={!format || cut.shots.length === 0} onClick={() => void exportFilm()}
              title={format ? 'Export the film to the project’s Exports folder' : 'This window cannot record video'}>
              Export…
            </button>
          ) : (
            <span className="video-exporting" role="status" aria-label="Exporting">
              <span className="video-progress" aria-hidden="true"><span style={{ width: `${Math.round(exporting * 100)}%` }} /></span>
              <span>{`${Math.round(exporting * 100)}%`}</span>
              <button type="button" className="btn" onClick={() => stopExport.current?.abort()}>Stop</button>
            </span>
          )}
        </div>
      </ToolbarControls>
      <div ref={viewer} className="video-viewer" data-full={full || undefined}>
        <div className="video-screen">
          {/* The picture's own box, its clip's shape, as large as fits: the title sits on the picture, not the page. */}
          <div className="video-frame" style={{ '--ar': aspect } as CSSProperties}>
            <video ref={player} className="video-player" aria-label="Viewer" playsInline onTimeUpdate={onTime} onEnded={onTime} onError={() => setUnplayable(true)}
              onLoadedMetadata={(e) => { setUnplayable(false); const v = e.currentTarget; if (v.videoWidth > 0 && v.videoHeight > 0) setAspect(v.videoWidth / v.videoHeight); }} onClick={toggle} />
            {shot?.title && <div className="video-title">{shot.title}</div>}
          </div>
          {cut.shots.length === 0 && <p className="video-empty">No shots yet. Drag a clip from Footage into the timeline.</p>}
          {unplayable && <p className="video-empty" role="status">This clip cannot be played in this window. Its file is untouched, and the cut still works.</p>}
        </div>
        <div className="video-transport" role="toolbar" aria-label="Transport">
          <span className="video-time" aria-label="Time">{timecode(t)}</span>
          <span className="video-buttons">
            <button type="button" className="strip-btn" aria-label="Previous edit" title="Previous edit (↑)" disabled={!shot} onClick={() => { const to = nextEdit(cut, t, -1); seek(to ?? 0); }}><Icon d="M5 5v10M15.5 5.5 8 10l7.5 4.5z" /></button>
            <button type="button" className="video-play" aria-label={playing ? 'Pause' : 'Play'} title={`${playing ? 'Pause' : 'Play'} (Space)`} disabled={!shot} onClick={toggle}><Icon d={playing ? PAUSE : PLAY} fill /></button>
            <button type="button" className="strip-btn" aria-label="Next edit" title="Next edit (↓)" disabled={!shot} onClick={() => { const to = nextEdit(cut, t, 1); if (to !== null) seek(to); }}><Icon d="M15 5v10M4.5 5.5 12 10l-7.5 4.5z" /></button>
            <button type="button" className="strip-btn" aria-label={full ? 'Exit full screen' : 'Full screen'} title={`${full ? 'Exit full screen' : 'Full screen'} (F)`} disabled={!shot} onClick={fullScreen}><Icon d={full ? EXIT_FULL : FULL} /></button>
          </span>
          <span className="video-time video-length" aria-label="Length">{timecode(total)}</span>
        </div>
      </div>
      {video.message && <p className="tasks-message" role="alert">{video.message}</p>}
      {changed.size > 0 && (
        <div className="studio-review" role="group" aria-label="Mobius's change">
          <span className="review-dot" aria-hidden="true" />
          <span>{`Mobius ${before === null ? 'made the cut' : `changed ${names.join(', ')}`}; dashed below. The clips are untouched.`}{review && <WhyThis conversation={review.conversation} />}</span>
          <ReviewActions onKeep={keep} onDiscard={discard} />
        </div>
      )}
      {exportError && <p className="tasks-message" role="alert">{`The film could not be exported: ${exportError}`}</p>}
      <div ref={strip} className="video-timeline" onDragOver={dragOver} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null); }} onDrop={dropOnTimeline}
        onPointerMove={(e) => { scrubMove(e); trimMove(e); }} onPointerUp={() => { scrubUp(); trimUp(); }} onPointerCancel={() => { scrubUp(); trimUp(); }}>
        <div className="video-track-wrap" style={{ width: Math.max(total * pxPerSec, width - 32) + 1 }}>
          <div className="video-ruler" aria-hidden="true" onPointerDown={scrubDown}>
            {ruler.marks.map((m) => <span key={m} className="video-mark" style={{ left: m * pxPerSec }}>{rulerLabel(m)}</span>)}
          </div>
          <div className="video-track" role="listbox" aria-label="Timeline" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
            {cut.shots.map((s, i) => (
              <ShotBlock key={s.id} shot={s} index={i} width={Math.max(12, shotLength(s) * pxPerSec)} selected={selected === s.id} playing={index === i} proposed={changed.has(s.id)} frame={frame}
                onSelect={() => { setSelected(s.id); seek(shotStart(cut, i)); showTab('shot'); }}
                onTrim={trimDown(s.id)}
                onDragStart={(e) => { e.dataTransfer.setData(SHOT_TYPE, s.id); e.dataTransfer.effectAllowed = 'move'; }}
                onMenu={shotMenu(s, i)} />
            ))}
            {dropAt !== null && <span className="video-drop" style={{ left: shotStart(cut, dropAt) * pxPerSec }} aria-hidden="true" />}
          </div>
          <span className="video-playhead" style={{ left: t * pxPerSec }} aria-hidden="true" onPointerDown={scrubDown} />
        </div>
      </div>
      <footer className="video-status">
        {exported ? (
          <span className="video-done" role="status">
            <span>{`Saved the film as ${exported}.`}</span>
            <button type="button" className="video-link" onClick={() => void video.showExports()}>Show in folder</button>
            <button type="button" className="video-link" onClick={() => setExported(null)}>Done</button>
          </span>
        ) : <span>{status}</span>}
      </footer>
      <Menu menu={menu} onClose={() => setMenu(null)} />
      <PanelTab id="shot" name="Shot">{inspector}</PanelTab>
    </section>
  );
}
