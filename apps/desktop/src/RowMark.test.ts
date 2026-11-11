import { describe, expect, it } from 'vitest';
import { RowMark } from './RowMark';

const kind = (props: Parameters<typeof RowMark>[0]) => (RowMark(props) as { props: Record<string, unknown> } | null)?.props['data-kind'] ?? null;

describe('the one mark on a sidebar row', () => {
  it('shows the one that most needs the person when several apply', () => {
    expect(kind({ changed: true, unread: true, comment: true })).toBe('changed');
    expect(kind({ unread: true, comment: true })).toBe('unread');
    expect(kind({ comment: true })).toBe('comment');
    expect(kind({})).toBeNull();
  });
  it('says what it means on hover', () => {
    expect((RowMark({ unread: true }) as { props: Record<string, unknown> }).props.title).toBe('Unread');
    expect((RowMark({ changed: true, changedTitle: 'Edited by Mobius' }) as { props: Record<string, unknown> }).props.title).toBe('Edited by Mobius');
  });
});
