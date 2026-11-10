import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NotesSidebar, type SidebarWords } from './NotesSidebar';
import { BEATS_PER_BAR, DRUMS, INSTRUMENTS, INSTRUMENT_NAMES, KEYS, changedTracks, freshTrackId, keyPitches, noteName, parseSong, writeSong, type Instrument, type Song, type Track } from './song-format';
import { play, type Player } from './studio-audio';
import { useFileReview } from './useFileReview';
import type { NotesState } from './useNotes';
import { ReviewActions, WhyThis } from './ReviewBar';

export const STUDIO_WORDS: SidebarWords = { app: 'Studio', group: 'folder', groups: 'Folders', item: 'song', items: 'songs', about: 'Songs are kept as JSON files in your workspace: tracks of notes, never audio, so the agent can read and write them like a score.', defaultGroup: 'Songs' };

export function StudioSidebar(props: { songs: NotesState; pin: ReactNode; changed?: ReadonlySet<string>; starts?: readonly import('./SideNew').Start[]; onStart?: (prompt: string) => void }) {
  const { songs, ...rest } = props;
  return <NotesSidebar notes={songs} words={STUDIO_WORDS} {...rest} />;
}

const BEAT_W = 28;
const LANE_H = 44;
const ROLL_BEAT_W = 40;
const ROW_H = 14;
const STEP = 0.25;
const MELODY_TOP = 84;
const MELODY_BOTTOM = 36;

function Lane({ track, bars, proposed }: { track: Track; bars: number; proposed: boolean }) {
  const pitches = track.notes.map((n) => n.pitch);
  const lo = Math.min(...pitches, 127), hi = Math.max(...pitches, 0);
  const span = Math.max(1, hi - lo);
  return (
    <div className="studio-lane" data-proposed={proposed || undefined} style={{ width: bars * BEATS_PER_BAR * BEAT_W }}>
      {Array.from({ length: bars }, (_, b) => <span key={b} className="studio-bar-line" style={{ left: b * BEATS_PER_BAR * BEAT_W }} />)}
      {track.notes.map((n, i) => (
        <span key={i} className="studio-mini" data-instrument={track.instrument} style={{ left: n.start * BEAT_W, width: Math.max(2, n.length * BEAT_W - 1), top: 4 + (1 - (n.pitch - lo) / span) * (LANE_H - 12) }} />
      ))}
    </div>
  );
}

