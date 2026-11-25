import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { onCommand } from './commands';
import { fileScore } from './code-edit';
import type { NotesState } from './useNotes';

export interface SwitchRow { path: string; title: string; notebook: string }

/**
 * The notes that answer what was typed, best first. With nothing typed, the most recently edited, the open one last
 * (Obsidian's quick switcher, Bear's Open note): the letters come in order, a match at the start of the title or a
 * word counts for more, and a tie goes to the note edited last.
 */
export function rankNotes(notes: NotesState['notebooks'], query: string, open: string | undefined, limit = 40): SwitchRow[] {
  const all = notes.flatMap((nb) => nb.pages.map((pg) => ({ path: pg.path, title: pg.title, notebook: nb.name, modified: pg.modified })));
  const q = query.trim();
  if (!q) {
    return all.sort((a, b) => Number(a.path === open) - Number(b.path === open) || b.modified - a.modified).slice(0, limit).map(({ modified: _m, ...row }) => row);
  }
  return all
    .map((row) => ({ row, score: Math.max(fileScore(q, row.title) ?? -Infinity, (fileScore(q, `${row.notebook}/${row.title}`) ?? -Infinity) - 4) }))
    .filter((r) => r.score > -Infinity)
    .sort((a, b) => b.score - a.score || b.row.modified - a.row.modified)
    .slice(0, limit)
    .map(({ row: { modified: _m, ...row } }) => row);
}

/** Ctrl+O in Notes (and Notes → Open note…): type part of a note's title, Enter opens it. When none has that title,
 *  the last row makes a new note with it, in the notebook that is open. */
export function NoteSwitcher({ notes, active }: { notes: NotesState; active: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); setShown(true); }
    };
    window.addEventListener('keydown', onKey);
    const stop = onCommand('open-note', () => setShown(true));
    return () => { window.removeEventListener('keydown', onKey); stop(); };
  }, [active]);
  useEffect(() => { if (!active) setShown(false); }, [active]);
  return shown ? createPortal(<Switcher notes={notes} onClose={() => setShown(false)} />, document.body) : null;
}

function Switcher({ notes, onClose }: { notes: NotesState; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [lit, setLit] = useState(0);
  const found = useMemo(() => rankNotes(notes.notebooks, query, notes.page?.path), [notes.notebooks, query, notes.page?.path]);
  const typed = query.trim();
  const into = notes.page?.path.split('/')[0] ?? notes.notebooks[0]?.name;
  const canMake = typed !== '' && !found.some((r) => r.title.toLowerCase() === typed.toLowerCase());
  const count = found.length + (canMake ? 1 : 0);
  const make = () => { onClose(); if (into) void notes.createPage(into, typed); else void notes.createNotebook('Notes').then((nb) => { if (nb) void notes.createPage(nb, typed); }); };
  const choose = (i: number) => {
    const row = found[i];
    if (row) { onClose(); void notes.open(row.path, row.title); } else if (i === found.length && canMake) make();
  };
  return (
    <div className="note-quick-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="note-quick" role="dialog" aria-label="Open a note">
        <input
          autoFocus
          aria-label="Note to open"
          placeholder="Open a note by its title"
          value={query}
          spellCheck={false}
          role="combobox"
          aria-expanded
          aria-controls="note-quick-list"
          aria-activedescendant={lit < count ? `note-quick-${lit}` : undefined}
          onChange={(e) => { setQuery(e.target.value); setLit(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setLit((i) => Math.min(count - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setLit((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter' && e.shiftKey && canMake) { e.preventDefault(); make(); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(lit); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          }}
        />
        <ul id="note-quick-list" role="listbox" aria-label="Notes">
          {found.map((row, i) => (
            <li key={row.path} id={`note-quick-${i}`} role="option" aria-selected={i === lit} onMouseEnter={() => setLit(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
              <span className="note-quick-name">{row.title}</span>
              <span className="note-quick-where">{row.notebook}</span>
            </li>
          ))}
          {canMake && (
            <li id={`note-quick-${found.length}`} role="option" aria-selected={lit === found.length} className="note-quick-new" onMouseEnter={() => setLit(found.length)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(found.length)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
              <span className="note-quick-name">New note “{typed}”</span>
              {into && <span className="note-quick-where">{into}</span>}
            </li>
          )}
          {count === 0 && <li className="note-quick-none" role="presentation">No notes yet. Type a title to make one.</li>}
        </ul>
      </div>
    </div>
  );
}
