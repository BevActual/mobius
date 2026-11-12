import { createPortal } from 'react-dom';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { EmptyState } from './EmptyState';
import { FromMobius } from './FromMobius';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { IS_MAC, cursorAt, deletePair, findAll, indentLines, keyLabel, langName, lineStart, newLine, rankFiles, toggleComment, typePair, type Edit } from './code-edit';
import { applyGroups, badgeOf, changeGroups, gitMarks, highlight, langOf, lineDiff, testLineKind, type DiffRow, type GitMark, type Lang } from './code-view';
import { RowMark } from './RowMark';
import type { CodeState } from './useCode';
import { ReviewActions, WhyThis } from './ReviewBar';
import { SideNew, type Start } from './SideNew';
import './code.css';

/** Projects, and the open project's files as a tree, with the ones the agent changed in its last turn marked. */
export function CodeSidebar({ code, pin, changed, starts, onStart }: { code: CodeState; pin?: ReactNode; changed?: ReadonlySet<string>; starts?: readonly Start[]; onStart?: (prompt: string) => void }) {
  const [naming, setNaming] = useState<'project' | 'file' | null>(null);
  const [name, setName] = useState('');
  useEffect(() => onCommand('new-project', () => { setNaming('project'); setName(''); }), []);
  useEffect(() => onCommand('new-file', () => { if (code.project) { setNaming('file'); setName(''); } }), [code.project]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = naming === 'project' ? (await code.createProject(name.trim() || 'Project')) !== null : await code.createFile(name.trim());
    if (ok) { setNaming(null); setName(''); }
  };
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  // A folder is shown when every folder above it is open; a filter shows the files that match and the folders above them.
  const matching = filter.trim() ? new Set(rankFiles(filter, code.entries.filter((e) => !e.folder).map((e) => e.path), 500)) : null;
  const shown = matching
    ? code.entries.filter((e) => (e.folder ? [...matching].some((m) => m.startsWith(`${e.path}/`)) : matching.has(e.path)))
    : code.entries.filter((e) => {
      const parts = e.path.split('/');
      return parts.slice(0, -1).every((_, i) => code.expanded.has(parts.slice(0, i + 1).join('/')));
    });
  const changedHere = (path: string) => code.project !== null && changed?.has(`${code.project}/${path}`) === true;
  const changedInside = (folder: string) => code.project !== null && [...(changed ?? [])].some((c) => c.startsWith(`${code.project}/${folder}/`));
  const marks = useMemo(() => gitMarks(code.git.repo ? code.git.changes : []), [code.git]);
  return (
    <aside className="side code-side" aria-label="Code sidebar">
      <div className="side-head">
        <span className="side-title">Projects</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New project" title="New project" onClick={() => { setNaming('project'); setName(''); }}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </span>
      </div>
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label={naming === 'project' ? 'Project name' : 'File name'} placeholder={naming === 'project' ? 'Project name' : 'src/file.ts'} value={name} maxLength={naming === 'project' ? 80 : 300} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {code.projects.length === 0 && !naming && (
        <div className="side-empty notes-empty">
          <p>Each project is a folder in your workspace, real files you can open in any editor too. Mobius suggests changes; you keep them or not.</p>
          <button type="button" className="btn primary" onClick={() => setNaming('project')}>New project</button>
        </div>
      )}
      {code.projects.length > 0 && (
        <label className="code-project">
          <span className="sr-only">Project</span>
          <select aria-label="Project" value={code.project ?? ''} onChange={(e) => void code.openProject(e.target.value)}>
            {code.projects.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </label>
      )}
      {code.project && code.git.repo && <GitBar code={code} />}
      {code.project && (
        <nav className="code-tree" aria-label="Files">
          <div className="code-tree-head">
            <span>Files</span>
          </div>
          <input className="side-search code-filter" type="search" aria-label="Filter files" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setFilter(''); if (e.key === 'Enter' && matching) { const first = [...matching][0]; if (first) void code.openFile(first); } }} />
          <SideNew item="file" title="New file, in the folder of the open one" onNew={() => { setNaming('file'); setName(code.open ? code.open.path.split('/').slice(0, -1).concat('').join('/') : ''); }} {...(starts ? { starts } : {})} {...(onStart ? { onStart } : {})} />
          <ul role="tree" aria-label={`Files in ${code.project}`}>
            {shown.map((e) => {
              const name = e.path.split('/').pop() ?? e.path;
              const isOpen = matching ? true : code.expanded.has(e.path);
              const mark = e.folder ? (changedInside(e.path) && !isOpen) : changedHere(e.path);
              return (
                <li key={e.path} role="treeitem" aria-expanded={e.folder ? isOpen : undefined} aria-selected={code.open?.path === e.path} aria-label={e.path}>
                  <button type="button" className="code-file" data-folder={e.folder || undefined} data-proposed={mark || undefined} aria-current={code.open?.path === e.path ? 'page' : undefined} style={{ paddingLeft: 6 + e.depth * 14 }} onClick={() => (e.folder ? (matching ? undefined : code.toggle(e.path)) : void code.openFile(e.path))} onContextMenu={(ev) => { if (e.folder) return; ev.preventDefault(); setMenu({ path: e.path, x: ev.clientX, y: ev.clientY }); }}>
                    {e.folder ? (
                      <>
                        <svg className="code-caret" data-open={isOpen || undefined} viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
                        <svg className="code-folder" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3.6l1.6 1.8H16a1.5 1.5 0 0 1 1.5 1.5v7.2A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" /></svg>
                      </>
                    ) : <span className="code-badge" data-lang={langOf(e.path)} aria-hidden="true">{badgeOf(e.path)}</span>}
                    <span className="code-file-name">{name}</span>
                    {mark ? <RowMark changed /> : !e.folder && marks.has(e.path) && <GitLetter mark={marks.get(e.path)!} />}
                  </button>
                </li>
              );
            })}
          </ul>
          {matching && shown.length === 0 && <p className="side-empty">No file matches “{filter}”.</p>}
          {removing && (
            <div className="code-confirm" role="alertdialog" aria-label={`Delete ${removing}?`}>
              <p>Delete <b>{removing.split('/').pop()}</b>? It is removed from the project folder.</p>
              <div>
                <button type="button" className="btn" autoFocus onClick={() => setRemoving(null)}>Cancel</button>
                <button type="button" className="btn danger" onClick={() => { const p = removing; setRemoving(null); void code.removeFile(p); }}>Delete</button>
              </div>
            </div>
          )}
        </nav>
      )}
      {menu && (
        <FileMenu x={menu.x} y={menu.y} label={menu.path} onClose={() => setMenu(null)} items={[
          { action: 'open', label: 'Open', run: () => void code.openFile(menu.path) },
          { action: 'copy', label: 'Copy path', run: () => void navigator.clipboard?.writeText(`${code.project}/${menu.path}`).catch(() => {}) },
          { label: 'New file beside it', run: () => { setNaming('file'); setName(menu.path.split('/').slice(0, -1).concat('').join('/')); } },
          { action: 'delete', label: 'Delete…', danger: true, separated: true, run: () => setRemoving(menu.path) },
        ]} />
      )}
      {code.project && <FromMobius items={[...(changed ?? [])].filter((c) => c.startsWith(`${code.project}/`)).map((c) => c.slice(code.project!.length + 1)).map((path) => ({ key: path, name: path.split('/').pop() ?? path, ...(path.includes('/') ? { where: path.split('/').slice(0, -1).join('/') } : {}), current: code.open?.path === path, onOpen: () => void code.openFile(path) }))} />}
    </aside>
  );
}

