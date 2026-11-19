import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { findMatches } from './doc-find';

const schema = getSchema([StarterKit]);
const p = (...parts: string[]) => schema.node('paragraph', null, parts.map((t) => schema.text(t)));
const doc = schema.node('doc', null, [
  schema.node('heading', { level: 1 }, [schema.text('Boat plan')]),
  p('Book the boat. The ', 'boat', ' leaves at nine.'),
  p('BOAT hire is paid.'),
]);
const words = (q: string, matchCase = false) => findMatches(doc, q, matchCase).map((m) => doc.textBetween(m.from, m.to));

describe('findMatches', () => {
  it('finds every match in document order, across marks and paragraphs, ignoring case', () => {
    expect(words('boat')).toEqual(['Boat', 'boat', 'boat', 'BOAT']);
  });
  it('matches case when asked', () => {
    expect(words('boat', true)).toEqual(['boat', 'boat']);
  });
  it('finds nothing for an empty query or missing words', () => {
    expect(findMatches(doc, '', false)).toEqual([]);
    expect(words('ferry')).toEqual([]);
  });
  it('does not run a match from one paragraph into the next', () => {
    expect(words('nine.BOAT')).toEqual([]);
  });
});
