import { describe, expect, it } from 'vitest';
import { saveAll, saveBeforeQuit } from './saveBeforeQuit';

describe('saving before quitting', () => {
  it('saves every registered editor, past a failing one, and not one that left', async () => {
    const saved: string[] = [];
    const notes = saveBeforeQuit(async () => { saved.push('notes'); });
    const broken = saveBeforeQuit(async () => { throw new Error('disk full'); });
    const gone = saveBeforeQuit(async () => { saved.push('gone'); });
    gone();
    const docs = saveBeforeQuit(async () => { saved.push('docs'); });
    await saveAll();
    expect(saved.sort()).toEqual(['docs', 'notes']);
    notes(); broken(); docs();
  });
});