/** A file's right-click menu: the shared one, opened from a point inside the sidebar. */
function FileMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: ContextMenuItem[]; onClose: () => void }) {
  const side = document.querySelector('.code-side')?.getBoundingClientRect();
  const left = side ? Math.max(side.left + 4, Math.min(x, side.right - 214)) : x;
  return createPortal(<ContextMenu x={left} y={y} label={label} items={items} onClose={onClose} />, document.body);
}

/** Git's mark on a changed file, as Xcode shows it at the end of the row: M, A, D, R, ? or C, with what it means on hover. */
function GitLetter({ mark }: { mark: GitMark }) {
  return <span className="code-git-letter" data-letter={mark.letter} role="img" aria-label={mark.label} title={mark.label}>{mark.letter}</span>;
}

const SHOWN_CHANGES = 6;

/** The project's branch and what changed since its last commit, with Commit and Push. Mobius asks before either. */
function GitBar({ code }: { code: CodeState }) {
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (!code.git.repo) return null;
  const { branch, changes, ahead } = code.git;
  const marks = [...gitMarks(changes)];
  const shown = showAll ? marks : marks.slice(0, SHOWN_CHANGES);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await code.commit(message)) { setWriting(false); setMessage(''); }
    setBusy(false);
  };
  return (
    <section className="code-git" aria-label="Git">
      <div className="code-git-head">
        <span className="code-git-branch" title="Branch"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="6" cy="4.5" r="1.8" /><circle cx="6" cy="15.5" r="1.8" /><circle cx="14" cy="7" r="1.8" /><path d="M6 6.3v7.4M14 8.8c0 3-3 3.2-8 4.9" /></svg>{branch || 'no branch'}</span>
        <span className="code-git-count" role="status">{changes.length === 0 ? 'Nothing to commit' : changes.length === 1 ? '1 change' : `${changes.length} changes`}{ahead ? ` · ${ahead} to push` : ''}</span>
      </div>
      {shown.length > 0 && (
        <ul className="code-git-changes" aria-label="Changed files">
          {shown.map(([path, mark]) => {
            const name = path.split('/').pop() ?? path;
            const where = path.slice(0, path.length - name.length - 1);
            return (
              <li key={path}>
                <button type="button" className="code-git-change" aria-label={`${path}, ${mark.label.toLowerCase()}`} aria-current={code.open?.path === path ? 'page' : undefined} disabled={mark.letter === 'D'} title={path} onClick={() => void code.openFile(path)}>
                  <span className="code-git-name">{name}</span>
                  {where && <span className="code-git-where">{where}</span>}
                  <GitLetter mark={mark} />
                </button>
              </li>
            );
          })}
          {marks.length > SHOWN_CHANGES && (
            <li><button type="button" className="code-git-more" onClick={() => setShowAll((all) => !all)}>{showAll ? 'Show fewer' : `${marks.length - SHOWN_CHANGES} more`}</button></li>
          )}
        </ul>
      )}
      {writing ? (
        <form className="code-git-form" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Commit message" placeholder="What changed, and why" value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setWriting(false); }} />
          <button type="submit" className="btn primary" disabled={busy || !message.trim()}>Commit</button>
        </form>
      ) : (
        <div className="code-git-actions">
          <button type="button" className="btn" disabled={changes.length === 0} onClick={() => setWriting(true)}>Commit…</button>
          <button type="button" className="btn" disabled={busy} onClick={() => { setBusy(true); void code.push().finally(() => setBusy(false)); }}>Push</button>
        </div>
      )}
    </section>
  );
}

