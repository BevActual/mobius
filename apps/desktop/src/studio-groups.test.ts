import { describe, expect, it } from 'vitest';
import { audible, parseSong, writeSong, type Song, type Track } from './song-format';
import { deleteGroup, groupRows, groupTracks, leaveGroup, soloInside, tracksIn, ungroup } from './studio-groups';

const track = (id: string, extra: Partial<Track> = {}): Track => ({ id, name: id.toUpperCase(), instrument: 'piano', volume: 0.8, pan: 0, muted: false, solo: false, color: 'blue', clips: [], ...extra });
const song = (...tracks: Track[]): Song => ({ version: 2, tempo: 120, key: 'C major', bars: 4, tracks });
const shown = (s: Song) => groupRows(s).map((r) => `${'  '.repeat(r.depth)}${r.kind === 'group' ? r.group.name : r.track.id}${r.hidden ? ' (hidden)' : ''}`);

describe('group tracks (Live 12, 18.3)', () => {
  it('groups tracks together where the first was, and shows the group above them', () => {
    const s = song(track('a'), track('b'), track('c'), track('d'));
    const id = groupTracks(s, ['d', 'b']);
    expect(id).toBe('g-1');
    expect(s.tracks.map((t) => t.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(shown(s)).toEqual(['a', 'Group', '  b', '  d', 'c']);
    expect(s.groups![0]).toMatchObject({ name: 'Group', volume: 0.8, pan: 0 });
    expect(tracksIn(s, 'g-1').map((t) => t.id)).toEqual(['b', 'd']);
  });

  it('nests a group in a new one, names each anew, and folds to hide what is inside', () => {
    const s = song(track('a'), track('b'), track('c'));
    const inner = groupTracks(s, ['a', 'b'])!;
    const outer = groupTracks(s, [inner, 'c'])!;
    expect(s.groups!.map((g) => g.name)).toEqual(['Group', 'Group 2']);
    expect(shown(s)).toEqual(['Group 2', '  Group', '    a', '    b', '  c']);
    s.groups!.find((g) => g.id === outer)!.folded = true;
    expect(shown(s)).toEqual(['Group 2', '  Group (hidden)', '    a (hidden)', '    b (hidden)', '  c (hidden)']);
    // Grouping inside a group keeps the new one in it.
    const s2 = song(track('a'), track('b'), track('c'));
    const g = groupTracks(s2, ['a', 'b', 'c'])!;
    const sub = groupTracks(s2, ['a', 'b'])!;
    expect(s2.groups!.find((x) => x.id === sub)!.group).toBe(g);
  });

  it('ungroups into the group around it, leaves one track out, and deletes a group with all it holds', () => {
    const s = song(track('a'), track('b'), track('c'));
    const inner = groupTracks(s, ['a', 'b'])!;
    const outer = groupTracks(s, [inner, 'c'])!;
    ungroup(s, inner);
    expect(s.tracks.filter((t) => t.group === outer).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    leaveGroup(s, 'c');
    expect(s.tracks.find((t) => t.id === 'c')!.group).toBeUndefined();
    expect(deleteGroup(s, outer)).toEqual(['a', 'b']);
    expect(s.tracks.map((t) => t.id)).toEqual(['c']);
    expect(s.groups).toBeUndefined();
  });

  it("hears a group's mute and solo in every track inside it", () => {
    const s = song(track('a'), track('b'), track('c'));
    const g = groupTracks(s, ['a', 'b'])!;
    s.groups![0]!.muted = true;
    expect(audible(s).map((t) => t.id)).toEqual(['c']);
    s.groups![0]!.muted = false;
    s.groups![0]!.solo = true;
    expect(audible(s).map((t) => t.id)).toEqual(['a', 'b']);
    s.groups![0]!.solo = false;
    s.tracks[0]!.solo = true;
    expect(soloInside(s, s.groups!.find((x) => x.id === g)!)).toBe(true);
  });

  it('reads and writes groups, dropping a group it is in that is not there and breaking a loop of groups', () => {
    const parsed = parseSong(JSON.stringify({ version: 2, tempo: 120, bars: 2, groups: [{ id: 'g', name: 'Drums', volume: 0.5, folded: true, group: 'h' }, { id: 'h', group: 'g' }, { id: 'k', group: 'nope' }], tracks: [{ id: 'a', group: 'g' }, { id: 'b', group: 'missing' }] }));
    if (!('song' in parsed)) throw new Error('not read');
    const s = parsed.song;
    expect(s.groups!.map((g) => [g.id, g.name, g.group ?? ''])).toEqual([['g', 'Drums', ''], ['h', 'Group', 'g'], ['k', 'Group', '']]);
    expect(s.groups![0]).toMatchObject({ volume: 0.5, folded: true });
    expect(s.tracks.map((t) => t.group ?? '')).toEqual(['g', '']);
    const again = parseSong(writeSong(s));
    if (!('song' in again)) throw new Error('not read again');
    expect(again.song.groups).toEqual(s.groups);
    expect(again.song.tracks[0]!.group).toBe('g');
  });
});
