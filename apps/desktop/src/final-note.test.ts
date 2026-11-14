import { describe, expect, it } from 'vitest';
import { finalNote, finalVerb } from './actions';

describe('what an approval says cannot be undone', () => {
  it('names sending, paying, deleting and running', () => {
    expect(finalNote('mail.send')).toBe('Sending can’t be undone.');
    expect(finalNote('mail-send')).toBe('Sending can’t be undone.');
    expect(finalNote('payments.pay')).toBe('Paying can’t be undone.');
    expect(finalNote('files.delete')).toBe('Deleting can’t be undone.');
    expect(finalNote('code.run')).toBe('Running it can’t be undone.');
    expect(finalNote('terminal.exec')).toBe('Running it can’t be undone.');
  });
  it('says nothing for what can be put back', () => {
    for (const t of ['clock.now', 'mail.draft', 'files.write', 'todo-write', 'browser.navigate']) expect(finalNote(t)).toBeNull();
  });
});

describe('the verb on the button that goes ahead', () => {
  it('is the action for what cannot be undone, and nothing otherwise', () => {
    expect(['mail.send', 'payments.pay', 'files.delete', 'code.run'].map(finalVerb)).toEqual(['Send', 'Pay', 'Delete', 'Run']);
    expect(finalVerb('clock.now')).toBeNull();
  });
});
