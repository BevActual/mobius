import { beforeEach, describe, expect, it } from 'vitest';
import { forgetLink, keepLink, linkOf, moveLink } from './drive-links';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { window?: unknown }).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } };
});

describe('drive links', () => {
  it('keeps, moves and forgets the drive file a workspace copy came from', () => {
    expect(linkOf('Drives/Home/a.md')).toBeNull();
    keepLink('Drives/Home/a.md', { drive: 'd1', path: '/Docs/a.md', etag: 'v1' });
    expect(linkOf('Drives/Home/a.md')).toEqual({ drive: 'd1', path: '/Docs/a.md', etag: 'v1' });
    keepLink('Drives/Home/a.md', { drive: 'd1', path: '/Docs/a.md', etag: 'v2' });
    expect(linkOf('Drives/Home/a.md')?.etag).toBe('v2');
    moveLink('Drives/Home/a.md', 'Work/a.md');
    expect(linkOf('Drives/Home/a.md')).toBeNull();
    expect(linkOf('Work/a.md')?.etag).toBe('v2');
    forgetLink('Work/a.md');
    expect(linkOf('Work/a.md')).toBeNull();
  });
  it('reads nothing from a broken store', () => {
    store.set('mobius.files.driveLinks', 'not json');
    expect(linkOf('x')).toBeNull();
  });
});
