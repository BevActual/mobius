/**
 * Which workspace files are copies of a file on a drive: the drive, the file's path there and the version copied
 * (its etag). Kept on this computer only, so a copy can be saved back over its file, and only while the file on the
 * drive is still that version.
 */
export interface DriveLink { drive: string; path: string; etag: string }

const KEY = 'mobius.files.driveLinks';

function all(): Record<string, DriveLink> {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, DriveLink>) : {};
  } catch { return {}; }
}
function keep(links: Record<string, DriveLink>): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(links)); } catch { /* not kept */ }
}

/** The drive file the workspace file `workspacePath` was copied from, or null. */
export function linkOf(workspacePath: string): DriveLink | null {
  const l = all()[workspacePath];
  return l && typeof l.drive === 'string' && typeof l.path === 'string' && typeof l.etag === 'string' ? l : null;
}

/** Remembers that `workspacePath` is a copy of `link` (a new version after a save back). */
export function keepLink(workspacePath: string, link: DriveLink): void {
  keep({ ...all(), [workspacePath]: link });
}

/** Forgets the link: the copy stays, and is no longer saved back. */
export function forgetLink(workspacePath: string): void {
  const links = all();
  delete links[workspacePath];
  keep(links);
}

/** A renamed or moved copy keeps its link under its new path. */
export function moveLink(from: string, to: string): void {
  const links = all();
  const l = links[from];
  if (!l) return;
  delete links[from];
  keep({ ...links, [to]: l });
}
