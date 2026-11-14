import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { newItemIn, type SidebarWords } from './NotesSidebar';
import { EmptyState } from './EmptyState';
import { BEATS_PER_BAR, COLOUR_NAMES, DRUMS, INSTRUMENTS, INSTRUMENT_NAMES, KEYS, KIT_DEFAULTS, EFFECT_KINDS, EFFECT_NAMES, EFFECT_PARAMS, freshEffectId, newEffect, type Effect, type EffectKind, KIT_RANGE, kitOf, TRACK_COLOURS, nextColour, SOUND_DEFAULTS, SOUND_RANGE, changedTracks, freshTrackId, keyPitches, noteName, parseSong, soundOf, writeSong, type Instrument, type Song, type SongNote, type KitSound, type Sound, type Track, type TrackColour } from './song-format';
import type { CSSProperties } from 'react';
import { play, previewNote, type Player } from './studio-audio';
import { GRIDS, addNote, clipsOf, effectText, cycleOf, duplicateNotes, fitTracks, nudgeVelocity, isBlack, moveNotes, notesIn, pasteNotes, position, quantizeNotes, removeNotes, setVelocity, snap, soundText, kitText, panText, stretchNotes, type Cycle, type Picked } from './studio-view';
import { AppSidebar, Button, Confirm, IconButton, Menu, Segmented, Switch, Swatches, PanelTab, ParamCell, ParamGrid, Select, SidebarRow, SidebarSearch, SidebarSection, Slider, ToolbarControls, UndoToast } from './ui';
import { SideNew } from './SideNew';
import { statusText } from './notes-state';
import { dayLabel, timeLabel, weekdayLabel } from './dates';
import { useFileReview } from './useFileReview';
import type { NotesState } from './useNotes';
import { ReviewActions, WhyThis } from './ReviewBar';
import { onCommand } from './commands';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import './studio.css';

export const STUDIO_WORDS: SidebarWords = { app: 'Music', group: 'folder', groups: 'Folders', item: 'song', items: 'songs', about: 'Songs are kept as JSON files in your workspace: tracks of notes, never audio, so the agent can read and write them like a score.', defaultGroup: 'Songs' };

