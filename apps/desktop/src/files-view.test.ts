import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@mobius/shared';
import { fileKind, sortEntries } from './files-view';

const entries: FileEntry[] = [
  { name: 'b.md', type: 'file', bytes: 50, modified: 300 },
  { name: 'Zed', type: 'folder' },
  { name: 'a10.csv', type: 'file', bytes: 900, modified: 100 },
  { name: 'a2.png', type: 'file', bytes: 10, modified: 200 },
  { name: 'alpha', type: 'folder' },
];

describe('Files list', () => {
  it('says what each row is: an app kind, an app folder, or by extension', () => {
    expect(fileKind('notes/Work/Plan.md', 'file')).toBe('Note');
    expect(fileKind('sheets/Budget/Sheet 1.csv', 'file')).toBe('Sheet');
    expect(fileKind('notes', 'folder')).toBe('Notes folder');
    expect(fileKind('notes/Work', 'folder')).toBe('Folder');
    expect(fileKind('README.md', 'file')).toBe('Markdown');
    expect(fileKind('scan.pdf', 'file')).toBe('PDF');
    expect(fileKind('thing.xyz', 'file')).toBe('XYZ file');
    expect(fileKind('LICENSE', 'file')).toBe('File');
  });

  it('keeps folders first and sorts names as people count (a2 before a10)', () => {
    expect(sortEntries(entries, { by: 'name', down: false }, '').map((e) => e.name)).toEqual(['alpha', 'Zed', 'a2.png', 'a10.csv', 'b.md']);
    expect(sortEntries(entries, { by: 'name', down: true }, '').map((e) => e.name)).toEqual(['Zed', 'alpha', 'b.md', 'a10.csv', 'a2.png']);
  });

  it('sorts by date, size and kind, folders still first', () => {
    expect(sortEntries(entries, { by: 'size', down: true }, '').map((e) => e.name)).toEqual(['Zed', 'alpha', 'a10.csv', 'b.md', 'a2.png']);
    expect(sortEntries(entries, { by: 'modified', down: true }, '').map((e) => e.name)).toEqual(['Zed', 'alpha', 'b.md', 'a2.png', 'a10.csv']);
    expect(sortEntries(entries, { by: 'kind', down: false }, '').map((e) => e.name)).toEqual(['alpha', 'Zed', 'a10.csv', 'b.md', 'a2.png']);
  });
});
