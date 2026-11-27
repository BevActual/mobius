import { createPortal } from 'react-dom';
import { AppGlance, useGlanceSlot } from './PanelSlots';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { EmptyState } from './EmptyState';
import { FromMobius } from './FromMobius';
import { Fragment, type MutableRefObject, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { onCommand, sendCommand } from './commands';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { readBefore } from './readBefore';
import { IS_MAC, cursorAt, deletePair, findAll, indentLines, keyLabel, langName, lineStart, newLine, rankFiles, toggleComment, typePair, type Edit } from './code-edit';
import { applyGroups, changeGroups, codeOutline, gitMarks, highlight, langOf, lineDiff, testLineKind, testsGlance, type DiffRow, type GitMark, type Lang } from './code-view';
import { RowMark } from './RowMark';
import type { CodeState, CodeTests } from './useCode';
import { useLanguage, type LanguageState } from './code-lsp';
import { pagePath, pickedLine, sourcePath, useCodePreview, type PreviewState } from './code-preview';
import { useSideFile, type SideFile } from './code-split';
import { testArgs, testKey, type TestMark } from './code-run';
import { fixPrompt, reviewRequest } from './code-mobius';
import { START_BRANCH_EVENT, takeBranchName } from './code-branch';
import { relativeTime } from './relative-time';
import { isNotesFailure, type CodeBranch, type CodeCommit, type CodeProblem, type ContextItem } from '@mobius/shared';
import { ReviewActions, TurnRunningContext, WhyThis } from './ReviewBar';
import { SideNew, type Start } from './SideNew';
import { AppSidebar, Button, KeyCaps, PanelLayout, SidebarRow, SidebarSection, type PanelSpec } from './ui';
import './code.css';
import { CodeText, type BarMode } from './CodeText';
import { afterPaint } from './ui/frame';

/** Projects, and the open project's files as a tree, with the ones the agent changed in its last turn marked. */
export function CodeSidebar({ code, pin, changed, starts, onStart, onReview }: { code: CodeState; pin?: ReactNode; changed?: ReadonlySet<string>; starts?: readonly Start[]; onStart?: (prompt: string) => void; /** Sends Review with Mobius (answered, nothing changed). */ onReview?: (prompt: string, item: ContextItem) => void }) {
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
    <AppSidebar label="Explorer" className="code-side">
      {code.project && (
<SideNew item="file" title="New file, in the folder of the open one" onNew={() => { setNaming('file'); setName(code.open ? code.open.path.split('/').slice(0, -1).concat('').join('/') : ''); }} {...(starts ? { starts } : {})} {...(onStart ? { onStart } : {})} />
      )}
      {code.project && (
<input className="side-search code-filter" type="search" aria-label="Filter files" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setFilter(''); if (e.key === 'Enter' && matching) { const first = [...matching][0]; if (first) void code.openFile(first); } }} />
      )}
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label={naming === 'project' ? 'Project name' : 'File name'} placeholder={naming === 'project' ? 'Project name' : 'src/file.ts'} value={name} maxLength={naming === 'project' ? 80 : 300} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {code.projects.length === 0 && !naming && (
        <div className="side-empty notes-empty">
          <p>No projects yet.</p>
          <button type="button" className="btn primary" onClick={() => setNaming('project')}>New project</button>
        </div>
      )}
      {code.projects.length > 0 && (
        <SidebarSection title="Projects" action={<>
          {pin}
          <button type="button" className="strip-btn" aria-label="New project" title="New project" onClick={() => { setNaming('project'); setName(''); }}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </>}>
          {code.projects.map((p) => <SidebarRow key={p.name} label={p.name} current={p.name === code.project} onSelect={() => { if (p.name !== code.project) void code.openProject(p.name); }} />)}
        </SidebarSection>
      )}
      {code.project && code.git.repo && <GitBar code={code} {...(onReview ? { onReview } : {})} />}
      {code.project && (
        <nav className="ui-side-section code-tree" aria-label="Files">
          <div className="side-head"><h3 className="side-title">Files</h3></div>
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
                    ) : <FileGlyph />}
                    <span className="code-file-name">{name}</span>
                    {mark ? <RowMark changed /> : !e.folder && marks.has(e.path) && <GitLetter mark={marks.get(e.path)!} />}
                  </button>
                </li>
              );
            })}
          </ul>
          {matching && shown.length === 0 && <p className="side-empty">No file matches “{filter}”.</p>}
          {!matching && code.entries.length === 0 && (
            <div className="code-tree-empty">
              <span>No files yet.</span>
              <Button kind="quiet" title={`New file (${keyLabel('N')})`} onClick={() => { setNaming('file'); setName(''); }}>New file</Button>
            </div>
          )}
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
    </AppSidebar>
  );
}