/** The sidebar's Sounds put a track on the open song; the editor listens while it is on screen. */
const ADD_TRACK = 'mobius:studio-add-track';
const askToAddTrack = (instrument: Instrument) => window.dispatchEvent(new CustomEvent<Instrument>(ADD_TRACK, { detail: instrument }));
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
    <AppSidebar label="Music sidebar" className="studio-side">
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
          <SidebarRow key={pg.path} label={pg.title} current={false} onSelect={() => void songs.open(pg.path, pg.title)} trail={<span className="studio-to-review">to review</span>} />
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
  const setKey = (key: string) => { const next = structuredClone(song); next.key = key; songs.edit(writeSong(next)); };
  return (
    <>
      <Select label="Key" hideLabel quiet value={song.key} choices={KEY_CHOICES} onChange={setKey} />
      {' · '}<span className="note-status" role="status" data-status={songs.status}>{songs.message || statusText(songs.status)}</span>
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
/** The least room left for the note editor when the track list is made taller. */
const EDITOR_MIN = 200;

const Icon = ({ d, fill }: { d: string; fill?: boolean }) => <svg viewBox="0 0 20 20" aria-hidden="true" data-fill={fill || undefined}><path d={d} /></svg>;
const ICONS = {
  play: 'M6.5 4.2v11.6L15.8 10z',
  stop: 'M5.5 5.5h9v9h-9z',
  loop: 'M4 9V8a3 3 0 0 1 3-3h8l-2.2-2.2M16 11v1a3 3 0 0 1-3 3H5l2.2 2.2',
};

/** A track's notes as clips: solid blocks in the track's colour with the notes drawn small inside, dashed and unfilled while Mobius proposes them. */
function Clips({ track, bars, proposed, bw, onOpen }: { track: Track; bars: number; proposed: boolean; bw: number; onOpen: (fromBeat: number) => void }) {
  const clips = useMemo(() => clipsOf(track.notes, bars), [track.notes, bars]);
  const pitches = track.notes.map((n) => n.pitch);
  const lo = Math.min(...pitches, 127), hi = Math.max(...pitches, 0);
  const span = Math.max(1, hi - lo);
  const bar = BEATS_PER_BAR * bw;
  return (
    <>
      {clips.map((c) => {
        const from = c.from * BEATS_PER_BAR, to = c.to * BEATS_PER_BAR;
        const words = c.to - c.from === 1 ? `bar ${c.from + 1}` : `bars ${c.from + 1} to ${c.to}`;
        return (
          <button
            key={c.from}
            type="button"
            className="studio-clip"
            data-proposed={proposed || undefined}
            style={{ left: c.from * bar + 1, width: (c.to - c.from) * bar - 3 }}
            aria-label={`${track.name}, ${words}${proposed ? ', proposed by Mobius' : ''}`}
            title="Double-click to edit the notes"
            onDoubleClick={(e) => { e.stopPropagation(); onOpen(from); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen(from); } }}
          >
            <span className="studio-clip-notes" aria-hidden="true">
              {track.notes.filter((n) => n.start >= from && n.start < to).map((n, i) => (
                <span key={i} style={{ left: (n.start - from) * bw, width: Math.max(1, n.length * bw - 1), top: `${(1 - (n.pitch - lo) / span) * 85}%` }} />
              ))}
            </span>
            <span className="studio-clip-name">{track.name}</span>
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
  { name: 'Filter', cells: [['cutoff', 'Cutoff'], ['resonance', 'Resonance'], ['envAmount', 'Sweep']] },
  { name: 'Envelope', cells: [['attack', 'Attack'], ['decay', 'Decay'], ['sustain', 'Sustain'], ['release', 'Release']] },
  { name: 'Motion', cells: [['vibrato', 'Vibrato'], ['rate', 'Rate']] },
];
const KIT_CELLS: readonly { k: keyof KitSound; name: string; step: number; log?: boolean }[] = [
  { k: 'tune', name: 'Tune', step: 1 }, { k: 'decay', name: 'Decay', step: 0.01, log: true }, { k: 'tone', name: 'Tone', step: 0.01 },
];

/** One of the Device panel's settings, as the shared parameter cell. Double-click puts it back to the instrument's own. */
function DeviceSlider({ name, k, value, base, onChange }: { name: string; k: keyof Sound; value: number; base: number; onChange: (v: number) => void }) {
  const { lo, hi } = SOUND_RANGE[k];
  return <ParamCell size="compact" label={name} value={value} min={lo} max={hi} step={SOUND_STEP[k]} scale={LOG_SOUND.has(k) ? 'log' : 'linear'} reset={base} format={(v) => soundText(k, v)} onChange={onChange} />;
}

/** How an effect's setting reads: "+3.0 dB", "1.2 kHz", "4:1", "12 ms", "35%", "2.0 s". */
const EFFECT_CELLS: { [K in EffectKind]: readonly { k: string; name: string; step: number; log?: boolean; origin?: number }[] } = {
  eq: [{ k: 'low', name: 'Low', step: 0.5 }, { k: 'mid', name: 'Mid', step: 0.5 }, { k: 'midFreq', name: 'Mid freq', step: 10, log: true }, { k: 'high', name: 'High', step: 0.5 }],
  compressor: [{ k: 'threshold', name: 'Threshold', step: 1, origin: 0 }, { k: 'ratio', name: 'Ratio', step: 0.1, log: true }, { k: 'attack', name: 'Attack', step: 0.001, log: true }, { k: 'release', name: 'Release', step: 0.01, log: true }, { k: 'makeup', name: 'Makeup', step: 0.5 }],
  delay: [{ k: 'feedback', name: 'Feedback', step: 0.01 }, { k: 'mix', name: 'Mix', step: 0.01 }],
  reverb: [{ k: 'size', name: 'Size', step: 0.1, log: true }, { k: 'damp', name: 'Damp', step: 0.01 }, { k: 'mix', name: 'Mix', step: 0.01 }],
};
/** A delay's echo time, in beats, as note values (a beat is a quarter note). */
const EFFECT_DETAILS: { [K in EffectKind]: string } = {
  eq: 'Lifts or cuts the lows, mids and highs',
  compressor: 'Evens out loud and quiet notes',
  delay: 'Echoes that fade, in time with the song',
  reverb: 'Puts the track in a room or hall',
};
const DELAY_TIMES = [{ value: '0.25', label: '1/16' }, { value: '0.5', label: '1/8' }, { value: '0.75', label: '3/16' }, { value: '1', label: '1/4' }, { value: '1.5', label: '3/8' }, { value: '2', label: '1/2' }] as const;

/** One effect on the track: its name, on or off, moved up or down the chain or taken off, and its settings. */
function EffectBlock({ effect, at, count, onChange, onMove, onRemove }: {
  effect: Effect; at: number; count: number;
  onChange: (fn: (e: Effect) => void, tag?: string) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const name = EFFECT_NAMES[effect.kind];
  const values = effect as unknown as Record<string, number>;
  return (
    <section className="studio-fx" aria-label={name} data-off={!effect.on || undefined}>
      <div className="studio-fx-head">
        <Switch label={`${name} on`} hideLabel checked={effect.on} onChange={(on) => onChange((e) => { e.on = on; })} />
        <h5 className="studio-fx-name">{name}</h5>
        <IconButton label={`Move ${name} up`} disabled={at === 0} icon={<Icon d="M10 15V5M5.5 9.5 10 5l4.5 4.5" />} onClick={() => onMove(-1)} />
        <IconButton label={`Move ${name} down`} disabled={at === count - 1} icon={<Icon d="M10 5v10M5.5 10.5 10 15l4.5-4.5" />} onClick={() => onMove(1)} />
        <IconButton label={`Remove ${name}`} icon={<Icon d="M6 6l8 8M14 6l-8 8" />} onClick={onRemove} />
      </div>
      {effect.kind === 'delay' && (
        <Segmented label="Time" wide value={String(effect.time) as (typeof DELAY_TIMES)[number]['value']} choices={DELAY_TIMES} onChange={(v) => onChange((e) => { (e as Extract<Effect, { kind: 'delay' }>).time = Number(v); }, 'fx:time')} />
      )}
      <ParamGrid label={`${name} settings`}>
        {EFFECT_CELLS[effect.kind].map(({ k, name: cell, step, log, origin }) => {
          const r = EFFECT_PARAMS[effect.kind][k]!;
          return <ParamCell size="compact" key={k} label={cell} value={values[k]!} min={r.lo} max={r.hi} step={step} scale={log ? 'log' : 'linear'} origin={origin} reset={r.start} format={(v) => effectText(effect.kind, k, v)} onChange={(v) => onChange((e) => { (e as unknown as Record<string, number>)[k] = v; }, `fx:${k}`)} />;
        })}
      </ParamGrid>
    </section>
  );
}

const INSTRUMENT_CHOICES = INSTRUMENTS.map((i) => ({ value: i, label: INSTRUMENT_NAMES[i] }));
const KEY_CHOICES = KEYS.map((k) => ({ value: k, label: k }));
const GRID_CHOICES = GRIDS.map((g) => ({ value: String(g.beats), label: g.label }));

/**
 * The Device panel: how the chosen track sounds (its instrument, volume, oscillator, filter and envelope), and what
 * Mobius proposes for this song, to keep or discard. It sits as a tab beside Mobius in the right panel.
 */
export function StudioDevice({ track, onTrack, proposal }: {
  track: Track | null;
  onTrack: (fn: (t: Track) => void, tag?: string) => void;
  proposal: ReactNode;
}) {
  const sound = track ? soundOf(track) : null;
  const base = track && track.instrument !== 'drums' ? SOUND_DEFAULTS[track.instrument] : null;
  const kit = track ? kitOf(track) : null;
  const set = (k: keyof Sound, v: number) => onTrack((t) => { if (t.instrument === 'drums') return; t.sound = { ...(t.sound ?? SOUND_DEFAULTS[t.instrument]), [k]: v }; }, `sound:${k}`);
  const setKit = (k: keyof KitSound, v: number) => onTrack((t) => { if (t.instrument !== 'drums') return; t.kit = { ...(t.kit ?? KIT_DEFAULTS), [k]: v }; }, `kit:${k}`);
  return (
    <div className="studio-device" aria-label="Device" role="region">
      {track ? (
        <>
          <h3 className="studio-dev-title" style={{ '--tc': `var(--c-${track.color})` } as CSSProperties}>
            <span className="studio-dev-dot" aria-hidden="true" />{track.name === INSTRUMENT_NAMES[track.instrument] ? track.name : `${track.name} · ${INSTRUMENT_NAMES[track.instrument]}`}
          </h3>
          <div className="studio-dev-group">
            <Select className="studio-dev-row" label="Instrument" value={track.instrument} choices={INSTRUMENT_CHOICES} onChange={(i) => onTrack((t) => { t.instrument = i; delete t.sound; delete t.kit; })} />
            <div className="studio-colour-row"><span aria-hidden="true">Colour</span>
              <Swatches label="Colour" value={track.color} colors={TRACK_COLOURS} names={COLOUR_NAMES} onChange={(c) => onTrack((t) => { t.color = c as TrackColour; })} />
            </div>
          </div>
          <ParamGrid label="Level">
            <ParamCell size="compact" label="Volume" value={track.volume} min={0} max={1} step={0.01} reset={0.8} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onTrack((t) => { t.volume = v; }, 'volume')} />
            <ParamCell size="compact" label="Pan" value={track.pan} min={-1} max={1} step={0.01} reset={0} format={panText} onChange={(v) => onTrack((t) => { t.pan = v; }, 'pan')} />
          </ParamGrid>
          {sound && base && SOUND_GROUPS.map((g) => (
            <section key={g.name} className="studio-dev-section" aria-label={g.name}>
              <h4 className="studio-dev-head">{g.name}</h4>
              <ParamGrid label={g.name}>
                {g.cells.map(([k, name]) => <DeviceSlider key={k} name={name} k={k} value={sound[k]} base={base[k]} onChange={(v) => set(k, v)} />)}
              </ParamGrid>
            </section>
          ))}
          {kit && (
            <section className="studio-dev-section" aria-label="Kit">
              <h4 className="studio-dev-head">Kit</h4>
              <ParamGrid label="Kit">
                {KIT_CELLS.map(({ k, name, step, log }) => <ParamCell size="compact" key={k} label={name} value={kit[k]} min={KIT_RANGE[k].lo} max={KIT_RANGE[k].hi} step={step} scale={log ? 'log' : 'linear'} origin={KIT_DEFAULTS[k]} reset={KIT_DEFAULTS[k]} format={(v) => kitText(k, v)} onChange={(v) => setKit(k, v)} />)}
              </ParamGrid>
              <p className="studio-dev-note">Every drum in the kit, together. Each drum has its own row in the notes.</p>
            </section>
          )}
        </>
      ) : <p className="studio-dev-note">Add a track from Sounds in the sidebar to set how it sounds.</p>}
      {track && (
        <section className="studio-dev-section studio-fx-chain" aria-label="Effects">
          <h4 className="studio-dev-head">Effects</h4>
          {(track.fx ?? []).length === 0 && <p className="studio-dev-note">No effects on this track.</p>}
          {(track.fx ?? []).map((e, i, all) => (
            <EffectBlock key={e.id} effect={e} at={i} count={all.length}
              onChange={(fn, tag) => onTrack((t) => { const x = t.fx?.find((f) => f.id === e.id); if (x) fn(x); }, tag ? `${tag}:${e.id}` : undefined)}
              onMove={(by) => onTrack((t) => { const fx = t.fx ?? []; const j = fx.findIndex((f) => f.id === e.id); const to = j + by; if (j < 0 || to < 0 || to >= fx.length) return; [fx[j], fx[to]] = [fx[to]!, fx[j]!]; })}
              onRemove={() => onTrack((t) => { t.fx = (t.fx ?? []).filter((f) => f.id !== e.id); if (t.fx.length === 0) delete t.fx; })} />
          ))}
          <Menu label="Add effect" entries={EFFECT_KINDS.map((k) => ({ label: EFFECT_NAMES[k], detail: EFFECT_DETAILS[k], run: () => onTrack((t) => { t.fx = [...(t.fx ?? []), newEffect(k, freshEffectId(t))]; }) }))}
            trigger={<Button kind="quiet" icon={<Icon d="M10 4.5v11M4.5 10h11" />}>Add effect</Button>} />
        </section>
      )}
      {proposal}
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
  const [loop, setLoop] = useState(false);
  // The bars the loop goes round, as picked on the ruler (counted from 0); null loops the whole song.
  const [range, setRange] = useState<{ a: number; b: number } | null>(null);
  const loopDrag = useRef<{ a: number; moved: boolean } | null>(null);
  // When the top of the ruler was last let go after a press that did not drag, so a second press soon after can loop the whole song.
  const lastZonePress = useRef(0);
  const [menu, setMenu] = useState<{ x: number; y: number; label: string; items: ContextMenuItem[] } | null>(null);
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
  // The room for the lanes, so the whole song fits across the window until it is zoomed in.
  const [laneW, setLaneW] = useState(900);
  // A track's row and the ruler, from the density tokens (Music is compact), so the list can fit its tracks.
  const [rowSize, setRowSize] = useState({ lane: 32, ruler: 30 });
  // Whether the notes editor is open under the tracks; a double-click on a clip opens it.
  const [editing, setEditing] = useState(false);
  const [undoText, setUndoText] = useState<string | null>(null);
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    // The room under the transport, which can wrap onto two lines in a narrow window.
    const measure = () => {
      setPageH(el.clientHeight);
      setLaneW(Math.max(200, (el.querySelector<HTMLElement>('.studio-arrange')?.clientWidth ?? el.clientWidth) - HEAD_W - 12));
      const css = getComputedStyle(el);
      const lane = parseFloat(css.getPropertyValue('--row-list')) || 32, ruler = parseFloat(css.getPropertyValue('--row-h')) || 30;
      setRowSize((was) => (was.lane === lane && was.ruler === ruler ? was : { lane, ruler }));
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

  /** What the player goes round: the picked bars, the whole song, or nothing when Loop is off. */
  const cycleFor = useCallback((s: Song): Cycle | null => (loop ? (range ? cycleOf(range.a, range.b, s.bars) : { from: 0, to: s.bars * BEATS_PER_BAR }) : null), [loop, range]);
  const stop = useCallback(() => { player.current?.stop(); player.current = null; setPlaying(false); }, []);
  const startAt = useCallback((from: number) => {
    if (!song) return;
    player.current?.stop();
    player.current = play(song, from >= song.bars * BEATS_PER_BAR ? 0 : from, cycleFor(song), click);
    setPlaying(true);
  }, [song, cycleFor, click]);
  const start = useCallback(() => startAt(Math.floor(beat)), [startAt, beat]);
  const seek = useCallback((to: number) => {
    setBeat(to);
    if (playing && song) { player.current?.stop(); player.current = play(song, to, cycleFor(song), click); }
  }, [playing, song, cycleFor, click]);
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
  useEffect(() => { stop(); setBeat(0); setSelected(null); setPicked(new Set()); setRange(null); }, [songs.page?.path, stop]);
  useEffect(() => { setPicked(new Set()); }, [selected]);
  // Restart from where it is when the notes or the loop and click change, so what is heard is what is shown.
  useEffect(() => {
    if (playing && song) { const b = player.current?.beat() ?? 0; player.current?.stop(); player.current = play(song, Math.floor(b), cycleFor(song), click); }
  }, [songs.text, cycleFor, click]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys for the chosen track and the loop, set each time the page is drawn (they need what the song has now).
  const pageKeys = useRef<((e: KeyboardEvent, t: HTMLElement) => boolean) | null>(null);
  // Keys anywhere on the page: Space plays and stops, Return goes back to the start, Ctrl+Z and Ctrl+Y undo and redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.studio-page') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (pageKeys.current?.(e, t)) { e.preventDefault(); return; }
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

  // The sidebar's Sounds and the menus' Play or stop reach the open song while Music is on screen.
  useEffect(() => {
    const onAdd = (e: Event) => {
      const instrument = (e as CustomEvent<Instrument>).detail;
      change((s) => {
        const id = freshTrackId(s);
        s.tracks.push({ id, name: INSTRUMENT_NAMES[instrument], instrument, volume: 0.8, pan: 0, muted: false, solo: false, color: nextColour(s.tracks), notes: [] });
        setSelected(id);
      });
    };
    window.addEventListener(ADD_TRACK, onAdd);
    return () => window.removeEventListener(ADD_TRACK, onAdd);
  }, [change]);
  useEffect(() => { setUndoText(null); }, [songs.page?.path]);
  // A short while for the last song to open before the page says none is open.
  const [settled, setSettled] = useState(false);
  useEffect(() => { const id = window.setTimeout(() => setSettled(true), 1500); return () => window.clearTimeout(id); }, []);

  if (!songs.page && songs.notebooks.some((n) => n.pages.length) && !settled) {
    // The last song is on its way: placeholder bars the shape of the tracks, not a spinner.
    return (
      <section className="studio-page studio-loading" aria-label="Music" aria-busy="true">
        {[0, 1, 2, 3].map((i) => <span key={i} className="studio-placeholder" style={{ ['--w' as string]: `${70 - i * 12}%` }} />)}
      </section>
    );
  }
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
  // The list fits its tracks and the row for adding one after them.
  const listFor = Math.max(96, Math.min(arrangeH ?? fitTracks(song.tracks.length + 1, rowSize.ruler + 1, rowSize.lane + 1) + 1, Math.max(96, pageH - EDITOR_MIN)));
  const rowH = drums ? Math.max(DRUM_ROW_H, Math.min(40, Math.floor((pageH - listFor - 1 - 38 - VEL_H - 2) / DRUMS.length))) : ROW_H;
  const keysW = drums ? DRUM_KEYS_W : KEYS_W;
  const rows = drums ? DRUMS.map((d) => ({ pitch: d.pitch, label: d.name, shade: false, black: false, c: true })) : Array.from({ length: MELODY_TOP - MELODY_BOTTOM + 1 }, (_, i) => MELODY_TOP - i).map((p) => ({ pitch: p, label: noteName(p), shade: !inKey.has(p % 12), black: isBlack(p), c: p % 12 === 0 }));
  const rowOf = (pitch: number) => rows.findIndex((r) => r.pitch === pitch);
  const rbw = ROLL_BEAT_W * zoom;
  // The arrangement fits the whole song across the window, then zooms in from there.
  const bw = Math.max(BEAT_MIN, laneW / total) * zoom;
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
  /** The sounds to add a track from, as a menu at a point: the sidebar's Sounds, for the row at the end of the tracks. */
  const soundsMenu = (x: number, y: number) => setMenu({ x, y, label: 'Add track', items: SOUNDS.map((i) => ({ label: INSTRUMENT_NAMES[i], run: () => askToAddTrack(i) })) });
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
  const openNotes = (id: string, fromBeat = 0) => {
    setSelected(id);
    setEditing(true);
    requestAnimationFrame(() => { if (roll.current) roll.current.scrollLeft = Math.max(0, fromBeat * ROLL_BEAT_W * zoom - 8); });
  };
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
  // What Mobius changed, by track and where: "Pad idea, bars 13 to 24".
  const names = [...changed].map((id) => {
    const t = song.tracks.find((x) => x.id === id);
    if (!t) return id;
    const clips = clipsOf(t.notes, song.bars);
    if (clips.length === 0) return t.name;
    const from = clips[0]!.from + 1, to = clips[clips.length - 1]!.to;
    return `${t.name}, ${from === to ? `bar ${from}` : `bars ${from} to ${to}`}`;
  });
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
      previewNote(track.instrument, n.pitch, n.velocity, undefined, track.sound, track.kit);
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
      previewNote(track.instrument, pitch, undefined, undefined, track.sound, track.kit);
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

  const proposal = changed.size > 0 ? (
    <div className="studio-dev-proposal" role="group" aria-label="Mobius's change">
      <h4 className="studio-dev-head">Proposed by Mobius</h4>
      <p>{`Mobius ${before === null ? 'made' : 'changed'} ${names.join('; ')}. Notes, never audio: each is yours to edit.`}{review && <> <WhyThis conversation={review.conversation} file={file ?? undefined} /></>}</p>
      <div className="studio-dev-actions"><ReviewActions onKeep={keep} onDiscard={discard} /></div>
    </div>
  ) : null;
  const stopOrRewind = () => { if (playing) stop(); else seek(0); };
  pageKeys.current = (e, t) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (!mod && !e.altKey && k === 'l') { setLoop((l) => !l); return true; }
    if (!mod && !e.altKey && k === 'k') { setClick((c) => !c); return true; }
    if (!track || !t.closest('.studio-tracks')) return false;
    if (mod && k === 'd') { duplicateTrack(track.id); return true; }
    if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) { deleteTrack(track.id); return true; }
    if (!mod && k === 'm') { setTrack(track.id, (v) => { v.muted = !v.muted; }); return true; }
    if (!mod && k === 's') { setTrack(track.id, (v) => { v.solo = !v.solo; }); return true; }
    if (!mod && e.key === 'Enter' && t.tagName !== 'BUTTON') { openNotes(track.id); return true; }
    return false;
  };
  const ticks = Math.max(1, [1, 2, 4, 8, 16].find((n) => n * BEATS_PER_BAR * bw >= 56) ?? 16);

  return (
    <section className="studio-page" aria-label="Music" ref={page} data-editing={editing || undefined}>
      <ToolbarControls label="Transport">
        <IconButton className="studio-play" label={playing ? 'Pause' : 'Play'} keys="Space" pressed={playing} icon={<Icon d={playing ? 'M6.5 4.5v11M13.5 4.5v11' : ICONS.play} />} onClick={() => (playing ? stop() : start())} />
        <IconButton label="Stop" title={playing ? 'Stop' : 'Back to the start'} keys={playing ? 'Space' : 'Enter'} icon={<Icon d={ICONS.stop} />} onClick={stopOrRewind} />
        <span className="studio-sep" aria-hidden="true" />
        <span className="studio-readout studio-pos" aria-label="Position" role="status" title={pos.time}>{pos.bars.split('.').join(' . ')}</span>
        <label className="studio-readout studio-tempo" title="Tempo, in beats per minute">
          <input aria-label="Tempo" type="number" min={30} max={300} value={song.tempo} onChange={(e) => { const v = Number(e.target.value); if (v >= 30 && v <= 300) change((s) => { s.tempo = Math.round(v); }, 'tempo'); }} />
          <span aria-hidden="true">bpm</span>
        </label>
        <span className="studio-readout studio-meter" aria-label="Meter: 4 beats to a bar" title="Every song is in 4 / 4 for now">4 / 4</span>
        <IconButton label="Loop" title={loop ? `Looping ${loopWords}` : 'Loop'} keys="L" pressed={loop} icon={<Icon d={ICONS.loop} />} onClick={() => setLoop((l) => !l)} />
      </ToolbarControls>
      <div className="studio-main">
        <div className="studio-arrange" data-empty={song.tracks.length === 0 || undefined} style={{ ['--head' as string]: `${HEAD_W}px`, ['--bar' as string]: `${BEATS_PER_BAR * bw}px`, ...(editing ? { height: listH, flex: 'none' } : {}) }}
          onWheel={(e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setZoom((z) => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + (e.deltaY < 0 ? 1 : -1)))] ?? z); }}>
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
                <div className="studio-track-head" onContextMenu={(e) => { e.preventDefault(); setSelected(t.id); trackMenu(t, e.clientX, e.clientY); }} onDoubleClick={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') openNotes(t.id); }}>
                  <span className="studio-track-no" aria-hidden="true">{String(n + 1).padStart(2, '0')}</span>
                  <input className="studio-track-name" aria-label="Track name" value={t.name} maxLength={60} onChange={(e) => setTrack(t.id, (x) => { x.name = e.target.value; }, `name:${t.id}`)} />
                  {t.name !== INSTRUMENT_NAMES[t.instrument] && <span className="studio-track-sub">{INSTRUMENT_NAMES[t.instrument]}</span>}
                  <div className="studio-track-buttons" data-on={t.muted || t.solo || undefined}>
                    <button type="button" className="studio-ms" aria-label={`Mute ${t.name}`} title="Mute (M)" aria-pressed={t.muted} onClick={(e) => { e.stopPropagation(); setTrack(t.id, (x) => { x.muted = !x.muted; }); }}>M</button>
                    <button type="button" className="studio-ms" aria-label={`Solo ${t.name}`} title="Solo (S)" aria-pressed={t.solo} onClick={(e) => { e.stopPropagation(); setTrack(t.id, (x) => { x.solo = !x.solo; }); }}>S</button>
                  </div>
                </div>
                <div className="studio-lane" style={{ width: total * bw }}>
                  <Clips track={t} bars={song.bars} proposed={changed.has(t.id)} bw={bw} onOpen={(from) => openNotes(t.id, from)} />
                </div>
              </div>
            ))}
            <div className="studio-add-row">
              <Button kind="quiet" className="studio-add" icon={<Icon d="M10 4.5v11M4.5 10h11" />} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); soundsMenu(r.left, r.bottom); }}>Add track</Button>
              {song.tracks.length === 0 && <span className="studio-none">No tracks yet.</span>}
            </div>
            <span className="studio-playhead" style={{ left: HEAD_W + beat * bw }} aria-hidden="true" />
          </div>
        </div>
        {editing && track && (
          <>
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
            <div className="studio-editor" data-instrument={track.instrument} style={{ '--tc': `var(--c-${track.color})` } as CSSProperties}>
              <div className="studio-roll-bar" role="toolbar" aria-label="Notes">
                <span className="studio-roll-title"><span className="studio-dev-dot" aria-hidden="true" />{track.name}</span>
                <Select inline label="Grid" value={String(grid)} choices={GRID_CHOICES} onChange={(g) => setGrid(Number(g))} />
                {!drums && <Select inline label="Note length" value={String(drawLength)} choices={GRID_CHOICES} onChange={(g) => setDrawLength(Number(g))} />}
                <Button kind="quiet" title="Line notes up to the grid" keys="Q" onClick={() => setNotes((n) => quantizeNotes(n, picked, grid, total))}>Quantize</Button>
                <span className="studio-gap" />
                {velocity !== null ? (
                  <>
                    <span className="studio-picked">{pickedNotes.length === 1 ? `${drums ? (DRUMS.find((d) => d.pitch === pickedNotes[0]!.pitch)?.name ?? '') : noteName(pickedNotes[0]!.pitch)} at ${position(pickedNotes[0]!.start, song.tempo).bars}` : `${pickedNotes.length} notes`}</span>
                    <Slider className="studio-velocity" label="Velocity" value={Math.round(velocity * 100) / 100} min={0} max={1} step={0.01} format={(v) => String(Math.round(v * 127))} onChange={(v) => setNotes((n) => setVelocity(n, picked, v), 'velocity')} />
                    <Button kind="quiet" danger aria-label="Delete notes" title="Delete" keys="Delete" onClick={() => { setNotes((n) => removeNotes(n, picked)); setPicked(new Set()); }}>Delete</Button>
                  </>
                ) : <span className="studio-hint">Click to draw a note, drag to move it, drag its end to stretch it.</span>}
                <IconButton className="studio-roll-close" label="Hide notes" icon={<Icon d="M6 6l8 8M14 6l-8 8" />} onClick={() => setEditing(false)} />
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
                  <span className="studio-key" role="rowheader" data-black={r.black || undefined} data-c={r.c || undefined} data-drum={drums || undefined} onPointerDown={(e) => { e.stopPropagation(); previewNote(track.instrument, r.pitch, undefined, undefined, track.sound, track.kit); }}>{r.label}</span>
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
          </>
        )}
      </div>
      <DevicePlace>
        <StudioDevice track={track} onTrack={(fn, tag) => { if (track) setTrack(track.id, fn, tag ? `${tag}:${track.id}` : ''); }} proposal={proposal} />
      </DevicePlace>
      {undoText && <UndoToast text={undoText} onUndo={() => { undo(); setUndoText(null); }} onDismiss={() => setUndoText(null)} />}
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onClose={() => setMenu(null)} />, document.body)}
    </section>
  );
}

/** The Device panel, as a tab before Mobius in the right panel. */
function DevicePlace({ children }: { children: ReactNode }) {
  return <PanelTab id="device" name="Device">{children}</PanelTab>;
}