/** One song: transport, tracks with their notes laid out by bar, and the notes of the chosen track to change by clicking. */
export function StudioEditor({ songs, review }: { songs: NotesState; review?: { conversation: string } | null }) {
  const parsed = useMemo(() => (songs.page ? parseSong(songs.text) : null), [songs.page, songs.text]);
  const song = parsed && 'song' in parsed ? parsed.song : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [beat, setBeat] = useState(0);
  const player = useRef<Player | null>(null);
  const roll = useRef<HTMLDivElement>(null);
  const file = songs.page ? `studio/${songs.page.path}` : null;
  const { before, keep, discard } = useFileReview(review, file, songs.page?.base);
  const changed = useMemo(() => {
    if (!song || before === undefined) return new Set<string>();
    const was = before === null ? null : parseSong(before);
    return changedTracks(was && 'song' in was ? was.song : null, song);
  }, [song, before]);

  const change = useCallback((fn: (s: Song) => void) => {
    if (!song) return;
    const next = structuredClone(song);
    fn(next);
    songs.edit(writeSong(next));
  }, [song, songs]);

  const stop = useCallback(() => { player.current?.stop(); player.current = null; setPlaying(false); }, []);
  const start = useCallback(() => {
    if (!song) return;
    player.current?.stop();
    player.current = play(song, beat >= song.bars * BEATS_PER_BAR ? 0 : Math.floor(beat), loop);
    setPlaying(true);
  }, [song, beat, loop]);
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
  useEffect(() => { stop(); setBeat(0); setSelected(null); }, [songs.page?.path, stop]);
  // Restart from where it is when the notes change, so what is heard is what is shown.
  const lastText = useRef(songs.text);
  useEffect(() => {
    if (playing && lastText.current !== songs.text && song) { const b = player.current?.beat() ?? 0; player.current?.stop(); player.current = play(song, Math.floor(b), loop); }
    lastText.current = songs.text;
  }, [songs.text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== ' ' || !t?.closest('.studio-page') || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName)) return;
      e.preventDefault();
      if (playing) stop(); else start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, start, stop]);

  // The piano roll opens on the chosen track's highest notes.
  const shownTrack = song ? (song.tracks.find((t) => t.id === selected) ?? song.tracks[0] ?? null) : null;
  useEffect(() => {
    if (!roll.current || !shownTrack || shownTrack.instrument === 'drums' || shownTrack.notes.length === 0) return;
    const top = Math.max(...shownTrack.notes.map((n) => n.pitch));
    roll.current.scrollTop = Math.max(0, (MELODY_TOP - top) * ROW_H - 2 * ROW_H);
  }, [shownTrack?.id, songs.page?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!songs.page) return <section className="studio-page empty" aria-label="Studio"><p className="note-empty">Choose a song on the left, or make a new one.</p></section>;
  if (!song) return <section className="studio-page empty" aria-label="Studio"><p className="note-empty">This song could not be read ({parsed && 'error' in parsed ? parsed.error : 'unknown'}).</p></section>;

  const track = song.tracks.find((t) => t.id === selected) ?? song.tracks[0] ?? null;
  const total = song.bars * BEATS_PER_BAR;
  const inKey = keyPitches(song.key);
  const rows = track?.instrument === 'drums' ? DRUMS.map((d) => ({ pitch: d.pitch, label: d.name, shade: false })) : Array.from({ length: MELODY_TOP - MELODY_BOTTOM + 1 }, (_, i) => MELODY_TOP - i).map((p) => ({ pitch: p, label: noteName(p), shade: !inKey.has(p % 12) }));
  const toggleNote = (pitch: number, at: number) => change((s) => {
    const t = s.tracks.find((x) => x.id === track?.id);
    if (!t) return;
    const hit = t.notes.findIndex((n) => n.pitch === pitch && at >= n.start && at < n.start + n.length);
    if (hit >= 0) t.notes.splice(hit, 1);
    else t.notes.push({ pitch, start: at, length: t.instrument === 'drums' ? STEP : 1, velocity: 0.8 });
    t.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  });
  const addTrack = (instrument: Instrument) => change((s) => {
    const id = freshTrackId(s);
    s.tracks.push({ id, name: INSTRUMENT_NAMES[instrument], instrument, volume: 0.8, muted: false, solo: false, notes: [] });
    setSelected(id);
  });
  const setTrack = (id: string, fn: (t: Track) => void) => change((s) => { const t = s.tracks.find((x) => x.id === id); if (t) fn(t); });
  const bar = Math.floor(beat / BEATS_PER_BAR) + 1, beatIn = Math.floor(beat % BEATS_PER_BAR) + 1;
  const names = [...changed].map((id) => song.tracks.find((t) => t.id === id)?.name ?? id);

  return (
    <section className="studio-page" aria-label="Studio">
      <div className="studio-transport" role="toolbar" aria-label="Transport">
        <button type="button" className="btn primary" onClick={() => (playing ? stop() : start())}>{playing ? 'Stop' : 'Play'}</button>
        <button type="button" className="btn" aria-pressed={loop} onClick={() => setLoop((l) => !l)}>Loop</button>
        <span className="studio-pos" aria-label="Position">{`${bar}.${beatIn}`}<small>BAR</small></span>
        <label className="studio-num"><input aria-label="Tempo" type="number" min={30} max={300} value={song.tempo} onChange={(e) => { const v = Number(e.target.value); if (v >= 30 && v <= 300) change((s) => { s.tempo = Math.round(v); }); }} /><small>TEMPO</small></label>
        <label className="studio-num"><select aria-label="Key" value={song.key} onChange={(e) => change((s) => { s.key = e.target.value; })}>{KEYS.map((k) => <option key={k}>{k}</option>)}</select><small>KEY</small></label>
        <label className="studio-num"><input aria-label="Bars" type="number" min={1} max={512} value={song.bars} onChange={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 512) change((s) => { s.bars = Math.round(v); }); }} /><small>BARS</small></label>
        <span className="design-bar-gap" />
        <label className="studio-add">
          <span className="sr-only">Add a track</span>
          <select aria-label="Add a track" value="" onChange={(e) => { if (e.target.value) addTrack(e.target.value as Instrument); }}>
            <option value="">Add track…</option>
            {INSTRUMENTS.map((i) => <option key={i} value={i}>{INSTRUMENT_NAMES[i]}</option>)}
          </select>
        </label>
      </div>
      <div className="studio-arrange" role="list" aria-label="Tracks">
        {song.tracks.length === 0 && <p className="note-empty">No tracks yet. Add one, or ask Mobius for a part: “a bass line that follows the chords”.</p>}
        {song.tracks.map((t) => (
          <div key={t.id} role="listitem" aria-label={t.name} className="studio-track" aria-current={track?.id === t.id || undefined} onClick={() => setSelected(t.id)}>
            <div className="studio-track-head" data-proposed={changed.has(t.id) || undefined}>
              <input className="studio-track-name" aria-label="Track name" value={t.name} maxLength={60} onChange={(e) => setTrack(t.id, (x) => { x.name = e.target.value; })} />
              <select aria-label="Instrument" value={t.instrument} onChange={(e) => setTrack(t.id, (x) => { x.instrument = e.target.value as Instrument; })}>{INSTRUMENTS.map((i) => <option key={i} value={i}>{INSTRUMENT_NAMES[i]}</option>)}</select>
              <button type="button" className="studio-ms" aria-label={`Mute ${t.name}`} aria-pressed={t.muted} onClick={(e) => { e.stopPropagation(); setTrack(t.id, (x) => { x.muted = !x.muted; }); }}>M</button>
              <button type="button" className="studio-ms" aria-label={`Solo ${t.name}`} aria-pressed={t.solo} onClick={(e) => { e.stopPropagation(); setTrack(t.id, (x) => { x.solo = !x.solo; }); }}>S</button>
            </div>
            <div className="studio-lane-wrap">
              <Lane track={t} bars={song.bars} proposed={changed.has(t.id)} />
              <span className="studio-playhead" style={{ left: beat * BEAT_W }} aria-hidden="true" />
            </div>
          </div>
        ))}
      </div>
      {changed.size > 0 && (
        <div className="studio-review" role="group" aria-label="Mobius's change">
          <span className="review-dot" aria-hidden="true" />
          <span>{`Mobius ${before === null ? 'made' : 'changed'} ${names.join(', ')}. Notes, never audio: each is yours to edit.`}{review && <WhyThis conversation={review.conversation} />}</span>
          <ReviewActions onKeep={keep} onDiscard={discard} />
        </div>
      )}
      {track && (
        <div className="studio-roll" ref={roll} role="grid" aria-label={`Notes of ${track.name}`}>
          <div className="studio-roll-inner" style={{ width: 64 + total * ROLL_BEAT_W, height: rows.length * ROW_H }}>
            {rows.map((r, i) => (
              <div key={r.pitch} className="studio-row" role="row" data-shade={r.shade || undefined} style={{ top: i * ROW_H, height: ROW_H }}>
                <span className="studio-row-label" role="rowheader">{r.label}</span>
                <div
                  className="studio-row-cells"
                  role="gridcell"
                  aria-label={`${r.label} row`}
                  style={{ width: total * ROLL_BEAT_W, backgroundSize: `${ROLL_BEAT_W}px 100%, ${ROLL_BEAT_W * BEATS_PER_BAR}px 100%` }}
                  onClick={(e) => { const x = e.clientX - e.currentTarget.getBoundingClientRect().left; toggleNote(r.pitch, Math.floor(x / (ROLL_BEAT_W * STEP)) * STEP); }}
                >
                  {track.notes.filter((n) => n.pitch === r.pitch).map((n, j) => (
                    <span key={j} className="studio-note" data-instrument={track.instrument} aria-label={`${r.label} at beat ${n.start + 1}, ${n.length} beats`} style={{ left: n.start * ROLL_BEAT_W, width: Math.max(4, n.length * ROLL_BEAT_W - 1), opacity: 0.45 + n.velocity * 0.55 }} />
                  ))}
                </div>
              </div>
            ))}
            <span className="studio-playhead" style={{ left: 64 + beat * ROLL_BEAT_W }} aria-hidden="true" />
          </div>
        </div>
      )}
    </section>
  );
}
