import { useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Knob } from './Instrument';

/**
 * Pieces of a browser panel (Music's Library first), after the Live 12 manual, "Working with the Browser"
 * (ableton.com/en/manual/working-with-the-browser/):
 *
 * - FilterBar (4.4): groups of tags under the search. A click picks one tag in its group, Ctrl or Cmd adds or takes
 *   back one more, and a click on the only tag picked clears the group. The results bar under it says how many filters
 *   are on, with Clear; there are no per-tag counts, as in Live.
 * - PreviewStrip (4.9): the foot of the panel. Preview on or off, the chosen file's shape as a scrub area, Raw (play at
 *   the file's own tempo, no loop) and the preview volume.
 */

export interface FilterGroup { id: string; name: string; tags: readonly string[] }
export type TagPicks = Readonly<Record<string, readonly string[]>>;

/** How many tags are picked across all groups. */
export const filterCount = (value: TagPicks): number => Object.values(value).reduce((n, tags) => n + tags.length, 0);

/** The next value after a click on `tag` in `group`: alone without `add`, added or taken back with it (Ctrl or Cmd). */
export function pickTag(value: TagPicks, group: string, tag: string, add: boolean): TagPicks {
  const now = value[group] ?? [];
  const has = now.includes(tag);
  const next = add ? (has ? now.filter((t) => t !== tag) : [...now, tag]) : has && now.length === 1 ? [] : [tag];
  const out: Record<string, readonly string[]> = { ...value };
  if (next.length) out[group] = next;
  else delete out[group];
  return out;
}

export function FilterBar({ groups, value, onChange, label = 'Filters', onClear }: {
  groups: readonly FilterGroup[];
  value: TagPicks;
  onChange: (next: TagPicks) => void;
  label?: string;
  /** Clear also empties the search, as in Live; the app passes that here. Without it, Clear empties the tags only. */
  onClear?: () => void;
}) {
  const count = filterCount(value);
  const click = (group: string, tag: string) => (e: MouseEvent<HTMLButtonElement>) => onChange(pickTag(value, group, tag, e.ctrlKey || e.metaKey));
  return (
    <div className="ui-filters" role="group" aria-label={label}>
      {groups.map((g) => (
        <div key={g.id} className="ui-filter-group" role="group" aria-label={g.name}>
          <span className="ui-filter-name" aria-hidden="true">{g.name}</span>
          <div className="ui-filter-tags">
            {g.tags.map((tag) => {
              const on = (value[g.id] ?? []).includes(tag);
              return (
                <button key={tag} type="button" className="ui-chip" aria-pressed={on} title={on ? undefined : 'Ctrl-click to pick more than one'} onClick={click(g.id, tag)}>
                  <span className="ui-chip-text">{tag}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="ui-filter-results" role="status">
        {/* Nothing picked says nothing (Live's browser has no empty line): the row appears with the first tag. */}
        {count > 0 && <span>{count === 1 ? '1 filter' : `${count} filters`}</span>}
        {count > 0 && <button type="button" className="ui-filter-clear" onClick={() => { onChange({}); onClear?.(); }}>Clear</button>}
      </div>
    </div>
  );
}

const HEADPHONES = 'M3 10V8.5a5 5 0 0 1 10 0V10M3 10h2v3.5H3.8a.8.8 0 0 1-.8-.8zM13 10h-2v3.5h1.2a.8.8 0 0 0 .8-.8z';

export function PreviewStrip({ on, onToggle, raw, onRaw, name, peaks, position, onScrub, volume, onVolume, keys = 'Shift+Enter' }: {
  /** Preview on: choosing a row (Up and Down too) plays it. */
  on: boolean;
  onToggle: (on: boolean) => void;
  /** Raw: the file's own tempo, no loop. Off: starts on the next bar and loops in time. */
  raw: boolean;
  onRaw: (raw: boolean) => void;
  /** What is chosen, shown with its shape; nothing chosen leaves the strip empty. */
  name?: string;
  /** Its shape, one peak (0 to 1) per slice. */
  peaks?: readonly number[];
  /** Where the preview is, 0 to 1, while it plays. */
  position?: number;
  /** A click on the shape plays from there (not for Raw files that can't be scrubbed: leave it out). */
  onScrub?: (at: number) => void;
  /** Preview volume, in dB. */
  volume: number;
  onVolume: (db: number) => void;
  /** The key that previews the chosen row while Preview is off. */
  keys?: string;
}) {
  const area = useRef<HTMLDivElement>(null);
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const box = area.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
  };
  const scrubKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onScrub) return;
    const now = position ?? 0;
    const by = e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowLeft' ? -0.05 : 0;
    if (by) { e.preventDefault(); onScrub(Math.min(1, Math.max(0, now + by))); }
    else if (e.key === 'Home') { e.preventDefault(); onScrub(0); }
  };
  const n = Math.max(2, peaks?.length ?? 0);
  const shape = peaks?.length
    ? `M ${peaks.map((p, i) => `${i} ${(50 - Math.min(1, p) * 46).toFixed(1)}`).join(' L ')} L ${[...peaks].reverse().map((p, i) => `${peaks.length - 1 - i} ${(50 + Math.min(1, p) * 46).toFixed(1)}`).join(' L ')} Z`
    : '';
  return (
    <div className="ui-preview" role="group" aria-label="Preview">
      <button type="button" className="ui-preview-toggle" aria-pressed={on} aria-label="Preview" title={on ? 'Preview: on' : `Preview: off (${keys} previews the chosen item)`} onClick={() => onToggle(!on)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d={HEADPHONES} /></svg>
      </button>
      <div
        ref={area}
        className="ui-preview-shape"
        data-empty={!name || undefined}
        role={onScrub ? 'slider' : undefined}
        tabIndex={onScrub && name ? 0 : undefined}
        aria-label={name ? `Play ${name} from` : undefined}
        aria-valuemin={onScrub ? 0 : undefined}
        aria-valuemax={onScrub ? 100 : undefined}
        aria-valuenow={onScrub ? Math.round((position ?? 0) * 100) : undefined}
        title={name}
        onPointerDown={(e) => { if (onScrub && name && e.button === 0) onScrub(at(e)); }}
        onKeyDown={scrubKey}
      >
        {name ? (
          <>
            {shape && <svg viewBox={`0 0 ${n - 1} 100`} preserveAspectRatio="none" aria-hidden="true"><path d={shape} /></svg>}
            {!shape && <span className="ui-preview-name">{name}</span>}
            {position !== undefined && <span className="ui-preview-head" style={{ left: `${position * 100}%` }} />}
          </>
        ) : <span className="ui-preview-name">Nothing chosen</span>}
      </div>
      <button type="button" className="ui-preview-raw" aria-pressed={raw} title={raw ? 'Raw: at its own tempo, once' : 'Raw: off, so it starts on the next bar and loops in time'} onClick={() => onRaw(!raw)}>Raw</button>
      <Knob className="ui-preview-volume" label="Preview volume" value={volume} onChange={onVolume} min={-60} max={6} step={0.5} reset={0} unit="dB" />
    </div>
  );
}
