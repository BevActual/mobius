import { describe, expect, it } from 'vitest';
import { hasTag, tagCounts, tagsIn } from './note-tags';

describe('tags in a note', () => {
  it('reads the same tags the Rust list does', () => {
    const page = '# Plan #intitle\n\nCall Sam #kestrel/p2 and #Supplier.\n## Heading\nSee page#part, \\#escaped, `#code` and #42.\n```\n#fenced\n```\n(#inbrackets) #supplier again #trail-\n';
    expect(tagsIn(page)).toEqual(['inbrackets', 'intitle', 'kestrel/p2', 'Supplier', 'trail']);
    expect(tagsIn('# Only a title\n')).toEqual([]);
  });
  it('a parent tag holds the tags under it', () => {
    expect(hasTag(['kestrel/p2'], 'Kestrel')).toBe(true);
    expect(hasTag(['kestrels'], 'kestrel')).toBe(false);
    expect(hasTag(undefined, 'x')).toBe(false);
  });
  it('counts each tag across pages, whatever its case', () => {
    expect(tagCounts([{ tags: ['Supplier', 'launch'] }, { tags: ['supplier'] }, {}])).toEqual([{ tag: 'launch', count: 1 }, { tag: 'Supplier', count: 2 }]);
  });
});

describe('tag ranges', () => {
  it('covers the # and the tag, not a trailing dash', async () => {
    const { tagRanges } = await import('./note-tags');
    expect(tagRanges('Call #sam- and (#p2)')).toEqual([[5, 9], [16, 19]]);
  });
});
