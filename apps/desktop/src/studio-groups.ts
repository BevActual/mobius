// Group tracks (Live 12 manual, 18.3 "Group Tracks"): putting tracks in a group, taking them out again, folding it,
// and the rows Arrange and the Mixer show, each group above what is in it.
import { MAX_GROUPS, groupsUp, type GroupTrack, type Song, type Track } from './song-format';

/** One row of the track list: a group or a track, how deep in groups it sits, and whether a folded group hides it. */
export type GroupRow =
  | { kind: 'group'; group: GroupTrack; depth: number; hidden: boolean }
  | { kind: 'track'; track: Track; depth: number; hidden: boolean };

/** A fresh group's id: never a track's, a return's or another group's (the engine reports meters by id). */
export function freshGroupId(song: Song): string {
  const taken = new Set([...song.tracks.map((t) => t.id), ...(song.returns ?? []).map((r) => r.id), ...(song.groups ?? []).map((g) => g.id)]);
  let n = (song.groups?.length ?? 0) + 1;
  while (taken.has(`g-${n}`)) n++;
  return `g-${n}`;
}

/** The group a track or group is in, by id ('' for none). */
const parentOf = (song: Song, id: string): string => song.tracks.find((t) => t.id === id)?.group ?? song.groups?.find((g) => g.id === id)?.group ?? '';

/** Whether `id` (a track or group) is `group` or inside it, however deep. */
export function isIn(song: Song, id: string, group: string): boolean {
  if (id === group) return true;
  return groupsUp(song, parentOf(song, id) || undefined).some((g) => g.id === group);
}

/** The tracks in a group, however deep, in song order. */
export const tracksIn = (song: Song, group: string): Track[] => song.tracks.filter((t) => t.group && isIn(song, t.id, group));

/**
 * The track list as Arrange and the Mixer show it: each group where its first track is, above what is in it (tracks
 * and groups, in the order they first come), indented by depth; a group with nothing in it comes last in the group it
 * is in. A folded group hides everything in it.
 */
export function groupRows(song: Song): GroupRow[] {
  const groups = song.groups ?? [];
  if (groups.length === 0) return song.tracks.map((track) => ({ kind: 'track', track, depth: 0, hidden: false }));
  const known = new Set(groups.map((g) => g.id));
  // Each container's children ('' is the song itself), in the order they first come.
  const children = new Map<string, string[]>();
  const add = (parent: string, id: string) => { const list = children.get(parent) ?? []; if (!list.includes(id)) list.push(id); children.set(parent, list); };
  for (const t of song.tracks) {
    // The chain of groups from the outermost down to the track, each added to the one above it.
    const chain = groupsUp(song, t.group).reverse();
    let parent = '';
    for (const g of chain) { add(parent, g.id); parent = g.id; }
    add(parent, t.id);
  }
  for (const g of groups) {
    const up = groupsUp(song, g.group).reverse();
    let parent = '';
    for (const p of up) { add(parent, p.id); parent = p.id; }
    add(parent, g.id);
  }
  const rows: GroupRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number, hidden: boolean) => {
    for (const id of children.get(parent) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (known.has(id)) {
        const group = groups.find((g) => g.id === id)!;
        rows.push({ kind: 'group', group, depth, hidden });
        walk(id, depth + 1, hidden || !!group.folded);
      } else {
        const track = song.tracks.find((t) => t.id === id);
        if (track) rows.push({ kind: 'track', track, depth, hidden });
      }
    }
  };
  walk('', 0, false);
  return rows;
}

/**
 * Puts tracks and groups (by id) in a new group (Live's Group Tracks, Ctrl+G), in the group they shared if they all
 * shared one; the tracks are moved together where the first of them was. Returns the new group's id, or null when
 * there is nothing to group or the song has as many groups as it keeps.
 */
export function groupTracks(song: Song, ids: readonly string[]): string | null {
  const groups = song.groups ?? [];
  const picked = ids.filter((id) => song.tracks.some((t) => t.id === id) || groups.some((g) => g.id === id));
  if (picked.length === 0 || groups.length >= MAX_GROUPS) return null;
  // A group picked with something inside it takes that along: only the outermost of what was picked moves.
  const outer = picked.filter((id) => !picked.some((other) => other !== id && groups.some((g) => g.id === other) && isIn(song, id, other)));
  const parents = new Set(outer.map((id) => parentOf(song, id)));
  const parent = parents.size === 1 ? [...parents][0]! : '';
  const id = freshGroupId(song);
  const first = song.tracks.find((t) => outer.some((o) => isIn(song, t.id, o)));
  const group: GroupTrack = { id, name: groupName(song), color: first?.color ?? 'blue', volume: 0.8, pan: 0 };
  if (parent) group.group = parent;
  for (const o of outer) {
    const t = song.tracks.find((x) => x.id === o);
    if (t) t.group = id;
    const g = groups.find((x) => x.id === o);
    if (g) g.group = id;
  }
  song.groups = [...groups, group];
  // Its tracks side by side, where the first of them was.
  const inside = song.tracks.filter((t) => isIn(song, t.id, id));
  const at = song.tracks.indexOf(inside[0]!);
  const rest = song.tracks.filter((t) => !inside.includes(t));
  const before = song.tracks.slice(0, at).filter((t) => !inside.includes(t)).length;
  song.tracks = [...rest.slice(0, before), ...inside, ...rest.slice(before)];
  return id;
}

/** A new group's name: "Group", then "Group 2" and on, as none has. */
function groupName(song: Song): string {
  const names = new Set((song.groups ?? []).map((g) => g.name));
  if (!names.has('Group')) return 'Group';
  let n = 2;
  while (names.has(`Group ${n}`)) n++;
  return `Group ${n}`;
}

/** Takes a group away and puts what was in it in the group it was in (Live's Ungroup Tracks, Ctrl+Shift+G). */
export function ungroup(song: Song, group: string): void {
  const g = song.groups?.find((x) => x.id === group);
  if (!g) return;
  for (const t of song.tracks) if (t.group === group) { if (g.group) t.group = g.group; else delete t.group; }
  for (const x of song.groups ?? []) if (x.group === group) { if (g.group) x.group = g.group; else delete x.group; }
  song.groups = song.groups!.filter((x) => x !== g);
  if (song.groups.length === 0) delete song.groups;
}

/** Deletes a group and everything in it: its tracks and the groups in it (18.3: "Deleting a Group Track deletes all of its contents"). Returns the tracks' ids. */
export function deleteGroup(song: Song, group: string): string[] {
  if (!song.groups?.some((g) => g.id === group)) return [];
  const gone = song.tracks.filter((t) => isIn(song, t.id, group)).map((t) => t.id);
  song.groups = song.groups.filter((g) => !isIn(song, g.id, group));
  song.tracks = song.tracks.filter((t) => !gone.includes(t.id));
  if (song.groups.length === 0) delete song.groups;
  return gone;
}

/** Takes one track out of its group, into the group that one is in. */
export function leaveGroup(song: Song, track: string): void {
  const t = song.tracks.find((x) => x.id === track);
  if (!t?.group) return;
  const up = song.groups?.find((g) => g.id === t.group)?.group;
  if (up) t.group = up; else delete t.group;
}

/** Whether a group has something soloed inside it but is not soloed itself: Live shows its Solo half lit. */
export function soloInside(song: Song, group: GroupTrack): boolean {
  if (group.solo) return false;
  return song.tracks.some((t) => t.solo && t.group && isIn(song, t.id, group.id)) || (song.groups ?? []).some((g) => g.solo && g.id !== group.id && isIn(song, g.id, group.id));
}
