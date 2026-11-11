import { describe, expect, it } from 'vitest';
import type { NoteComment } from '@mobius/shared';
import { commentLine, commentsOutline } from './NoteComments';
import { noteContext } from './surface';

const c = (id: string, text: string, more: Partial<NoteComment> = {}): NoteComment => ({ id, quote: 'May 14', text, by: 'you', whenMs: 1, resolved: false, ...more });

describe('comments for Mobius', () => {
  it('lists open threads with ids and replies, and leaves resolved ones out', () => {
    const all = [c('c1', 'Is this  the date?'), c('r1', 'Yes.', { replyTo: 'c1', by: 'Mobius', quote: '' }), c('c2', 'Done', { resolved: true })];
    const out = commentsOutline(all, 'docs/Plan.md');
    expect(out).toContain('page docs/Plan.md');
    expect(out).toContain('- [c1] Me on “May 14”: Is this the date?\n    - Mobius: Yes.');
    expect(out).not.toContain('c2');
    expect(commentsOutline([c('c2', 'x', { resolved: true })], 'docs/Plan.md')).toBe('');
  });
  it('writes a new comment without an id', () => {
    expect(commentLine(c('', 'Shorter?'), [])).toBe('- Me on “May 14”: Shorter?');
  });
  it('keeps the comments after a long page', () => {
    const item = noteContext({ path: 'Plan.md', title: 'Plan', text: 'x'.repeat(500_000), folder: 'docs', extra: 'Open comments' });
    expect(item.text.endsWith('---\nOpen comments')).toBe(true);
  });
});
