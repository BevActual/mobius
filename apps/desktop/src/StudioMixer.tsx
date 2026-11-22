import { useEffect, useRef } from 'react';
import { MixerStrip, type LevelFeed } from './ui';
import type { Song, Track } from './song-format';
import type { Player } from './studio-audio';

/** A track's volume (0 to 1, as kept in the song) in dB for the fader, and back. The fader stops at 0 dB, the most a track's volume can be. */
export const gainToDb = (v: number): number => (v <= 0.001 ? -60 : Math.max(-60, Math.round(20 * Math.log10(v) * 10) / 10));
export const dbToGain = (db: number): number => (db <= -60 ? 0 : Math.min(1, Math.round(10 ** (db / 20) * 1000) / 1000));

/**
 * Music's Mixer, a tab beside the Detail at the bottom (Design's layout, after Live's Mixer view): a strip per track
 * with pan, fader and meter, mute and solo, then the main out's meter. The meters move while the engine plays.
 */
export function StudioMixer({ song, selected, onSelect, setTrack, source, playing }: {
  song: Song;
  selected: string | null;
  onSelect: (id: string) => void;
  /** A change to one track, as one Undo step per `tag`. */
  setTrack: (id: string, fn: (t: Track) => void, tag?: string) => void;
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
  return (
    <div className="studio-mixer" role="region" aria-label="Mixer">
      {song.tracks.map((t) => (
        <MixerStrip key={t.id} name={t.name} color={t.color} selected={t.id === selected} onSelect={() => onSelect(t.id)}
          volume={gainToDb(t.volume)} ceiling={0} volumeReset={gainToDb(0.8)}
          onVolume={(db) => setTrack(t.id, (x) => { x.volume = dbToGain(db); }, `mix-vol:${t.id}`)}
          pan={t.pan} onPan={(p) => setTrack(t.id, (x) => { x.pan = Math.round(p * 100) / 100; }, `mix-pan:${t.id}`)}
          mute={t.muted} onMute={(on) => setTrack(t.id, (x) => { x.muted = on; })}
          solo={t.solo} onSolo={(on) => setTrack(t.id, (x) => { x.solo = on; })}
          dimmed={anySolo && !t.solo} meter={feed(t.id)} />
      ))}
      {/* Live's Main: no pan, mute or solo; its volume isn't in the song yet, so its fader stays fixed. */}
      <MixerStrip name="Main" className="studio-mixer-main" meter={feed('master')} />
    </div>
  );
}
