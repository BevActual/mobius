import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { newItemIn, type SidebarWords } from './NotesSidebar';
import { EmptyState } from './EmptyState';
import { controlRange, controlValue } from './device-format';
import { builtinDevice, BEATS_PER_BAR, CLIP_BARS, MAX_SCENES, METRONOME_VOLUME, sceneCount, sceneName, type Clip, COLOUR_NAMES, DRUMS, INSTRUMENTS, INSTRUMENT_NAMES, KEYS, KIT_DEFAULTS, EFFECT_KINDS, EFFECT_NAMES, EFFECT_PARAMS, freshEffectId, newEffect, type Effect, type EffectKind, KIT_RANGE, kitOf, PAD_DEFAULTS, PAD_RANGE, padOf, type DrumPad, type PadSetting, type SamplerSound, TRACK_COLOURS, nextColour, SOUND_DEFAULTS, SOUND_RANGE, changedTracks, freshTrackId, keyPitches, noteName, parseSong, putNotes, playedNotes, firstPass, soundOf, trackNotes, writeSong, type ArrangeClip, type Instrument, type Song, type SongNote, type KitSound, type Sound, type Track, type TrackColour } from './song-format';
import type { CSSProperties } from 'react';
import { ClipWave } from './studio-wave';
import { SampleSlot, sampleName } from './StudioSample';
import { pressKey, armKeys, countIn, engineOn, engineReady, loadSong, onTake, play, recordInput, takeClip, type ArmHeard, playSession, previewOn, watchDevice, type Player, type SessionPlayer, type SessionPlaying, type SessionQueued } from './studio-engine';
import { SessionGrid } from './StudioSession';
import { StudioLibrary } from './StudioLibrary';
import { StudioMixer } from './StudioMixer';
import type { LibraryItem } from './studio-library';
import { arpeggiate, chop, connect, fitKey, humanize, reverse, strum } from './note-transform';
import { StudioWorkbench } from './StudioBench';
import { recordOver, duplicateClip as duplicateArrange, followScroll, moveClip, resizeClip, toggleClipLoop, setClipLoop, scaleClipLoop, GRIDS, deviceSettingText, notesDiffer, soundChanges, recordedNote, joinNotes, splitNotes, keyboardDrum, keyboardPitch, nudgeKeyVelocity, spellIn, scaleRows, stepOctave, addNote, clipsOf, setStep, stepCells, effectText, eqBands, eqFromBand, type EqEffect, cycleOf, duplicateNotes, nudgeVelocity, isBlack, moveNotes, notesIn, pasteNotes, position, quantizeNotes, removeNotes, setVelocity, snap, soundText, kitText, panText, stretchNotes, type Cycle, type Picked } from './studio-view';
import { AppSidebar, Button, Confirm, PadGrid, StepGrid, DeviceChain, DeviceFrame, Knob, EqGraph, EnvelopeGraph, FilterGraph, IconButton, Menu, NumberField, Segmented, Swatches, Switch, PanelLayout, PanelTab, ParamCell, Readout, ParamGrid, Select, SidebarRow, SidebarSearch, SidebarSection, Slider, TapTempo, TOOL_ICONS, ToolbarControls, ToolbarItem, Transport, UndoToast, useKeyboardClaim, AutomationLane, ViewSwitch, type MenuEntry, type PanelSpec } from './ui';
import { SideNew } from './SideNew';
import { statusText } from './notes-state';
import { dayLabel, timeLabel, weekdayLabel } from './dates';
import { useFileReview } from './useFileReview';
import { useTurnFileChanged } from './liveMarks';
import type { NotesState } from './useNotes';
import { ChangeBar, WhyThis } from './ReviewBar';
import { onCommand } from './commands';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import './studio.css';
import { afterPaint } from './ui/frame';

export const STUDIO_WORDS: SidebarWords = { app: 'Music', group: 'folder', groups: 'Folders', item: 'song', items: 'songs', about: 'Songs are kept as JSON files in your workspace: tracks of notes, never audio, so the agent can read and write them like a score.', defaultGroup: 'Songs' };

/** The sidebar's Sounds put a track on the open song; the editor listens while it is on screen. */
const ADD_TRACK = 'mobius:studio-add-track';
/** An audio clip's file, by its own name: "Samples/Recorded/take 1.wav" is "take 1". */
const fileName = (file: string) => file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || file;
/** Adds a track of a sound to the open song, an audio track (Live 12, chapter 9: it plays recordings and samples), or a
 *  Sampler track (36.8: its notes play a sample). */
const askToAddTrack = (instrument: Instrument | 'audio' | 'sampler') => window.dispatchEvent(new CustomEvent<Instrument | 'audio' | 'sampler'>(ADD_TRACK, { detail: instrument }));
/** The engine's stems export, once it has one (music.renderStems). */
type RenderStems = (path: string, name: string, song?: unknown) => Promise<{ ok: true; saved: string; path: string; files: { file: string; peakDb: number; over: boolean }[] } | { ok: false; message: string }>;
/** The order the sidebar lists sounds in: drums first, as most songs start with a beat. */
const SOUNDS: Instrument[] = ['drums', 'bass', 'piano', 'pad', 'lead'];

/** When a song was last changed, short: the time today, the weekday this week, else the date ("3 Nov"). */
function whenShort(at: number, now: number): string {
  const days = (new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000;
  if (days <= 0) return timeLabel(at);
  if (days < 7) return weekdayLabel(at);
  return dayLabel(at);
}

/** Music's sidebar: New, Search, the songs, the sounds to add as tracks, and what Mobius made for review. */
export function StudioSidebar({ songs, pin, changed }: { songs: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; starts?: readonly import('./SideNew').Start[]; onStart?: (prompt: string) => void }) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; title: string } | null>(null);
  const [confirming, setConfirming] = useState<{ path: string; title: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [songs.notebooks]);
  const all = useMemo(() => songs.notebooks.flatMap((nb) => nb.pages).sort((a, b) => b.modified - a.modified), [songs.notebooks]);
  const shown = query.trim() ? all.filter((pg) => pg.title.toLowerCase().includes(query.trim().toLowerCase())) : all;
  const folder = songs.page?.path.split('/')[0] ?? songs.notebooks[0]?.name;
  const made = all.filter((pg) => changed?.has(pg.path));
  return (
    <AppSidebar label="Songs" className="studio-side">
      <SideNew item="song" onNew={() => newItemIn(songs, folder, STUDIO_WORDS.defaultGroup)} />
      <SidebarSearch label="Search music" value={query} onChange={setQuery} />
      <SidebarSection title="Songs" action={pin}>
        {shown.length === 0 && <li className="side-empty">{query.trim() ? 'No songs match.' : 'No songs yet.'}</li>}
        {shown.map((pg) => (
          <SidebarRow key={pg.path} label={pg.title} current={songs.page?.path === pg.path} proposed={changed?.has(pg.path) === true}
            onSelect={() => void songs.open(pg.path, pg.title)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, path: pg.path, title: pg.title }); }}
            trail={<span className="studio-side-when">{whenShort(pg.modified, Math.max(now, pg.modified))}</span>} />
        ))}
      </SidebarSection>
      <SidebarSection title="Sounds">
        {SOUNDS.map((i) => (
          <SidebarRow key={i} label={INSTRUMENT_NAMES[i]} title={songs.page ? `Add a ${INSTRUMENT_NAMES[i]} track to this song` : 'Open a song to add a track'} onSelect={() => askToAddTrack(i)} />
        ))}
      </SidebarSection>
      <SidebarSection title="From Mobius">
        {made.length === 0 && <li className="side-empty">Nothing to review.</li>}
        {made.map((pg) => (
          <SidebarRow key={pg.path} label={pg.title} current={false} onSelect={() => void songs.open(pg.path, pg.title)} trail={<span className="studio-to-review">To review</span>} />
        ))}
      </SidebarSection>
      <Confirm open={confirming !== null} title={`Delete “${confirming?.title ?? ''}”?`} description="The song and its notes go from your workspace." action="Delete song"
        onConfirm={() => { const c = confirming; setConfirming(null); if (c) void songs.remove(c.path); }} onCancel={() => setConfirming(null)} />
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} label={menu.title} items={[{ action: 'delete', label: 'Delete Song', danger: true, run: () => setConfirming({ path: menu.path, title: menu.title }) }]} onClose={() => setMenu(null)} />, document.body)}
    </AppSidebar>
  );
}

/** The toolbar's grey line for a song: its key (which can be changed there) and whether it is saved. */
export function StudioSub({ songs }: { songs: NotesState }) {
  const parsed = useMemo(() => (songs.page ? parseSong(songs.text) : null), [songs.page, songs.text]);
  if (!parsed || !('song' in parsed)) return null;
  const song = parsed.song;
  return (
    <>
      {song.key}{' · '}<span className="note-status" role="status" data-status={songs.status}>{songs.message || statusText(songs.status)}</span>
    </>
  );
}

/** The narrowest a beat is drawn in the arrangement; it otherwise fits the song to the window. */
const BEAT_MIN = 4;
const HEAD_W = 196;
const ROLL_BEAT_W = 40;
const KEYS_W = 64;
const ROW_H = 14;
const MELODY_TOP = 84;
const MELODY_BOTTOM = 36;
const ZOOMS = [1, 1.5, 2, 3, 4, 6];
/** Drums get taller rows and room for their names, since there are only a few of them. */
const DRUM_ROW_H = 26;
const DRUM_KEYS_W = 96;
/** The velocity lane under the roll. */
const VEL_H = 64;

const Icon = ({ d, fill }: { d: string; fill?: boolean }) => <svg viewBox="0 0 20 20" aria-hidden="true" data-fill={fill || undefined}><path d={d} /></svg>;
/** How a clip opens is said on it until the person has opened clips a few times; after that the tip only gets in the way. */
const CLIP_TIP_KEY = 'mobius.studio.clipEdits';
const CLIP_TIP_UNTIL = 3;
const clipTipWanted = (): boolean => { try { return Number(window.localStorage.getItem(CLIP_TIP_KEY) ?? 0) < CLIP_TIP_UNTIL; } catch { return true; } };
const clipEdited = () => { try { window.localStorage.setItem(CLIP_TIP_KEY, String(Number(window.localStorage.getItem(CLIP_TIP_KEY) ?? 0) + 1)); } catch { /* not kept */ } };

const ICONS = {
  play: 'M6.5 4.2v11.6L15.8 10z',
  stop: 'M5.5 5.5h9v9h-9z',
  loop: 'M4 9V8a3 3 0 0 1 3-3h8l-2.2-2.2M16 11v1a3 3 0 0 1-3 3H5l2.2 2.2',
  keys: 'M3.5 5.5h13v9h-13zM7.5 5.5v5M10 10.5v4M12.5 5.5v5',
  mixer: 'M5 4v12M10 4v12M15 4v12M3.5 12h3M8.5 7h3M13.5 10h3',
  transform: 'M4 16 12 8M12 3.5v2.5M15.5 5 14 6.5M16.5 9H14',
  draw: 'M12.5 4.5l3 3-8 8H4.5v-3zM10.5 6.5l3 3',
  auto: 'M3.5 14.5l4-6 4 3 5-7',
  export: 'M10 3.5v9M6.5 9l3.5 3.5L13.5 9M4 14.5v2h12v-2',
};

/** The notes editor's Transform menu, Quantize first: each row changes the picked notes, or all of them when none are picked. */
function transformEntries(drums: boolean, apply: (fn: (n: SongNote[], picked: ReadonlySet<number>) => { notes: SongNote[]; picked: Set<number> }) => void, grid: number, span: number, key: string): MenuEntry[] {
  return [
    { label: 'Quantize', detail: 'Notes lined up to the grid', keys: 'Q', run: () => apply((n, p) => quantizeNotes(n, p, grid, span)) },
    ...(drums ? [] : [
      { label: 'Arpeggiate up', detail: 'Each chord a note at a time, low to high', separated: true, run: () => apply((n, p) => arpeggiate(n, p, grid, 'up')) },
      { label: 'Arpeggiate down', detail: 'High to low', run: () => apply((n, p) => arpeggiate(n, p, grid, 'down')) },
      { label: 'Arpeggiate up and down', detail: 'Low to high and back', run: () => apply((n, p) => arpeggiate(n, p, grid, 'updown')) },
      { label: 'Strum', detail: 'Each chord spread from the lowest note', separated: true, run: () => apply((n, p) => strum(n, p, Math.min(0.0625, grid / 4))) },
      { label: 'Fit to key', detail: `Notes outside ${key} moved to the nearest in it`, run: () => apply((n, p) => fitKey(n, p, key)) },
    ]),
    { label: 'Chop', detail: 'Long notes cut into grid steps', separated: !drums, run: () => apply((n, p) => chop(n, p, grid)) },
    { label: 'Connect', detail: 'Each note held until the next', run: () => apply((n, p) => connect(n, p)) },
    { label: 'Reverse', detail: 'Played backwards', run: () => apply((n, p) => reverse(n, p)) },
    { label: 'Humanize', detail: 'Timing and velocity loosened a little', separated: true, run: () => apply((n, p) => humanize(n, p, span, Date.now())) },
  ];
}

/** A clip in Arrange or Session: a button that Space doesn't press, since Space plays the song. */
const isClip = (t: HTMLElement) => t.closest('.studio-clip, .studio-clip-body') !== null;

/** What a clip in Arrange can be asked to do: moved or stretched by dragging, and the rest from its menu or keys. */
interface ClipActions { onMove: (id: string, start: number) => void; onResize: (id: string, length: number) => void; onMenu: (id: string, x: number, y: number) => void; onKey: (id: string, key: 'delete' | 'duplicate' | 'mute' | 'double' | 'halve') => void }

/**
 * A track's clips: solid blocks in the track's colour with the notes drawn small inside, dashed and unfilled while
 * Mobius proposes them, faded when muted. Drag one to move it and its right edge to stretch it, a bar at a time (a
 * beat with Alt held); it never passes the clips beside it.
 */