/** A file's right-click menu: the shared one, opened from a point inside the sidebar. */
/** A file in the tree, tabs and breadcrumb: one grey line icon. The name already says the type. */
function FileGlyph() {
  return <svg className="code-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.75h5L12.25 5v8.5a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75V2.5A.75.75 0 0 1 4 1.75Z" /><path d="M9 1.75V5h3.25" /></svg>;
}

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
function GitBar({ code, onReview }: { code: CodeState; onReview?: (prompt: string, item: ContextItem) => void }) {
  const [writing, setWriting] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  /** The branch list, open below the branch's name; `naming` is a new branch's name being typed. */
  const [picking, setPicking] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [list, setList] = useState<CodeBranch[]>([]);
  /** The changed file whose Discard is waiting for a yes. */
  const [confirm, setConfirm] = useState<string | null>(null);
  const repo = code.git.repo;
  const openBranches = useCallback(async (name: string | null = null) => {
    setPicking(true);
    setNaming(name);
    const got = code.project ? await window.mobius.code?.branches?.(code.project).catch(() => null) : null;
    setList(got && 'branches' in got ? got.branches : []);
  }, [code.project]);
  // A task asked for a branch (Tasks' Start a branch in Code): New branch opens with its name.
  useEffect(() => {
    if (!repo) return undefined;
    const take = () => { const name = takeBranchName(); if (name) void openBranches(name); };
    take();
    window.addEventListener(START_BRANCH_EVENT, take);
    return () => window.removeEventListener(START_BRANCH_EVENT, take);
  }, [repo, openBranches]);
  if (!code.git.repo) return null;
  const { branch, changes, ahead } = code.git;
  const switchTo = async (name: string, create: boolean) => {
    const project = code.project;
    if (!project || !window.mobius.code?.switchBranch) return;
    setBusy(true);
    const done = await window.mobius.code.switchBranch(project, name, create).catch(() => null);
    setBusy(false);
    if (!done || isNotesFailure(done)) { code.setMessage(done?.message ?? 'Git would not switch branches.'); return; }
    setPicking(false); setNaming(null);
    code.setMessage('');
    await code.refresh();
  };
  const discard = async (path: string) => {
    const project = code.project;
    setConfirm(null);
    if (!project || !window.mobius.code?.discard) return;
    const done = await window.mobius.code.discard(project, path).catch(() => null);
    if (!done || isNotesFailure(done)) { code.setMessage(done?.message ?? 'That file could not be put back.'); return; }
    await code.refresh();
  };
  const marks = [...gitMarks(changes)];
  const shown = showAll ? marks : marks.slice(0, SHOWN_CHANGES);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await code.commit(message)) { setWriting(false); setMessage(''); }
    setBusy(false);
  };
  const review = async () => {
    const project = code.project;
    if (!onReview || !project || !window.mobius.code?.gitDiff) return;
    setReading(true);
    const got = await window.mobius.code.gitDiff(project).catch(() => null);
    setReading(false);
    if (!got || !('repo' in got) || !got.repo) { code.setMessage('What changed could not be read.'); return; }
    if (!got.diff.trim()) { code.setMessage('Nothing has changed since the last commit.'); return; }
    const { prompt, item } = reviewRequest(project, branch, got.diff, got.truncated);
    onReview(prompt, item);
  };
  const status = `${changes.length === 0 ? 'Nothing to commit' : changes.length === 1 ? '1 change' : `${changes.length} changes`}${ahead ? ` · ${ahead} to push` : ''}`;
  return (
    <section className="ui-side-section code-git" aria-label="Changes">
      <div className="side-head">
        <h3 className="side-title">Changes</h3>
        <div className="side-actions">
          <Button kind="quiet" disabled={changes.length === 0 || writing} onClick={() => setWriting(true)}>Commit…</Button>
          <Button kind="quiet" disabled={busy} onClick={() => { setBusy(true); void code.push().finally(() => setBusy(false)); }}>Push</Button>
        </div>
      </div>
      <div className="code-git-head">
        <button type="button" className="code-git-branch" aria-expanded={picking} aria-label={`Branch: ${branch || 'none'}. Switch or start a branch`} title="Switch branch, or start a new one from here" onClick={() => (picking ? setPicking(false) : void openBranches())}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="6" cy="4.5" r="1.8" /><circle cx="6" cy="15.5" r="1.8" /><circle cx="14" cy="7" r="1.8" /><path d="M6 6.3v7.4M14 8.8c0 3-3 3.2-8 4.9" /></svg><span>{branch || 'no branch'}</span><svg className="code-git-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></button>
        <span className="code-git-count" role="status">{status}</span>
      </div>
      {picking && (
        <div className="code-git-branches" role="group" aria-label="Branches" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setPicking(false); } }}>
          {naming !== null ? (
            <form className="code-git-form" onSubmit={(e) => { e.preventDefault(); if (naming.trim()) void switchTo(naming.trim(), true); }}>
              <input autoFocus aria-label="New branch name" placeholder="New branch, from here" value={naming} maxLength={200} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setNaming(null); } }} />
              <Button kind="primary" type="submit" disabled={busy || !naming.trim()}>Start</Button>
            </form>
          ) : (
            <button type="button" className="list-row code-git-new" onClick={() => setNaming('')}>New branch…</button>
          )}
          <ul className="ui-side-list" aria-label="Switch to">
            {list.map((b) => (
              <li key={b.name}>
                <button type="button" className="list-row code-git-change" aria-current={b.current || undefined} disabled={busy} onClick={() => (b.current ? setPicking(false) : void switchTo(b.name, false))}>
                  <span className="code-git-name">{b.name}</span>
                  {b.current && <span className="code-git-where">current</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {writing && (
        <form className="code-git-form" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Commit message" placeholder="What changed, and why" value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setWriting(false); }} />
          <Button kind="primary" type="submit" disabled={busy || !message.trim()}>Commit</Button>
        </form>
      )}
      {shown.length > 0 && (
        <ul className="ui-side-list code-git-changes" aria-label="Changed files">
          {shown.map(([path, mark]) => {
            const name = path.split('/').pop() ?? path;
            const where = path.includes('/') ? path.slice(0, path.length - name.length - 1) : '';
            return (
              <li key={path} className="code-git-row">
                {confirm === path ? (
                  <div className="code-git-confirm" role="group" aria-label={`Discard changes to ${path}?`}>
                    <span className="code-git-where">{mark.letter === '?' || mark.letter === 'A' ? `Delete ${name}?` : `Put back ${name}?`}</span>
                    <button type="button" className="btn code-git-yes" autoFocus onClick={() => void discard(path)}>Discard</button>
                    <button type="button" className="btn" onClick={() => setConfirm(null)}>Keep</button>
                  </div>
                ) : (
                  <>
                    <button type="button" className="list-row code-git-change" aria-label={`${path}, ${mark.label.toLowerCase()}`} disabled={mark.letter === 'D'} title={path} onClick={() => void code.openFile(path)}>
                      <span className="code-git-name">{name}</span>
                      {where && <span className="code-git-where">{where}</span>}
                      <GitLetter mark={mark} />
                    </button>
                    <button type="button" className="code-git-discard" aria-label={`Discard changes to ${path}`} title="Discard changes: put the file back as the last commit has it" onClick={() => setConfirm(path)}>
                      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8h7a3.5 3.5 0 0 1 0 7H8" /><path d="m8 5-3 3 3 3" /></svg>
                    </button>
                  </>
                )}
              </li>
            );
          })}
          {marks.length > SHOWN_CHANGES && (
            <li><button type="button" className="list-row code-git-more" onClick={() => setShowAll((all) => !all)}>{showAll ? 'Show fewer' : `${marks.length - SHOWN_CHANGES} more`}</button></li>
          )}
        </ul>
      )}
      {onReview && shown.length > 0 && (
        <button type="button" className="list-row code-git-review" disabled={reading} title="Mobius reads what changed since the last commit and says what it would fix. It changes nothing." onClick={() => void review()}>
          <span className="code-git-name">{reading ? 'Reading the changes…' : 'Review with Mobius'}</span>
        </button>
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
            const where = path.includes('/') ? path.slice(0, path.length - name.length - 1) : '';
            return (
              <li key={path} id={`code-quick-${i}`} role="option" aria-selected={i === lit} onMouseEnter={() => setLit(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(path)}>
                <FileGlyph />
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
              <FileGlyph />
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
    <section className="code-tests code-panel">
      <header className="code-tests-head">
        {summary ? <span className="code-tests-summary" data-state={tests.running ? 'running' : last?.passed ? 'pass' : 'fail'} role="status">{summary}{tests.by === 'assistant' && !tests.running ? ' · run by Mobius' : ''}</span> : <span className="code-tests-summary">{tests.command ? 'Not run yet' : 'No test command'}</span>}
        <span className="code-tests-actions">
          {!editing && tests.command && <code className="code-tests-command" title={tests.ran && !tests.running ? 'What the last run ran: your test command narrowed to one test' : "The command Mobius runs for this project's tests"}>{tests.ran && !tests.running ? tests.ran : tests.command}</code>}
          {!editing && <Button kind="quiet" onClick={start}>{tests.command ? 'Change' : 'Choose command'}</Button>}
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
    <section className="code-console code-panel">
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

/**
 * What shows while no file is open, as Xcode's and Nova's start pages: the project, the files opened lately, and the
 * few things to do next with their shortcuts.
 */
function OutlinePanel({ text, lang, onGo }: { text: string; lang: Lang; onGo: (line: number) => void }) {
  const entries = useMemo(() => codeOutline(text, lang), [text, lang]);
  if (!entries.length) return <p className="code-outline-empty muted">Nothing to outline in this file.</p>;
  return (
    <ul className="code-outline" aria-label="What this file defines">
      {entries.map((e) => (
        <li key={`${e.line}:${e.name}`} style={{ paddingLeft: `calc(var(--sp-2) + ${e.depth * 12}px)` }}>
          <button type="button" onClick={() => onGo(e.line)} title={`Line ${e.line}`}>
            <span className="code-outline-kind">{e.kind}</span>
            <span className="code-outline-name">{e.name}</span>
            <span className="code-outline-line">{e.line}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NoFileOpen({ code, onQuick }: { code: CodeState; onQuick: () => void }) {
  const files = code.entries.filter((e) => !e.folder);
  const changed = code.git.repo ? code.git.changes.length : 0;
  return (
    <div className="code-none" role="region" aria-label="No file open">
      <div className="code-none-inner">
        <div className="code-none-head">
          <h2 className="code-none-title">{code.project}</h2>
          <p className="code-none-sub">{files.length === 1 ? '1 file' : `${files.length} files`}{code.git.repo ? ` · ${code.git.branch || 'no branch'}${changed ? ` · ${changed === 1 ? '1 change' : `${changed} changes`}` : ''}` : ''}</p>
        </div>
        {code.recent.length > 0 && (
          <section className="code-none-group" aria-label="Recent files">
            <h3>Recent</h3>
            <ul>
              {code.recent.slice(0, 5).map((path) => {
                const name = path.split('/').pop() ?? path;
                const where = path.includes('/') ? path.slice(0, path.length - name.length - 1) : '';
                return (
                  <li key={path}>
                    <button type="button" className="code-none-row" onClick={() => void code.openFile(path)}>
                      <FileGlyph />
                      <span className="code-none-name">{name}</span>
                      {where && <span className="code-none-where">{where}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <section className="code-none-group" aria-label="Start">
          <h3>Start</h3>
          <ul>
            <li><button type="button" className="code-none-row" onClick={onQuick}><span className="code-none-name">Open a file…</span><KeyCaps keys={keyLabel('P')} /></button></li>
            <li><button type="button" className="code-none-row" onClick={() => sendCommand('new-file')}><span className="code-none-name">New file…</span><KeyCaps keys={keyLabel('N')} /></button></li>
            {code.tests.command && <li><button type="button" className="code-none-row" disabled={code.tests.running} onClick={() => void code.runTests()}><span className="code-none-name">Run tests</span><code className="code-none-where">{code.tests.command}</code></button></li>}
          </ul>
        </section>
      </div>
    </div>
  );
}


/** The open file: as Mobius changed it (to keep or discard) or as you type it, and the project's tests below. */
export function CodeEditor({ code, review, listPanels = [], terminal, onAsk, onDraft, busy = false }: { /** Mobius is working: Fix with Mobius waits, and Ctrl+. is left to stop it. */ busy?: boolean; /** Sends a request to Mobius (Fix with Mobius). */ onAsk?: (prompt: string) => void; /** Puts a request in Mobius's box for the person to finish (Ask Mobius about a picked element). */ onDraft?: (prompt: string) => void; code: CodeState; review?: { conversation: string; settled?: boolean } | null; /** The app's list, from the frame: its left panel. */ listPanels?: readonly PanelSpec[]; /** The workspace's terminal, Code's Terminal panel (the Terminal app folded in). */ terminal?: ReactNode }) {
  const file = code.open && code.project ? `code/${code.project}/${code.open.path}` : null;
  const [bar, setBar] = useState<BarMode | null>(null);
  const [quick, setQuick] = useState(false);
  // Ctrl+P opens a file by name from anywhere in the app.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p' && code.project) {
        e.preventDefault();
        // In the second editor, Ctrl+P opens a file there.
        if ((document.activeElement as HTMLElement | null)?.closest('.code-pane-side')) setSideQuick(true); else setQuick(true);
      }
      // F6 and Shift+F6 move the keyboard between the two editors of a split, as in VS Code.
      if (e.key === 'F6' && !e.altKey && !e.ctrlKey && !e.metaKey && document.querySelector('.code-pane-side .ed-input')) {
        e.preventDefault();
        const inSide = (document.activeElement as HTMLElement | null)?.closest('.code-pane-side');
        document.querySelector<HTMLTextAreaElement>(inSide ? '.code-pane-main .ed-input' : '.code-pane-side .ed-input')?.focus({ preventScroll: true });
      }
      // Ctrl+\ splits the editor: the open file beside itself, or the split closed when there is one.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === '\\' || e.code === 'Backslash') && code.open) {
        e.preventDefault();
        splitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [code.project, code.open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setBar(null); }, [code.open?.path]);
  const splitRef = useRef<() => void>(() => {});
  // A command Mobius runs shows where it can be seen: the Console panel opens for it.
  const assistantRuns = code.consoleRuns.filter((r) => r.by === 'assistant').length;
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
    if (!review || kept || !file) { setBefore(undefined); return; }
    return readBefore(review.conversation, file, setBefore, () => setBefore(undefined));
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
  // Not while Mobius's turn still runs: its change is shown as it lands, and kept or put back once it is whole.
  const running = useContext(TurnRunningContext);
  const jump = useRef<((line: number) => void) | null>(null);
  const lsp = useLanguage(code);
  const preview = useCodePreview(code);
  const base = useGitBase(code);
  // The split: a second editor beside the first (Ctrl+\\), with its own find bar and language smarts.
  const side = useSideFile(code);
  const sideLsp = useLanguage(side.state && !side.shared ? side.state : NO_FILE(code));
  const sideBase = useGitBase(side.state ?? NO_FILE(code));
  const [sideBar, setSideBar] = useState<BarMode | null>(null);
  const [sideQuick, setSideQuick] = useState(false);
  useEffect(() => { setSideBar(null); }, [side.path]);
  const [showProblems, setShowProblems] = useState(0);
  const [showTests, setShowTests] = useState(0);
  /** Fix with Mobius, for a problem in a file (the open one travels with the message; Mobius reads others itself). */
  const fixFor = (path: string, problem: CodeProblem) => { if (onAsk && code.project) onAsk(fixPrompt(code.project, path, problem)); };
  const fixIn = (state: CodeState | null) => (onAsk && !busy && state?.open ? (p: CodeProblem) => fixFor(state.open!.path, p) : undefined);
  /** Run buttons beside a pane's tests: the file saved first, then the project's test command narrowed to that test. */
  const runnerFor = (state: CodeState) => {
    const path = state.open?.path ?? '';
    const what = (m: TestMark) => (m.group ? `the tests in “${m.name}”` : `“${m.name}”`);
    return {
      results: code.tests.results,
      running: code.tests.running,
      keyOf: (m: TestMark) => testKey(path, m),
      label: (m: TestMark) => {
        if (!code.tests.command) return `Run ${what(m)} (choose a test command first)`;
        const r = code.tests.results.get(testKey(path, m));
        return r === 'running' ? `Running ${what(m)}…` : r === 'passed' ? `Passed. Run ${what(m)} again` : r === 'failed' ? `Failed${code.tests.notes.get(testKey(path, m)) ? `: ${code.tests.notes.get(testKey(path, m))}` : ''}. Run ${what(m)} again` : `Run ${what(m)}`;
      },
      run: (m: TestMark) => void (async () => {
        setShowTests((n) => n + 1);
        const command = code.tests.command;
        if (!command || !path) return;
        if (state.dirty && !(await state.save())) return;
        await code.runTests({ key: testKey(path, m), args: testArgs(command, path, m, langOf(path)) });
      })(),
    };
  };
  splitRef.current = () => {
    if (side.path) { side.close(); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.code-pane-main .ed-input')?.focus({ preventScroll: true })); return; }
    if (!code.open) return;
    void side.open(code.open.path).then(() => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.code-pane-side .ed-input')?.focus({ preventScroll: true })));
  };
  useEffect(() => {
    if (!showSuggestion || running) return;
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

  // Terminal (bottom dock, beside Tests and Console): the workspace's own terminal, there with or without a project.
  const terminalPanels: PanelSpec[] = terminal ? [{ id: 'terminal', name: 'Terminal', dock: 'bottom', group: 'run', shown: false, render: () => terminal }] : [];
  if (!code.available) return <PanelLayout app="code" panels={[...listPanels, ...terminalPanels]}><section className="code-page empty" aria-label="Code"><EmptyState app="code" title="Code is not available here" /></section></PanelLayout>;
  if (!code.project) return <PanelLayout app="code" panels={[...listPanels, ...terminalPanels]}><section className="code-page empty" aria-label="Code"><EmptyState app="code" title="No project open" line="A project is a folder of files Mobius can read, suggest changes to and test." action={{ label: 'New project', run: () => void code.createProject('Project') }} /></section></PanelLayout>;
  // Tests and Console (bottom dock, side by side): the test run and a shell in the project.
  const bottomPanels: PanelSpec[] = [
    { id: 'tests', name: 'Tests', dock: 'bottom', group: 'run', shown: true, reveal: showTests, render: () => <TestsPanel code={code} /> },
    { id: 'console', name: 'Console', dock: 'bottom', group: 'run', shown: false, reveal: assistantRuns, render: () => <ConsolePanel code={code} /> },
    ...(code.git.repo ? [{ id: 'history', name: 'History', dock: 'bottom' as const, group: 'run', shown: false, render: () => <HistoryPanel code={code} /> }] : []),
    { id: 'problems', name: 'Problems', dock: 'bottom', group: 'run', shown: false, reveal: showProblems, render: () => <ProblemsPanel lsp={lsp} {...(onAsk && !busy ? { onFix: fixFor } : {})} /> },
    ...terminalPanels,
  ];
  const lang = code.open ? langOf(code.open.path) : 'plain';
  // Outline (right, hidden until asked for): what the open file defines; a click goes to its line.
  const outlinePanel: PanelSpec | null = code.open ? { id: 'outline', name: 'Outline', dock: 'right', shown: false, render: () => <OutlinePanel text={code.draft} lang={lang} onGo={(line) => jump.current?.(line)} /> } : null;
  return (
    <PanelLayout app="code" panels={[...listPanels, ...(outlinePanel ? [outlinePanel] : []), ...bottomPanels]}>
    <section className="code-page" aria-label="Code">
      <div className="code-main" data-split={side.state ? '' : undefined}>
       <div className="code-pane code-pane-main">
        {code.open ? (
          <>
            <FileTabs code={code} />
            <header className="code-file-head">
              <nav className="code-crumbs" aria-label="Where this file is">
                <span>{code.project}</span>
                {code.open.path.split('/').map((part, i, parts) => (
                  <Fragment key={i}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
                    {i === parts.length - 1 ? <span className="code-path"><FileGlyph />{part}</span> : <span>{part}</span>}
                  </Fragment>
                ))}
              </nav>
              {code.dirty && <span className="code-dirty" role="status">Not saved</span>}
              <span className="code-head-actions">
                {window.mobius.code?.preview && (
                  <>
                    <Button kind="quiet" pressed={preview.url !== null} title="Show the project's page in the Browser beside Code; saving reloads it" onClick={() => void preview.open().then(() => document.querySelector<HTMLTextAreaElement>('.code-page .ed-input')?.focus({ preventScroll: true }))}>Preview</Button>
                    {preview.url && <Button kind="quiet" pressed={preview.picking} title="Click an element on the page to go to its code" onClick={() => void preview.pick()}>Pick</Button>}
                  </>
                )}
                {code.open.text !== null && !side.state && <Button kind="quiet" title={`Split the editor: a second file beside this one (${keyLabel('\\')})`} onClick={() => splitRef.current()}>Split</Button>}
                {code.dirty && <button type="button" className="btn" onClick={() => code.setDraft(code.open?.text ?? '')}>Revert</button>}
                {code.open.text !== null && <Button kind={code.dirty ? 'primary' : 'quiet'} disabled={!code.dirty} title={`Save (${keyLabel('S')})`} onClick={() => void lsp.save()}>Save</Button>}
              </span>
            </header>
            {code.message && (
              <p className="tasks-message" role="alert">
                {code.message}
                {code.clash && <>
                  {' '}<button type="button" className="btn" title="Show the file as it is on disk; what you typed goes" onClick={() => void code.settleClash('theirs')}>Use theirs</button>
                  {' '}<button type="button" className="btn" title="Write what you typed over the file on disk" onClick={() => void code.settleClash('mine')}>Keep mine</button>
                </>}
              </p>
            )}
            <PreviewNotice code={code} lsp={lsp} preview={preview} {...(onAsk ? { onAsk } : {})} {...(onDraft ? { onDraft } : {})} />
            {code.open.text === null ? (
              <p className="note-empty">This file is {code.open.why ?? 'not shown'}.</p>
            ) : showSuggestion && rows ? (
              <Suggestion rows={rows} lang={lang} endsWithNewline={code.open.text.endsWith('\n')} onWrite={(t) => void code.write(t)} onKeepAll={() => void keepAll()} onDiscardAll={() => void discardAll()} {...(review ? { conversation: review.conversation } : {})} />
            ) : (
              <CodeText code={code} lang={lang} bar={bar} setBar={setBar} jump={jump} lsp={lsp} onShowProblems={() => setShowProblems((n) => n + 1)} runner={runnerFor(code)} {...(fixIn(code) ? { onFix: fixIn(code)! } : {})} {...(base !== undefined ? { base } : {})} />
            )}
          </>
        ) : (
          <NoFileOpen code={code} onQuick={() => setQuick(true)} />
        )}
       </div>
        {side.state && <SidePane side={side} lsp={side.shared ? lsp : sideLsp} base={side.shared ? base : sideBase} bar={sideBar} setBar={setSideBar} onQuick={() => setSideQuick(true)} onShowProblems={() => setShowProblems((n) => n + 1)} runner={runnerFor(side.state)} {...(fixIn(side.state) ? { onFix: fixIn(side.state)! } : {})} />}
      </div>
      {quick && <QuickOpen code={code} onClose={() => setQuick(false)} />}
      {sideQuick && side.state && <QuickOpen code={{ ...side.state, openFile: (p: string) => side.open(p) }} onClose={() => { setSideQuick(false); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.code-pane-side .ed-input')?.focus({ preventScroll: true })); }} />}
    </section>
    </PanelLayout>
  );
}

/** Code with no file open, for the second editor's hooks while it shows nothing of its own. */
const NO_FILE = (code: CodeState): CodeState => ({ ...code, open: null });

/** The open file as the last commit has it, for the editor's change marks (read again after each save and commit). */
function useGitBase(code: CodeState): string | undefined {
  const [base, setBase] = useState<string | undefined>(undefined);
  const project = code.project;
  const path = code.open?.path;
  const repo = code.git.repo;
  useEffect(() => {
    const api = window.mobius.code;
    if (!api || !project || !path || !repo) { setBase(undefined); return undefined; }
    let on = true;
    void api.gitBase(project, path).then((r) => { if (on) setBase('repo' in r && r.repo && r.text !== null ? r.text : undefined); }).catch(() => { if (on) setBase(undefined); });
    return () => { on = false; };
  }, [project, path, repo, code.git, code.open?.modified]); // eslint-disable-line react-hooks/exhaustive-deps
  return base;
}

/** The second editor: its file's name, Open file…, Save and Close, then the file itself. */
function SidePane({ side, lsp, base, bar, setBar, onQuick, onShowProblems, runner, onFix }: { side: SideFile; lsp: LanguageState; base: string | undefined; bar: BarMode | null; setBar: (bar: BarMode | null) => void; onQuick: () => void; onShowProblems: () => void; runner: ComponentProps<typeof CodeText>['runner']; onFix?: (problem: CodeProblem) => void }) {
  const state = side.state;
  if (!state) return null;
  const file = state.open;
  const name = side.path?.split('/').pop() ?? '';
  return (
    <div className="code-pane code-pane-side" role="region" aria-label={`Second editor: ${side.path ?? ''}`}>
      <div className="code-tabs" role="tablist" aria-label="File in the second editor">
        <div className="code-tab" data-current title={side.path ?? ''}>
          <button type="button" role="tab" aria-selected className="code-tab-main"><FileGlyph /><span className="code-tab-name">{name}</span></button>
          <button type="button" className="code-tab-close" data-unsaved={state.dirty || undefined} aria-label="Close the second editor" title={`Close the split (${keyLabel('\\')})${state.dirty ? ': drops what was typed' : ''}`} onClick={side.close}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
          </button>
        </div>
      </div>
      <header className="code-file-head">
        <nav className="code-crumbs" aria-label="Where this file is">
          {side.path!.split('/').slice(0, -1).map((part, i) => <Fragment key={i}><span>{part}</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg></Fragment>)}
          <span className="code-path"><FileGlyph />{name}</span>
        </nav>
        {state.dirty && <span className="code-dirty" role="status">Not saved</span>}
        <span className="code-head-actions">
          <Button kind="quiet" title={`Open another file here (${keyLabel('P')} while this editor has the keyboard; F6 moves between the editors)`} onClick={onQuick}>Open…</Button>
          {file?.text != null && <Button kind={state.dirty ? 'primary' : 'quiet'} disabled={!state.dirty} title={`Save (${keyLabel('S')})`} onClick={() => void (side.shared ? state.save() : lsp.save())}>Save</Button>}
        </span>
      </header>
      {side.message && <p className="tasks-message" role="alert">{side.message}</p>}
      {file === null ? null : file.text === null ? (
        <p className="note-empty">This file is {file.why ?? 'not shown'}.</p>
      ) : (
        <CodeText code={state} lang={langOf(file.path)} bar={bar} setBar={setBar} lsp={lsp} onShowProblems={onShowProblems} runner={runner} {...(onFix ? { onFix } : {})} {...(base !== undefined ? { base } : {})} />
      )}
    </div>
  );
}

/** What the preview reported: the page's last error, or the element just picked, each with a way to its code and to Mobius. */
function PreviewNotice({ code, lsp, preview, onAsk, onDraft }: { code: CodeState; lsp: LanguageState; preview: PreviewState; onAsk?: (prompt: string) => void; onDraft?: (prompt: string) => void }) {
  const error = preview.errors.at(-1);
  const pick = preview.picked;
  const project = code.project ?? '';
  if (preview.message) return <p className="code-preview-note" role="alert">{preview.message}</p>;
  if (preview.picking) return <p className="code-preview-note" role="status">Click an element on the page beside to pick it (Esc on the page stops).</p>;
  if (pick) {
    const page = pagePath(pick.path);
    const what = `<${pick.tag ?? 'element'}>${pick.text ? ` “${pick.text.trim().slice(0, 40)}”` : ''}`;
    const goToCode = async () => {
      const got = await window.mobius.code?.read(project, page).catch(() => null);
      const text = got && 'text' in got && typeof got.text === 'string' ? got.text : null;
      const line = text === null ? -1 : pickedLine(text, pick);
      if (line < 0) { code.setMessage(`That element was not found in ${page}; it may be made by a script.`); return; }
      void lsp.goTo({ path: page, line, character: Math.max(0, (text!.split('\n')[line] ?? '').search(/\S/)) });
    };
    return (
      <div className="code-preview-note" role="status" data-kind="pick">
        <span className="code-preview-text">Picked {what} on {page}</span>
        <Button kind="quiet" onClick={() => void goToCode()}>Go to code</Button>
        {onDraft && <Button kind="quiet" onClick={() => onDraft(`In the preview of the Code project "${project}", on ${page}, this element:\n\n\`\`\`html\n${(pick.html ?? '').slice(0, 1500)}\n\`\`\`\n\n`)}>Ask Mobius</Button>}
        <button type="button" className="ed-peek-close" aria-label="Dismiss" onClick={preview.clearPicked}>×</button>
      </div>
    );
  }
  if (error) {
    const file = sourcePath(error.source, preview.url);
    const where = file ? `${file}${error.line ? `:${error.line}` : ''}` : '';
    const more = preview.errors.length > 1 ? ` (and ${preview.errors.length - 1} more)` : '';
    return (
      <div className="code-preview-note" role="alert" data-kind="error">
        <span className="ed-hover-mark" aria-hidden="true" />
        <span className="code-preview-text">The page has an error: {error.message}{where ? ` · ${where}` : ''}{more}</span>
        {file && <Button kind="quiet" onClick={() => void lsp.goTo({ path: file, line: Math.max(0, (error.line ?? 1) - 1), character: Math.max(0, (error.column ?? 1) - 1) })}>Go to it</Button>}
        {onAsk && <Button kind="quiet" onClick={() => { onAsk(`The preview of the Code project "${project}" shows this error:\n${error.message}${where ? `\nat ${where}${error.column ? `:${error.column}` : ''}` : ''}${error.stack ? `\n${error.stack}` : ''}\nFind the cause in the project and fix it.`); preview.clearErrors(); }}>Fix with Mobius</Button>}
        <button type="button" className="ed-peek-close" aria-label="Dismiss" onClick={preview.clearErrors}>×</button>
      </div>
    );
  }
  return null;
}

/** History (bottom dock, beside Tests): the branch's commits, newest first; one opens to its message and files. */
function HistoryPanel({ code }: { code: CodeState }) {
  const [commits, setCommits] = useState<CodeCommit[] | null>(null);
  const [open, setOpen] = useState<{ id: string; message: string; files: { path: string; added: number | null; removed: number | null }[] } | null>(null);
  const key = code.git.repo ? `${code.git.branch}\u0001${code.git.ahead ?? ''}\u0001${code.git.changes.length}` : '';
  useEffect(() => {
    const project = code.project;
    if (!project || !window.mobius.code?.history) return undefined;
    let on = true;
    void window.mobius.code.history(project).catch(() => null).then((got) => { if (on) setCommits(got && 'repo' in got && got.repo ? got.commits : []); });
    return () => { on = false; };
  }, [code.project, key]);
  const show = async (id: string) => {
    if (open?.id === id) { setOpen(null); return; }
    const got = code.project ? await window.mobius.code?.showCommit?.(code.project, id).catch(() => null) : null;
    if (got && !isNotesFailure(got)) setOpen(got);
  };
  if (commits === null) return <p className="code-panel code-problems-empty">Reading the history…</p>;
  if (commits.length === 0) return <p className="code-panel code-problems-empty">No commits on this branch yet. Commit from Changes, in the Explorer.</p>;
  const now = Date.now();
  return (
    <div className="code-panel code-history">
      <ul aria-label="Commits">
        {commits.map((c) => (
          <li key={c.id}>
            <button type="button" className="code-commit" aria-expanded={open?.id === c.id} onClick={() => void show(c.id)}>
              <span className="code-commit-subject">{c.subject}</span>
              {!c.pushed && code.git.repo && code.git.ahead != null && <span className="code-commit-tag" title="On this computer only">Not pushed</span>}
              <span className="code-commit-where">{c.author} · {relativeTime(c.when * 1000, now)} · <code>{c.id}</code></span>
            </button>
            {open?.id === c.id && (
              <div className="code-commit-open">
                {open.message.trim().split('\n').slice(1).join('\n').trim() && <p className="code-commit-body">{open.message.trim().split('\n').slice(1).join('\n').trim()}</p>}
                <ul aria-label={`Files in ${c.id}`}>
                  {open.files.map((f) => (
                    <li key={f.path}>
                      <button type="button" className="code-commit-file" onClick={() => void code.openFile(f.path)}>
                        <span>{f.path}</span>
                        <span className="code-commit-count">{f.added === null ? 'binary' : <><span data-kind="add">+{f.added}</span> <span data-kind="del">−{f.removed}</span></>}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Problems (bottom dock, beside Tests): what the project's language servers found, file by file; a click goes there. */
function ProblemsPanel({ lsp, onFix }: { lsp: LanguageState; onFix?: (path: string, problem: CodeProblem) => void }) {
  const files = [...lsp.problems.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (files.length === 0) {
    return (
      <p className="code-panel code-problems-empty">
        {lsp.status.kind === 'failed'
          ? `The ${lsp.status.language} server (${lsp.status.program}) would not start: ${lsp.status.message}`
          : lsp.status.kind === 'missing'
          ? `Problems in ${lsp.status.language} files show here once ${lsp.status.program ?? 'a language server'} is installed on this computer or in this project.`
          : lsp.status.kind === 'server' ? 'No problems found.' : 'Problems show here for files a language server knows.'}
      </p>
    );
  }
  return (
    <div className="code-panel code-problems">
      {files.map(([path, items]) => (
        <section key={path} aria-label={path}>
          <h3>{path} · {items.length}</h3>
          <ul>
            {items.map((p, i) => (
              <li key={i}>
                <button type="button" className="code-problem" data-severity={p.severity} onClick={() => void lsp.goTo({ path, line: p.line, character: p.character })}>
                  <span className="ed-hover-mark" aria-hidden="true" />
                  <span>{p.message}</span>
                  <span className="code-problem-where">{p.source ? `${p.source} · ` : ''}Ln {p.line + 1}, Col {p.character + 1}</span>
                </button>
                {onFix && <button type="button" className="code-problem-fix" aria-label={`Fix with Mobius, line ${p.line + 1}`} title={`Fix with Mobius: ${p.message}`} onClick={() => onFix(path, p)}>Fix</button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Code in Glance, after a test run fails: what failed, and Find the cause, which asks Mobius to fix it and run the tests again. */
export function CodeGlance({ tests, onDebug }: { tests: CodeTests; onDebug: () => void }) {
  const slot = useGlanceSlot();
  const facts = testsGlance(tests.last, tests.command);
  if (!slot || !facts || tests.running) return null;
  return <AppGlance slot={slot} title="A test fails" facts={facts} action={{ label: 'Find the cause', run: onDebug }} />;
}
