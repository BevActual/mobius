import { useEffect, useRef } from 'react';
import { Button, Knob, MixerStrip, type LevelFeed } from './ui';
import { MAIN_VOLUME, MAX_RETURNS, returnName, type ReturnTrack, type Song, type Track } from './song-format';
import type { Player } from './studio-audio';

/** A track's volume (0 to 1, as kept in the song) in dB for the fader, and back. The fader stops at 0 dB, the most a track's volume can be. */
export const gainToDb = (v: number): number => (v <= 0.001 ? -60 : Math.max(-60, Math.round(20 * Math.log10(v) * 10) / 10));
export const dbToGain = (db: number): number => (db <= -60 ? 0 : Math.min(1, Math.round(10 ** (db / 20) * 1000) / 1000));

/** A fresh return's id: never a track's or another return's (the engine reports meters by id). */
export function freshReturnId(song: Song): string {
  const taken = new Set([...song.tracks.map((t) => t.id), ...(song.returns ?? []).map((r) => r.id)]);
  let n = (song.returns?.length ?? 0) + 1;
  while (taken.has(`r-${n}`)) n++;
  return `r-${n}`;
}

/** A send's amount, short enough for a strip: −∞ when off, else its level in whole dB (Live shows -inf and dB). */
const sendText = (v: number) => (v <= 0.001 ? '−∞' : String(Math.round(gainToDb(v))).replace('-', '−'));

/**
 * Music's Mixer, a tab beside the Detail at the bottom (Design's layout, after Live's Mixer view): a strip per track
 * with its sends, pan, fader and meter, mute and solo; then the return tracks; then Main with its own fader. The
 * meters move while the engine plays.
 */
export function StudioMixer({ song, selected, onSelect, setTrack, setSong, source, playing }: {
  song: Song;
  selected: string | null;
  onSelect: (id: string) => void;
  /** A change to one track, as one Undo step per `tag`. */
  setTrack: (id: string, fn: (t: Track) => void, tag?: string) => void;
  /** A change to the song as a whole (Main and the returns), as one Undo step per `tag`. */
  setSong: (fn: (s: Song) => void, tag?: string) => void;
  /** What is playing, for its meters. */
  source: () => Player | null;
  playing: boolean;
}) {
  const feeds = useRef(new Map<string, LevelFeed | null>());
  const anySolo = song.tracks.some((t) => t.solo);
  useEffect(() => {
    const quiet = () => { for (const f of feeds.current.values()) f?.set(-90, -90); };
    if (!playing) { quiet(); return; }
    let id = 0;
    const tick = () => {
      const p = source();
      for (const [key, f] of feeds.current) {
        const m = p?.meter?.(key);
        f?.set(...(m ?? [-90, -90]));
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(id); quiet(); };
  }, [playing, source]);
  const feed = (key: string) => (f: LevelFeed | null) => { feeds.current.set(key, f); };
  const returns = song.returns ?? [];
  const setReturn = (id: string, fn: (r: ReturnTrack) => void, tag = '') => setSong((s) => { const r = s.returns?.find((x) => x.id === id); if (r) fn(r); }, tag);
  // Every strip has the same room for sends, so the faders line up: knobs on a track, the same space on the others.
  const spacer = returns.length > 0 ? <span className="studio-sends" data-empty aria-hidden="true" style={{ ['--sends' as string]: returns.length }} /> : null;
  const sendsOf = (t: Track) => (returns.length === 0 ? null : (
    <span className="studio-sends" role="group" aria-label={`${t.name} sends`} style={{ ['--sends' as string]: returns.length }}>
      {returns.map((r, i) => (
        <span key={r.id} className="studio-send-row"><span className="studio-send-letter" aria-hidden="true">{returnName(r, i)}</span>
        <Knob className="studio-send" label={`Send to ${returnName(r, i)}`} value={t.sends?.[r.id] ?? 0} min={0} max={1} step={0.01} reset={0} format={sendText}
          onChange={(v) => setTrack(t.id, (x) => { const next = { ...(x.sends ?? {}) }; if (v > 0) next[r.id] = Math.round(v * 100) / 100; else delete next[r.id]; if (Object.keys(next).length > 0) x.sends = next; else delete x.sends; }, `mix-send:${t.id}:${r.id}`)} /></span>
      ))}
    </span>
  ));
  const addReturn = () => setSong((s) => { s.returns = [...(s.returns ?? []), { id: freshReturnId(s), volume: MAIN_VOLUME, pan: 0 }]; });
  return (
    // The panel around it is already the "Mixer" region.
    <div className="studio-mixer">
      {song.tracks.map((t) => (
        <MixerStrip key={t.id} name={t.name} color={t.color} selected={t.id === selected} onSelect={() => onSelect(t.id)}
          volume={gainToDb(t.volume)} ceiling={0} volumeReset={gainToDb(0.8)}
          onVolume={(db) => setTrack(t.id, (x) => { x.volume = dbToGain(db); }, `mix-vol:${t.id}`)}
          pan={t.pan} onPan={(p) => setTrack(t.id, (x) => { x.pan = Math.round(p * 100) / 100; }, `mix-pan:${t.id}`)}
          mute={t.muted} onMute={(on) => setTrack(t.id, (x) => { x.muted = on; })}
          solo={t.solo} onSolo={(on) => setTrack(t.id, (x) => { x.solo = on; })}
          dimmed={anySolo && !t.solo} meter={feed(t.id)} sends={sendsOf(t)} />
      ))}
      {returns.map((r, i) => (
        <MixerStrip key={r.id} name={`${returnName(r, i)} Return`} className="studio-mixer-return" sends={spacer}
          volume={gainToDb(r.volume)} ceiling={0} volumeReset={gainToDb(MAIN_VOLUME)}
          onVolume={(db) => setReturn(r.id, (x) => { x.volume = dbToGain(db); }, `mix-vol:${r.id}`)}
          pan={r.pan} onPan={(p) => setReturn(r.id, (x) => { x.pan = Math.round(p * 100) / 100; }, `mix-pan:${r.id}`)}
          mute={!!r.muted} onMute={(on) => setReturn(r.id, (x) => { if (on) x.muted = true; else delete x.muted; })} meter={feed(r.id)} />
      ))}
      {returns.length < MAX_RETURNS && (
        <Button kind="quiet" className="studio-mixer-add" title="A return track: tracks send to it with their Send knobs, as in Live" onClick={addReturn}>Add return</Button>
      )}
      {/* Live's Main: no pan, mute or solo; its fader sets the whole song's level. */}
      <MixerStrip name="Main" className="studio-mixer-main" meter={feed('master')} sends={spacer}
        volume={gainToDb(song.main?.volume ?? MAIN_VOLUME)} ceiling={0} volumeReset={gainToDb(MAIN_VOLUME)}
        onVolume={(db) => setSong((s) => { s.main = { ...(s.main ?? {}), volume: dbToGain(db) }; }, 'mix-vol:main')} />
    </div>
  );
}
