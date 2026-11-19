import { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { clearFind, findState, replaceAll, replaceCurrent, setFind, stepFind } from './doc-find';
import './doc-find.css';

const Chevron = ({ d }: { d: string }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>;

/**
 * Find (Ctrl+F) and Replace (Ctrl+H) above a page, as the find bar in Code: what to look for, how many there are, Match
 * case, previous and next; Replace adds a second line with Replace and Replace all. Esc closes it and puts the cursor
 * at the match.
 */
export function DocFind({ editor, replacing, focusToken, onClose }: { editor: Editor; replacing: boolean; focusToken: number; onClose: () => void }) {
  const [query, setQuery] = useState(() => {
    const { from, to, empty } = editor.state.selection;
    const picked = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
    return picked.includes('\n') || picked.length > 100 ? '' : picked;
  });
  const [matchCase, setMatchCase] = useState(false);
  const [withText, setWith] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const other = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const to = replacing && query ? other.current : field.current;
    to?.focus();
    to?.select();
  }, [focusToken, replacing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFind(editor, query, matchCase); setDone(null); }, [editor, query, matchCase]);
  useEffect(() => () => clearFind(editor), [editor]);
  const found = useEditorState({ editor, selector: ({ editor: e }) => { const s = e ? findState(e) : undefined; return { count: s?.matches.length ?? 0, current: s?.current ?? 0 }; } }) ?? { count: 0, current: 0 };
  const close = () => { onClose(); editor.commands.focus(undefined, { scrollIntoView: false }); };
  const keys = (e: React.KeyboardEvent, enter: () => void) => {
    if (e.key === 'Enter') { e.preventDefault(); enter(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const status = done ?? (query ? (found.count === 0 ? 'No matches' : `${found.current + 1} of ${found.count}`) : '');
  return (
    <div className="doc-find glass" role="search" aria-label={replacing ? 'Find and replace' : 'Find in page'}>
      <div className="doc-find-line">
        <input ref={field} aria-label="Find in page" placeholder="Find" value={query} spellCheck={false} maxLength={200}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => keys(e, () => stepFind(editor, e.shiftKey ? -1 : 1))} />
        <span className="doc-find-count" role="status" aria-live="polite">{status}</span>
        <button type="button" className="doc-find-case" aria-label="Match case" aria-pressed={matchCase} title="Match case" onClick={() => setMatchCase((m) => !m)}>Aa</button>
        <button type="button" className="strip-btn" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={found.count === 0} onClick={() => stepFind(editor, -1)}><Chevron d="m5 12 5-5 5 5" /></button>
        <button type="button" className="strip-btn" aria-label="Next match" title="Next match (Enter)" disabled={found.count === 0} onClick={() => stepFind(editor, 1)}><Chevron d="m5 8 5 5 5-5" /></button>
        <button type="button" className="strip-btn" aria-label="Close find" title="Close (Esc)" onClick={close}><Chevron d="m6 6 8 8M14 6l-8 8" /></button>
      </div>
      {replacing && (
        <div className="doc-find-line">
          <input ref={other} aria-label="Replace with" placeholder="Replace with" value={withText} spellCheck={false} maxLength={200}
            onChange={(e) => setWith(e.target.value)} onKeyDown={(e) => keys(e, () => replaceCurrent(editor, withText))} />
          <button type="button" className="btn" disabled={found.count === 0} onClick={() => replaceCurrent(editor, withText)}>Replace</button>
          <button type="button" className="btn" disabled={found.count === 0} onClick={() => { const n = replaceAll(editor, withText); setDone(`Replaced ${n}`); }}>Replace all</button>
        </div>
      )}
    </div>
  );
}

/** Ctrl+F (Cmd+F) finds, Ctrl+H (Cmd+Option+F on a Mac) replaces. Returns which, or null for any other key. */
export function findKeyOf(e: KeyboardEvent | React.KeyboardEvent): 'find' | 'replace' | null {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'f' || e.code === 'KeyF') return e.altKey ? 'replace' : 'find';
  if ((key === 'h' || e.code === 'KeyH') && !e.altKey) return 'replace';
  return null;
}
