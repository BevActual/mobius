import type { CSSProperties, DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Button, IconButton, NumberField, Select } from './ui';
import { FOLLOW_NAMES, type Follow, SIGNATURE_UNITS, barBeats, meterOf, sceneCount, sceneName, type Signature, type Song } from './song-format';
import { SCENE_FOLLOW_NAMES, sceneSettingsOf, sceneSettingsWords } from './studio-scenes';
import type { SessionPlaying, SessionQueued } from './studio-engine';
import { CLIP_DRAG } from './studio-moves';

/**
 * Music's Session view: a grid of clips, a column per track and a row per scene. A clip is a short loop that starts on
 * the next bar when launched and goes round until the track is stopped or another clip on it is launched; launching a
 * scene starts its whole row. The Arrange view is the song from start to end; this is for trying parts against each
 * other before they are laid out.
 */
const PLAY = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5l8 5-8 5z" /></svg>;
const ADD = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>;
const STOP = <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="8" height="8" rx="1" /></svg>;
const TEMPO = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 16.5h5l-1.8-12h-1.4zM10 12.5l3.5-6" /></svg>;
const CLEAR = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>;
const UNITS = SIGNATURE_UNITS.map((u) => ({ value: String(u), label: String(u) }));

export function SessionGrid({ song, selected, chosen, playing, queued, beat, onSelect, onChoose, onCreate, onLaunch, onLaunchScene, onStopAll, onSceneName, onAddScene, onClipMenu, onDropClip, sceneTempo = false, onSceneTempo, onSceneSetting }: {
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
  /** A clip dragged onto a slot: moved there, or copied with Ctrl held (Live 12, 7.4). */
  onDropClip: (from: { trackId: string; slot: number }, to: { trackId: string; slot: number }, copy: boolean) => void;
  /** Whether the scenes show their tempo and time signature controls (Live 12, 7.2.1: hidden until revealed). */
  sceneTempo?: boolean;
  onSceneTempo?: (shown: boolean) => void;
  /** A scene's tempo or time signature set, or cleared with null. */
  onSceneSetting?: (slot: number, change: { tempo?: number | null; signature?: Signature | null; follow?: Follow | null }) => void;
}) {
  // A slot takes a Session clip dragged onto it; the drop reads which one from the drag's data.
  const dropOn = (trackId: string, slot: number) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => { if (Array.from(e.dataTransfer.types).includes(CLIP_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move'; } },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      const raw = e.dataTransfer.getData(CLIP_DRAG);
      if (!raw) return;
      e.preventDefault();
      try { const from = JSON.parse(raw) as { trackId: string; slot: number }; onDropClip(from, { trackId, slot }, e.ctrlKey || e.metaKey); } catch { /* not a clip */ }
    },
  });
  const scenes = sceneCount(song);
  const soloed = song.tracks.some((t) => t.solo);
  return (
    <div className="studio-session" role="grid" aria-label="Clips" data-scene-tempo={sceneTempo || undefined} style={{ ['--cols' as string]: song.tracks.length }}>
      <div className="studio-session-row studio-session-heads" role="row">
        {song.tracks.map((t, n) => (
          <div key={t.id} role="columnheader" className="studio-session-head" style={{ '--tc': `var(--c-${t.color})` } as CSSProperties}
            aria-current={selected === t.id || undefined} data-muted={(t.muted || (soloed && !t.solo)) || undefined}>
            <button type="button" className="studio-session-name" onClick={() => onSelect(t.id)}>
              <span className="studio-track-no" aria-hidden="true">{String(n + 1).padStart(2, '0')}</span>{t.name}
            </button>
          </div>
        ))}
        <div role="columnheader" className="studio-scene-head">
          <span>Scenes</span>
          {onSceneTempo && <IconButton className="studio-scene-tempo-toggle" label="Scene settings" pressed={sceneTempo} icon={TEMPO}
            title={sceneTempo ? 'Hide scene settings' : 'Show scene settings: a tempo and time signature the song takes when the scene is launched, and what plays after it'} onClick={() => onSceneTempo(!sceneTempo)} />}
        </div>
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
                <div key={t.id} role="gridcell" className="studio-slot" style={style} {...dropOn(t.id, i)}>
                  <button type="button" className="studio-slot-empty" aria-label={`New clip on ${t.name}, scene ${sceneName(song, i)}`} title="New clip" onClick={() => onCreate(t.id, i)} />
                </div>
              );
            }
            const length = clip.bars * barBeats(song);
            const round = on && now ? (((beat - now.start) % length) + length) % length / length : 0;
            const isChosen = selected === t.id && chosen === i;
            return (
              <div key={t.id} role="gridcell" className="studio-slot" style={style} data-playing={on || undefined} data-queued={waiting || undefined} aria-selected={isChosen} {...dropOn(t.id, i)}
                onContextMenu={(e: ReactMouseEvent) => { e.preventDefault(); onClipMenu(t.id, i, e.clientX, e.clientY); }}>
                <IconButton className="studio-clip-launch" label={`Launch ${clip.name}, scene ${sceneName(song, i)}`} pressed={on} title={on ? 'Playing: launch again to start it over' : 'Launch: starts on the next bar'} icon={PLAY} onClick={() => onLaunch(t.id, i)} />
                <button type="button" className="studio-clip-body" aria-label={`${clip.name}, ${clip.bars} ${clip.bars === 1 ? 'bar' : 'bars'}${clip.follow ? `, then ${FOLLOW_NAMES[clip.follow.a]}` : ''}`} aria-pressed={isChosen} onClick={() => onChoose(t.id, i)}
                  draggable onDragStart={(e) => { e.dataTransfer.setData(CLIP_DRAG, JSON.stringify({ trackId: t.id, slot: i })); e.dataTransfer.effectAllowed = 'copyMove'; }}>
                  <span className="studio-clip-name">{clip.name}</span>
                  {/* It has Follow Actions (Live 12, 16.7): a small arrow, as Live marks such a clip. */}
                  {clip.follow && <span className="studio-clip-follow" title={`Then ${FOLLOW_NAMES[clip.follow.a]}${clip.follow.chance < 1 ? ` (${Math.round(clip.follow.chance * 100)}%) or ${FOLLOW_NAMES[clip.follow.b]}` : ''}`} aria-hidden="true">↻</span>}
                  {on && <span className="studio-clip-round" style={{ ['--p' as string]: round }} aria-hidden="true" />}
                </button>
              </div>
            );
          })}
          <div role="rowheader" className="studio-scene">
            {(() => {
              const set = sceneSettingsOf(song, i);
              const words = sceneSettingsWords(set);
              return <>
                {/* A scene with its own tempo or time signature has its launch button filled in, as Live colours it. */}
                <IconButton className="studio-scene-launch" data-set={set ? true : undefined} label={`Launch scene ${sceneName(song, i)}${words ? `, ${words}` : ''}`} title={words ? `Launch this row of clips on the next bar, at ${words}` : 'Launch this row of clips on the next bar'} icon={PLAY} onClick={() => onLaunchScene(i)} />
                <input className="studio-scene-name" aria-label={`Scene ${i + 1} name`} placeholder={`Scene ${i + 1}`} value={song.scenes?.[i] ?? ''} maxLength={40} onChange={(e) => onSceneName(i, e.target.value)} />
                {sceneTempo && onSceneSetting && (
                  <span className="studio-scene-set" role="group" aria-label={`Scene ${i + 1} settings`}>
                    <span className="studio-scene-field" data-unset={set?.tempo === undefined || undefined}>
                      <NumberField label="Scene tempo" hideLabel value={set?.tempo ?? song.tempo} min={30} max={300} step={1} bigStep={10} decimals={0} width={3}
                        onChange={(v) => onSceneSetting(i, { tempo: v })} />
                    </span>
                    <span className="studio-scene-field" data-unset={!set?.signature || undefined}>
                      <NumberField label="Scene beats in a bar" hideLabel value={(set?.signature ?? meterOf(song))[0]} min={1} max={32} step={1} decimals={0} width={2}
                        onChange={(v) => onSceneSetting(i, { signature: [v, (set?.signature ?? meterOf(song))[1]] })} />
                      <span aria-hidden="true">/</span>
                      <Select label="Scene beat unit" hideLabel quiet value={String((set?.signature ?? meterOf(song))[1])} choices={UNITS}
                        onChange={(u) => onSceneSetting(i, { signature: [(set?.signature ?? meterOf(song))[0], Number(u)] })} />
                    </span>
                    {(() => {
                      // The scene's follow action (16.7): what is launched once it has played a while; Jump by the scene's name.
                      const f = set?.follow;
                      const bar = barBeats(song);
                      const then = f ? (f.a === 'jump' ? `jump:${f.jump ?? 0}` : f.a) : 'none';
                      const choices = [...Object.entries(SCENE_FOLLOW_NAMES).map(([value, label]) => ({ value, label: label! })), ...Array.from({ length: scenes }, (_, k) => ({ value: `jump:${k}`, label: `Scene ${sceneName(song, k)}` }))];
                      const afters = [1, 2, 4, 8, 16].map((b) => ({ value: String(b * bar), label: b === 1 ? '1 bar' : `${b} bars` }));
                      return <>
                        <Select inline label="Then" value={then} choices={choices} onChange={(v) => {
                          if (v === 'none') { onSceneSetting(i, { follow: null }); return; }
                          const time = f?.time ?? 4 * bar;
                          onSceneSetting(i, { follow: v.startsWith('jump:') ? { a: 'jump', b: 'none', chance: 1, time, jump: Number(v.slice(5)) } : { a: v as Follow['a'], b: 'none', chance: 1, time } });
                        }} />
                        {f && <Select inline hideLabel label="Follow after" value={afters.some((a) => Number(a.value) === f.time) ? String(f.time) : String(4 * bar)} choices={afters}
                          onChange={(v) => onSceneSetting(i, { follow: { ...f, time: Number(v) } })} />}
                      </>;
                    })()}
                    {(set?.tempo !== undefined || set?.signature) && <IconButton className="studio-scene-clear" label={`Clear scene ${i + 1} tempo and time signature`} title="Return to default: the scene leaves the song’s tempo and time signature as they are" icon={CLEAR}
                      onClick={() => onSceneSetting(i, { tempo: null, signature: null })} />}
                  </span>
                )}
              </>;
            })()}
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