function Line({ text, lang }: { text: string; lang: Lang }) {
  return <>{highlight(text, lang).map((t, i) => <span key={i} className={`tok-${t.k}`}>{t.t}</span>)}{text === '' ? '​' : null}</>;
}

/** What the agent's last turn changed in the open file, as removed and added lines, each change kept or put back. */
function Suggestion({ rows, lang, endsWithNewline, onWrite, onKeepAll, onDiscardAll, conversation }: { rows: DiffRow[]; lang: Lang; endsWithNewline: boolean; onWrite: (text: string) => void; onKeepAll: () => void; onDiscardAll: () => void; conversation?: string }) {
  const groups = changeGroups(rows);
  const lastOf = new Map(groups.map(([, e], g) => [e, g]));
  const discardOne = (g: number) => onWrite(applyGroups(rows, new Set(groups.map((_, i) => i).filter((i) => i !== g)), endsWithNewline));
  return (
    <div className="code-lines code-diff" role="region" aria-label="Suggested change">
      {rows.map((r, i) => {
        const g = lastOf.get(i);
        return (
          <Fragment key={i}>
            <div className="code-line" data-kind={r.kind === 'same' ? undefined : r.kind}>
              <span className="code-n" aria-hidden="true">{r.n ?? ''}</span>
              <span className="code-sign" aria-hidden="true">{r.kind === 'del' ? '−' : r.kind === 'add' ? '+' : ''}</span>
              <span className="code-text">{r.kind === 'del' ? <s><Line text={r.text} lang={lang} /></s> : <Line text={r.text} lang={lang} />}</span>
            </div>
            {g !== undefined && (
              <div className="code-diff-actions" role="group" aria-label={`Change ${g + 1}`}>
                {groups.length > 1 && <button type="button" className="review-btn" onClick={() => discardOne(g)}>Discard this</button>}
              </div>
            )}
          </Fragment>
        );
      })}
      <div className="code-diff-bar" role="group" aria-label="Mobius's change">
        <span>{groups.length === 1 ? 'One change from Mobius' : `${groups.length} changes from Mobius`}{conversation && <WhyThis conversation={conversation} />}</span>
        <ReviewActions onKeep={onKeepAll} onDiscard={onDiscardAll} discardTitle={`Discard (${IS_MAC ? '⌘⌫' : 'Ctrl+Backspace'})`} keepTitle={`Keep (${IS_MAC ? '⌘⏎' : 'Ctrl+Enter'})`} />
      </div>
    </div>
  );
}

/** Puts an edit in as typing would, so Ctrl+Z takes it back; falls back to setting the text where that is not offered. */
function put(el: HTMLTextAreaElement, edit: Edit, setDraft: (text: string) => void) {
  el.focus();
  let typed = true;
  if (edit.from !== edit.to || edit.insert !== '') {
    el.setSelectionRange(edit.from, edit.to);
    typed = edit.insert === '' ? document.execCommand('delete') : document.execCommand('insertText', false, edit.insert);
    if (!typed) setDraft(`${el.value.slice(0, edit.from)}${edit.insert}${el.value.slice(edit.to)}`);
  }
  // Typed edits change the field at once, so the cursor is placed now, before the next key; a set text waits for React.
  if (typed) el.setSelectionRange(edit.select[0], edit.select[1]);
  else requestAnimationFrame(() => el.setSelectionRange(edit.select[0], edit.select[1]));
}

