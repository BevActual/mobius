import type { FileEntry, FilesActionResult } from '@mobius/shared';

/**
 * The preview's Files: a small workspace kept in memory for as long as the preview is open, so New folder, Rename and
 * Move to Trash can be tried without the Rust core. Paths are relative to the workspace, as the core gives them.
 */
const now = Date.now();
const hour = 3_600_000;
type Item = { type: 'file'; bytes: number; modified: number } | { type: 'folder'; modified: number };
const TREE = new Map<string, Item>([
  ['docs', { type: 'folder', modified: now - 2 * hour }],
  ['docs/P2 build', { type: 'folder', modified: now - 2 * hour }],
  ['docs/P2 build/Build brief.md', { type: 'file', bytes: 1840, modified: now - 5 * 60_000 }],
  ['notes', { type: 'folder', modified: now - hour }],
  ['notes/P2 build', { type: 'folder', modified: now - hour }],
  ['notes/P2 build/Build plan.md', { type: 'file', bytes: 620, modified: now - 3 * hour }],
  ['notes/P2 build/Supplier notes.md', { type: 'file', bytes: 410, modified: now - 5 * 60_000 }],
  ['notes/Home', { type: 'folder', modified: now - 30 * hour }],
  ['notes/Home/Groceries.md', { type: 'file', bytes: 48, modified: now - 30 * hour }],
  ['sheets', { type: 'folder', modified: now - 26 * hour }],
  ['sheets/P2 budget', { type: 'folder', modified: now - 26 * hour }],
  ['sheets/P2 budget/Sheet 1.csv', { type: 'file', bytes: 3200, modified: now - 5 * 60_000 }],
  ['tasks', { type: 'folder', modified: now - 4 * hour }],
  ['tasks/P2 build.md', { type: 'file', bytes: 730, modified: now - 5 * 60_000 }],
  ['README.md', { type: 'file', bytes: 2048, modified: now - 9 * 24 * hour }],
]);
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
const fail = (error: string): FilesActionResult => ({ ok: false, error });
const badName = (name: string) => (!name.trim() ? 'give it a name' : name.startsWith('.') ? 'a name cannot start with a dot' : /[/\\:*?"<>|]/.test(name) ? 'a name cannot have / \\ : * ? " < > or |' : null);
/** Moves `from` and everything under it to `to`. */
function move(from: string, to: string): void {
  for (const [path, item] of [...TREE]) {
    if (path === from || path.startsWith(`${from}/`)) { TREE.delete(path); TREE.set(to + path.slice(from.length), item); }
  }
}

export const PREVIEW_FILES: Record<string, (...args: never[]) => unknown> = {
  'files.list': ((folder: string) => {
    if (folder && TREE.get(folder)?.type !== 'folder') return { error: 'that folder is not there' };
    const entries: FileEntry[] = [...TREE].filter(([p]) => parentOf(p) === folder && !p.startsWith('.')).map(([p, item]) => (item.type === 'file' ? { name: nameOf(p), type: 'file', bytes: item.bytes, modified: item.modified } : { name: nameOf(p), type: 'folder', modified: item.modified }));
    entries.sort((a, b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.toLowerCase().localeCompare(b.name.toLowerCase())));
    return { path: folder, truncated: false, entries };
  }) as never,
  'files.newFolder': ((folder: string, name: string): FilesActionResult => {
    const bad = badName(name);
    if (bad) return fail(bad);
    const path = join(folder, name.trim());
    if (TREE.has(path)) return fail(`there is already something called ${name.trim()} here`);
    TREE.set(path, { type: 'folder', modified: Date.now() });
    return { ok: true, path };
  }) as never,
  'files.rename': ((path: string, name: string): FilesActionResult => {
    const bad = badName(name);
    if (bad) return fail(bad);
    const to = join(parentOf(path), name.trim());
    if (TREE.has(to) && to.toLowerCase() !== path.toLowerCase()) return fail(`there is already something called ${name.trim()} here`);
    move(path, to);
    return { ok: true, path: to };
  }) as never,
  'files.trash': ((path: string): FilesActionResult => {
    const held = `.trash/${Date.now()}-${nameOf(path)}`;
    move(path, held);
    return { ok: true, path: held };
  }) as never,
  'files.putBack': ((held: string, path: string): FilesActionResult => {
    if (TREE.has(path)) return fail('something else is there now');
    move(held, path);
    return { ok: true, path };
  }) as never,
  'files.show': () => undefined,
};
