import type { FileEntry } from '@mobius/shared';
import { APP_ICONS } from './Rail';
import { appOf } from './review-view';
import type { AppId } from './apps';

/** Files' icons, shared by the workspace's folders and the person's drives. */
export const GLYPH = {
  folder: <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  file: <><path d="M6 3.5h5.5l3 3v10H6z" /><path d="M11.5 3.5v3h3" /></>,
  workspace: <><rect x="3.5" y="4.5" width="13" height="11" rx="2" /><path d="M3.5 11.5h13M7 13.5h.01" /></>,
  // What Mobius made wears Mobius's own mark, never a sparkle.
  made: APP_ICONS.agent,
  back: <path d="M12 4.5 6.5 10l5.5 5.5" />,
  newFolder: <><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M10 8.5v5M7.5 11h5" /></>,
  forward: <path d="m8 4.5 5.5 5.5L8 15.5" />,
  putBack: <><path d="M7.5 5 4.5 8l3 3" /><path d="M4.5 8h7a4 4 0 0 1 0 8H9" /></>,
  // A drive: a server's disk, a slab with its light.
  drive: <><rect x="3.5" y="6" width="13" height="8" rx="2" /><path d="M6.5 10h.01M9 10h4.5" /></>,
  add: <path d="M10 5v10M5 10h10" />,
  trash: <><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" /><path d="M8.7 8.5v4.5M11.3 8.5v4.5" /></>,
};

/** A row's icon: the app that opens it, in its colour; a folder in Finder blue; anything else plain. */
export function FileIcon({ path, type, size = 'row' }: { path: string; type: FileEntry['type']; size?: 'row' | 'side' }) {
  const app: AppId | null = appOf(path);
  // An app's own folder (notes/) wears that app's icon; a folder inside it is a folder.
  const top = !path.includes('/');
  if (type === 'folder' && !(top && app)) return <svg className="files-icon" data-size={size} data-glyph="folder" viewBox="0 0 20 20" aria-hidden="true">{GLYPH.folder}</svg>;
  if (app && APP_ICONS[app]) return <svg className="files-icon" data-size={size} data-app={app} viewBox="0 0 20 20" aria-hidden="true">{APP_ICONS[app]}</svg>;
  return <svg className="files-icon" data-size={size} data-glyph="file" viewBox="0 0 20 20" aria-hidden="true">{GLYPH.file}</svg>;
}

export const placeIcon = (glyph: 'workspace' | 'made' | 'trash' | 'drive' | 'add') => <svg className="files-icon" data-size="side" data-glyph={glyph === 'workspace' ? 'place' : glyph} viewBox="0 0 20 20" aria-hidden="true">{GLYPH[glyph]}</svg>;

/** A size as Finder says it. */
export const size = (bytes: number | undefined) => (bytes === undefined ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