const LINE = 20;
const PAD_TOP = 10;
/** Scrolls the text area so a line sits a third of the way down, as Go to line and Find do. */
function reveal(el: HTMLTextAreaElement, line: number) {
  const top = PAD_TOP + (line - 1) * LINE;
  if (top < el.scrollTop + LINE || top > el.scrollTop + el.clientHeight - 3 * LINE) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
}

/** Find in the file (Ctrl+F) or go to a line (Ctrl+G), in a bar above the text. */
function EditorBar({ mode, text, onClose, onFind, onLine }: { mode: 'find' | 'line'; text: string; onClose: () => void; onFind: (query: string, matchCase: boolean, at: number) => void; onLine: (line: number) => void }) {
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [at, setAt] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, [mode]);
  const count = mode === 'find' ? findAll(text, query, matchCase).length : 0;
  useEffect(() => { if (mode === 'find') onFind(query, matchCase, count === 0 ? 0 : Math.min(at, count - 1)); }, [query, matchCase, at, count, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = text.split('\n').length;
  if (mode === 'line') {
    return (
      <form className="code-bar" role="search" aria-label="Go to line" onSubmit={(e) => { e.preventDefault(); const n = Number.parseInt(query, 10); if (n > 0) onLine(Math.min(n, lines)); }}>
        <input ref={field} aria-label="Line number" inputMode="numeric" placeholder={`Line, 1 to ${lines}`} value={query} onChange={(e) => setQuery(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }} />
        <button type="submit" className="btn">Go</button>
        <button type="button" className="strip-btn" aria-label="Close" onClick={onClose}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg></button>
      </form>
    );
  }
  const step = (by: number) => { if (count > 0) setAt((i) => (i + by + count) % count); };
  return (
    <div className="code-bar" role="search" aria-label="Find in file">
      <input ref={field} aria-label="Find in file" placeholder="Find in file" value={query} spellCheck={false} onChange={(e) => { setQuery(e.target.value); setAt(0); }} onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      }} />
      <span className="code-bar-count" aria-live="polite">{query ? (count === 0 ? 'No matches' : `${Math.min(at, count - 1) + 1} of ${count}`) : ''}</span>
      <button type="button" className="code-bar-case" aria-pressed={matchCase} title="Match case" onClick={() => setMatchCase((m) => !m)}>Aa</button>
      <button type="button" className="strip-btn" aria-label="Previous match" disabled={count === 0} onClick={() => step(-1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 12 5-5 5 5" /></svg></button>
      <button type="button" className="strip-btn" aria-label="Next match" disabled={count === 0} onClick={() => step(1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg></button>
      <button type="button" className="strip-btn" aria-label="Close find" onClick={onClose}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg></button>
    </div>
  );
}

/**
 * A plain text area with the coloured lines drawn under it, so it types like any text field and reads like code. As
 * Xcode's editor: the line with the cursor is lit, brackets and quotes close themselves, Tab and Shift+Tab indent the
 * lines picked, Ctrl+/ comments them, Ctrl+F finds and Ctrl+G goes to a line. Every change goes in as typing, so
 * Ctrl+Z takes it back.
 */
function Editor({ code, lang, bar, setBar }: { code: CodeState; lang: Lang; bar: 'find' | 'line' | null; setBar: (bar: 'find' | 'line' | null) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const under = useRef<HTMLDivElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => code.draft.split('\n'), [code.draft]);
  const [caret, setCaret] = useState<[number, number]>([0, 0]);
  const [found, setFound] = useState<{ marks: [number, number][]; at: number }>({ marks: [], at: 0 });
  const path = code.open?.path ?? '';
  useEffect(() => { setCaret([0, 0]); setFound({ marks: [], at: 0 }); }, [path]);
  const track = () => { const el = area.current; if (el) setCaret([el.selectionStart, el.selectionEnd]); };
  const here = cursorAt(code.draft, caret[1]);
  const picked = Math.abs(caret[1] - caret[0]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    const { selectionStart: s, selectionEnd: end } = el;
    const text = el.value;
    let edit: Edit | null = null;
    if (mod && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); void code.save(); return; }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); setBar('find'); return; }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); setBar('line'); return; }
    if (mod && !e.altKey && (e.key === '/' || e.code === 'Slash')) { e.preventDefault(); edit = toggleComment(text, s, end, lang); }
    else if (mod && !e.altKey && (e.key === ']' || e.key === '[')) { e.preventDefault(); edit = indentLines(text, s, end, e.key === '['); }
    else if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      edit = e.shiftKey || s !== end ? indentLines(text, s, end, e.shiftKey) : { from: s, to: s, insert: '  ', select: [s + 2, s + 2] };
    } else if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) { e.preventDefault(); edit = newLine(text, s, end); }
    else if (e.key === 'Backspace' && !mod && !e.altKey) { edit = deletePair(text, s, end); if (edit) e.preventDefault(); }
    else if (e.key.length === 1 && !mod && !e.altKey) { edit = typePair(text, s, end, e.key); if (edit) e.preventDefault(); }
    if (edit) put(el, edit, code.setDraft);
  };
  const onFind = useCallback((query: string, matchCase: boolean, at: number) => {
    const marks = findAll(code.draft, query, matchCase);
    setFound({ marks, at });
    const el = area.current;
    const hit = marks[at];
    if (el && hit) { el.setSelectionRange(hit[0], hit[1]); reveal(el, cursorAt(code.draft, hit[0]).line); sync(el); }
  }, [code.draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeBar = () => {
    setBar(null);
    setFound({ marks: [], at: 0 });
    requestAnimationFrame(() => { area.current?.focus(); track(); });
  };
  const goLine = (line: number) => {
    const el = area.current;
    if (!el) return;
    const at = lineStart(code.draft, line);
    setBar(null);
    el.focus();
    el.setSelectionRange(at, at);
    reveal(el, line);
    sync(el);
    track();
  };
  const sync = (t: HTMLTextAreaElement) => {
    if (under.current) { under.current.scrollTop = t.scrollTop; under.current.scrollLeft = t.scrollLeft; }
    if (gutter.current) gutter.current.scrollTop = t.scrollTop;
  };
  // Find's marks, drawn in the layer under the text, one box per match on its line (the font is fixed-width).
  const marks = found.marks.slice(0, 2000).map(([a, b], i) => {
    const p = cursorAt(code.draft, a);
    return <span key={a} className="code-found" data-current={i === found.at || undefined} style={{ top: PAD_TOP + (p.line - 1) * LINE, left: `calc(4px + ${p.col - 1}ch)`, width: `${b - a}ch` }} />;
  });

  return (
    <div className="code-editor">
      {bar && <EditorBar key={bar} mode={bar} text={code.draft} onClose={closeBar} onFind={onFind} onLine={goLine} />}
      <div className="code-edit">
        <div className="code-gutter" ref={gutter} aria-hidden="true">
          {lines.map((_, i) => <span key={i} data-current={i + 1 === here.line || undefined}>{i + 1}</span>)}
        </div>
        <div className="code-stack">
          <div className="code-under" ref={under} aria-hidden="true">
            {marks}
            {lines.map((l, i) => <div key={i} className="code-under-line" data-current={(i + 1 === here.line && picked === 0) || undefined}><Line text={l} lang={lang} /></div>)}
          </div>
          <textarea
            ref={area}
            className="code-area"
            aria-label={`Contents of ${code.open?.path ?? 'the file'}`}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            value={code.draft}
            onChange={(e) => { code.setDraft(e.target.value); track(); }}
            onKeyDown={onKey}
            onSelect={track}
            onScroll={(e) => sync(e.currentTarget)}
          />
        </div>
      </div>
      <footer className="code-status" aria-label="Where the cursor is">
        <span>Ln {here.line}, Col {here.col}{picked > 0 ? ` (${picked} selected)` : ''}</span>
        <span>{langName(path)}</span>
        <span>Spaces: 2</span>
        <span className="code-status-keys">{keyLabel('P')} Open · {keyLabel('F')} Find · {keyLabel('G')} Line · {keyLabel('/')} Comment</span>
      </footer>
    </div>
  );
}

/** Quick open (Ctrl+P): type part of a file's name, then Enter opens it. */
function QuickOpen({ code, onClose }: { code: CodeState; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [lit, setLit] = useState(0);
  const files = useMemo(() => code.entries.filter((e) => !e.folder).map((e) => e.path), [code.entries]);
  const found = useMemo(() => rankFiles(query, query ? files : [...code.tabs.filter((t) => t !== code.open?.path), ...files.filter((f) => !code.tabs.includes(f))]), [query, files, code.tabs, code.open?.path]);
  const choose = (path: string | undefined) => { if (path) void code.openFile(path); onClose(); };
  return (
    <div className="code-quick-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="code-quick" role="dialog" aria-label="Open a file">
        <input
          autoFocus
          aria-label="File to open"
          placeholder="Open a file by name"
          value={query}
          spellCheck={false}
          role="combobox"
          aria-expanded
          aria-controls="code-quick-list"
          aria-activedescendant={found[lit] ? `code-quick-${lit}` : undefined}
          onChange={(e) => { setQuery(e.target.value); setLit(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setLit((i) => Math.min(found.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setLit((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(found[lit]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        <ul id="code-quick-list" role="listbox" aria-label="Files">
          {found.map((path, i) => {
            const name = path.split('/').pop() ?? path;
            const where = path.slice(0, path.length - name.length - 1);
            return (
              <li key={path} id={`code-quick-${i}`} role="option" aria-selected={i === lit} onMouseEnter={() => setLit(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(path)}>
                <span className="code-badge" data-lang={langOf(path)} aria-hidden="true">{badgeOf(path)}</span>
                <span className="code-quick-name">{name}</span>
                {where && <span className="code-quick-where">{where}</span>}
              </li>
            );
          })}
          {found.length === 0 && <li className="code-quick-none" role="presentation">No file matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}

/** The files open as tabs, as Xcode's and VS Code's tab bars: a dot on one not saved, a middle click closes. */
function FileTabs({ code }: { code: CodeState }) {
  if (code.tabs.length === 0) return null;
  return (
    <div className="code-tabs" role="tablist" aria-label="Open files">
      {code.tabs.map((path) => {
        const name = path.split('/').pop() ?? path;
        const current = code.open?.path === path;
        const unsaved = code.unsaved(path);
        return (
          <div key={path} className="code-tab" data-current={current || undefined} title={path} onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void code.closeTab(path); } }}>
            <button type="button" role="tab" aria-selected={current} className="code-tab-main" onClick={() => { if (!current) void code.openFile(path); }}>
              <span className="code-badge" data-lang={langOf(path)} aria-hidden="true">{badgeOf(path)}</span>
              <span className="code-tab-name">{name}</span>
            </button>
            <button type="button" className="code-tab-close" data-unsaved={unsaved || undefined} aria-label={`Close ${path}${unsaved ? ' (not saved)' : ''}`} title={unsaved ? 'Not saved: closing drops what was typed' : 'Close'} onClick={() => void code.closeTab(path)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The test command (the person's to choose) and what the last run printed. */
function TestsPanel({ code }: { code: CodeState }) {
  const { tests } = code;
  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState('');
  useEffect(() => { setEditing(false); }, [code.project]);
  const start = () => { setCommand(tests.command ?? tests.suggested ?? ''); setEditing(true); };
  const save = async (e: FormEvent) => { e.preventDefault(); if (await code.setTestCommand(command)) setEditing(false); };
  const last = tests.last;
  const summary = tests.running ? 'Running…' : last ? (last.timedOut ? 'Ran out of time' : last.passed ? `Passed · ${last.seconds} s` : `Failed · ${last.seconds} s`) : '';
  return (
    <section className="code-tests" aria-label="Tests">
      <header className="code-tests-head">
        {summary ? <span className="code-tests-summary" data-state={tests.running ? 'running' : last?.passed ? 'pass' : 'fail'} role="status">{summary}{tests.by === 'assistant' && !tests.running ? ' · run by Mobius' : ''}</span> : <span className="code-tests-summary">{tests.command ? 'Not run yet' : 'No test command'}</span>}
        <span className="code-tests-actions">
          {!editing && tests.command && <code className="code-tests-command" title="The command Mobius runs for this project's tests">{tests.command}</code>}
          {!editing && <button type="button" className="btn" onClick={start}>{tests.command ? 'Change' : 'Choose command'}</button>}
          {!editing && tests.command && <button type="button" className="btn primary" disabled={tests.running} onClick={() => void code.runTests()}>Run</button>}
        </span>
      </header>
      {editing && (
        <form className="code-tests-form" onSubmit={(e) => void save(e)}>
          <input autoFocus aria-label="Test command" placeholder="npm test" value={command} maxLength={500} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }} />
          <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
          <p className="code-tests-note">Runs in the project folder on this computer. Mobius can run it to check its work, but only you choose what it is.</p>
        </form>
      )}
      {!editing && !tests.command && !last && <p className="code-tests-note">Choose the command that runs this project’s tests{tests.suggested ? `, such as ${tests.suggested}` : ''}. Mobius can then run it to check a change before you keep it.</p>}
      {last && (
        <pre className="code-tests-output" aria-label="Test output">
          {last.output.split('\n').map((l, i) => <span key={i} data-kind={testLineKind(l)}>{l}{'\n'}</span>)}
        </pre>
      )}
    </section>
  );
}

/** Commands run in the project's folder: the person's, typed here, and Mobius's, each of which it asked to run. */
function ConsolePanel({ code }: { code: CodeState }) {
  const [command, setCommand] = useState('');
  const [keep, setKeep] = useState(false);
  const out = useRef<HTMLDivElement>(null);
  useEffect(() => { out.current?.scrollTo({ top: out.current.scrollHeight }); }, [code.consoleRuns]);
  const running = code.consoleRuns.some((r) => r.result === null);
  const submit = (e: FormEvent) => { e.preventDefault(); const c = command.trim(); if (!c || (running && !keep)) return; setCommand(''); void (keep ? code.startProcess(c) : code.runCommand(c)); };
  const live = code.processes.filter((p) => p.running || Date.now() - p.started < 600_000);
  return (
    <section className="code-console" aria-label="Console">
      {live.length > 0 && (
        <ul className="code-procs" aria-label="Running">
          {live.map((p) => (
            <li key={p.id} className="code-proc" data-running={p.running || undefined}>
              <div className="code-proc-head">
                <span className="code-proc-dot" aria-hidden="true" />
                <span className="code-console-cmd">{p.by === 'assistant' ? 'Mobius › ' : '› '}{p.command}</span>
                <span className="photo-meta" role="status">{p.running ? 'Running' : p.code === null ? 'Stopped' : `Exited with ${p.code}`}</span>
                {p.running && <button type="button" className="btn" aria-label={`Stop ${p.command}`} onClick={() => void code.stopProcess(p.id)}>Stop</button>}
              </div>
              <pre aria-label={`Output of ${p.command}`}>{p.output.split('\n').slice(-8).join('\n')}</pre>
            </li>
          ))}
        </ul>
      )}
      <div className="code-console-out" ref={out} role="log" aria-label="Console output">
        {code.consoleRuns.length === 0 && <p className="code-tests-note">Run a command in the project's folder, such as git status or npm install. Mobius can run one too, and asks you each time.</p>}
        {code.consoleRuns.map((r, i) => (
          <div key={i} className="code-console-run" data-by={r.by}>
            <div className="code-console-cmd"><span aria-hidden="true">{r.by === 'assistant' ? 'Mobius ›' : '›'}</span> {r.command}</div>
            {r.result === null ? <div className="code-tests-note" role="status">Running…</div> : <pre>{r.result.output || (r.result.passed ? '(no output)' : `exited with ${r.result.code ?? 'no code'}`)}</pre>}
          </div>
        ))}
      </div>
      <form className="code-console-form" onSubmit={submit}>
        <span aria-hidden="true">›</span>
        <input aria-label="Command" placeholder="A command to run in this project" value={command} maxLength={2000} spellCheck={false} autoCapitalize="off" onChange={(e) => setCommand(e.target.value)} />
        <label className="code-keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep running</label>
        <button type="submit" className="btn" disabled={(running && !keep) || !command.trim()}>{keep ? 'Start' : 'Run'}</button>
      </form>
    </section>
  );
}

const PANEL_KEY = 'mobius.code.panel';

/** The open file: as Mobius changed it (to keep or discard) or as you type it, and the project's tests below. */
export function CodeEditor({ code, review }: { code: CodeState; review?: { conversation: string; settled?: boolean } | null }) {
  const file = code.open && code.project ? `code/${code.project}/${code.open.path}` : null;
  const [bottom, setBottom] = useState<'tests' | 'console'>('tests');
  const [panel, setPanel] = useState(() => { try { return window.localStorage.getItem(PANEL_KEY) !== 'hidden'; } catch { return true; } });
  const showPanel = (on: boolean) => { setPanel(on); try { window.localStorage.setItem(PANEL_KEY, on ? 'shown' : 'hidden'); } catch { /* Not kept. */ } };
  const [bar, setBar] = useState<'find' | 'line' | null>(null);
  const [quick, setQuick] = useState(false);
  // Ctrl+P opens a file by name from anywhere in the app.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p' && code.project) { e.preventDefault(); setQuick(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [code.project]);
  useEffect(() => { setBar(null); }, [code.open?.path]);
  // A command Mobius runs shows where it can be seen.
  const runs = code.consoleRuns.length;
  useEffect(() => { if (runs > 0 && code.consoleRuns[runs - 1]?.by === 'assistant') { setBottom('console'); showPanel(true); } }, [runs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [kept, setKept] = useState(false);
  const [before, setBefore] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns('code').includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
    // Checked again when the file changes (a new turn's change is not kept yet) and when a turn ends, so a check made
    // while it ran cannot leave its change hidden.
  }, [review?.conversation, review?.settled, file, code.open?.modified]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!review || kept || !file) { setBefore(undefined); return; }
    void window.mobius.changes.before(review.conversation, file).then((was) => { if (live) setBefore(was && was.ok ? was.text : undefined); }).catch(() => {});
    return () => { live = false; };
  }, [review?.conversation, review?.settled, kept, file, code.open?.modified]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (before !== undefined && code.open?.text != null ? lineDiff(before ?? '', code.open.text) : null), [before, code.open?.text]);
  const showSuggestion = rows !== null && rows.some((r) => r.kind !== 'same') && !code.dirty;
  const keepAll = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id, 'code');
    setKept(true);
  };
  const discardAll = async () => {
    if (!review || !file) return;
    await window.mobius.changes.undoFile(review.conversation, file).catch(() => null);
    await code.reload();
  };
  // ⌘⏎ keeps and ⌘⌫ discards while a suggestion is shown, as in the rest of Mobius.
  useEffect(() => {
    if (!showSuggestion) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      if (e.key === 'Enter') { e.preventDefault(); void keepAll(); }
      if (e.key === 'Backspace') { e.preventDefault(); void discardAll(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!code.available) return <section className="code-page empty" aria-label="Code"><EmptyState app="code" title="Code is not available here" /></section>;
  if (!code.project) return <section className="code-page empty" aria-label="Code"><EmptyState app="code" title="No project open" line="A project is a folder of files Mobius can read, suggest changes to and test." action={{ label: 'New project', run: () => void code.createProject('Project') }} /></section>;
  const lang = code.open ? langOf(code.open.path) : 'plain';
  return (
    <section className="code-page" aria-label="Code">
      <div className="code-main">
        {code.open ? (
          <>
            <FileTabs code={code} />
            <header className="code-file-head">
              <nav className="code-crumbs" aria-label="Where this file is">
                <span>{code.project}</span>
                {code.open.path.split('/').map((part, i, parts) => (
                  <Fragment key={i}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
                    {i === parts.length - 1 ? <span className="code-path"><span className="code-badge" data-lang={lang} aria-hidden="true">{badgeOf(code.open!.path)}</span>{part}</span> : <span>{part}</span>}
                  </Fragment>
                ))}
              </nav>
              {code.dirty && <span className="code-dirty" role="status">Not saved</span>}
              <span className="code-head-actions">
                {code.dirty && <button type="button" className="btn" onClick={() => code.setDraft(code.open?.text ?? '')}>Revert</button>}
                {code.open.text !== null && <button type="button" className="btn primary" disabled={!code.dirty} onClick={() => void code.save()}>Save <kbd>{keyLabel('S')}</kbd></button>}
              </span>
            </header>
            {code.message && <p className="tasks-message" role="alert">{code.message}</p>}
            {code.open.text === null ? (
              <p className="note-empty">This file is {code.open.why ?? 'not shown'}.</p>
            ) : showSuggestion && rows ? (
              <Suggestion rows={rows} lang={lang} endsWithNewline={code.open.text.endsWith('\n')} onWrite={(t) => void code.write(t)} onKeepAll={() => void keepAll()} onDiscardAll={() => void discardAll()} {...(review ? { conversation: review.conversation } : {})} />
            ) : (
              <Editor code={code} lang={lang} bar={bar} setBar={setBar} />
            )}
          </>
        ) : (
          <div className="code-none">
            <p>Choose a file on the left, or open one by name.</p>
            <button type="button" className="btn" onClick={() => setQuick(true)}>Open a file… <kbd>{keyLabel('P')}</kbd></button>
          </div>
        )}
      </div>
      {quick && <QuickOpen code={code} onClose={() => setQuick(false)} />}
      <div className="code-bottom" data-hidden={!panel || undefined}>
        <div className="code-bottom-tabs">
          <div role="tablist" aria-label="Below the file">
            <button type="button" role="tab" aria-selected={panel && bottom === 'tests'} onClick={() => { setBottom('tests'); showPanel(true); }}>Tests{code.tests.last && !code.tests.running && <span className="code-tab-dot" data-state={code.tests.last.passed ? 'pass' : 'fail'} aria-hidden="true" />}</button>
            <button type="button" role="tab" aria-selected={panel && bottom === 'console'} onClick={() => { setBottom('console'); showPanel(true); }}>Console</button>
          </div>
          <button type="button" className="strip-btn code-panel-toggle" aria-expanded={panel} aria-label={panel ? 'Hide the panel' : 'Show the panel'} title={panel ? 'Hide the panel' : 'Show the panel'} onClick={() => showPanel(!panel)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d={panel ? 'm5 8 5 5 5-5' : 'm5 12 5-5 5 5'} /></svg>
          </button>
        </div>
        {panel && (bottom === 'tests' ? <TestsPanel code={code} /> : <ConsolePanel code={code} />)}
      </div>
    </section>
  );
}
