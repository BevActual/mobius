import { describe, expect, it } from 'vitest';
import { listEndLine, nameFor } from './Mail';

describe('listEndLine', () => {
  it('says a view is empty in one plain line', () => {
    expect(listEndLine({ kind: 'box', box: 'inbox', category: 'all' }, 0, '')).toBe('Your inbox is empty.');
    expect(listEndLine({ kind: 'box', box: 'flagged', category: 'all' }, 0, '')).toBe('No flagged mail. Flag a message to keep it here.');
    expect(listEndLine({ kind: 'drafts', only: 'mobius' }, 0, '')).toBe('No suggested replies to review.');
    expect(listEndLine({ kind: 'box', box: 'inbox', category: 'all' }, 0, 'kestrel')).toBe('Nothing matches.');
  });
  it('ends a short list quietly', () => {
    expect(listEndLine({ kind: 'box', box: 'inbox', category: 'primary' }, 3, '')).toBe('That’s everything in your inbox.');
    expect(listEndLine({ kind: 'box', box: 'sent', category: 'all' }, 2, '')).toBe('That’s everything in Sent.');
    expect(listEndLine({ kind: 'drafts' }, 1, '')).toBe('That’s every draft.');
  });
});

describe('nameFor', () => {
  const messages = [{ from: { name: 'Priya Nair', email: 'priya@northway.example' } }] as unknown as Parameters<typeof nameFor>[1];
  it('shows the name a message from that address gave', () => {
    expect(nameFor('priya@northway.example', messages)).toBe('Priya Nair');
    expect(nameFor('Priya <PRIYA@northway.example>, sam@x.example', messages)).toBe('Priya Nair');
  });
  it('falls back to the name in the address, then the address', () => {
    expect(nameFor('"Sam Okafor" <sam@x.example>', messages)).toBe('Sam Okafor');
    expect(nameFor('sam@x.example', messages)).toBe('sam@x.example');
  });
});
