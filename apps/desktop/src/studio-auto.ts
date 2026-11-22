// A track's automation in the Arrange view: which settings have a line, the lane's 0-to-1 points for one, and the
// overrides a hand on a control makes (Ableton Live 12 manual, 25 "Automation and Editing Envelopes", 25.4 overriding).
import { autoRange, returnName, type AutoPoint, type ReturnTrack, type Track } from './song-format';

/** The settings a track's lane can show: Volume, Pan, then a send per return track, by their engine names. */
export function autoChoices(returns: readonly ReturnTrack[] = []): { name: string; label: string }[] {
  return [{ name: 'volume', label: 'Volume' }, { name: 'pan', label: 'Pan' }, ...returns.map((r, i) => ({ name: `send:${r.id}`, label: `Send ${returnName(r, i)}` }))];
}

/** A setting's points as the lane draws them, 0 to 1 (pan's -1 to 1 maps onto it). */
export function toLane(points: readonly AutoPoint[], name: string): AutoPoint[] {
  const { lo, hi } = autoRange(name);
  return points.map((p) => ({ ...p, value: (p.value - lo) / (hi - lo) }));
}

/** The lane's edited points back in the setting's range, each keeping the bend of the point it was at that beat. */
export function fromLane(next: readonly { beat: number; value: number }[], was: readonly AutoPoint[], name: string): AutoPoint[] {
  const { lo, hi } = autoRange(name);
  return next.map((p) => {
    const point: AutoPoint = { beat: p.beat, value: Math.round((lo + p.value * (hi - lo)) * 1000) / 1000 };
    const curve = was.find((w) => w.beat === p.beat)?.curve;
    if (curve !== undefined) point.curve = curve;
    return point;
  });
}

/** A setting's own value on the lane's 0 to 1, drawn faint where it has no line. */
export function laneEmpty(track: Track, name: string): number {
  if (name === 'volume') return track.volume;
  if (name === 'pan') return (track.pan + 1) / 2;
  if (name.startsWith('send:')) return track.sends?.[name.slice(5)] ?? 0;
  return 0;
}

/** Sets a setting's line on the track, dropping it (and its override) when empty. */
export function setAuto(track: Track, name: string, points: AutoPoint[]): void {
  const auto = { ...(track.auto ?? {}) };
  if (points.length > 0) auto[name] = points; else delete auto[name];
  if (Object.keys(auto).length > 0) track.auto = auto; else delete track.auto;
  if (points.length === 0) reEnable(track, name);
}

/** A hand moved this setting: when it has a line it now plays the hand's value until automation is re-enabled. */
export function override(track: Track, name: string): void {
  if (!track.auto?.[name]?.length || track.autoOff?.includes(name)) return;
  track.autoOff = [...(track.autoOff ?? []), name];
}

/** Re-enables one setting's automation, or all of them with no name (Live 12, 25.4 "Re-Enable Automation"). */
export function reEnable(track: Track, name?: string): void {
  const left = name === undefined ? [] : (track.autoOff ?? []).filter((n) => n !== name);
  if (left.length > 0) track.autoOff = left; else delete track.autoOff;
}
