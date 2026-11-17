import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import type { Device } from './device-format';
import type { TrackColour } from './song-format';
import { benchBoxHeight, benchPatch } from './studio-bench';
import { Button, PatchCanvas, Port, layoutFlow, type PatchBox, type PatchLevels } from './ui';

/** How often the cables' levels are read while the song plays: about 30 times a second. */
const LEVEL_EVERY_MS = 33;

/**
 * The Workbench: one of the track's devices opened up, its parts as boxes and its cables between them, each cable
 * showing how loud the sound on it is while the song plays. For looking: nothing here moves or rewires yet.
 */
export function StudioWorkbench({ device, color, on, builtIn, levelOf, onClose }: {
  device: Device;
  color: TrackColour;
  /** The device is switched on; when off, nothing flows through it. */
  on: boolean;
  /** One of Music's four effects, shown as the device it is made of. */
  builtIn: boolean;
  /** How loud a part's output is now, in dB, or null when nothing is playing through it. */
  levelOf: (part: string) => number | null;
  onClose: () => void;
}) {
  // Built-in effects are made into a device on each render, so the picture is kept until the device itself changes.
  const shape = JSON.stringify(device);
  const patch = useMemo(() => benchPatch(device), [shape]); // eslint-disable-line react-hooks/exhaustive-deps
  const boxes = useMemo<PatchBox[]>(() => {
    const at = layoutFlow(patch.boxes, patch.cables, { column: 240, gap: 24, height: (b) => benchBoxHeight(patch.boxes.find((x) => x.id === b.id)!) });
    return patch.boxes.map((b) => ({
      id: b.id, title: b.title, color, inputs: b.inputs, outputs: b.outputs, ...at[b.id]!,
      children: b.settings.length > 0 || b.kindName ? (
        <div className="studio-bench-box">
          {b.kindName && <span className="studio-bench-kind">{b.kindName}</span>}
          {b.settings.map((s) => (
            <span key={s.key} className="studio-bench-setting">
              {s.moves ? <Port id={s.key} label={s.name} kind="control" /> : <span className="studio-bench-dot" aria-hidden="true" />}
              <span className="studio-bench-name">{s.name}</span>
              <span className="studio-bench-value">{s.text}</span>
            </span>
          ))}
        </div>
      ) : undefined,
    }));
  }, [patch, color]);

  // The cables' levels, read from the playing song and handed to the canvas without a re-render.
  const levels = useRef<PatchLevels>(null);
  const read = useRef(levelOf);
  read.current = levelOf;
  useEffect(() => {
    let frame = 0;
    let last = 0;
    let live = false;
    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      if (now - last < LEVEL_EVERY_MS) return;
      last = now;
      let heard = false;
      for (const c of patch.cables) {
        const db = read.current(patch.source[c.id]!);
        if (db === null) continue;
        heard = true;
        levels.current?.set(c.id, db);
      }
      if (live && !heard) levels.current?.reset();
      live = heard;
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); levels.current?.reset(); };
  }, [patch]);

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  return (
    <div className="studio-bench" role="region" aria-label={`Workbench: ${device.name}`} onKeyDown={keys}>
      <div className="studio-bench-head">
        <Button kind="quiet" onClick={onClose} keys="Esc">Back to devices</Button>
        <h3 className="studio-bench-title">{device.name}</h3>
        {builtIn && <span className="studio-bench-tag">Built in</span>}
        {!on && <span className="studio-bench-tag">Off</span>}
        {device.about && <p className="studio-bench-about">{device.about}</p>}
      </div>
      <PatchCanvas className="studio-bench-canvas" label={`${device.name} parts and cables`} boxes={boxes} cables={patch.cables} levels={levels} readOnly />
    </div>
  );
}