function Clips({ track, proposed, bw, onOpen, actions, songPath, tempo }: { track: Track; proposed: boolean; bw: number; songPath: string; tempo: number; onOpen: (fromBeat: number, clip: string) => void; actions: ClipActions }) {
  const pitches = track.clips.flatMap((c) => c.notes.map((n) => n.pitch));
  const lo = Math.min(...pitches, 127), hi = Math.max(...pitches, 0);
  const span = Math.max(1, hi - lo);
  // A drag under way: the clip, how, where it began, and where it is now (in beats), shown before it is let go.
  const [drag, setDrag] = useState<{ id: string; size: boolean; x: number; start: number; length: number; now: number } | null>(null);
  const grab = (e: React.PointerEvent, id: string, size: boolean) => {
    if (e.button !== 0 || proposed) return;
    const c = track.clips.find((x) => x.id === id);
    if (!c) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, size, x: e.clientX, start: c.start, length: c.length, now: size ? c.length : c.start });
  };
  const follow = (e: React.PointerEvent) => {
    if (!drag) return;
    const step = e.altKey ? 1 : BEATS_PER_BAR;
    const from = drag.size ? drag.length : drag.start;
    setDrag({ ...drag, now: Math.max(drag.size ? step : 0, from + Math.round((e.clientX - drag.x) / bw / step) * step) });
  };
  const drop = () => {
    if (!drag) return;
    const was = drag.size ? drag.length : drag.start;
    if (drag.now !== was) { if (drag.size) actions.onResize(drag.id, drag.now); else actions.onMove(drag.id, drag.now); }
    setDrag(null);
  };
  return (
    <>
      {track.clips.map((c) => {
        const start = drag?.id === c.id && !drag.size ? drag.now : c.start;
        const length = drag?.id === c.id && drag.size ? drag.now : c.length;
        const first = Math.floor(c.start / BEATS_PER_BAR) + 1, last = Math.ceil((c.start + c.length) / BEATS_PER_BAR - 1e-9);
        // What it plays, round its loop and from its start marker, drawn from its left edge; a notch where each pass begins.
        const heard = playedNotes({ ...c, start: 0, length });
        const pass = firstPass(c);
        const turns: number[] = [];
        if (c.loop) for (let at = pass.to - pass.from; at < length - 1e-9 && turns.length < 256; at += c.loop.end - c.loop.start) turns.push(at);
        const words = first >= last ? `bar ${first}` : `bars ${first} to ${last}`;
        return (
          <button
            key={c.id}
            type="button"
            className="studio-clip"
            data-proposed={proposed || undefined}
            data-muted={c.muted || undefined}
            data-looped={c.loop ? true : undefined}
            data-audio={c.audio ? true : undefined}
            data-dragging={drag?.id === c.id || undefined}
            style={{ left: start * bw + 1, width: length * bw - 3 }}
            aria-label={`${c.name ?? (c.audio ? fileName(c.audio.file) : track.name)}, ${words}${c.audio ? ', audio' : ''}${c.loop ? ', looped' : ''}${c.muted ? ', muted' : ''}${proposed ? ', proposed by Mobius' : ''}`}
            {...(clipTipWanted() ? { title: 'Double-click to edit the notes. Drag to move, or its right edge to stretch it', 'data-tip-at': 'pointer' } : {})}
            onPointerDown={(e) => grab(e, c.id, false)}
            onPointerMove={follow}
            onPointerUp={drop}
            onPointerCancel={() => setDrag(null)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); actions.onMenu(c.id, e.clientX, e.clientY); }}
            onDoubleClick={(e) => { e.stopPropagation(); if (c.audio) return; clipEdited(); onOpen(c.start, c.id); }}
            onKeyDown={(e) => {
              const mod = e.ctrlKey || e.metaKey;
              if (e.key === 'Enter') { e.preventDefault(); clipEdited(); onOpen(c.start, c.id); return; }
              if (proposed) return;
              if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) { e.preventDefault(); e.stopPropagation(); actions.onKey(c.id, 'delete'); }
              else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); actions.onKey(c.id, 'duplicate'); }
              else if (e.key === '0' && !mod) { e.preventDefault(); e.stopPropagation(); actions.onKey(c.id, 'mute'); }
              // Live's Clip View: Ctrl+Up doubles the loop, Ctrl+Down halves it.
              else if (mod && c.loop && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); actions.onKey(c.id, e.key === 'ArrowUp' ? 'double' : 'halve'); }
            }}
          >
            {/* An audio clip: its sound as a band (the file's waveform comes with the engine's peaks); a MIDI clip: its notes. */}
            {c.audio ? <ClipWave songPath={songPath} file={c.audio.file} offset={c.audio.offset ?? 0} seconds={(length * 60) / (c.audio.warp && c.audio.bpm ? c.audio.bpm : tempo)} width={length * bw - 8} /> : <span className="studio-clip-notes" aria-hidden="true">
              {heard.map((n, i) => (
                <span key={i} style={{ left: n.start * bw, width: Math.max(1, n.length * bw - 1), top: `${(1 - (n.pitch - lo) / span) * 85}%` }} />
              ))}
            </span>}
            {turns.map((at) => <span key={at} className="studio-clip-turn" aria-hidden="true" style={{ left: at * bw }} />)}
            <span className="studio-clip-name">{c.name ?? (c.audio ? fileName(c.audio.file) : track.name)}</span>
            {!proposed && <span className="studio-clip-edge" aria-hidden="true" onPointerDown={(e) => grab(e, c.id, true)} />}
          </button>
        );
      })}
    </>
  );
}

/** How finely each setting moves with the arrow keys (Shift for ten times as far). */
const SOUND_STEP: Record<keyof Sound, number> = { shape: 0.01, detune: 1, sub: 0.01, drive: 0.01, cutoff: 10, resonance: 0.01, envAmount: 0.01, attack: 0.001, decay: 0.01, sustain: 0.01, release: 0.01, vibrato: 1, rate: 0.1 };
/** Cutoff, times and rate are heard in ratios, so their sliders move evenly in octaves rather than in Hz or seconds. */
const LOG_SOUND = new Set<keyof Sound>(['cutoff', 'attack', 'decay', 'release', 'rate']);
/** The Device panel's groups of settings, in the order a sound is made: source, filter, envelope, then movement. */
const SOUND_GROUPS: readonly { name: string; cells: readonly [keyof Sound, string][] }[] = [
  { name: 'Oscillator', cells: [['shape', 'Shape'], ['detune', 'Detune'], ['sub', 'Sub'], ['drive', 'Drive']] },
  // The filter graph holds cutoff, resonance and sweep; the envelope is drawn as one shape.
  { name: 'Filter', cells: [] },
  { name: 'Envelope', cells: [] },
  { name: 'Motion', cells: [['vibrato', 'Vibrato'], ['rate', 'Rate']] },
];
const KIT_CELLS: readonly { k: keyof KitSound; name: string; step: number; log?: boolean }[] = [
  { k: 'tune', name: 'Tune', step: 1 }, { k: 'decay', name: 'Decay', step: 0.01, log: true }, { k: 'tone', name: 'Tone', step: 0.01 },
];

/** One of the Device panel's settings, as a shared knob. Double-click puts it back to the instrument's own. */
function DeviceSlider({ name, k, value, base, proposed, onChange }: { name: string; k: keyof Sound; value: number; base: number; proposed?: boolean; onChange: (v: number) => void }) {
  const { lo, hi } = SOUND_RANGE[k];
  return <Knob label={name} value={value} min={lo} max={hi} step={SOUND_STEP[k]} scale={LOG_SOUND.has(k) ? 'log' : 'linear'} reset={base} format={(v) => soundText(k, v)} proposed={proposed} onChange={onChange} />;
}

/** How an effect's setting reads: "+3.0 dB", "1.2 kHz", "4:1", "12 ms", "35%", "2.0 s". */
const EFFECT_CELLS: { [K in EffectKind]: readonly { k: string; name: string; step: number; log?: boolean; origin?: number }[] } = {
  eq: [],
  compressor: [{ k: 'threshold', name: 'Threshold', step: 1, origin: 0 }, { k: 'ratio', name: 'Ratio', step: 0.1, log: true }, { k: 'attack', name: 'Attack', step: 0.001, log: true }, { k: 'release', name: 'Release', step: 0.01, log: true }, { k: 'makeup', name: 'Makeup', step: 0.5 }],
  delay: [{ k: 'feedback', name: 'Feedback', step: 0.01 }, { k: 'mix', name: 'Mix', step: 0.01 }],
  reverb: [{ k: 'size', name: 'Size', step: 0.1, log: true }, { k: 'damp', name: 'Damp', step: 0.01 }, { k: 'mix', name: 'Mix', step: 0.01 }],
};
/** Which EQ setting each band's handle moves, low to high: what Mobius changed shows on the band it belongs to. */
const EQ_FIELDS: readonly Partial<Record<'freq' | 'gain' | 'q', string>>[] = [
  { freq: 'lowFreq', gain: 'low' }, { freq: 'midFreq', gain: 'mid', q: 'midQ' }, { freq: 'highFreq', gain: 'high' },
];
/** A delay's echo time, in beats, as note values (a beat is a quarter note). */
const EFFECT_DETAILS: { [K in EffectKind]: string } = {
  eq: 'Lifts or cuts the lows, mids and highs',
  compressor: 'Evens out loud and quiet notes',
  delay: 'Echoes that fade, in time with the song',
  reverb: 'Puts the track in a room or hall',
};
const DELAY_TIMES = [{ value: '0.25', label: '1/16' }, { value: '0.5', label: '1/8' }, { value: '0.75', label: '3/16' }, { value: '1', label: '1/4' }, { value: '1.5', label: '3/8' }, { value: '2', label: '1/2' }] as const;

/** One effect on the track, as a shared device: on or off, dragged along the chain by its grip, taken off, and its settings. */
const BENCH_ICON = 'M3.5 6.5h3M13.5 13.5h3M6.5 6.5c4 0 3 7 7 7M6.5 6.5a1.5 1.5 0 1 1 0-.01M13.5 13.5a1.5 1.5 0 1 1 0-.01';
/** The button on an effect's head that opens it up in the Workbench. */
const BenchButton = ({ name, onOpen }: { name: string; onOpen: () => void }) => <IconButton label={`Open ${name} in Workbench`} title="See its parts and cables" icon={<Icon d={BENCH_ICON} />} onClick={onOpen} />;

function EffectBlock({ effect, at, onChange, onRemove, onOpen, folded, onFold, proposed }: {
  effect: Effect; at: number;
  /** Opens the effect in the Workbench. */
  onOpen: () => void;
  /** What Mobius changed on this effect and nobody has kept yet: `fx:<id>` for the whole effect, `fx:<id>:<setting>`. */
  proposed?: ReadonlySet<string>;
  folded: boolean; onFold: (folded: boolean) => void;
  onChange: (fn: (e: Effect) => void, tag?: string) => void;
  onRemove: () => void;
}) {
  if (effect.kind === 'device') return <DeviceBlock effect={effect} at={at} onChange={onChange} onRemove={onRemove} onOpen={onOpen} folded={folded} onFold={onFold} proposed={proposed} />;
  const name = EFFECT_NAMES[effect.kind];
  const values = effect as unknown as Record<string, number>;
  return (
    <DeviceFrame className={`studio-fx studio-fx-${effect.kind}`} title={name} index={at} on={effect.on} proposed={proposed?.has(`fx:${effect.id}`)} onToggle={(on) => onChange((e) => { e.on = on; })} collapsed={folded} onCollapse={onFold}
      actions={<><BenchButton name={name} onOpen={onOpen} /><IconButton label={`Remove ${name}`} icon={<Icon d="M6 6l8 8M14 6l-8 8" />} onClick={onRemove} /></>}>
      <div className="studio-fx-body">
      {effect.kind === 'delay' && (
        <Segmented label="Time" wide value={String(effect.time) as (typeof DELAY_TIMES)[number]['value']} choices={DELAY_TIMES} onChange={(v) => onChange((e) => { (e as Extract<Effect, { kind: 'delay' }>).time = Number(v); }, 'fx:time')} />
      )}
      {effect.kind === 'eq' && (
        <EqGraph label="EQ bands" bands={eqBands(effect)} reset={eqBands(newEffect('eq', effect.id) as EqEffect)}
          proposed={proposed && EQ_FIELDS.map((band) => {
            const on = Object.fromEntries(Object.entries(band).map(([field, k]) => [field, proposed.has(`fx:${effect.id}:${k}`)]));
            return Object.values(on).some(Boolean) ? on : undefined;
          })}
          onChange={(i, band) => onChange((e) => { Object.assign(e, eqFromBand(i, band)); }, `fx:band${i}`)} />
      )}
      {EFFECT_CELLS[effect.kind].length > 0 && <ParamGrid label={`${name} settings`} columns={4}>
        {EFFECT_CELLS[effect.kind].map(({ k, name: cell, step, log, origin }) => {
          const r = EFFECT_PARAMS[effect.kind][k]!;
          return <Knob key={k} label={cell} value={values[k]!} min={r.lo} max={r.hi} step={step} scale={log ? 'log' : 'linear'} origin={origin} reset={r.start} format={(v) => effectText(effect.kind, k, v)} proposed={proposed?.has(`fx:${effect.id}:${k}`)} onChange={(v) => onChange((e) => { (e as unknown as Record<string, number>)[k] = v; }, `fx:${k}`)} />;
        })}
      </ParamGrid>}
      </div>
    </DeviceFrame>
  );
}

/** A song's own device on the track: its name, what it is for, and the knobs its file names as controls. */
function DeviceBlock({ effect, at, onChange, onRemove, onOpen, folded, onFold, proposed }: {
  effect: Extract<Effect, { kind: 'device' }>; at: number; proposed?: ReadonlySet<string>;
  onOpen: () => void;
  folded: boolean; onFold: (folded: boolean) => void;
  onChange: (fn: (e: Effect) => void, tag?: string) => void;
  onRemove: () => void;
}) {
  const { device } = effect;
  return (
    <DeviceFrame className="studio-fx studio-fx-device" title={device.name} index={at} on={effect.on} proposed={proposed?.has(`fx:${effect.id}`)} onToggle={(on) => onChange((e) => { e.on = on; })} collapsed={folded} onCollapse={onFold}
      actions={<><BenchButton name={device.name} onOpen={onOpen} /><IconButton label={`Remove ${device.name}`} icon={<Icon d="M6 6l8 8M14 6l-8 8" />} onClick={onRemove} /></>}>
      <div className="studio-fx-body">
        {device.about && <p className="studio-fx-about">{device.about}</p>}
        {device.controls.length > 0 && <ParamGrid label={`${device.name} controls`} columns={4}>
          {device.controls.map((c) => {
            const r = controlRange(device, c);
            if (!r) return null;
            const key = `${c.part}.${c.param}`;
            return <Knob key={key} label={c.label} value={controlValue(device, c)} min={r.lo} max={r.hi} step={(r.hi - r.lo) / 200} scale={r.unit === 'Hz' ? 'log' : 'linear'} reset={r.start} format={(v) => deviceSettingText(r, v)} proposed={proposed?.has(`fx:${effect.id}:${key}`)}
              onChange={(v) => onChange((e) => { if (e.kind !== 'device') return; const part = e.device.parts.find((p) => p.id === c.part); if (part) part[c.param] = v; }, `fx:${key}`)} />;
          })}
        </ParamGrid>}
      </div>
    </DeviceFrame>
  );
}

