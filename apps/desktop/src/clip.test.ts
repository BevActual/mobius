import { describe, expect, it } from 'vitest';
import { clipToNotes, withClipping } from './clip';

describe('web clippings', () => {
  it('quotes the selection and links back to the page', () => {
    const item = { kind: 'page' as const, title: 'Selected on Rust [async] book', source: 'https://rust.example/a', text: 'Futures are lazy.\nThey wait.' };
    expect(withClipping('# Clippings\n\n', item, new Date('2026-11-07T12:00:00Z'))).toBe(
      '# Clippings\n\n> Futures are lazy.\n> They wait.\n\n— [Rust async book](https://rust.example/a), 2026-11-07\n',
    );
  });
});

describe('where clippings go', () => {
  const item = { kind: 'page' as const, title: 'Selected on A page', source: 'https://a.example/', text: 'Worth keeping.' };
  const fake = (paths: string[]) => {
    const saved: string[] = [];
    (globalThis as unknown as { window: { mobius: unknown } }).window = { mobius: { notes: {
      list: async () => [{ name: 'Work', pages: paths.map((path) => ({ path, title: path, modified: 1 })) }],
      read: async (path: string) => ({ path, content: '', modified: 1 }),
      save: async (path: string) => { saved.push(path); return { path, modified: 2 }; },
      createPage: async (notebook: string, title: string) => ({ path: `${notebook}/${title}.md`, title, modified: 1 }),
      createNotebook: async (name: string) => ({ name, pages: [] }),
    } } };
    return saved;
  };
  it('goes to the chosen page when it is there', async () => {
    const saved = fake(['Work/Reading.md', 'Work/Clippings.md']);
    expect(await clipToNotes(item, 'Work/Reading.md')).toEqual({ ok: true, path: 'Work/Reading.md' });
    expect(saved).toEqual(['Work/Reading.md']);
  });
  it('falls back to Clippings when the chosen page is gone', async () => {
    const saved = fake(['Work/Clippings.md']);
    expect(await clipToNotes(item, 'Work/Reading.md')).toEqual({ ok: true, path: 'Work/Clippings.md' });
    expect(saved).toEqual(['Work/Clippings.md']);
  });
});
