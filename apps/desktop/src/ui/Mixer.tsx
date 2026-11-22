import { useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from 'react';
import type { ContentColor } from './Bits';
import { Knob, panLabel } from './Instrument';
import { LetterToggle, LevelMeter, decibelLabel, levelPosition, type LevelFeed } from './Pro';
import { useGlide } from './Slider';

/**
 * A mixer channel strip, top to bottom: the track's name on its colour, pan, the fader beside the level meter, the
 * volume readout, then Mute, Solo and (when the track records) Arm. Strips sit side by side in a mixer; Music's mixer
 * view first, then Video's audio. The fader and the meter share one scale (`floor` to `ceiling` dB), so the fader's
 * cap sits at the level it lets through.
 *
 * Fader keys: Up and Down move half a decibel, Shift three; Page Up and Page Down six; Home puts it back to
 * `volumeReset`, End pulls it all the way down. Two quick presses on the cap also put it back.
 * `proposed` marks what Mobius moved and nobody has kept yet, and a volume changed from outside glides to its value.
 */
export interface MixerStripProps {
  name: string;
  color?: ContentColor;
  /** Volume in dB; at or under `floor` reads as off (−∞). Leave out (with `onVolume`) for a strip whose volume can't be
   *  set yet: the fader's track stays, empty, so the strip still lines up. */
  volume?: number;
  onVolume?: (db: number) => void;
  onVolumeCommit?: (db: number) => void;
  volumeReset?: number;
  /** −1 (left) to 1 (right). Leave out (with `onPan`) for the Main strip: its place stays empty, so the faders line up. */
  pan?: number;
  onPan?: (pan: number) => void;
  onPanCommit?: (pan: number) => void;
  /** Leave mute and solo out for the Main strip (Live's Main has neither): their row stays, empty. */
  mute?: boolean;
  onMute?: (on: boolean) => void;
  solo?: boolean;
  onSolo?: (on: boolean) => void;
  /** Leave out for a strip that can't record (a return or the main out). */
  arm?: boolean;
  onArm?: (on: boolean) => void;
  /** Another strip is soloed, so this one is silent: its letters and name dim. */
  dimmed?: boolean;
  /** The strip whose track is chosen. */
  selected?: boolean;
  onSelect?: () => void;
  /** The level meter's feed: `meter.current.set(left, right)`. */
  meter?: Ref<LevelFeed>;
  proposed?: { volume?: boolean; pan?: boolean };
  floor?: number;
  ceiling?: number;
  disabled?: boolean;
  className?: string;
}

const RESET_MS = 400;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** "−3.0 dB", "+1.5 dB", "−∞" at or below the floor. */
export const faderLabel = (db: number, floor = -60): string => (db <= floor ? '−∞' : `${db > 0 ? '+' : ''}${decibelLabel(db, 1)}`);

export function MixerStrip({
  name, color, volume: given, onVolume, onVolumeCommit, volumeReset = 0, pan, onPan, onPanCommit, mute, onMute, solo, onSolo, arm, onArm,
  dimmed, selected, onSelect, meter, proposed, floor = -60, ceiling = 6, disabled, className,
}: MixerStripProps) {
  const id = useId();
  const fixed = given === undefined || !onVolume;
  const volume = given ?? floor;
  const own = useRef<number | null>(null);
  const last = useRef(0);
  const put = (db: number) => {
    const next = Math.round(clamp(db, floor, ceiling) * 10) / 10;
    own.current = next;
    onVolume?.(next);
    return next;
  };
  const shown = useGlide(volume, own);
  const at = levelPosition(shown, floor, ceiling);
  const fromY = (el: HTMLElement, y: number) => {
    const box = el.getBoundingClientRect();
    return floor + (1 - (y - box.top) / box.height) * (ceiling - floor);
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || fixed || e.button !== 0) return;
    e.preventDefault();
    const track = e.currentTarget;
    (track.querySelector('[role="slider"]') as HTMLElement | null)?.focus();
    const now = performance.now();
    if (now - last.current < RESET_MS) { last.current = 0; const v = put(volumeReset); onVolumeCommit?.(v); return; }
    last.current = now;
    track.setPointerCapture(e.pointerId);
    put(fromY(track, e.clientY));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) put(fromY(e.currentTarget, e.clientY));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) { e.currentTarget.releasePointerCapture(e.pointerId); onVolumeCommit?.(volume); }
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (fixed) return;
    const step = e.shiftKey ? 3 : 0.5;
    const from = volume <= floor ? floor : volume;
    const to = e.key === 'ArrowUp' ? from + step : e.key === 'ArrowDown' ? from - step : e.key === 'PageUp' ? from + 6 : e.key === 'PageDown' ? from - 6
      : e.key === 'Home' ? volumeReset : e.key === 'End' ? floor : null;
    if (to === null) return;
    e.preventDefault();
    // Not `onVolumeCommit?.(put(to))`: without a commit handler, `?.` would skip `put` and the key would do nothing.
    const v = put(to);
    onVolumeCommit?.(v);
  };
  return (
    <div
      className={className ? `ui-strip ${className}` : 'ui-strip'}
      role="group"
      aria-labelledby={`${id}-name`}
      data-color={color}
      data-selected={selected || undefined}
      data-dimmed={dimmed || undefined}
      data-disabled={disabled || undefined}
    >
      <button type="button" id={`${id}-name`} className="ui-strip-name" title={name} aria-pressed={onSelect ? !!selected : undefined} disabled={!onSelect} onClick={onSelect}>{name}</button>
      {/* The knob and its readout say "pan" (Live prints no label): the name is for screen readers. */}
      {pan !== undefined && onPan
        ? <Knob className="ui-strip-pan" label="Pan" value={pan} min={-1} max={1} step={0.01} reset={0} format={panLabel} proposed={proposed?.pan} disabled={disabled} onChange={onPan} {...(onPanCommit ? { onCommit: onPanCommit } : {})} />
        : <span className="ui-strip-pan ui-strip-empty" aria-hidden="true" />}
      <div className="ui-strip-body">
        <div className="ui-strip-fader" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <span className="ui-strip-zero" aria-hidden="true" style={{ bottom: `${levelPosition(0, floor, ceiling) * 100}%` }} />
          {!fixed && <div
            className="ui-strip-cap"
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`${name} volume`}
            aria-valuemin={floor}
            aria-valuemax={ceiling}
            aria-valuenow={Math.max(volume, floor)}
            aria-valuetext={volume <= floor ? 'Off' : decibelLabel(volume, 1)}
            aria-disabled={disabled || undefined}
            data-proposed={proposed?.volume || undefined}
            style={{ bottom: `${at * 100}%` } as CSSProperties}
            onKeyDown={key}
          />}
        </div>
        <LevelMeter ref={meter} label={`${name} level`} floor={floor} ceiling={ceiling} />
      </div>
      <span className="ui-strip-value" hidden={fixed || undefined} data-proposed={proposed?.volume || undefined} data-changed={volume !== volumeReset || undefined}>{faderLabel(shown === volume ? volume : Math.round(shown * 10) / 10, floor)}</span>
      <div className="ui-strip-letters">
        {onMute && <LetterToggle letter="M" label={`Mute ${name}`} pressed={!!mute} dimmed={dimmed} disabled={disabled} onChange={onMute} />}
        {onSolo && <LetterToggle letter="S" label={`Solo ${name}`} pressed={!!solo} disabled={disabled} onChange={onSolo} />}
        {onArm && <LetterToggle letter="R" label={`Arm ${name} to record`} pressed={!!arm} armed disabled={disabled} onChange={onArm} />}
      </div>
    </div>
  );
}