const DETAIL_VIEWS = [{ value: 'notes', label: 'Notes' }, { value: 'device', label: 'Devices' }] as const;
/** The song's two views: its clips to launch and try against each other, and the song laid out from start to end. */
const VIEWS = [{ id: 'session', name: 'Session', keys: 'Alt+1' }, { id: 'arrange', name: 'Arrange', keys: 'Alt+2' }] as const;
const LENGTH_CHOICES = CLIP_BARS.map((b) => ({ value: String(b), label: `${b} ${b === 1 ? 'bar' : 'bars'}` }));
/** The octaves a melody's steps can start from, named by the two octaves they show. */
const OCTAVE_CHOICES = [1, 2, 3, 4, 5, 6].map((o) => ({ value: String(o), label: `C${o}–C${o + 2}` }));
const STEP_VIEWS = [{ value: 'notes', label: 'Piano roll' }, { value: 'steps', label: 'Steps' }] as const;
/** The drums bottom to top, as pads and step rows read them: kick first. */
const DRUMS_UP = [...DRUMS].reverse();
const COUNT_IN_KEY = 'mobius.music.countIn';
/** The keys that play the pads while the grid has focus, laid out as the pads are: two rows of three. */
const PAD_KEYS = ['Q', 'W', 'E', 'A', 'S', 'D'];
const STEP_ROWS = DRUMS.map((d) => ({ id: String(d.pitch), name: d.name }));
const PAD_CELLS: readonly { k: PadSetting; name: string; step: number; log?: boolean; format: (v: number) => string }[] = [
  { k: 'tune', name: 'Tune', step: 1, format: (v) => kitText('tune', v) },
  { k: 'decay', name: 'Decay', step: 0.01, log: true, format: (v) => kitText('decay', v) },
  { k: 'level', name: 'Level', step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { k: 'pan', name: 'Pan', step: 0.01, format: panText },
];
const INSTRUMENT_CHOICES = INSTRUMENTS.map((i) => ({ value: i, label: INSTRUMENT_NAMES[i] }));
const KEY_CHOICES = KEYS.map((k) => ({ value: k, label: k }));
const GRID_CHOICES = GRIDS.map((g) => ({ value: String(g.beats), label: g.label }));

const SAMPLER_MODES = [{ value: 'classic', label: 'Classic' }, { value: 'oneshot', label: 'One-Shot' }] as const;

/**
 * A Sampler track's sample and how it plays (Live 12 manual, 36.8 "Working with Samples"): the file, Classic (held
 * keys, the track's envelope, an optional loop) or One-Shot (played through, or gated, with fades), the note it plays at
 * its own pitch on, and its gain.
 */
function SamplerSection({ track, songPath, onTrack }: { track: Track; songPath: string; onTrack: (fn: (t: Track) => void, tag?: string) => void }) {
  const s = track.sampler;
  const put = (patch: Partial<SamplerSound>, tag: string) => onTrack((t) => { if (!t.sampler) return; t.sampler = { ...t.sampler, ...patch }; for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (t.sampler as unknown as Record<string, unknown>)[k]; }, `sampler:${tag}`);
  const oneShot = s?.mode === 'oneshot';
  return (
    <section className="studio-dev-section studio-dev-col" data-wide aria-label="Sample">
      <h4 className="studio-dev-head">Sample</h4>
      <SampleSlot label="Sample" songPath={songPath} sample={s} onSample={(next) => onTrack((t) => { if (next) t.sampler = next; else delete t.sampler; })} />
      {s && <>
        <Segmented label="Playback" value={oneShot ? 'oneshot' : 'classic'} choices={SAMPLER_MODES} onChange={(m) => put({ mode: m === 'oneshot' ? 'oneshot' : undefined }, 'mode')} />
        <ParamGrid label="Sample settings" columns={oneShot ? 4 : 3}>
          <Knob label="Root" value={s.root ?? 60} min={0} max={127} step={1} origin={60} reset={60} format={(v) => noteName(Math.round(v))} onChange={(v) => put({ root: Math.round(v) === 60 ? undefined : Math.round(v) }, 'root')} />
          <Knob label="Gain" value={s.gainDb ?? 0} min={-70} max={24} step={0.1} origin={0} reset={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => put({ gainDb: v === 0 ? undefined : v }, 'gain')} />
          {oneShot ? <>
            <Knob label="Fade in" value={s.fadeIn ?? 0} min={0} max={2} step={0.001} reset={0} format={(v) => `${Math.round(v * 1000)} ms`} onChange={(v) => put({ fadeIn: v > 0 ? v : undefined }, 'fadeIn')} />
            <Knob label="Fade out" value={s.fadeOut ?? 0} min={0} max={2} step={0.001} reset={0} format={(v) => `${Math.round(v * 1000)} ms`} onChange={(v) => put({ fadeOut: v > 0 ? v : undefined }, 'fadeOut')} />
          </> : null}
        </ParamGrid>
        {oneShot
          ? <Switch label="Gate: stop when the key lifts" checked={s.gate === true} onChange={(on) => put({ gate: on || undefined }, 'gate')} />
          : <Switch label="Loop while held" checked={s.loop === true} onChange={(on) => put({ loop: on || undefined }, 'loop')} />}
      </>}
    </section>
  );
}

/**
 * The chosen track's devices, in the bottom area beside its notes (Shift+Tab switches): the track's own colour and
 * level first, then its instrument, then its effects, left to right in the order the sound goes.
 */
export function StudioDevice({ track, onTrack, onOpen, proposed, songPath = '' }: {
  track: Track | null;
  /** The open song's page, for a sample dropped on a sampler or a pad. */
  songPath?: string;
  /** Opens one of the track's effects in the Workbench, by its id. */
  onOpen?: (fx: string) => void;
  /** The settings Mobius changed on this track and nobody has kept yet (soundChanges keys): marked, and turned to. */
  proposed?: ReadonlySet<string>;
  onTrack: (fn: (t: Track) => void, tag?: string) => void;
}) {
  const sound = track ? soundOf(track) : null;
  const base = track && track.instrument !== 'drums' ? SOUND_DEFAULTS[track.instrument] : null;
  const kit = track ? kitOf(track) : null;
  const set = (k: keyof Sound, v: number) => onTrack((t) => { if (t.instrument === 'drums') return; t.sound = { ...(t.sound ?? SOUND_DEFAULTS[t.instrument]), [k]: v }; }, `sound:${k}`);
  const setMany = (patch: Partial<Sound>, tag: string) => onTrack((t) => { if (t.instrument === 'drums') return; t.sound = { ...(t.sound ?? SOUND_DEFAULTS[t.instrument]), ...patch }; }, `sound:${tag}`);
  const [pad, setPad] = useState(0);
  // Folded devices, by track and device, so a long chain fits: the head stays, with its switch and name.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const fold = (key: string) => (on: boolean) => setFolded((f) => { const next = new Set(f); if (on) next.add(key); else next.delete(key); return next; });
  const setKit = (k: keyof KitSound, v: number) => onTrack((t) => { if (t.instrument !== 'drums') return; t.kit = { ...(t.kit ?? KIT_DEFAULTS), [k]: v }; }, `kit:${k}`);
  if (!track) return <div className="studio-device" aria-label="Device chain" role="region"><p className="studio-dev-note">Add a track from Sounds, on the left, to set how it sounds.</p></div>;
  const fx = track.fx ?? [];
  return (
    <div className="studio-device" aria-label="Device chain" role="region" style={{ '--tc': `var(--c-${track.color})` } as CSSProperties}>
      {/* The track's own settings lead the row: they belong to the track, whatever plays it. */}
      <section className="studio-dev-section studio-track-strip" aria-label="Track">
        <h4 className="studio-dev-head">Track</h4>
        <Swatches label="Colour" value={track.color} colors={TRACK_COLOURS} names={COLOUR_NAMES} onChange={(c) => onTrack((t) => { t.color = c as TrackColour; })} />
        <ParamGrid label="Level" columns={2}>
          <ParamCell size="compact" label="Volume" value={track.volume} min={0} max={1} step={0.01} reset={0.8} format={(v) => `${Math.round(v * 100)}%`} proposed={proposed?.has('volume')} onChange={(v) => onTrack((t) => { t.volume = v; }, 'volume')} />
          <Knob label="Pan" value={track.pan} min={-1} max={1} step={0.01} reset={0} format={panText} proposed={proposed?.has('pan')} onChange={(v) => onTrack((t) => { t.pan = v; }, 'pan')} />
        </ParamGrid>
      </section>
      {/* Then the instrument, as sound flows: its switch bypasses it alone, as each effect's does (M mutes the track). */}
      <DeviceFrame className="studio-instrument" title={track.kind === 'sampler' ? 'Sampler' : 'Instrument'} index={0} on={track.instrumentOn !== false} onToggle={(on) => onTrack((t) => { if (on) delete t.instrumentOn; else t.instrumentOn = false; })}
        collapsed={folded.has(`${track.id}:instrument`)} onCollapse={fold(`${track.id}:instrument`)}
        actions={track.kind === 'sampler' ? undefined : <Select inline quiet hideLabel label="Instrument" value={track.instrument} choices={INSTRUMENT_CHOICES} onChange={(i) => onTrack((t) => { t.instrument = i; delete t.sound; delete t.kit; delete t.pads; })} />}>
        <div className="studio-dev-cols">
          {track.kind === 'sampler' && <SamplerSection track={track} songPath={songPath} onTrack={onTrack} />}
          {sound && base && SOUND_GROUPS.filter((g) => track.kind !== 'sampler' || g.name === 'Envelope').map((g) => (
            <section key={g.name} className="studio-dev-section studio-dev-col" data-graph={g.name === 'Filter' || g.name === 'Envelope' || undefined} aria-label={g.name}>
              <h4 className="studio-dev-head">{g.name}</h4>
              {g.name === 'Filter' && (
                <FilterGraph label="Filter curve" value={{ cutoff: sound.cutoff, resonance: sound.resonance }}
                  proposed={proposed && { cutoff: proposed.has('sound:cutoff'), resonance: proposed.has('sound:resonance') }} reset={{ cutoff: base.cutoff, resonance: base.resonance }}
                  min={SOUND_RANGE.cutoff.lo} max={SOUND_RANGE.cutoff.hi} envAmount={sound.envAmount}
                  onEnvAmount={(v) => set('envAmount', v)} envAmountReset={base.envAmount}
                  onChange={(f) => setMany({ cutoff: f.cutoff, resonance: f.resonance }, 'filter')} />
              )}
              {g.name === 'Envelope' && (
                <EnvelopeGraph label="Envelope shape" value={sound} reset={base}
                  proposed={proposed && { attack: proposed.has('sound:attack'), decay: proposed.has('sound:decay'), sustain: proposed.has('sound:sustain'), release: proposed.has('sound:release') }}
                  onChange={(env) => setMany({ attack: env.attack, decay: env.decay, sustain: env.sustain, release: env.release }, 'envelope')} />
              )}
              {g.cells.length > 0 && <ParamGrid label={g.name} columns={2}>
                {g.cells.map(([k, name]) => <DeviceSlider key={k} name={name} k={k} value={sound[k]} base={base[k]} proposed={proposed?.has(`sound:${k}`)} onChange={(v) => set(k, v)} />)}
              </ParamGrid>}
            </section>
          ))}
          {kit && (
            <section className="studio-dev-section studio-dev-col" aria-label="Kit">
              <h4 className="studio-dev-head">Kit</h4>
              <ParamGrid label="Kit" columns={2}>
                {KIT_CELLS.map(({ k, name, step, log }) => <Knob key={k} label={name} value={kit[k]} min={KIT_RANGE[k].lo} max={KIT_RANGE[k].hi} step={step} scale={log ? 'log' : 'linear'} origin={KIT_DEFAULTS[k]} reset={KIT_DEFAULTS[k]} format={(v) => kitText(k, v)} proposed={proposed?.has(`kit:${k}`)} onChange={(v) => setKit(k, v)} />)}
              </ParamGrid>
              <p className="studio-dev-note">Every drum together. Each drum also has its own pad.</p>
            </section>
          )}
          {kit && (() => {
            const drum = DRUMS_UP[Math.min(pad, DRUMS_UP.length - 1)]!;
            const own = padOf(track, drum.pitch);
            return (
              <section className="studio-dev-section studio-dev-col" data-wide aria-label="Pads">
                <h4 className="studio-dev-head">Pads</h4>
                <div className="studio-pads">
                  <PadGrid fill label="Drum pads" columns={3} chosen={pad} onChoose={setPad}
                    pads={DRUMS_UP.map((d, i) => ({ id: String(d.pitch), name: d.name, color: track.color, key: PAD_KEYS[i] }))}
                    onPlay={(i, v) => { const d = DRUMS_UP[i]!; previewOn(track, d.pitch, v, undefined, padOf(track, d.pitch)); }} />
                  <ParamGrid label={`${drum.name} settings`} columns={2}>
                    {PAD_CELLS.map(({ k, name, step, log, format }) => (
                      <Knob key={k} label={name} value={own[k]} min={PAD_RANGE[k].lo} max={PAD_RANGE[k].hi} step={step} scale={log ? 'log' : 'linear'} origin={PAD_DEFAULTS[k]} reset={PAD_DEFAULTS[k]} format={format}
                        onChange={(v) => onTrack((t) => { t.pads = { ...(t.pads ?? {}), [drum.pitch]: { ...padOf(t, drum.pitch), [k]: v } }; }, `pad:${drum.pitch}:${k}`)} />
                    ))}
                  </ParamGrid>
                  <SampleSlot label={`${drum.name} sample`} songPath={songPath} sample={own.sample}
                    onSample={(next) => onTrack((t) => { const p = { ...padOf(t, drum.pitch) }; if (next) p.sample = next; else delete p.sample; t.pads = { ...(t.pads ?? {}), [drum.pitch]: p }; })} />
                </div>
              </section>
            );
          })()}
        </div>
      </DeviceFrame>
      {/* Then the effects, left to right in the order the sound goes through them. */}
      <section className="studio-fx-chain" aria-label="Effects">
        {fx.length > 0 && (
          <DeviceChain label={`${track.name} effects`} count={fx.length}
            onMove={(from, to) => onTrack((t) => { const list = t.fx ?? []; const [moved] = list.splice(from, 1); if (moved) list.splice(to, 0, moved); })}>
            {fx.map((e, i) => (
              <EffectBlock key={e.id} effect={e} at={i} proposed={proposed} onOpen={() => onOpen?.(e.id)} folded={folded.has(`${track.id}:${e.id}`)} onFold={fold(`${track.id}:${e.id}`)}
                onChange={(fn, tag) => onTrack((t) => { const x = t.fx?.find((f) => f.id === e.id); if (x) fn(x); }, tag ? `${tag}:${e.id}` : undefined)}
                onRemove={() => onTrack((t) => { t.fx = (t.fx ?? []).filter((f) => f.id !== e.id); if (t.fx.length === 0) delete t.fx; })} />
            ))}
          </DeviceChain>
        )}
        <Menu label="Add effect" entries={EFFECT_KINDS.map((k) => ({ label: EFFECT_NAMES[k], detail: EFFECT_DETAILS[k], run: () => onTrack((t) => { t.fx = [...(t.fx ?? []), newEffect(k, freshEffectId(t))]; }) }))}
          trigger={<Button kind="quiet" icon={<Icon d="M10 4.5v11M4.5 10h11" />}>Add effect</Button>} />
      </section>
    </div>
  );
}

/** How the piano roll is being pressed on: a note moved or stretched, a box drawn, or a click that may add a note. */
type Gesture =
  | { kind: 'move'; x: number; y: number; db: number; dr: number; moved: boolean; hit: number; wasPicked: boolean; shift: boolean }
  | { kind: 'stretch'; x: number; dl: number; these: Picked }
  | { kind: 'empty'; x: number; y: number; beat: number; row: number; box: boolean; shift: boolean }
  // Draw mode: a stroke along one row that writes a note in each grid cell it crosses, or takes them out if it began on one.
  | { kind: 'paint'; row: number; erase: boolean; done: Set<number>; tag: string };

/** One song: transport, tracks laid out by bar, and the chosen track's notes on a piano roll to draw, move and stretch. */
export function StudioEditor({ songs, review, working = false, listPanels = [] }: { songs: NotesState; /** The app's list, from the frame: its left panel. */ listPanels?: readonly PanelSpec[]; review?: { conversation: string } | null; /** Mobius's turn is still running: its changes are marked as they come, and Keep waits for the end. */ working?: boolean }) {
  const parsed = useMemo(() => (songs.page ? parseSong(songs.text) : null), [songs.page, songs.text]);
  const song = parsed && 'song' in parsed ? parsed.song : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(new Set());
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  // The bars the loop goes round, as picked on the ruler (counted from 0); null loops the whole song.
  const [range, setRange] = useState<{ a: number; b: number } | null>(null);
  const loopDrag = useRef<{ a: number; moved: boolean } | null>(null);
  // When the top of the ruler was last let go after a press that did not drag, so a second press soon after can loop the whole song.
  const lastZonePress = useRef(0);
  const [menu, setMenu] = useState<{ x: number; y: number; label: string; items: ContextMenuItem[] } | null>(null);
  const [click, setClick] = useState(false);
  const [beat, setBeat] = useState(0);
  // Recording: keys played on the computer keyboard while it plays are written into the chosen track, as one take.
  const [recording, setRecording] = useState(false);
  // What arming the chosen audio track found: the input it hears, or why it hears none (Live 12, 19.1).
  const [armed, setArmed] = useState<(ArmHeard & { track: string }) | null>(null);
  // A bar of ticks before recording starts from a stop, as in other studios. On unless turned off; kept for every song.
  const [counts, setCounts] = useState(() => { try { return window.localStorage.getItem(COUNT_IN_KEY) !== '0'; } catch { return true; } });
  const counting = useRef<{ stop(): void } | null>(null);
  // While playing, Arrange scrolls a page at a time to keep the playhead in sight, until the person scrolls it.
  const following = useRef(true);
  const beatW = useRef(0);
  const takeKeys = useRef<Map<string, { pitch: number; start: number; velocity: number }>>(new Map());
  const take = useRef('');
  const finishKey = useRef<((key: string) => void) | null>(null);
  const finishAll = useRef<(() => void) | null>(null);
  const [grid, setGrid] = useState(0.25);
  /** A drums track's notes as a piano roll, or as a bar of steps. */
  const [drumView, setDrumView] = useState<'notes' | 'steps'>('notes');
  /** The octave a melody's steps show, until it is picked; then it stays for that track. */
  const [stepOct, setStepOct] = useState<Record<string, number>>({});
  const [stepBar, setStepBar] = useState(0);
  const [drawLength, setDrawLength] = useState(1);
  // Draw mode (B): a press or a drag on the roll writes notes a grid step long; on a note, it takes notes out.
  const [draw, setDraw] = useState(false);
  // Automation (A): a Volume line under each track in the Arrange view, drawn with points.
  const [showAuto, setShowAuto] = useState(false);
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
  const arrangeEl = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollX] = useState(0);
  // A drag on the velocity lane: which notes, and how much louder or softer so far.
  const [velDrag, setVelDrag] = useState<{ these: Picked; y: number; by: number } | null>(null);
  const page = useRef<HTMLElement>(null);
  // The height of the bottom panel's editor, so drum rows can grow to fill it.
  const [editorH, setEditorH] = useState(320);
  const [editorEl, setEditorEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!editorEl) return undefined;
    const look = () => setEditorH(editorEl.clientHeight);
    look();
    const ro = new ResizeObserver(look);
    ro.observe(editorEl);
    return () => ro.disconnect();
  }, [editorEl]);
  // The room for the lanes, so the whole song fits across the window until it is zoomed in.
  const [laneW, setLaneW] = useState(900);
  // Whether the notes editor is open under the tracks; a double-click on a clip opens it.
  const [editing, setEditing] = useState(false);
  /** What the bottom area shows for the chosen track: its notes or its devices. */
  const [detail, setDetail] = useState<'notes' | 'device'>('notes');
  // Opening a track's notes or devices brings the Detail tab in front of the Mixer beside it.
  const [detailReveal, setDetailReveal] = useState(0);
  useEffect(() => { if (editing) setDetailReveal((n) => n + 1); }, [editing, selected, detail]);
  /** The effect open in the Workbench, in place of the track's devices: on which track, and its id. */
  const [bench, setBench] = useState<{ track: string; fx: string } | null>(null);
  /** Which view of the song is shown: its clips (Session) or the song from start to end (Arrange). */
  const [view, setView] = useState<'session' | 'arrange'>('arrange');
  /** The chosen clip's slot on the chosen track, in the Session view; its notes are the ones in the bottom area. */
  const [clipAt, setClipAt] = useState<number | null>(null);
  /** The Arrange clip opened from its block (double-click or Enter): its loop and start marker show in the Clip toolbar. */
  const [openClip, setOpenClip] = useState<string | null>(null);
  const session = useRef<SessionPlayer | null>(null);
  const [sessionNow, setSessionNow] = useState<{ playing: SessionPlaying; queued: SessionQueued }>({ playing: {}, queued: {} });
  const [undoText, setUndoText] = useState<string | null>(null);
  /** Export as WAV: busy while the song renders, then a line on where it went (or why not). */
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ text: string; kind: 'busy' | 'done' | 'note'; progress?: number } | null>(null);
  const exportStop = useRef<AbortController | null>(null);
  // A finished or failed export says so for a few seconds, then the toast goes by itself.
  useEffect(() => {
    if (!exported || exported.kind === 'busy') return undefined;
    const id = window.setTimeout(() => setExported(null), 6000);
    return () => window.clearTimeout(id);
  }, [exported]);
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    // The room for the lanes across the arrangement.
    const measure = () => {
      setLaneW(Math.max(200, (el.querySelector<HTMLElement>('.studio-arrange')?.clientWidth ?? el.clientWidth) - HEAD_W - 12));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const arrange = el.querySelector('.studio-arrange');
    if (arrange) ro.observe(arrange);
    measure();
    return () => ro.disconnect();
  }, [song !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, setTick] = useState(0);
  const player = useRef<Player | null>(null);
  /** What is playing, for the Mixer's meters (a stable function, so its meter loop isn't restarted). */
  const mixSource = useCallback(() => session.current ?? player.current, []);
  /** Bumped to bring the Mixer tab up from the toolbar. */
  const [mixerReveal, setMixerReveal] = useState(0);
  const roll = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const copied = useRef<SongNote[]>([]);
  const history = useRef(new Map<string, { undo: string[]; redo: string[]; tag: string; at: number }>());
  const file = songs.page ? `studio/${songs.page.path}` : null;
  // Each call of a running turn that changes this song reads what it was before the turn again, so Mobius's change is
  // dashed and named as it lands, not when the turn ends.
  const [asked, setAsked] = useState(0);
  useTurnFileChanged(review?.conversation ?? null, file, () => setAsked((n) => n + 1));
  const { before, keep, discard } = useFileReview(review, file, `${String(songs.page?.base ?? '')}:${asked}`);
  /** The song as it was before Mobius's change (null when Mobius made it), while there is one to review. */
  const wasSong = useMemo(() => {
    if (before === undefined || before === null) return null;
    const was = parseSong(before);
    return 'song' in was ? was.song : null;
  }, [before]);
  const changed = useMemo(() => (!song || before === undefined ? new Set<string>() : changedTracks(wasSong, song)), [song, before, wasSong]);
  // A change Mobius made only to how a track sounds opens that track's devices, so the moved knobs are in view.
  const soundOnly = useMemo(() => {
    if (!song || !wasSong) return null;
    return [...changed].find((id) => {
      const was = wasSong.tracks.find((t) => t.id === id), now = song.tracks.find((t) => t.id === id);
      return was && now && !notesDiffer(was, now) && soundChanges(was, now).length > 0;
    }) ?? null;
  }, [changed, song, wasSong]);
  /** The chosen track's settings Mobius changed and nobody has kept yet: its devices mark them until Keep or Discard. */
  const proposedKeys = useMemo(() => {
    const id = selected;
    if (!song || !wasSong || !id || !changed.has(id)) return undefined;
    const now = song.tracks.find((t) => t.id === id);
    return now ? new Set(soundChanges(wasSong.tracks.find((t) => t.id === id), now).map((c) => c.key)) : undefined;
  }, [changed, song, wasSong, selected]);
  useEffect(() => {
    if (!soundOnly) return;
    setSelected(soundOnly); setEditing(true); setDetail('device');
  }, [soundOnly]); // eslint-disable-line react-hooks/exhaustive-deps
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
    // A recording take is one step however long it runs; other runs of one change join while they come quickly.
    if (!(tag && tag === steps.tag && (now - steps.at < 1200 || tag.startsWith('record:')))) { steps.undo.push(songs.text); if (steps.undo.length > 200) steps.undo.shift(); }
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

  /** What the player goes round: the picked bars, the whole song, or nothing when Loop is off. */
  const cycleFor = useCallback((s: Song): Cycle | null => (loop ? (range ? cycleOf(range.a, range.b, s.bars) : { from: 0, to: s.bars * BEATS_PER_BAR }) : null), [loop, range]);
  const stop = useCallback(() => {
    counting.current?.stop(); counting.current = null;
    finishAll.current?.();
    setRecording(false);
    player.current?.stop(); player.current = null;
    session.current?.stop(); session.current = null;
    setSessionNow({ playing: {}, queued: {} });
    setPlaying(false);
  }, []);
  /** Starts the Session view's clock, with any clips to launch on its first beat. */
  const startSession = useCallback((launches: SessionQueued = {}) => {
    if (!song) return;
    player.current?.stop(); player.current = null;
    session.current?.stop();
    session.current = playSession(song, click, launches);
    setBeat(0);
    setPlaying(true);
  }, [song, click]);
  /** What the playing song was started with that it cannot change while playing: a change to one of them restarts it. */
  const heard = useRef('');
  const playedAs = (s: Song, cycle: Cycle | null) => JSON.stringify([s.tempo, s.bars, cycle, click]);
  const startAt = useCallback((from: number) => {
    if (!song) return;
    player.current?.stop();
    heard.current = playedAs(song, cycleFor(song));
    player.current = play(song, from >= song.bars * BEATS_PER_BAR ? 0 : from, cycleFor(song), click);
    following.current = true;
    setPlaying(true);
  }, [song, cycleFor, click]);
  const start = useCallback(() => (view === 'session' ? startSession() : startAt(Math.floor(beat))), [view, startSession, startAt, beat]);
  const seek = useCallback((to: number) => {
    setBeat(to);
    if (playing && song) { player.current?.stop(); heard.current = playedAs(song, cycleFor(song)); player.current = play(song, to, cycleFor(song), click); }
  }, [playing, song, cycleFor, click]);
  // While playing, the playhead follows; a change to the notes is heard from the next time round.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => {
      const live = session.current;
      if (live) {
        setBeat(live.beat());
        setSessionNow({ playing: live.playing(), queued: live.queued() });
        id = requestAnimationFrame(tick);
        return;
      }
      const p = player.current;
      if (!p || !song) return;
      const b = p.beat();
      if (!loop && b >= song.bars * BEATS_PER_BAR) { stop(); setBeat(0); return; }
      setBeat(Math.max(0, b));
      const el = arrangeEl.current;
      if (el && following.current && beatW.current > 0) {
        const to = followScroll(el.scrollLeft, el.clientWidth, HEAD_W, Math.max(0, b) * beatW.current);
        if (to !== null) el.scrollLeft = to;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, song, loop, stop]);
  useEffect(() => () => player.current?.stop(), []);
  // The engine opens its sound output once, and has the song as it is, so a note sounds on its track at once.
  useEffect(() => { void engineReady(); }, []);
  // The engine reports the levels of the device open in the Workbench, for its cables.
  const watched = bench && editing && detail === 'device' ? bench : null;
  useEffect(() => { void engineReady().then(() => watchDevice(watched?.track ?? null, watched?.fx ?? null)); }, [watched?.track, watched?.fx]);
  useEffect(() => {
    setArmed(null);
    void engineReady().then(() => armKeys(selected, (heard) => { if (selected) setArmed({ track: selected, ...heard }); }));
  }, [selected]);
  // A take the engine saved becomes an audio clip on its track where it was recorded, as one step for undo.
  const changeNow = useRef(change);
  changeNow.current = change;
  useEffect(() => onTake((take) => {
    changeNow.current((s) => {
      const t = s.tracks.find((x) => x.id === take.track);
      if (!t) return;
      const taken = new Set(t.clips.map((c) => c.id));
      let n = t.clips.length + 1;
      const nextId = () => { while (taken.has(`c${n}`)) n++; taken.add(`c${n}`); return `c${n}`; };
      const clip = takeClip(take, s.tempo, nextId());
      // As Live's Arrangement records: the take replaces what it covers on its track, cutting or splitting clips under it.
      t.clips = [...recordOver(t.clips, clip.start, clip.start + clip.length, s.tempo, nextId), clip].sort((a, b) => a.start - b.start);
      const end = Math.ceil((clip.start + clip.length) / BEATS_PER_BAR);
      if (end > s.bars) s.bars = end;
    }, `take:${take.file}`);
    if (take.lost) setExported({ text: 'The disk fell behind while recording, so the take has gaps.', kind: 'note' });
  }), []);
  useEffect(() => { if (song) loadSong(song, songs.page?.path ?? null); }, [songs.text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { stop(); setBeat(0); setSelected(null); setPicked(new Set()); setRange(null); setClipAt(null); }, [songs.page?.path, stop]);
  // Each view plays its own way, so switching stops what is playing.
  useEffect(() => { stop(); setBeat(0); setClipAt(null); setPicked(new Set()); }, [view, stop]);
  useEffect(() => { setPicked(new Set()); }, [selected]);
  // What is heard follows what is shown. A change to the notes, sounds or effects goes into what is playing, so a part
  // Mobius adds (or Try another) comes in on time; a change of tempo, length, loop or click restarts from where it is.
  useEffect(() => {
    if (session.current && song) { session.current.update(song); return; }
    if (!playing || !song) return;
    const cycle = cycleFor(song);
    const how = playedAs(song, cycle);
    if (how === heard.current && player.current?.update) { player.current.update(song); return; }
    heard.current = how;
    const b = player.current?.beat() ?? 0;
    player.current?.stop();
    player.current = play(song, b, cycle, click);
  }, [songs.text, cycleFor, click]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys for the chosen track and the loop, set each time the page is drawn (they need what the song has now).
  const pageKeys = useRef<((e: KeyboardEvent, t: HTMLElement) => boolean) | null>(null);
  // Keys anywhere on the page: Space plays and stops, Return goes back to the start, Ctrl+Z and Ctrl+Y undo and redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.studio-page') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!t.isContentEditable && playKeys.current?.(e)) { e.preventDefault(); return; }
      if (pageKeys.current?.(e, t)) { e.preventDefault(); return; }
      if (e.key === ' ' && (t.tagName !== 'BUTTON' || isClip(t))) { e.preventDefault(); if (playing) stop(); else start(); } else if (e.key === 'Enter' && t.tagName !== 'BUTTON' && !mod) { e.preventDefault(); seek(0); } else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); } else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    // A clip is a button, but Space on it plays the song as anywhere else in Music; its click on key-up is let go.
    const onUp = (e: KeyboardEvent) => { if (e.key === ' ' && e.target instanceof HTMLElement && isClip(e.target)) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }, [playing, start, stop, seek, undo, redo]);
  // The computer keyboard's keys go to playKeys first (in the page's own listener); while it is on, Music holds the
  // keyboard so the shell's single-letter keys (C for comments) stand down.
  const playKeys = useRef<((e: KeyboardEvent) => boolean) | null>(null);

  // The piano roll opens on the chosen track's highest notes.
  const shownTrack = song ? (song.tracks.find((t) => t.id === selected) ?? song.tracks[0] ?? null) : null;
  useEffect(() => {
    if (!roll.current || !shownTrack || shownTrack.instrument === 'drums' || shownTrack.clips.every((c) => c.notes.length === 0)) return;
    const top = Math.max(...trackNotes(shownTrack).map((n) => n.pitch));
    roll.current.scrollTop = Math.max(0, (MELODY_TOP - top) * ROW_H - 2 * ROW_H);
  }, [shownTrack?.id, songs.page?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // The sidebar's Sounds and the menus' Play or stop reach the open song while Music is on screen.
  useEffect(() => {
    const onAdd = (e: Event) => {
      const asked = (e as CustomEvent<Instrument | 'audio' | 'sampler'>).detail;
      change((s) => {
        const id = freshTrackId(s);
        // An audio track keeps an instrument for the file's sake (the engine ignores it); its clips play sounds.
        if (asked === 'audio') s.tracks.push({ id, name: 'Audio', kind: 'audio', instrument: 'piano', volume: 0.8, pan: 0, muted: false, solo: false, color: nextColour(s.tracks), clips: [] });
        // A Sampler track too: its sample comes once one is dropped on it; its envelope is the track's sound.
        else if (asked === 'sampler') s.tracks.push({ id, name: 'Sampler', kind: 'sampler', instrument: 'piano', volume: 0.8, pan: 0, muted: false, solo: false, color: nextColour(s.tracks), clips: [] });
        else s.tracks.push({ id, name: INSTRUMENT_NAMES[asked], instrument: asked, volume: 0.8, pan: 0, muted: false, solo: false, color: nextColour(s.tracks), clips: [] });
        setSelected(id);
      });
    };
    window.addEventListener(ADD_TRACK, onAdd);
    return () => window.removeEventListener(ADD_TRACK, onAdd);
  }, [change]);
  useEffect(() => { setUndoText(null); }, [songs.page?.path]);
  // The computer keyboard as an instrument: which keys are down, so the roll's keyboard shows them, until let go.
  const [keyboard, setKeyboard] = useState(false);
  useKeyboardClaim(keyboard);
  const [keyOctave, setKeyOctave] = useState(4);
  const [keyVelocity, setKeyVelocity] = useState(100);
  const [held, setHeld] = useState<ReadonlyMap<string, number>>(new Map());
  // The computer keys held down through the engine, by key, so each lifts the note it pressed.
  const pressed = useRef(new Map<string, number>());
  useEffect(() => {
    const lift = (k: string) => { const pitch = pressed.current.get(k); if (pitch === undefined) return; pressed.current.delete(k); pressKey(pitch, 0); };
    const up = (e: KeyboardEvent) => { lift(e.key.toLowerCase()); finishKey.current?.(e.key.toLowerCase()); setHeld((h) => { if (!h.has(e.key.toLowerCase())) return h; const next = new Map(h); next.delete(e.key.toLowerCase()); return next; }); };
    const clear = () => { for (const k of [...pressed.current.keys()]) lift(k); finishAll.current?.(); setHeld(new Map()); };
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); };
  }, []);
  // A short while for the last song to open before the page says none is open.
  const [settled, setSettled] = useState(false);
  useEffect(() => { const id = window.setTimeout(() => setSettled(true), 1500); return () => window.clearTimeout(id); }, []);

  if (!songs.page && songs.notebooks.some((n) => n.pages.length) && !settled) {
    // The last song is on its way: placeholder bars the shape of the tracks, not a spinner.
    return (
      <PanelLayout app="studio" panels={listPanels}>
        <section className="studio-page studio-loading" aria-label="Music" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <span key={i} className="studio-placeholder" style={{ ['--w' as string]: `${70 - i * 12}%` }} />)}
        </section>
      </PanelLayout>
    );
  }
  if (!songs.page) {
    return (
      <PanelLayout app="studio" panels={listPanels}>
        <section className="studio-page empty" aria-label="Music">
          <EmptyState app="studio" label="No song open" title={songs.notebooks.some((n) => n.pages.length) ? 'No song open' : 'No songs yet'} line="Songs are notes, never audio, so Mobius can read and write them like a score." action={{ label: 'New song', run: () => newItemIn(songs, null, STUDIO_WORDS.defaultGroup) }} />
        </section>
      </PanelLayout>
    );
  }
  if (!song) return <PanelLayout app="studio" panels={listPanels}><section className="studio-page empty" aria-label="Music"><p className="note-empty">This song could not be read ({parsed && 'error' in parsed ? parsed.error : 'unknown'}).</p></section></PanelLayout>;

  const track = song.tracks.find((t) => t.id === selected) ?? song.tracks[0] ?? null;
  const total = song.bars * BEATS_PER_BAR;
  // The Workbench shows its effect while that track stays chosen and the effect is still on it.
  const benchFx = bench && track && bench.track === track.id ? track.fx?.find((e) => e.id === bench.fx) ?? null : null;
  // In the Session view the bottom area edits the chosen clip, which goes round on its own length.
  const clip: Clip | null = view === 'session' && track && clipAt !== null ? (track.slots?.[clipAt] ?? null) : null;
  const span = clip ? clip.bars * BEATS_PER_BAR : total;
  const spanBars = span / BEATS_PER_BAR;
  // Where the playhead is in what the bottom area shows: the clip's own time round, or nowhere when it is not playing.
  const clipPlaying = clip && track ? sessionNow.playing[track.id] : undefined;
  const rollBeat = view === 'arrange' ? beat : clip && clipPlaying && clipPlaying.slot === clipAt ? (((beat - clipPlaying.start) % span) + span) % span : -1;
  const inKey = keyPitches(song.key);
  const drums = track?.instrument === 'drums';
  // Drum rows grow to fill the editor (there are only six), up to a comfortable pad size.
  // The list fits its tracks and the row for adding one after them.
  const rowH = drums ? Math.max(DRUM_ROW_H, Math.min(40, Math.floor((editorH - 38 - VEL_H - 2) / DRUMS.length))) : ROW_H;
  const keysW = drums ? DRUM_KEYS_W : KEYS_W;
  const rows = drums ? DRUMS.map((d) => ({ pitch: d.pitch, label: d.name, shade: false, black: false, c: true })) : Array.from({ length: MELODY_TOP - MELODY_BOTTOM + 1 }, (_, i) => MELODY_TOP - i).map((p) => ({ pitch: p, label: noteName(p), shade: !inKey.has(p % 12), black: isBlack(p), c: p % 12 === 0 }));
  const rowOf = (pitch: number) => rows.findIndex((r) => r.pitch === pitch);
  // A clip's notes fill the editor's width, so a one-bar clip is not a strip at the left; the song's notes keep their scale.
  const rbw = clip ? Math.max(ROLL_BEAT_W * zoom, (laneW + HEAD_W - keysW) / span) : ROLL_BEAT_W * zoom;
  // The arrangement fits the whole song across the window, then zooms in from there.
  const bw = Math.max(BEAT_MIN, laneW / total) * zoom;
  beatW.current = view === 'arrange' ? bw : 0;
  // Worked out on each render: this is after the early returns above, where no hook may be.
  const notes = clip ? clip.notes : track ? trackNotes(track) : [];
  // The Arrange clip opened from its block, while it's still there and the notes editor shows Arrange.
  const arrClip = !clip && view === 'arrange' && track ? track.clips.find((c) => c.id === openClip) ?? null : null;
  // A looped clip's later passes, drawn faintly after its first: they play what the first pass holds, and change with it.
  const echoes = !clip && track ? track.clips.flatMap((c) => {
    if (!c.loop) return [];
    const pass = firstPass(c);
    const edge = c.start + pass.to - pass.from;
    return playedNotes(c).filter((n) => n.start >= edge - 1e-9);
  }) : [];
  const heldPitches = new Set(held.values());
  const lastHeld = [...held.values()].at(-1);
  const heldName = lastHeld === undefined ? null : spellIn(lastHeld, song.key);
  // Steps: a row per drum, or for a melody a row per note of the key across two octaves, from the octave picked.
  const octave = track ? (stepOct[track.id] ?? stepOctave(notes, track.instrument === 'bass' ? 2 : 4)) : 4;
  const stepRows = drums ? STEP_ROWS : scaleRows(inKey, octave).map((p) => ({ id: String(p), name: spellIn(p, song.key) }));
  const pickedNotes = notes.filter((_, i) => picked.has(i));

  const setNotes = (fn: (n: SongNote[]) => { notes: SongNote[]; picked: Set<number> } | SongNote[], tag = '') => {
    if (!track) return;
    const after: { picked: Set<number> | null } = { picked: null };
    change((s) => {
      const t = s.tracks.find((x) => x.id === track.id);
      if (!t) return;
      const c = clip && clipAt !== null ? t.slots?.[clipAt] : null;
      const out = fn(c ? c.notes : trackNotes(t));
      // Arrange's notes go back into the track's clips: each into the clip it starts in, new clips for the rest.
      const put = (v: SongNote[]) => { if (c) c.notes = v; else t.clips = putNotes(t.clips, v, s.bars); };
      if (Array.isArray(out)) put(out); else { put(out.notes); after.picked = out.picked; }
    }, tag);
    if (after.picked) setPicked(after.picked);
  };
  /** Moves by rows rather than semitones, so drums step from one drum to the next. */
  const moveByRows = (db: number, dr: number) => setNotes((n) => {
    const moved = moveNotes(n, picked, db, 0, span);
    if (dr === 0) return moved;
    const can = moved.notes.every((x, i) => !moved.picked.has(i) || (rowOf(x.pitch) + dr >= 0 && rowOf(x.pitch) + dr < rows.length));
    if (!can) return moved;
    return { notes: moved.notes.map((x, i) => (moved.picked.has(i) ? { ...x, pitch: rows[rowOf(x.pitch) + dr]!.pitch } : x)), picked: moved.picked };
  });
  /** The sounds to add a track from, as a menu at a point: the sidebar's Sounds, for the row at the end of the tracks. */
  const soundsMenu = (x: number, y: number) => setMenu({ x, y, label: 'Add track', items: [...SOUNDS.map((i) => ({ label: INSTRUMENT_NAMES[i], run: () => askToAddTrack(i) })), { label: 'Audio track', run: () => askToAddTrack('audio') }, { label: 'Sampler', run: () => askToAddTrack('sampler') }] });
  const setTrack = (id: string, fn: (t: Track) => void, tag = '') => change((s) => { const t = s.tracks.find((x) => x.id === id); if (t) fn(t); }, tag);
  const duplicateTrack = (id: string) => change((s) => {
    const i = s.tracks.findIndex((x) => x.id === id);
    if (i < 0) return;
    const copy = { ...structuredClone(s.tracks[i]!), id: freshTrackId(s), name: `${s.tracks[i]!.name} copy`.slice(0, 60), color: nextColour(s.tracks) };
    s.tracks.splice(i + 1, 0, copy);
    setSelected(copy.id);
  });
  const deleteTrack = (id: string) => {
    const name = song.tracks.find((x) => x.id === id)?.name ?? 'track';
    change((s) => { s.tracks = s.tracks.filter((x) => x.id !== id); if (selected === id) setSelected(null); });
    setUndoText(`Deleted “${name}”`);
  };
  /** Opens the notes editor on a track, scrolled to `fromBeat`. */
  const openNotes = (id: string, fromBeat = 0, arrangeClipId: string | null = null) => {
    setSelected(id);
    setClipAt(null);
    setOpenClip(arrangeClipId);
    setEditing(true);
    setDetail('notes');
    afterPaint(() => { if (roll.current) roll.current.scrollLeft = Math.max(0, fromBeat * ROLL_BEAT_W * zoom - 8); });
  };
  /** Opens the bottom area on a track's devices, as double-clicking a track's name does in a studio. */
  const openDevice = (id: string) => { setSelected(id); setEditing(true); setDetail('device'); };

  // The Session view: clips in slots, launched on the next bar.
  /** Opens a clip's notes in the bottom area, as clicking a clip does in a studio. */
  const chooseClip = (id: string, slot: number) => { setSelected(id); setClipAt(slot); setPicked(new Set()); setEditing(true); setDetail('notes'); };
  const setSlot = (id: string, slot: number, c: Clip | null) => setTrack(id, (t) => {
    const slots = [...(t.slots ?? [])];
    while (slots.length <= slot) slots.push(null);
    slots[slot] = c;
    while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop();
    if (slots.length > 0) t.slots = slots; else delete t.slots;
  });
  const createClip = (id: string, slot: number) => {
    const t = song.tracks.find((x) => x.id === id);
    if (!t) return;
    setSlot(id, slot, { name: `${t.name} ${slot + 1}`.slice(0, 60), bars: 1, notes: [] });
    chooseClip(id, slot);
  };
  const setClip = (id: string, slot: number, fn: (c: Clip) => void, tag = '') => setTrack(id, (t) => { const c = t.slots?.[slot]; if (c) fn(c); }, tag);
  const launch = (id: string, slot: number | null) => {
    if (session.current) session.current.launch(id, slot);
    else if (slot !== null) startSession({ [id]: slot });
  };
  /** Launches a row: each track plays its clip in that scene, and a track with none there stops. */
  const launchScene = (slot: number) => {
    const row = Object.fromEntries(song.tracks.map((t) => [t.id, t.slots?.[slot] ? slot : null]));
    if (session.current) for (const [id, at] of Object.entries(row)) session.current.launch(id, at);
    else startSession(Object.fromEntries(Object.entries(row).filter(([, at]) => at !== null)));
  };
  const stopAll = () => { for (const t of song.tracks) session.current?.launch(t.id, null); };
  const deleteClip = (id: string, slot: number) => {
    if (sessionNow.playing[id]?.slot === slot) session.current?.launch(id, null);
    setSlot(id, slot, null);
    if (selected === id && clipAt === slot) setClipAt(null);
  };
  /** Copies a clip into the next empty slot below it on the same track. */
  const duplicateClip = (id: string, slot: number) => {
    const t = song.tracks.find((x) => x.id === id);
    const c = t?.slots?.[slot];
    if (!t || !c) return;
    let to = slot + 1;
    while (to < MAX_SCENES && t.slots?.[to]) to++;
    if (to >= MAX_SCENES) return;
    setSlot(id, to, structuredClone(c));
    chooseClip(id, to);
  };
  /** A track's clips in Arrange: moved, stretched, copied, muted and deleted, each one Undo. */
  const editClips = (trackId: string, fn: (clips: ArrangeClip[], beats: number) => ArrangeClip[], tag: string) => change((s) => {
    const t = s.tracks.find((x) => x.id === trackId);
    if (t) t.clips = fn(t.clips, s.bars * BEATS_PER_BAR);
  }, tag);
  const arrangeClip = (trackId: string, id: string, act: 'delete' | 'duplicate' | 'mute' | 'double' | 'halve') => {
    if (act === 'double' || act === 'halve') editClips(trackId, (cs) => scaleClipLoop(cs, id, act === 'double' ? 2 : 0.5), '');
    else if (act === 'delete') editClips(trackId, (cs) => cs.filter((c) => c.id !== id), '');
    else if (act === 'mute') editClips(trackId, (cs) => cs.map((c) => (c.id !== id ? c : c.muted ? (({ muted: _, ...rest }) => rest)(c) : { ...c, muted: true })), '');
    else editClips(trackId, (cs, beats) => duplicateArrange(cs, id, beats)?.clips ?? cs, '');
  };
  const clipActions = (trackId: string): ClipActions => ({
    onMove: (id, start) => editClips(trackId, (cs, beats) => moveClip(cs, id, start, beats), ''),
    onResize: (id, length) => editClips(trackId, (cs, beats) => resizeClip(cs, id, length, beats), ''),
    onKey: (id, key) => arrangeClip(trackId, id, key),
    onMenu: (id, x, y) => {
      const c = song.tracks.find((t) => t.id === trackId)?.clips.find((k) => k.id === id);
      if (!c) return;
      setSelected(trackId);
      setMenu({ x, y, label: c.name ?? 'Clip', items: [
        { label: 'Edit Notes', keys: 'Enter', run: () => openNotes(trackId, c.start) },
        { label: 'Duplicate', keys: 'Ctrl+D', separated: true, disabled: !duplicateArrange(song.tracks.find((t) => t.id === trackId)!.clips, id, song.bars * BEATS_PER_BAR), run: () => arrangeClip(trackId, id, 'duplicate') },
        { label: c.muted ? 'Unmute' : 'Mute', keys: '0', run: () => arrangeClip(trackId, id, 'mute') },
        { label: c.loop ? 'Stop Looping' : 'Loop', run: () => editClips(trackId, (cs) => toggleClipLoop(cs, id), '') },
        { label: 'Delete', keys: 'Delete', run: () => arrangeClip(trackId, id, 'delete') },
      ] });
    },
  });
  const clipMenu = (id: string, slot: number, x: number, y: number) => {
    const c = song.tracks.find((t) => t.id === id)?.slots?.[slot];
    if (!c) return;
    chooseClip(id, slot);
    setMenu({ x, y, label: c.name, items: [
      { label: 'Launch', run: () => launch(id, slot) },
      { label: 'Duplicate', keys: 'Ctrl+D', separated: true, run: () => duplicateClip(id, slot) },
      { label: 'Delete', keys: 'Delete', run: () => deleteClip(id, slot) },
    ] });
  };
  const setSceneName = (slot: number, name: string) => change((s) => {
    const names = [...(s.scenes ?? [])];
    while (names.length <= slot) names.push('');
    names[slot] = name;
    s.scenes = names;
  }, `scene:${slot}`);
  const addScene = () => change((s) => { const names = [...(s.scenes ?? [])]; const n = sceneCount(s); while (names.length < n + 1) names.push(''); s.scenes = names; });
  const cycle = cycleFor(song);
  const loopWords = cycle && range ? (cycle.to - cycle.from === BEATS_PER_BAR ? `bar ${cycle.from / BEATS_PER_BAR + 1}` : `bars ${cycle.from / BEATS_PER_BAR + 1} to ${cycle.to / BEATS_PER_BAR}`) : 'the whole song';
  /** A press on the ruler: along its top it picks the bars to loop (twice quickly loops the whole song); below, it moves the playhead. */
  const onRulerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (e.clientY - r.top < 11) {
      e.currentTarget.setPointerCapture(e.pointerId);
      if (lastZonePress.current && e.timeStamp - lastZonePress.current < 500) { lastZonePress.current = 0; loopDrag.current = null; setRange(null); setLoop(true); return; }
      lastZonePress.current = 0;
      const bar = Math.max(0, Math.min(song.bars - 1, Math.floor(x / (BEATS_PER_BAR * bw))));
      loopDrag.current = { a: bar, moved: false };
      setRange({ a: bar, b: bar });
      setLoop(true);
      return;
    }
    seek(Math.max(0, Math.min(total - 1, Math.floor(x / bw))));
  };
  const onRulerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = loopDrag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    const bar = Math.max(0, Math.min(song.bars - 1, Math.floor((e.clientX - r.left) / (BEATS_PER_BAR * bw))));
    if (bar !== d.a) d.moved = true;
    setRange((was) => (was && was.a === d.a && was.b === bar ? was : { a: d.a, b: bar }));
  };
  /** A track's menu, from a right-click on its header: the same things as its buttons. */
  const trackMenu = (t: Track, x: number, y: number) => setMenu({ x, y, label: t.name, items: [
    { label: 'Edit Notes', keys: 'Enter', run: () => openNotes(t.id) },
    { action: 'duplicate', keys: 'Ctrl+D', separated: true, run: () => duplicateTrack(t.id) },
    { label: t.muted ? 'Unmute' : 'Mute', keys: 'M', run: () => setTrack(t.id, (v) => { v.muted = !v.muted; }) },
    { label: t.solo ? 'Unsolo' : 'Solo', keys: 'S', run: () => setTrack(t.id, (v) => { v.solo = !v.solo; }) },
    { action: 'delete', label: 'Delete Track', keys: 'Delete', danger: true, separated: true, run: () => deleteTrack(t.id) },
  ] });
  // What Mobius changed, by track and where: "Pad idea, bars 13 to 24", or how it sounds: "Pad: cutoff 4.2 kHz → 1.1 kHz".
  const names = [...changed].flatMap((id) => {
    const t = song.tracks.find((x) => x.id === id);
    if (!t) return [id];
    const was = wasSong?.tracks.find((x) => x.id === id);
    const parts: string[] = [];
    const clips = clipsOf(trackNotes(t), song.bars);
    if (notesDiffer(was, t) && clips.length > 0) {
      const from = clips[0]!.from + 1, to = clips[clips.length - 1]!.to;
      parts.push(`${t.name}, ${from === to ? `bar ${from}` : `bars ${from} to ${to}`}`);
    }
    const moved = soundChanges(was, t);
    if (moved.length) parts.push(`${t.name}: ${moved.slice(0, 3).map((c) => c.text).join(', ')}${moved.length > 3 ? ` and ${moved.length - 3} more` : ''}`);
    return parts.length ? parts : [t.name];
  });
  const pos = position(beat, song.tempo);

  // ---------- The piano roll's pointer ----------
  const at = (e: { clientX: number; clientY: number }) => {
    const r = inner.current!.getBoundingClientRect();
    return { beat: Math.max(0, Math.min(span - 1e-6, (e.clientX - r.left - keysW) / rbw)), row: Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientY - r.top) / rowH))) };
  };
  const onRollDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !track) return;
    const target = e.target as HTMLElement;
    if (target.closest('.studio-key')) return;
    roll.current?.focus({ preventScroll: true });
    const noteEl = target.closest<HTMLElement>('.studio-note');
    e.currentTarget.setPointerCapture(e.pointerId);
    if (draw) {
      const p = at(e);
      const g: Gesture = { kind: 'paint', row: p.row, erase: !!noteEl, done: new Set(), tag: `paint:${e.timeStamp}` };
      setPicked(new Set());
      setGesture(g);
      paintAt(g, p.beat);
      return;
    }
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
      previewOn(track, n.pitch, n.velocity);
      setGesture({ kind: 'move', x: e.clientX, y: e.clientY, db: 0, dr: 0, moved: false, hit: i, wasPicked, shift: e.shiftKey });
      return;
    }
    const p = at(e);
    setGesture({ kind: 'empty', x: e.clientX, y: e.clientY, beat: p.beat, row: p.row, box: false, shift: e.shiftKey });
  };
  /** One cell of a draw-mode stroke: a note there, or the notes there gone. */
  const paintAt = (g: Extract<Gesture, { kind: 'paint' }>, beatAt: number) => {
    if (!track) return;
    const cell = Math.floor(Math.max(0, Math.min(span - 1e-6, beatAt)) / grid) * grid;
    if (g.done.has(cell)) return;
    g.done.add(cell);
    const pitch = rows[g.row]!.pitch;
    if (g.erase) {
      setNotes((n) => n.filter((x) => !(x.pitch === pitch && x.start < cell + grid && x.start + x.length > cell)), g.tag);
      return;
    }
    const length = Math.min(drums ? Math.min(grid, 0.25) : grid, span - cell);
    setNotes((n) => (n.some((x) => x.pitch === pitch && x.start === cell) ? n : [...n, { pitch, start: cell, length, velocity: 0.8 }]), g.tag);
    if (g.done.size === 1) previewOn(track, pitch);
  };
  const onRollMove = (e: { clientX: number; clientY: number }) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === 'paint') { paintAt(g, at(e).beat); return; }
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
    if (!g || !track || g.kind === 'paint') return;
    if (g.kind === 'move') {
      if (g.moved) lastPress.current = null;
      if (g.moved && (g.db !== 0 || g.dr !== 0)) moveByRows(g.db, g.dr);
      else if (!g.moved && g.wasPicked && g.shift) setPicked(new Set([...picked].filter((i) => i !== g.hit)));
      else if (!g.moved && g.wasPicked && !g.shift) setPicked(new Set([g.hit]));
    } else if (g.kind === 'stretch') {
      if (g.dl !== 0) setNotes((n) => stretchNotes(n, g.these, g.dl, span, Math.min(grid, 0.25)));
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
      setNotes((n) => addNote(n, { pitch, start: snap(g.beat, grid), length: Math.min(length, span - snap(g.beat, grid)), velocity: 0.8 }));
      previewOn(track, pitch);
    }
  };
  const onRollKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!track) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if ((k === 'Delete' || k === 'Backspace') && picked.size) { setNotes((n) => removeNotes(n, picked)); setPicked(new Set()); } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (!picked.size) return;
      const d = (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? BEATS_PER_BAR : grid);
      if (e.altKey) setNotes((n) => stretchNotes(n, picked, d, span, Math.min(grid, 0.25))); else moveByRows(d, 0);
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (!picked.size) return;
      const dir = k === 'ArrowUp' ? -1 : 1;
      if (drums) moveByRows(0, dir);
      else setNotes((n) => moveNotes(n, picked, 0, -dir * (e.shiftKey ? 12 : 1), span));
    } else if (mod && k.toLowerCase() === 'a') { setPicked(new Set(notes.map((_, i) => i))); } else if (mod && k.toLowerCase() === 'd') { setNotes((n) => duplicateNotes(n, picked, span)); } else if (mod && k.toLowerCase() === 'c') { copied.current = pickedNotes; } else if (mod && k.toLowerCase() === 'x') { copied.current = pickedNotes; setNotes((n) => removeNotes(n, picked)); setPicked(new Set()); } else if (mod && k.toLowerCase() === 'v') { const from = snap(beat, grid); setNotes((n) => pasteNotes(n, copied.current, from, span)); } else if (!mod && k.toLowerCase() === 'q') { setNotes((n) => quantizeNotes(n, picked, grid, span)); } else if (mod && k.toLowerCase() === 'e' && picked.size) { setNotes((n) => splitNotes(n, picked, clip ? -1 : beat, grid)); } else if (mod && k.toLowerCase() === 'j' && picked.size > 1) { setNotes((n) => joinNotes(n, picked)); } else if (mod && k.toLowerCase() === 'l' && picked.size && !clip) {
      // Loop the bars the picked notes are in.
      const first = Math.min(...pickedNotes.map((x) => x.start));
      const last = Math.max(...pickedNotes.map((x) => x.start + x.length));
      setRange({ a: Math.floor(first / BEATS_PER_BAR), b: Math.max(Math.floor(first / BEATS_PER_BAR), Math.ceil(last / BEATS_PER_BAR) - 1) });
      setLoop(true);
    } else if (k === 'Escape') { setPicked(new Set()); } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // While a note is dragged, the picked notes are drawn where they would land.
  const dragShift = gesture?.kind === 'move' && gesture.moved ? { db: gesture.db, dr: gesture.dr } : null;
  const dragStretch = gesture?.kind === 'stretch' ? gesture.dl : 0;
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

  // What Mobius changed: one floating bar under the tracks (the panel look), the clips themselves dashed. Why opens
  // what was asked under it.
  const proposal = changed.size > 0 && !working ? (
    <ChangeBar floating who={`Mobius ${before === null ? 'made' : 'changed'} ${names.join('; ')}`}
      why={<>{review && <WhyThis conversation={review.conversation} file={file ?? undefined} />} <span>Notes, never audio: each is yours to edit.</span></>}
      onKeep={keep} onDiscard={discard} />
  ) : null;
  const stopOrRewind = () => { if (playing || counting.current) stop(); else seek(0); };
  // With the computer keyboard on, its keys play the chosen track, ahead of the page's letter keys.
  playKeys.current = (e) => {
    const k = e.key.toLowerCase();
    if (!keyboard || !track || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === 'z' || k === 'x') { setKeyOctave((o) => Math.max(0, Math.min(8, o + (k === 'z' ? -1 : 1)))); return true; }
    if (k === 'c' || k === 'v') { setKeyVelocity((v) => nudgeKeyVelocity(v, k === 'c' ? -1 : 1)); return true; }
    const pitch = drums ? keyboardDrum(k, DRUMS_UP.map((d) => d.pitch)) : keyboardPitch(k, keyOctave);
    if (pitch === null) return false;
    if (!e.repeat) {
      // Held on the armed (chosen) track until the key lifts, as a MIDI key; a short preview without the engine.
      if (track.id === selected && pressKey(pitch, keyVelocity / 127)) pressed.current.set(k, pitch);
      else previewOn(track, pitch, keyVelocity / 127, 0.45, track.pads?.[pitch]);
      setHeld((h) => new Map(h).set(k, pitch));
      if (recording && player.current) takeKeys.current.set(k, { pitch, start: player.current.beat(), velocity: keyVelocity / 127 });
    }
    return true;
  };
  finishKey.current = (k) => {
    const held = takeKeys.current.get(k);
    if (!held) return;
    takeKeys.current.delete(k);
    const p = player.current;
    if (!p || !song) return;
    const note = recordedNote(held, p.beat(), cycleFor(song), song.bars * BEATS_PER_BAR);
    if (note) setNotes((n) => addNote(n, note), take.current);
  };
  finishAll.current = () => { for (const k of [...takeKeys.current.keys()]) finishKey.current?.(k); };
  /** Record (F9): plays from the playhead with the computer keyboard on, writing what is played into the chosen track. */
  const record = () => {
    const audio = track?.kind === 'audio';
    if (recording) { if (audio) recordInput(false); finishAll.current?.(); setRecording(false); return; }
    if (view !== 'arrange' || !track) return;
    // An audio track records its input through the engine; it says first when it has none to hear.
    if (audio && armed?.track === track.id && armed.input === null) { setExported({ text: armed.problem ?? 'There is no sound input to record from.', kind: 'note' }); return; }
    take.current = `record:${Date.now()}`;
    if (!audio) setKeyboard(true);
    setRecording(true);
    page.current?.focus();
    if (playing) { if (audio) recordInput(true); return; }
    const go = () => { start(); if (audio) recordInput(true); };
    if (!counts) { go(); return; }
    // The count-in: a bar of ticks, then the song plays from the playhead and what is played is written.
    const bar = countIn(song.tempo, BEATS_PER_BAR);
    counting.current = bar;
    void bar.done.then(() => { if (counting.current !== bar) return; counting.current = null; go(); });
  };
  /** Renders the whole song, every track through its devices and volume line plus a short tail, and saves it as a WAV in the song's Exports folder. */
  /** Renders every heard track, return and Main into its own WAV, all the same length, in the song's Exports folder
   *  (Live 12 manual 5.1.3.1, Rendered Track: All Individual Tracks); a silent track gets no file. */
  const exportStems = async () => {
    if (exporting || !songs.page) return;
    const engine = (await engineReady()) ? (window.mobius?.music as (NonNullable<typeof window.mobius>['music'] & { renderStems?: RenderStems }) | undefined) : undefined;
    if (!engine?.renderStems) { setExported({ text: engine ? 'Exporting stems needs a newer Mobius desktop app.' : 'Export needs the Mobius desktop app.', kind: 'note' }); return; }
    setExporting(true);
    const name = songs.page.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Song';
    setExported({ text: `Exporting the tracks of “${name}”…`, kind: 'busy', progress: 0 });
    try {
      const done = await engine.renderStems(songs.page.path, name, song);
      if (!done.ok) { setExported({ text: `Couldn’t export: ${done.message}`, kind: 'note' }); return; }
      const over = done.files.filter((f) => f.over).length;
      const loud = over ? ` ${over === 1 ? 'One peaks' : `${over} peak`} over 0 dB, so ${over === 1 ? 'it' : 'they'} will clip if made 16 or 24-bit.` : '';
      setExported({ text: `Exported ${done.files.length} ${done.files.length === 1 ? 'track' : 'tracks'} to ${done.saved}.${loud}`, kind: 'done' });
    } catch (err) {
      setExported({ text: `Couldn’t export: ${err instanceof Error ? err.message : String(err)}`, kind: 'note' });
    } finally { setExporting(false); }
  };
  const exportEntries: MenuEntry[] = [
    { label: 'Export Main as WAV', keys: 'Ctrl+Shift+E', disabled: exporting || song.tracks.length === 0, run: () => void exportWav() },
    { label: 'Export All Tracks as WAVs (stems)', disabled: exporting || song.tracks.length === 0, run: () => void exportStems() },
  ];
  const exportWav = async () => {
    if (exporting || !songs.page) return;
    const engine = (await engineReady()) ? window.mobius?.music : undefined;
    if (!engine) { setExported({ text: 'Export needs the Mobius desktop app.', kind: 'note' }); return; }
    setExporting(true);
    const name = `${songs.page.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Song'}.wav`;
    setExported({ text: `Exporting “${name}”…`, kind: 'busy', progress: 0 });
    const stop = new AbortController();
    exportStop.current = stop;
    try {
      // The engine renders and saves in one step, at 32-bit float (as Live renders).
      const done = await engine.render(songs.page.path, name, song);
      if (stop.signal.aborted) throw new Error('stopped');
      // A 32-bit float file keeps anything over 0 dB; say so, as it clips once made into 16 or 24-bit.
      const loud = done && 'saved' in done && (done.over ?? 0) > 0 ? ` It peaks at +${(done.peakDb ?? 0).toFixed(1)} dB, so it will clip if made 16 or 24-bit.` : '';
      if (done && 'saved' in done) setExported({ text: `Exported “${done.name}” to ${done.saved.split('/')[0]}.${loud}`, kind: 'done' });
      else setExported({ text: done && 'message' in done ? `Couldn’t export: ${done.message}` : 'Couldn’t export the song.', kind: 'note' });
    } catch (err) {
      if (stop.signal.aborted) setExported({ text: `Didn’t export “${name}”`, kind: 'note' });
      else setExported({ text: `Couldn’t export: ${err instanceof Error ? err.message : String(err)}`, kind: 'note' });
    } finally { setExporting(false); exportStop.current = null; }
  };
  pageKeys.current = (e, t) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && e.shiftKey && !e.altKey && k === 'e') { void exportWav(); return true; }
    if (!mod && !e.altKey && e.key === 'F9') { record(); return true; }
    if (!mod && !e.altKey && k === 'a' && view === 'arrange') { setShowAuto((a) => !a); return true; }
    if (!mod && !e.altKey && k === 'l') { setLoop((l) => !l); return true; }
    if (!mod && !e.altKey && k === 'b' && editing && detail === 'notes' && drumView !== 'steps') { setDraw((d) => !d); return true; }
    if (!mod && !e.altKey && k === 'k') { setClick((c) => !c); return true; }
    // Alt+1 and Alt+2 switch between Session and Arrange from anywhere; Tab does too while the focus is on the page or
    // the timeline itself, not on a clip or a control (where Tab moves on as usual).
    if (e.altKey && !mod && !e.shiftKey && (e.key === '1' || e.key === '2')) { setView(e.key === '1' ? 'session' : 'arrange'); return true; }
    if (e.key === 'Tab' && !e.shiftKey && !mod && !e.altKey && (t === page.current || t.classList.contains('studio-arrange'))) { setView((v) => (v === 'session' ? 'arrange' : 'session')); return true; }
    // Shift+Tab switches the bottom area between the chosen track's notes and its devices, opening it if it's shut.
    if (e.key === 'Tab' && e.shiftKey && !mod && !e.altKey && track) { if (!editing) { setEditing(true); setDetail('device'); } else setDetail((d) => (d === 'notes' ? 'device' : 'notes')); return true; }
    if (track && clip && clipAt !== null && t.closest('.studio-session')) {
      if (mod && k === 'd') { duplicateClip(track.id, clipAt); return true; }
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) { deleteClip(track.id, clipAt); return true; }
    }
    if (!track || !t.closest('.studio-tracks')) return false;
    if (mod && k === 'd') { duplicateTrack(track.id); return true; }
    if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) { deleteTrack(track.id); return true; }
    if (!mod && k === 'm') { setTrack(track.id, (v) => { v.muted = !v.muted; }); return true; }
    if (!mod && k === 's') { setTrack(track.id, (v) => { v.solo = !v.solo; }); return true; }
    if (!mod && e.key === 'Enter' && t.tagName !== 'BUTTON') { openNotes(track.id); return true; }
    return false;
  };
  const ticks = Math.max(1, [1, 2, 4, 8, 16].find((n) => n * BEATS_PER_BAR * bw >= 56) ?? 16);

  // The chosen track's clip notes or devices (Shift+Tab switches), as the bottom panel, as Ableton keeps them under
  // the arrangement. It is there while a track is open in it; hiding it closes it, so the next track opens it again.
  /**
   * The Library's Enter or double-click: a sound or kit replaces the chosen track's (hot-swap) when the kinds match
   * (melodic onto melodic, a kit onto drums), else it comes in as a new track; an effect is added to the chosen track.
   * One Undo step either way.
   */
  const applyLibraryItem = (it: LibraryItem) => {
    if (it.effect) {
      if (!track) return;
      change((s) => { const t = s.tracks.find((x) => x.id === track.id); if (t) t.fx = [...(t.fx ?? []), newEffect(it.effect!, freshEffectId(t))]; });
      return;
    }
    const instrument = it.instrument!;
    const swap = track && (track.instrument === 'drums') === (instrument === 'drums') ? track.id : null;
    change((s) => {
      let t = swap ? s.tracks.find((x) => x.id === swap) : undefined;
      if (!t) {
        t = { id: freshTrackId(s), name: it.name, instrument, volume: 0.8, pan: 0, muted: false, solo: false, color: nextColour(s.tracks), clips: [] };
        s.tracks.push(t);
      }
      t.instrument = instrument;
      if (it.sound) t.sound = { ...it.sound }; else delete t.sound;
      if (it.kit) t.kit = { ...it.kit }; else if (instrument === 'drums') delete t.kit;
      setSelected(t.id);
    });
  };
  const mixerPanel: PanelSpec = { id: 'mixer', name: 'Mixer', dock: 'bottom', group: 'bottom', keys: 'mod+alt+m', size: 300, reveal: mixerReveal, render: () => (
    <StudioMixer song={song} selected={track?.id ?? null} onSelect={setSelected} setTrack={setTrack} setSong={change} source={mixSource} playing={playing} />
  ) };
  // The Browser (Live 12's): the Library, Collections and Places in one panel; the songs list is its Songs place.
  const songsList = listPanels[0];
  const libraryPanel: PanelSpec = { id: 'library', name: 'Browser', dock: 'left', shown: true, size: 420, keys: 'mod+alt+b', render: () => (
    <StudioLibrary songKey={song.key} target={track ? { name: track.name, drums: track.instrument === 'drums' } : null} onUse={applyLibraryItem} songs={songsList?.render()} />
  ) };
  const detailPanel: PanelSpec | null = editing && track ? { id: 'detail', name: detail === 'notes' ? 'Clip' : 'Devices', dock: 'bottom', group: 'bottom', shown: true, size: 340, reveal: detailReveal, onHide: () => setEditing(false), render: () => (
    <div ref={setEditorEl} className="studio-editor" data-instrument={track.instrument} style={{ '--tc': `var(--c-${track.color})` } as CSSProperties}>
      <div className="studio-roll-bar" role="toolbar" aria-label={detail === 'notes' ? 'Notes' : 'Devices'}>
        <span className="studio-roll-title"><span className="studio-dev-dot" aria-hidden="true" />{track.name}</span>
        {clip && clipAt !== null && detail === 'notes' && <>
          <input className="studio-clip-title" aria-label="Clip name" value={clip.name} maxLength={60} onChange={(e) => setClip(track.id, clipAt, (c) => { c.name = e.target.value; }, `clip-name:${track.id}:${clipAt}`)} />
          <Select inline label="Clip length" value={String(clip.bars)} choices={LENGTH_CHOICES} onChange={(b) => setClip(track.id, clipAt, (c) => { c.bars = Number(b); c.notes = c.notes.filter((n) => n.start < c.bars * BEATS_PER_BAR); })} />
        </>}
        {arrClip && detail === 'notes' && (
          // Live's Clip View loop settings for the Arrange clip opened: its start marker and loop, in beats of its own time.
          <span className="studio-clip-loop" role="group" aria-label={`Loop of ${arrClip.name ?? track.name}`}>
            <IconButton label="Loop clip" pressed={!!arrClip.loop} title={arrClip.loop ? 'Loop on: stretch the clip to repeat it (Ctrl+Up doubles the loop, Ctrl+Down halves it)' : 'Loop'} icon={<Icon d={ICONS.loop} />}
              onClick={() => editClips(track.id, (cs) => toggleClipLoop(cs, arrClip.id), '')} />
            <NumberField label="Start" value={arrClip.offset ?? 0} min={0} max={4096} step={0.25} bigStep={BEATS_PER_BAR} decimals={2} width={4}
              onChange={(v) => editClips(track.id, (cs) => setClipLoop(cs, arrClip.id, { offset: v }), `clip-offset:${arrClip.id}`)} />
            {arrClip.loop && <>
              <span className="ui-field-label" aria-hidden="true">Loop</span>
              <NumberField label="Loop start" hideLabel value={arrClip.loop.start} min={0} max={4096} step={0.25} bigStep={BEATS_PER_BAR} decimals={2} width={4}
                onChange={(v) => editClips(track.id, (cs) => setClipLoop(cs, arrClip.id, { loopStart: v }), `clip-loop:${arrClip.id}`)} />
              <span className="ui-field-label" aria-hidden="true">for</span>
              <NumberField label="Loop length" hideLabel value={arrClip.loop.end - arrClip.loop.start} min={0.25} max={4096} step={0.25} bigStep={BEATS_PER_BAR} decimals={2} width={4}
                onChange={(v) => editClips(track.id, (cs) => setClipLoop(cs, arrClip.id, { loopLength: v }), `clip-loop:${arrClip.id}`)} />
            </>}
          </span>
        )}
        <Segmented label="Show" value={detail} choices={DETAIL_VIEWS} onChange={setDetail} />
        {detail === 'notes' && (view === 'arrange' || clip) && <>
        <Segmented label="View" value={drumView} choices={STEP_VIEWS} onChange={setDrumView} />
        {drumView === 'steps' ? (
          <Select inline hideLabel label="Bar" value={String(Math.min(stepBar, spanBars - 1))} choices={Array.from({ length: spanBars }, (_, b) => ({ value: String(b), label: `Bar ${b + 1}` }))} onChange={(b) => setStepBar(Number(b))} />
        ) : <Select inline label="Grid" value={String(grid)} choices={GRID_CHOICES} onChange={(g) => setGrid(Number(g))} />}
        {drumView === 'steps' && !drums && <span className="studio-step-key">{song.key}</span>}
        {drumView === 'steps' && !drums && <Select inline hideLabel label="Range" value={String(octave)} choices={OCTAVE_CHOICES} onChange={(o) => setStepOct((all) => ({ ...all, [track.id]: Number(o) }))} />}
        {!drums && <Select inline label="Note length" value={String(drawLength)} choices={GRID_CHOICES} onChange={(g) => setDrawLength(Number(g))} />}
        {!(drumView === 'steps') && <IconButton label="Draw" keys="B" pressed={draw} title={draw ? 'Draw mode: drag to write notes a grid step long, or drag over notes to take them out' : 'Draw mode'} icon={<Icon d={ICONS.draw} />} onClick={() => setDraw((d) => !d)} />}
        {!(drumView === 'steps') && <Menu label="Transform" trigger={<Button kind="quiet" title={picked.size ? 'Change the picked notes' : 'Change all the notes'} icon={<Icon d={ICONS.transform} />}>Transform</Button>} entries={transformEntries(drums, (fn) => setNotes((n) => fn(n, picked)), grid, span, song.key)} />}
        <span className="studio-gap" />
        {velocity !== null && !(drumView === 'steps') ? (
          <span className="studio-picked-group">
            <span className="studio-picked">{pickedNotes.length === 1 ? <>{drums ? (DRUMS.find((d) => d.pitch === pickedNotes[0]!.pitch)?.name ?? '') : noteName(pickedNotes[0]!.pitch)} at <span className="studio-mono">{position(pickedNotes[0]!.start, song.tempo).bars}</span></> : <><span className="studio-mono">{pickedNotes.length}</span> notes</>}</span>
            <span className="ui-field-label" aria-hidden="true">Velocity</span>
            <Slider className="studio-velocity" label="Velocity" hideLabel hideValue value={Math.round(velocity * 100) / 100} min={0} max={1} step={0.01} format={(v) => String(Math.round(v * 127))} onChange={(v) => setNotes((n) => setVelocity(n, picked, v), 'velocity')} />
            <span className="studio-mono studio-vel-value" aria-hidden="true">{Math.round(velocity * 127)}</span>
            <span className="studio-picked-sep" aria-hidden="true" />
            <Button kind="quiet" danger aria-label="Delete notes" title="Delete" keys="Delete" onClick={() => { setNotes((n) => removeNotes(n, picked)); setPicked(new Set()); }}>Delete</Button>
          </span>
        ) : null}
        </>}
      </div>
  {detail === 'device' && benchFx ? (
    <StudioWorkbench device={benchFx.kind === 'device' ? benchFx.device : builtinDevice(benchFx)} builtIn={benchFx.kind !== 'device'} on={benchFx.on} color={track.color}
      levelOf={(part) => (session.current ?? player.current)?.level?.(track.id, benchFx.id, part) ?? null} onClose={() => setBench(null)} />
  ) : detail === 'device' ? (
    <StudioDevice track={track} songPath={songs.page?.path ?? ''} proposed={proposedKeys} onOpen={(fx) => setBench({ track: track.id, fx })} onTrack={(fn, tag) => setTrack(track.id, fn, tag ? `${tag}:${track.id}` : '')} />
  ) : view === 'session' && !clip ? (
    <p className="studio-dev-note studio-pick-clip">Pick a clip to see its notes, or click an empty slot to make one.</p>
  ) : drumView === 'steps' ? (
    <div className="studio-steps">
      <p className="studio-dev-note studio-steps-hint">{drums ? 'Click a step to switch it on or off, Shift+click for an accent.' : 'Rows are the notes of the key. Click a step to play that note there, Shift+click for an accent.'}</p>
      <StepGrid fill label={`Steps of ${track.name}, bar ${Math.min(stepBar, spanBars - 1) + 1}`} rows={stepRows} cells={stepCells(notes, Math.min(stepBar, spanBars - 1), stepRows.map((r) => Number(r.id)))}
        now={playing && rollBeat >= 0 && Math.floor(rollBeat / BEATS_PER_BAR) === Math.min(stepBar, spanBars - 1) ? Math.floor((rollBeat % BEATS_PER_BAR) * 4) : undefined}
        onChange={(row, step, v) => {
          const pitch = Number(stepRows[row]!.id);
          if (v > 0) { previewOn(track, pitch, v, drums ? undefined : 0.3, track.pads?.[pitch]); }
          setNotes((n) => setStep(n, Math.min(stepBar, spanBars - 1), pitch, step, v, drums ? 0.25 : drawLength), 'steps');
        }} />
    </div>
  ) : <>
  {/* How to draw, while there is nothing drawn yet; the bar keeps to controls so none of them is cut short. */}
  {notes.length === 0 && <p className="studio-dev-note studio-roll-hint">{draw ? 'Drag along a row to write a note in each grid step, or start on a note to take notes out. B leaves draw mode.' : 'Click to draw a note, drag to move it, drag its end to stretch it. B draws a run of notes.'}</p>}
  <div className="studio-roll" ref={roll} data-own-keys="mod+j" role="grid" aria-label={`Notes of ${track.name}`} aria-multiselectable="true" tabIndex={0} onKeyDown={onRollKey} onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}>
    <div
      className="studio-roll-inner" data-draw={draw || undefined}
      ref={inner}
      style={{ width: keysW + span * rbw, height: rows.length * rowH, ['--row' as string]: `${rowH}px`, ['--keys' as string]: `${keysW}px` }}
      onPointerDown={onRollDown}
      onPointerMove={onRollMove}
      onPointerUp={onRollUp}
      onPointerCancel={() => { setGesture(null); setBox(null); }}
    >
      {rows.map((r, i) => (
        <div key={r.pitch} className="studio-row" role="row" data-shade={r.shade || undefined} data-black={r.black || undefined} style={{ top: i * rowH, height: rowH }}>
          <span className="studio-key" role="rowheader" data-black={r.black || undefined} data-c={r.c || undefined} data-drum={drums || undefined} data-on={heldPitches.has(r.pitch) || undefined} onPointerDown={(e) => { e.stopPropagation(); previewOn(track, r.pitch, undefined, undefined, track.pads?.[r.pitch]); }}>{r.label}</span>
          <div
            className="studio-row-cells"
            role="gridcell"
            aria-label={`${r.label} row`}
            style={{ width: span * rbw, backgroundSize: `${rbw * grid}px 100%, ${rbw}px 100%, ${rbw * BEATS_PER_BAR}px 100%` }}
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
            {echoes.map((n, j) => (n.pitch !== r.pitch ? null : (
              <span key={`e${j}`} className="studio-note" data-echo aria-hidden="true" data-instrument={track.instrument}
                style={{ left: n.start * rbw, width: Math.max(4, n.length * rbw - 1), ['--vel' as string]: n.velocity }} />
            )))}
          </div>
        </div>
      ))}
      {box && (() => {
        const [b0, b1] = box.b0 < box.b1 ? [box.b0, box.b1] : [box.b1, box.b0];
        const [r0, r1] = box.r0 < box.r1 ? [box.r0, box.r1] : [box.r1, box.r0];
        return <span className="studio-box" style={{ left: keysW + b0 * rbw, width: (b1 - b0) * rbw, top: r0 * rowH, height: (r1 - r0 + 1) * rowH }} aria-hidden="true" />;
      })()}
      {rollBeat >= 0 && <span className="studio-playhead" style={{ left: keysW + rollBeat * rbw }} aria-hidden="true" />}
    </div>
  </div>
  <div className="studio-vel" role="group" aria-label={`Velocity of ${track.name}`} style={{ height: VEL_H, ['--keys' as string]: `${keysW}px` }}>
    <span className="studio-vel-label" aria-hidden="true">Velocity</span>
    <div className="studio-vel-inner" style={{ width: span * rbw, transform: `translateX(${-scrollX}px)`, backgroundSize: `${rbw}px 100%, ${rbw * BEATS_PER_BAR}px 100%` }} onPointerMove={onVelMove} onPointerUp={onVelUp} onPointerCancel={() => setVelDrag(null)}>
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
      {rollBeat >= 0 && <span className="studio-playhead" style={{ left: rollBeat * rbw }} aria-hidden="true" />}
    </div>
  </div>
  </>}
    </div>
  ) } : null;
  return (
    <section className="studio-page" aria-label="Music" ref={page} tabIndex={-1} data-editing={editing || undefined}>
      {keyboard && <span className="studio-sr" role="status">{`Computer keyboard from C${keyOctave}, velocity ${keyVelocity}`}</span>}
      <ToolbarControls label="Transport">
        {/* Left to right as in a studio: the view, the transport, then tempo. The view, the transport and the tempo
            never drop into the ⋯ menu when the toolbar is short of room; the rest may. */}
        <ViewSwitch label="View" views={VIEWS} value={view} onChange={setView} />
        <span className="studio-sep" aria-hidden="true" />
        <ToolbarItem priority="keep">
          <Transport playing={playing} onPlay={() => (playing ? stop() : start())} onStop={stopOrRewind}
            recording={recording} onRecord={view === 'arrange' && track ? record : undefined}
            loop={loop} onLoop={() => setLoop((l) => !l)} metronome={click} onMetronome={() => setClick((c) => !c)}
            keys={{ play: 'Space', stop: 'Enter', record: 'F9', loop: 'L', metronome: 'K' }} />
        </ToolbarItem>
        <span className="studio-sep" aria-hidden="true" />
        {/* One mono readout, as Live's control bar reads: position · tempo · metre · key. */}
        <ToolbarItem priority="keep">
          <span className="studio-readouts" role="group" aria-label="Song">
            <span className="studio-readout studio-pos" aria-label="Position" role="status" title={pos.time}>{pos.bars.split('.').join(' . ')}</span>
            <span className="studio-readout-dot" aria-hidden="true">·</span>
            <label className="studio-readout studio-tempo" title="Tempo, in beats per minute">
              <input aria-label="Tempo" type="number" min={30} max={300} value={song.tempo} onChange={(e) => { const v = Number(e.target.value); if (v >= 30 && v <= 300) change((s) => { s.tempo = Math.round(v); }, 'tempo'); }} />
              <span aria-hidden="true">bpm</span>
            </label>
            <span className="studio-readout-dot" aria-hidden="true">·</span>
            <span className="studio-readout" title="Every song is in 4 / 4 for now">4/4</span>
            <span className="studio-readout-dot" aria-hidden="true">·</span>
            <Select label="Key" hideLabel quiet value={song.key} choices={KEY_CHOICES} onChange={(key) => change((s) => { s.key = key; }, 'key')} />
          </span>
        </ToolbarItem>
        <ToolbarItem priority="keep">
          <TapTempo icon={TOOL_ICONS.tap} onTempo={(bpm) => change((s) => { s.tempo = Math.round(bpm); }, 'tempo')} min={30} max={300} />
        </ToolbarItem>
        <span className="studio-sep" aria-hidden="true" />
        <IconButton label="Mixer" keys="Ctrl+Alt+M" title="Mixer: a strip per track, with meters" icon={TOOL_ICONS.mixer} onClick={() => setMixerReveal((n) => n + 1)} />
        {view === 'arrange' && <IconButton label="Automation" keys="A" pressed={showAuto} title={showAuto ? 'Hide automation' : 'Automation: a volume line under each track'} icon={TOOL_ICONS.automation} onClick={() => setShowAuto((a) => !a)} />}
        <IconButton label="Computer keyboard" pressed={keyboard}
          title={keyboard ? `Playing from the computer keyboard: A S D F… from C${keyOctave}, velocity ${keyVelocity} (Z X octave, C V velocity)` : 'Play notes from the computer keyboard'}
          icon={<Icon d={ICONS.keys} />} onClick={() => { setKeyboard((on) => !on); page.current?.focus(); }} />
        {keyboard && <span className="studio-keys-at" title="Note and velocity: the note held, else the one A plays. Z and X change octave, C and V velocity"><Readout label="Note and velocity" width={7} formats={[{ name: 'Note', text: `${heldName ?? `C${keyOctave}`} ${keyVelocity}` }]} /></span>}
        {/* Export is the first to drop into the ⋯ menu, where it keeps its shortcut. */}
        <ToolbarItem priority="low" menu={exportEntries}>
          {/* Export, as Live's Rendered Track: Main (every track mixed down) or each track on its own. */}
          <Menu label="Export" entries={exportEntries} trigger={<IconButton label="Export" disabled={exporting || song.tracks.length === 0} title={exporting ? 'Exporting…' : 'Export as WAV: Main, or every track on its own'} icon={TOOL_ICONS.export} />} />
        </ToolbarItem>
      </ToolbarControls>
      <PanelLayout app="studio" panels={[libraryPanel, ...(detailPanel ? [detailPanel] : []), mixerPanel]}>
      <div className="studio-main">
        {view === 'arrange' && song.tracks.length > 0 && (
          <header className="studio-arrange-head">
            <h2 className="studio-arrange-title">Arrangement</h2>
            <span className="studio-arrange-sum">{song.tracks.length} track{song.tracks.length === 1 ? '' : 's'} · {song.bars} bar{song.bars === 1 ? '' : 's'}</span>
          </header>
        )}
        <div ref={arrangeEl} className="studio-arrange" data-empty={song.tracks.length === 0 || undefined} style={{ ['--head' as string]: `${HEAD_W}px`, ['--bar' as string]: `${BEATS_PER_BAR * bw}px` }}
          onWheel={(e) => { if (!(e.ctrlKey || e.metaKey)) { following.current = false; return; } e.preventDefault(); setZoom((z) => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + (e.deltaY < 0 ? 1 : -1)))] ?? z); }}>
          {view === 'session' ? (<>
            <SessionGrid song={song} selected={track?.id ?? null} chosen={clipAt} playing={sessionNow.playing} queued={sessionNow.queued} beat={beat}
              onSelect={(id) => { setSelected(id); setClipAt(null); }} onChoose={chooseClip} onCreate={createClip} onLaunch={launch} onLaunchScene={launchScene}
              onStopAll={stopAll} onSceneName={setSceneName} onAddScene={addScene} onClipMenu={clipMenu} />
            {proposal && <div className="studio-float">{proposal}</div>}
          </>) : <>
          <div className="studio-ruler-row">
            <div className="studio-ruler-head" />
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
              title="Click to move the playhead. Drag along the top to loop some bars. Right-click for the song's length and zoom."
              onPointerDown={onRulerDown}
              onPointerMove={onRulerMove}
              onPointerUp={(e) => { if (loopDrag.current && !loopDrag.current.moved) lastZonePress.current = e.timeStamp; loopDrag.current = null; }}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, label: 'Loop', items: [
              { label: 'Loop Whole Song', disabled: loop && !range, run: () => { setRange(null); setLoop(true); } },
              { label: loop ? 'Turn Loop Off' : 'Turn Loop On', keys: 'L', run: () => setLoop((l) => !l) },
              { label: click ? 'Turn Metronome Off' : 'Turn Metronome On', keys: 'K', run: () => setClick((c) => !c) },
              { label: counts ? 'Turn Count-In Off' : 'Turn Count-In On', run: () => setCounts((c) => { try { window.localStorage.setItem(COUNT_IN_KEY, c ? '0' : '1'); } catch { /* not kept */ } return !c; }) },
              // The metronome's and count-in's level, apart from Main (also on the Mixer's Main strip); the one in use is greyed.
              ...[1, METRONOME_VOLUME, 0.5, 0.25].map((v, i) => ({ label: `Metronome Volume ${Math.round(v * 100)}%`, separated: i === 0, disabled: Math.abs((song.metronome?.volume ?? METRONOME_VOLUME) - v) < 0.005, run: () => change((s) => { s.metronome = { volume: v }; }, 'metronome') })),
              { label: 'Add 4 Bars', separated: true, disabled: song.bars >= 512, run: () => change((s) => { s.bars = Math.min(512, s.bars + 4); }) },
              { label: 'Remove Last 4 Bars', disabled: song.bars <= 4, run: () => change((s) => { s.bars = Math.max(4, s.bars - 4); }) },
              { label: 'Zoom In', separated: true, disabled: zoom >= ZOOMS[ZOOMS.length - 1]!, run: () => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? z) },
              { label: 'Zoom Out', disabled: zoom <= ZOOMS[0]!, run: () => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? z) },
            ] }); }}
              onPointerCancel={() => { loopDrag.current = null; }}
              onKeyDown={(e) => { if (e.key === 'ArrowRight') seek(Math.min(total - 1, Math.floor(beat) + (e.shiftKey ? 1 : BEATS_PER_BAR))); else if (e.key === 'ArrowLeft') seek(Math.max(0, Math.floor(beat) - (e.shiftKey ? 1 : BEATS_PER_BAR))); else return; e.preventDefault(); }}
            >
              <span className="studio-cycle-zone" aria-hidden="true" />
              {cycle && <span className="studio-cycle" role="img" aria-label={`Loop: ${loopWords}`} data-part={range ? true : undefined} style={{ left: cycle.from * bw, width: (cycle.to - cycle.from) * bw }} />}
              {Array.from({ length: Math.ceil(song.bars / ticks) }, (_, k) => k * ticks).map((b) => <span key={b} className="studio-ruler-bar" style={{ left: b * BEATS_PER_BAR * bw }}>{b + 1}</span>)}
            </div>
          </div>
          <div className="studio-tracks" role="list" aria-label="Tracks" style={{ ['--grid' as string]: `${ticks * BEATS_PER_BAR * bw}px` }}>
            {song.tracks.map((t, n) => (
              <div key={t.id} role="listitem" aria-label={t.name} tabIndex={-1} className="studio-track" style={{ '--tc': `var(--c-${t.color})` } as CSSProperties} aria-current={track?.id === t.id || undefined} data-instrument={t.instrument} data-muted={(t.muted || (song.tracks.some((x) => x.solo) && !t.solo)) || undefined} onClick={() => setSelected(t.id)}>
                <div className="studio-track-head" onContextMenu={(e) => { e.preventDefault(); setSelected(t.id); trackMenu(t, e.clientX, e.clientY); }} onDoubleClick={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') openDevice(t.id); }}>
                  <span className="studio-track-no" aria-hidden="true">{String(n + 1).padStart(2, '0')}</span>
                  <input className="studio-track-name" aria-label="Track name" value={t.name} maxLength={60} onChange={(e) => setTrack(t.id, (x) => { x.name = e.target.value; }, `name:${t.id}`)} />
                  {!t.kind && t.name !== INSTRUMENT_NAMES[t.instrument] && <span className="studio-track-sub">{INSTRUMENT_NAMES[t.instrument]}</span>}
                  {t.kind === 'sampler' && <span className="studio-track-sub" title={t.sampler?.file}>{t.sampler ? sampleName(t.sampler.file) : 'No sample'}</span>}
                  {t.kind === 'audio' && armed?.track === t.id && (armed.input !== null
                    ? <span className="studio-track-sub" title="The sound input this track hears and records">{armed.input}</span>
                    : <span className="studio-track-sub" data-problem title={armed.problem ?? 'No sound input'}>No input</span>)}
                  <div className="studio-track-buttons" data-on={t.muted || t.solo || undefined}>
                    <button type="button" className="studio-ms" aria-label={`Mute ${t.name}`} title="Mute (M)" aria-pressed={t.muted} onClick={(e) => { e.stopPropagation(); setTrack(t.id, (x) => { x.muted = !x.muted; }); }}>M</button>
                    <button type="button" className="studio-ms" aria-label={`Solo ${t.name}`} title="Solo (S)" aria-pressed={t.solo} onClick={(e) => { e.stopPropagation(); setTrack(t.id, (x) => { x.solo = !x.solo; }); }}>S</button>
                  </div>
                </div>
                <div className="studio-lane" style={{ width: total * bw }}>
                  <Clips track={t} proposed={changed.has(t.id) && notesDiffer(wasSong?.tracks.find((w) => w.id === t.id), t)} bw={bw} songPath={songs.page?.path ?? ''} tempo={song.tempo} onOpen={(from, id) => openNotes(t.id, from, id)} actions={clipActions(t.id)} />
                </div>
                {showAuto && <>
                  <div className="studio-auto-head" aria-hidden="true"><span className="studio-auto-name">Volume</span></div>
                  <AutomationLane className="studio-auto" label="Volume" head={false} color={t.color} points={t.volumeAuto ?? []} beats={total} pxPerBeat={bw} empty={t.volume}
                    onChange={(next) => setTrack(t.id, (x) => { if (next.length) x.volumeAuto = next; else delete x.volumeAuto; }, `auto:${t.id}`)} />
                </>}
              </div>
            ))}
            <div className="studio-add-row">
              <Button kind="quiet" className="studio-add" icon={<Icon d="M10 4.5v11M4.5 10h11" />} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); soundsMenu(r.left, r.bottom); }}>Add track</Button>
              {song.tracks.length === 0 && <span className="studio-none">No tracks yet.</span>}
            </div>
            {/* Under the tracks, centred on what is in view however far the arrangement scrolls. */}
            <span className="studio-playhead" style={{ left: HEAD_W + beat * bw }} aria-hidden="true" />
          </div>
          {/* Under the tracks, outside them so the playhead never crosses it, centred on what is in view. */}
          {proposal && <div className="studio-float" style={{ width: laneW + HEAD_W }}>{proposal}</div>}
          </>}
        </div>
      </div>
      </PanelLayout>
      {exported && <UndoToast text={exported.text} progress={exported.progress}
        undoLabel={exported.kind === 'done' ? 'Show in folder' : 'Cancel'}
        onUndo={exported.kind === 'note' ? undefined : () => { if (exported.kind === 'done') void window.mobius?.songs?.showExports?.(); else exportStop.current?.abort(); setExported(null); }}
        onDismiss={() => setExported(null)} />}
      {undoText && <UndoToast text={undoText} onUndo={() => { undo(); setUndoText(null); }} onDismiss={() => setUndoText(null)} />}
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onClose={() => setMenu(null)} />, document.body)}
    </section>
  );
}

