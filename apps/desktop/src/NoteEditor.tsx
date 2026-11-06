import { useEffect, useRef } from 'react';
import { liveTitle, statusText } from './notes-state';
import type { NotesState } from './useNotes';

/** The open page. Plain Markdown, saved as you type; a page the assistant changed meanwhile is never overwritten. */
export function NoteEditor({ notes }: { notes: NotesState }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const path = notes.page?.path;
  useEffect(() => { if (path) area.current?.focus(); }, [path]);

  if (!notes.page) {
    return (
      <section className="note-editor empty" aria-label="Note">
        <p className="note-empty">{notes.notebooks.length ? 'Choose a page, or make a new one.' : 'Make a notebook to start.'}</p>
      </section>
    );
  }
  const title = liveTitle(notes.text, notes.page.title || path?.split('/')[1]?.replace(/\.md$/, '') || '');
  return (
    <section className="note-editor" aria-label={`Note: ${title}`}>
      <div className="note-bar">
        <span className="note-where">{path?.split('/')[0]}</span>
        <span className="note-status" role="status" data-status={notes.status}>{notes.message || statusText(notes.status)}</span>
      </div>
      {notes.status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <span>The assistant changed this page while you were editing it.</span>
          <button type="button" className="btn" onClick={() => void notes.resolve(false)}>Use their version</button>
          <button type="button" className="btn primary" onClick={() => void notes.resolve(true)}>Keep mine</button>
        </div>
      )}
      <textarea
        ref={area}
        className="note-text"
        aria-label="Page text"
        spellCheck
        value={notes.text}
        onChange={(e) => notes.edit(e.target.value)}
      />
    </section>
  );
}