/** A send's amount as a strip shows it: −∞ when off, else its level in whole dB (Live prints -inf and dB). `v` is a gain, 0 to 1. */
export const sendLabel = (v: number): string => (v <= 0.001 ? '\u2212\u221e' : String(Math.round(Math.max(-60, 20 * Math.log10(v)))).replace('-', '\u2212'));

export interface SendKnobProps {
  /** The return's letter (A, B, C…) or its short name, shown beside the dial. */
  letter: string;
  /** Read aloud; defaults to "Send A". */
  label?: string;
  /** How much goes to the return, as a gain from 0 (off) to 1 (0 dB). */
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  /** Mobius moved it and nobody has kept it yet. */
  proposed?: boolean;
  disabled?: boolean;
}

/**
 * One send of a mixer strip, as in Live's Mixer: the return's letter, a small dial and its level in dB. Live 12 manual,
 * Mixing: "Return Tracks and the Main Track" (each track's Send knobs set how much goes to each return) and "The Mixer
 * Section" (sends sit above pan). https://www.ableton.com/en/live-manual/12/mixing/
 */
export function SendKnob({ letter, label, value, onChange, onCommit, proposed, disabled }: SendKnobProps) {
  return (
    <span className="ui-send">
      <span className="ui-send-letter" aria-hidden="true">{letter}</span>
      <Knob className="ui-send-knob" label={label ?? `Send ${letter}`} value={value} min={0} max={1} step={0.01} reset={0} format={sendLabel}
        proposed={proposed} disabled={disabled} onChange={onChange} {...(onCommit ? { onCommit } : {})} />
    </span>
  );
}

/**
 * The sends of one strip, for MixerStrip's `sends`. Every strip in a mixer passes the same `count` (the number of
 * returns), so their faders line up: a strip with no sends (a return, Main) passes `<Sends count={n} />` with no
 * children and keeps the room empty.
 */
export function Sends({ count, label, children }: { count: number; label?: string; children?: ReactNode }) {
  if (count <= 0) return null;
  const style = { '--sends': count } as CSSProperties;
  return children
    ? <span className="ui-sends" role="group" aria-label={label ?? 'Sends'} style={style}>{children}</span>
    : <span className="ui-sends" data-empty aria-hidden="true" style={style} />;
}
