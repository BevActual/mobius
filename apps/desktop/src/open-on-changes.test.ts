import { describe, expect, it } from 'vitest';
import { openOnChanges } from './open-on-changes';

describe('an app opens on what the last turn changed in it', () => {
  const pending = ['tasks/P2 build.md', 'docs/Kestrel/P2.md'];
  it('Docs opens on the changed document, once', () => {
    const seen = new Set<string>();
    expect(openOnChanges('docs', pending, false, seen)).toEqual({ app: 'docs', path: 'Kestrel/P2.md', title: 'P2' });
    expect(openOnChanges('docs', pending, false, seen)).toBeNull();
  });
  it('an app already on a change, or with none, is left where it is', () => {
    expect(openOnChanges('tasks', pending, true, new Set())).toBeNull();
    expect(openOnChanges('sheets', pending, false, new Set())).toBeNull();
  });
  it('a new turn changing the same app opens it again', () => {
    const seen = new Set<string>();
    openOnChanges('tasks', pending, false, seen);
    expect(openOnChanges('tasks', ['tasks/Errands.md'], false, seen)).toEqual({ app: 'tasks', list: 'Errands' });
  });
});
