import { describe, expect, it } from 'vitest';
import { trashLeft } from './NotesSidebar';

describe('trashLeft', () => {
  const day = 86_400_000;
  it('counts the days until a deleted note goes for good, 30 days after it was deleted', () => {
    expect(trashLeft(0, 0)).toBe('30 days left');
    expect(trashLeft(0, 10 * day + 1)).toBe('20 days left');
    expect(trashLeft(0, 29 * day + 1)).toBe('Goes today');
    expect(trashLeft(0, 31 * day)).toBe('Goes today');
  });
});
