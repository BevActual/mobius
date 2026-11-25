import { useEffect } from 'react';
import type { Notebook } from '@mobius/shared';
import { onCommand } from './commands';

export interface RecentNote { path: string; title: string; notebook: string }

/** The notes edited last, newest first, the open one at the end: what Ctrl+O lists before anything is typed. */
export function recentNotes(notebooks: readonly Notebook[], open: string | undefined, limit = 20): RecentNote[] {
  return notebooks
    .flatMap((nb) => nb.pages.map((pg) => ({ path: pg.path, title: pg.title, notebook: nb.name, modified: pg.modified })))
    .sort((a, b) => Number(a.path === open) - Number(b.path === open) || b.modified - a.modified)
    .slice(0, limit)
    .map(({ modified: _m, ...row }) => row);
}

/**
 * Ctrl+O in Notes, and Notes → Open note…: the launcher opens narrowed to Notes (docs/design/notes.md), rather than a
 * switcher of its own. Listens only while Notes is the app in front.
 */
export function useNoteQuickOpen(active: boolean, open: () => void): void {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); open(); }
    };
    window.addEventListener('keydown', onKey);
    const stop = onCommand('open-note', open);
    return () => { window.removeEventListener('keydown', onKey); stop(); };
  }, [active, open]);
}
