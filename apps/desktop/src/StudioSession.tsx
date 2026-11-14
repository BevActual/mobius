import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { Button, IconButton } from './ui';
import { BEATS_PER_BAR, sceneCount, sceneName, type Song } from './song-format';
import type { SessionPlaying, SessionQueued } from './studio-audio';

/**
 * Music's Session view: a grid of clips, a column per track and a row per scene. A clip is a short loop that starts on
 * the next bar when launched and goes round until the track is stopped or another clip on it is launched; launching a
 * scene starts its whole row. The Arrange view is the song from start to end; this is for trying parts against each
 * other before they are laid out.
 */
const PLAY = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5l8 5-8 5z" /></svg>;
const ADD = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>;
const STOP = <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="8" height="8" rx="1" /></svg>;

export function SessionGrid({ song, selected, chosen, playing, queued, beat, onSelect, onChoose, onCreate, onLaunch, onLaunchScene, onStopAll, onSceneName, onAddScene, onClipMenu }: {
  song: Song;
  selected: string | null;
  /** The chosen clip's slot on the selected track, shown in the bottom area. */
  chosen: number | null;
  playing: SessionPlaying;
  queued: SessionQueued;
  /** Beats since Play, for how far round each playing clip is. */
  beat: number;
  onSelect: (trackId: string) => void;
  onChoose: (trackId: string, slot: number) => void;
  onCreate: (trackId: string, slot: number) => void;
  onLaunch: (trackId: string, slot: number | null) => void;
  onLaunchScene: (slot: number) => void;
  onStopAll: () => void;
  onSceneName: (slot: number, name: string) => void;
  onAddScene: () => void;
  onClipMenu: (trackId: string, slot: number, x: number, y: number) => void;
}) {
  const scenes = sceneCount(song);
  const soloed = song.tracks.some((t) => t.solo);
  return (
    <div className="studio-session" role="grid" aria-label="Clips" style={{ ['--cols' as string]: song.tracks.length }}>
      <div className="studio-session-row studio-session-heads" role="row">
        {song.tracks.map((t, n) => (
          <div key={t.id} role="columnheader" className="studio-session-head" style={{ '--tc': `var(--c-${t.color})` } as CSSProperties}
            aria-current={selected === t.id || undefined} data-muted={(t.muted || (soloed && !t.solo)) || undefined}>
            <button type="button" className="studio-session-name" onClick={() => onSelect(t.id)}>
              <span className="studio-track-no" aria-hidden="true">{String(n + 1).padStart(2, '0')}</span>{t.name}
            </button>
          </div>
        ))}
        <div role="columnheader" className="studio-scene-head">Scenes</div>
      </div>
      {Array.from({ length: scenes }, (_, i) => (
        <div key={i} className="studio-session-row" role="row" aria-label={`Scene ${sceneName(song, i)}`}>
          {song.tracks.map((t) => {
            const clip = t.slots?.[i] ?? null;
            const now = playing[t.id];
            const on = now?.slot === i;
            const waiting = queued[t.id] === i;
            const style = { '--tc': `var(--c-${t.color})` } as CSSProperties;
            if (!clip) {
              return (
                <div key={t.id} role="gridcell" className="studio-slot" style={style}>
                  <button type="button" className="studio-slot-empty" aria-label={`New clip on ${t.name}, scene ${sceneName(song, i)}`} title="New clip" onClick={() => onCreate(t.id, i)} />
                </div>
              );
            }
            const length = clip.bars * BEATS_PER_BAR;
            const round = on && now ? (((beat - now.start) % length) + length) % length / length : 0;
            const isChosen = selected === t.id && chosen === i;
            return (
              <div key={t.id} role="gridcell" className="studio-slot" style={style} data-playing={on || undefined} data-queued={waiting || undefined} aria-selected={isChosen}
                onContextMenu={(e: ReactMouseEvent) => { e.preventDefault(); onClipMenu(t.id, i, e.clientX, e.clientY); }}>
                <IconButton className="studio-clip-launch" label={`Launch ${clip.name}, scene ${sceneName(song, i)}`} pressed={on} title={on ? 'Playing: launch again to start it over' : 'Launch: starts on the next bar'} icon={PLAY} onClick={() => onLaunch(t.id, i)} />
                <button type="button" className="studio-clip-body" aria-label={`${clip.name}, ${clip.bars} ${clip.bars === 1 ? 'bar' : 'bars'}`} aria-pressed={isChosen} onClick={() => onChoose(t.id, i)}>
                  <span className="studio-clip-name">{clip.name}</span>
                  {on && <span className="studio-clip-round" style={{ ['--p' as string]: round }} aria-hidden="true" />}
                </button>
              </div>
            );
          })}
          <div role="rowheader" className="studio-scene">
            <IconButton className="studio-scene-launch" label={`Launch scene ${sceneName(song, i)}`} title="Launch this row of clips on the next bar" icon={PLAY} onClick={() => onLaunchScene(i)} />
            <input className="studio-scene-name" aria-label={`Scene ${i + 1} name`} placeholder={`Scene ${i + 1}`} value={song.scenes?.[i] ?? ''} maxLength={40} onChange={(e) => onSceneName(i, e.target.value)} />
          </div>
        </div>
      ))}
      <div className="studio-session-row studio-session-add" role="row">
        {song.tracks.map((t) => <div key={t.id} role="gridcell" className="studio-slot" />)}
        <div role="rowheader" className="studio-scene">
          <Button kind="quiet" className="studio-add-scene" icon={ADD} onClick={onAddScene}>Add scene</Button>
        </div>
      </div>
      <div className="studio-session-row studio-session-stops" role="row">
        {song.tracks.map((t) => (
          <div key={t.id} role="gridcell" className="studio-slot">
            <IconButton className="studio-clip-stop" label={`Stop ${t.name}`} title="Stop this track's clip at the next bar" icon={STOP} disabled={!playing[t.id] && queued[t.id] === undefined} onClick={() => onLaunch(t.id, null)} />
          </div>
        ))}
        <div role="rowheader" className="studio-scene">
          <Button kind="quiet" className="studio-stop-all" icon={STOP} title="Stop every clip at the next bar" onClick={onStopAll}>Stop all</Button>
        </div>
      </div>
    </div>
  );
}
