import type { FileEntry } from '@mobius/shared';
import { describeChange } from './ReviewStrip';
import { appOf } from './review-view';
import { appName } from './apps';

/** How the open folder is sorted: by a column, and which way. Folders stay first, as in Finder and Explorer. */
export interface FilesSort { by: 'name' | 'modified' | 'kind' | 'size'; down: boolean }

const BY_EXTENSION: Record<string, string> = {
  md: 'Markdown', txt: 'Text', csv: 'CSV', json: 'JSON', ics: 'Calendar', pdf: 'PDF', html: 'Web page', htm: 'Web page',
  png: 'Picture', jpg: 'Picture', jpeg: 'Picture', gif: 'Picture', webp: 'Picture', svg: 'Picture', heic: 'Picture',
  mp3: 'Audio', wav: 'Audio', m4a: 'Audio', mp4: 'Video', mov: 'Video', webm: 'Video', zip: 'Archive', sqlite: 'Database',
  js: 'Code', ts: 'Code', tsx: 'Code', py: 'Code', rs: 'Code', css: 'Code',
};

/** What a row is, in a word or two: the app's kind for an app's file ("Note"), an app's own folder ("Notes folder"), else by its extension. */
export function fileKind(path: string, type: FileEntry['type']): string {
  const app = appOf(path);
  if (type === 'folder') return app && !path.includes('/') ? `${appName(app)} folder` : 'Folder';
  if (app) { const kind = describeChange(path).kind; if (kind !== 'File') return kind; }
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return (ext && BY_EXTENSION[ext]) ?? (ext ? `${ext.toUpperCase()} file` : 'File');
}

const byName = (a: FileEntry, b: FileEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** The folder's entries in the chosen order. Folders come first either way; ties fall back to the name. */
export function sortEntries(entries: readonly FileEntry[], sort: FilesSort, folder: string): FileEntry[] {
  const join = (name: string) => (folder ? `${folder}/${name}` : name);
  const dir = sort.down ? -1 : 1;
  const compare = (a: FileEntry, b: FileEntry): number => {
    if (sort.by === 'kind') return fileKind(join(a.name), a.type).localeCompare(fileKind(join(b.name), b.type)) || byName(a, b);
    if (sort.by === 'modified') return ((a.modified ?? 0) - (b.modified ?? 0)) || byName(a, b);
    if (sort.by === 'size') return ((a.bytes ?? 0) - (b.bytes ?? 0)) || byName(a, b);
    return byName(a, b);
  };
  return [...entries].sort((a, b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : dir * compare(a, b)));
}
