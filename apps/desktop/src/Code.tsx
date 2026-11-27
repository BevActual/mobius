import { createPortal } from 'react-dom';
import { AppGlance, useGlanceSlot } from './PanelSlots';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { EmptyState } from './EmptyState';
import { FromMobius } from './FromMobius';
import { Fragment, type MutableRefObject, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { onCommand, sendCommand } from './commands';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { readBefore } from './readBefore';
import { IS_MAC, cursorAt, deletePair, findAll, indentLines, keyLabel, langName, lineStart, newLine, rankFiles, toggleComment, typePair, type Edit } from './code-edit';
import { applyGroups, changeGroups, codeOutline, gitMarks, highlight, langOf, lineDiff, testLineKind, testsGlance, type DiffRow, type GitMark, type Lang } from './code-view';
import { RowMark } from './RowMark';
import type { CodeState, CodeTests } from './useCode';
import { useLanguage, type LanguageState } from './code-lsp';
import { ReviewActions, TurnRunningContext, WhyThis } from './ReviewBar';
import { SideNew, type Start } from './SideNew';
import { AppSidebar, Button, KeyCaps, PanelLayout, SidebarRow, SidebarSection, type PanelSpec } from './ui';
import './code.css';
import { CodeText, type BarMode } from './CodeText';
import { afterPaint } from './ui/frame';

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
      {code.project && code.git.repo && <GitBar code={code} />}
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
        <span className="code-git-branch" title="Branch"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="6" cy="4.5" r="1.8" /><circle cx="6" cy="15.5" r="1.8" /><circle cx="14" cy="7" r="1.8" /><path d="M6 6.3v7.4M14 8.8c0 3-3 3.2-8 4.9" /></svg>{branch || 'no branch'}</span>
        <span className="code-git-count" role="status">{status}</span>
      </div>
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
            const where = path.slice(0, path.length - name.length - 1);
            return (
              <li key={path}>
                <button type="button" className="list-row code-git-change" aria-label={`${path}, ${mark.label.toLowerCase()}`} disabled={mark.letter === 'D'} title={path} onClick={() => void code.openFile(path)}>
                  <span className="code-git-name">{name}</span>
                  {where && <span className="code-git-where">{where}</span>}
                  <GitLetter mark={mark} />
                </button>
              </li>
            );
          })}
          {marks.length > SHOWN_CHANGES && (
            <li><button type="button" className="list-row code-git-more" onClick={() => setShowAll((all) => !all)}>{showAll ? 'Show fewer' : `${marks.length - SHOWN_CHANGES} more`}</button></li>
          )}
        </ul>
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
            const where = path.slice(0, path.length - name.length - 1);
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
          {!editing && tests.command && <code className="code-tests-command" title="The command Mobius runs for this project's tests">{tests.command}</code>}
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
                const where = path.slice(0, path.length - name.length - 1);
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
export function CodeEditor({ code, review, listPanels = [], terminal }: { code: CodeState; review?: { conversation: string; settled?: boolean } | null; /** The app's list, from the frame: its left panel. */ listPanels?: readonly PanelSpec[]; /** The workspace's terminal, Code's Terminal panel (the Terminal app folded in). */ terminal?: ReactNode }) {
  const file = code.open && code.project ? `code/${code.project}/${code.open.path}` : null;
  const [bar, setBar] = useState<BarMode | null>(null);
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
  // The open file as the last commit has it, for the editor's change marks (read again after each save and commit).
  const [base, setBase] = useState<string | undefined>(undefined);
  useEffect(() => {
    const api = window.mobius.code;
    const project = code.project;
    const path = code.open?.path;
    if (!api || !project || !path || !code.git.repo) { setBase(undefined); return undefined; }
    let on = true;
    void api.gitBase(project, path).then((r) => { if (on) setBase('repo' in r && r.repo && r.text !== null ? r.text : undefined); }).catch(() => { if (on) setBase(undefined); });
    return () => { on = false; };
  }, [code.project, code.open?.path, code.git]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showProblems, setShowProblems] = useState(0);
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
    { id: 'tests', name: 'Tests', dock: 'bottom', group: 'run', shown: true, render: () => <TestsPanel code={code} /> },
    { id: 'console', name: 'Console', dock: 'bottom', group: 'run', shown: false, reveal: assistantRuns, render: () => <ConsolePanel code={code} /> },
    { id: 'problems', name: 'Problems', dock: 'bottom', group: 'run', shown: false, reveal: showProblems, render: () => <ProblemsPanel lsp={lsp} /> },
    ...terminalPanels,
  ];
  const lang = code.open ? langOf(code.open.path) : 'plain';
  // Outline (right, hidden until asked for): what the open file defines; a click goes to its line.
  const outlinePanel: PanelSpec | null = code.open ? { id: 'outline', name: 'Outline', dock: 'right', shown: false, render: () => <OutlinePanel text={code.draft} lang={lang} onGo={(line) => jump.current?.(line)} /> } : null;
  return (
    <PanelLayout app="code" panels={[...listPanels, ...(outlinePanel ? [outlinePanel] : []), ...bottomPanels]}>
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
                    {i === parts.length - 1 ? <span className="code-path"><FileGlyph />{part}</span> : <span>{part}</span>}
                  </Fragment>
                ))}
              </nav>
              {code.dirty && <span className="code-dirty" role="status">Not saved</span>}
              <span className="code-head-actions">
                {code.dirty && <button type="button" className="btn" onClick={() => code.setDraft(code.open?.text ?? '')}>Revert</button>}
                {code.open.text !== null && <Button kind={code.dirty ? 'primary' : 'quiet'} disabled={!code.dirty} title={`Save (${keyLabel('S')})`} onClick={() => void lsp.save()}>Save</Button>}
              </span>
            </header>
            {code.message && <p className="tasks-message" role="alert">{code.message}</p>}
            {code.open.text === null ? (
              <p className="note-empty">This file is {code.open.why ?? 'not shown'}.</p>
            ) : showSuggestion && rows ? (
              <Suggestion rows={rows} lang={lang} endsWithNewline={code.open.text.endsWith('\n')} onWrite={(t) => void code.write(t)} onKeepAll={() => void keepAll()} onDiscardAll={() => void discardAll()} {...(review ? { conversation: review.conversation } : {})} />
            ) : (
              <CodeText code={code} lang={lang} bar={bar} setBar={setBar} jump={jump} lsp={lsp} onShowProblems={() => setShowProblems((n) => n + 1)} {...(base !== undefined ? { base } : {})} />
            )}
          </>
        ) : (
          <NoFileOpen code={code} onQuick={() => setQuick(true)} />
        )}
      </div>
      {quick && <QuickOpen code={code} onClose={() => setQuick(false)} />}
    </section>
    </PanelLayout>
  );
}

/** Problems (bottom dock, beside Tests): what the project's language servers found, file by file; a click goes there. */
function ProblemsPanel({ lsp }: { lsp: LanguageState }) {
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
