import { describe, expect, it } from 'vitest';
import { appsOf, rewindQuestion } from './Rewind';

describe('rewind to here', () => {
  it('names the apps that will change, each once', () => {
    expect(appsOf(['notes/Work/Plan.md', 'sheets/Budget/Sheet 1.csv', 'notes/Home/List.md', 'tasks/Inbox.md'])).toEqual(['Notes', 'Sheets', 'Tasks']);
    expect(appsOf([])).toEqual([]);
  });

  it('asks once, saying how many later turns go and what will change', () => {
    expect(rewindQuestion(3, ['Mail', 'Sheets'])).toBe('Rewind 3 later turns? Mail, Sheets will change.');
    expect(rewindQuestion(1, ['Notes'])).toBe('Rewind 1 later turn? Notes will change.');
    expect(rewindQuestion(0, [])).toBe('Rewind to here? Nothing in your apps will change.');
  });
});
