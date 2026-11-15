import { describe, expect, it } from 'vitest';
import { canMoveOnDrive, driveSaying } from './Drives';

describe('drives', () => {
  it('says a file changed on the server plainly, and passes other answers on', () => {
    expect(driveSaying({ ok: false, conflict: true, message: 'x' }, 'Budget.csv')).toBe('“Budget.csv” changed on the server since Files listed it, so nothing was changed. The list now shows the server\'s version.');
    expect(driveSaying({ ok: false, conflict: false, message: 'The drive is full.' })).toBe('The drive is full.');
  });
  it('moves only into another folder, never into itself', () => {
    expect(canMoveOnDrive('A/b.txt', 'C')).toBe(true);
    expect(canMoveOnDrive('A/b.txt', 'A')).toBe(false);
    expect(canMoveOnDrive('A', 'A/B')).toBe(false);
    expect(canMoveOnDrive('A', 'A')).toBe(false);
    expect(canMoveOnDrive('A/b.txt', '')).toBe(true);
  });
});
