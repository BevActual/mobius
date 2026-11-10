import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { applyGroups, badgeOf, changeGroups, highlight, langOf, lineDiff, testLineKind, type DiffRow, type Lang } from './code-view';
import type { CodeState } from './useCode';
import { ReviewActions } from './ReviewBar';

/** Projects, and the open project's files as a tree, with the ones the agent changed in its last turn marked. */
export function CodeSidebar({ code, pin, changed }: { code: CodeState; pin?: ReactNode; changed?: ReadonlySet<string> }) {
  const [naming, setNaming] = useState<'project' | 'file' | null>(null);
  const [name, setName] = useState('');
  useEffect(() => onCommand('new-project', () => { setNaming('project'); setName(''); }), []);
  useEffect(() => onCommand('new-file', () => { if (code.project) { setNaming('file'); setName(''); } }), [code.project]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = naming === 'project' ? (await code.createProject(name.trim() || 'Project')) !== null : await code.createFile(name.trim());
    if (ok) { setNaming(null); setName(''); }
  };
  // A folder is shown when every folder above it is open.
  const shown = code.entries.filter((e) => {
    const parts = e.path.split('/');
    return parts.slice(0, -1).every((_, i) => code.expanded.has(parts.slice(0, i + 1).join('/')));
  });
  const changedHere = (path: string) => code.project !== null && changed?.has(`${code.project}/${path}`) === true;
  const changedInside = (folder: string) => code.project !== null && [...(changed ?? [])].some((c) => c.startsWith(`${code.project}/${folder}/`));
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
            <button type="button" className="strip-btn" aria-label="New file" title="New file" onClick={() => { setNaming('file'); setName(code.open ? code.open.path.split('/').slice(0, -1).concat('').join('/') : ''); }}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            </button>
          </div>
          <ul role="tree" aria-label={`Files in ${code.project}`}>
            {shown.map((e) => {
              const name = e.path.split('/').pop() ?? e.path;
              const isOpen = code.expanded.has(e.path);
              const mark = e.folder ? (changedInside(e.path) && !isOpen) : changedHere(e.path);
              return (
                <li key={e.path} role="treeitem" aria-expanded={e.folder ? isOpen : undefined} aria-selected={code.open?.path === e.path} aria-label={e.path}>
                  <button type="button" className="code-file" data-folder={e.folder || undefined} aria-current={code.open?.path === e.path ? 'page' : undefined} style={{ paddingLeft: 8 + e.depth * 14 }} onClick={() => (e.folder ? code.toggle(e.path) : void code.openFile(e.path))}>
                    {e.folder ? <span className="code-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span> : <span className="code-badge" data-lang={langOf(e.path)} aria-hidden="true">{badgeOf(e.path)}</span>}
                    <span className="code-file-name">{name}</span>
                    {mark && <span className="code-mark" role="img" aria-label="Changed by the agent" title="Changed by Mobius in its last turn">M</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </aside>
  );
}

/** The project's branch and what changed since its last commit, with Commit and Push. Mobius asks before either. */
function GitBar({ code }: { code: CodeState }) {
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (!code.git.repo) return null;
  const { branch, changes, ahead } = code.git;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await code.commit(message)) { setWriting(false); setMessage(''); }
    setBusy(false);
  };
  return (
    <section className="code-git" aria-label="Git">
      <div className="code-git-head">
        <span className="code-git-branch" title="Branch">⎇ {branch || 'no branch'}</span>
        <span className="code-git-count" role="status">{changes.length === 0 ? 'Nothing to commit' : changes.length === 1 ? '1 change' : `${changes.length} changes`}{ahead ? ` · ${ahead} to push` : ''}</span>
      </div>
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
function Suggestion({ rows, lang, endsWithNewline, onWrite, onKeepAll, onDiscardAll }: { rows: DiffRow[]; lang: Lang; endsWithNewline: boolean; onWrite: (text: string) => void; onKeepAll: () => void; onDiscardAll: () => void }) {
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
        <span>{groups.length === 1 ? 'One change from Mobius' : `${groups.length} changes from Mobius`}</span>
        <ReviewActions onKeep={onKeepAll} onDiscard={onDiscardAll} discardTitle="Discard (Ctrl+Backspace)" keepTitle="Keep (Ctrl+Enter)" />
      </div>
    </div>
  );
}

/** A plain text area with the coloured lines drawn under it, so it types like any text field and reads like code. */
function Editor({ code, lang }: { code: CodeState; lang: Lang }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const under = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => code.draft.split('\n'), [code.draft]);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void code.save(); return; }
    const el = e.currentTarget;
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end } = el;
      const next = `${code.draft.slice(0, s)}  ${code.draft.slice(end)}`;
      code.setDraft(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      // A new line starts as indented as the one above it.
      const s = el.selectionStart;
      const lineStart = code.draft.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(code.draft.slice(lineStart, s))?.[0] ?? '';
      if (!indent) return;
      e.preventDefault();
      const next = `${code.draft.slice(0, s)}\n${indent}${code.draft.slice(el.selectionEnd)}`;
      code.setDraft(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 1 + indent.length; });
    }
  };
  return (
    <div className="code-edit">
      <div className="code-gutter" aria-hidden="true">
        {lines.map((_, i) => <span key={i}>{i + 1}</span>)}
      </div>
      <div className="code-stack">
        <div className="code-under" ref={under} aria-hidden="true">
          {lines.map((l, i) => <div key={i} className="code-under-line"><Line text={l} lang={lang} /></div>)}
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
          onChange={(e) => code.setDraft(e.target.value)}
          onKeyDown={onKey}
          onScroll={(e) => {
            const t = e.currentTarget;
            if (under.current) { under.current.scrollTop = t.scrollTop; under.current.scrollLeft = t.scrollLeft; }
            const gutter = t.closest('.code-edit')?.querySelector<HTMLElement>('.code-gutter');
            if (gutter) gutter.scrollTop = t.scrollTop;
          }}
        />
      </div>
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
        <span className="code-tests-title">Tests</span>
        {summary && <span className="code-tests-summary" data-state={tests.running ? 'running' : last?.passed ? 'pass' : 'fail'} role="status">{summary}{tests.by === 'assistant' && !tests.running ? ' · run by Mobius' : ''}</span>}
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

/** The open file: as Mobius changed it (to keep or discard) or as you type it, and the project's tests below. */
export function CodeEditor({ code, review }: { code: CodeState; review?: { conversation: string } | null }) {
  const file = code.open && code.project ? `code/${code.project}/${code.open.path}` : null;
  const [bottom, setBottom] = useState<'tests' | 'console'>('tests');
  // A command Mobius runs shows where it can be seen.
  const runs = code.consoleRuns.length;
  useEffect(() => { if (runs > 0 && code.consoleRuns[runs - 1]?.by === 'assistant') setBottom('console'); }, [runs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [kept, setKept] = useState(false);
  const [before, setBefore] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns().includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
    // Checked again when the file changes: a new turn's change is not kept yet.
  }, [review?.conversation, file, code.open?.modified]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!review || kept || !file) { setBefore(undefined); return; }
    void window.mobius.changes.before(review.conversation, file).then((was) => { if (live) setBefore(was && was.ok ? was.text : undefined); }).catch(() => {});
    return () => { live = false; };
  }, [review?.conversation, kept, file, code.open?.modified]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (before !== undefined && code.open?.text != null ? lineDiff(before ?? '', code.open.text) : null), [before, code.open?.text]);
  const showSuggestion = rows !== null && rows.some((r) => r.kind !== 'same') && !code.dirty;
  const keepAll = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id);
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

  if (!code.available) return <section className="code-page empty" aria-label="Code"><p className="note-empty">Code is not available here.</p></section>;
  if (!code.project) return <section className="code-page empty" aria-label="Code"><p className="note-empty">Make a project to start: a folder of files Mobius can read, suggest changes to and test.</p></section>;
  const lang = code.open ? langOf(code.open.path) : 'plain';
  return (
    <section className="code-page" aria-label="Code">
      <div className="code-main">
        {code.open ? (
          <>
            <header className="code-file-head">
              <span className="code-badge" data-lang={lang} aria-hidden="true">{badgeOf(code.open.path)}</span>
              <span className="code-path">{code.open.path}</span>
              {code.dirty && <span className="code-dirty" role="status">Not saved</span>}
              <span className="code-head-actions">
                {code.dirty && <button type="button" className="btn" onClick={() => code.setDraft(code.open?.text ?? '')}>Revert</button>}
                {code.open.text !== null && <button type="button" className="btn primary" disabled={!code.dirty} onClick={() => void code.save()}>Save <kbd>⌘S</kbd></button>}
              </span>
            </header>
            {code.message && <p className="tasks-message" role="alert">{code.message}</p>}
            {code.open.text === null ? (
              <p className="note-empty">This file is {code.open.why ?? 'not shown'}.</p>
            ) : showSuggestion && rows ? (
              <Suggestion rows={rows} lang={lang} endsWithNewline={code.open.text.endsWith('\n')} onWrite={(t) => void code.write(t)} onKeepAll={() => void keepAll()} onDiscardAll={() => void discardAll()} />
            ) : (
              <Editor code={code} lang={lang} />
            )}
          </>
        ) : (
          <p className="note-empty">Choose a file on the left.</p>
        )}
      </div>
      <div className="code-bottom">
        <div className="code-bottom-tabs" role="tablist" aria-label="Below the file">
          <button type="button" role="tab" aria-selected={bottom === 'tests'} onClick={() => setBottom('tests')}>Tests</button>
          <button type="button" role="tab" aria-selected={bottom === 'console'} onClick={() => setBottom('console')}>Console</button>
        </div>
        {bottom === 'tests' ? <TestsPanel code={code} /> : <ConsolePanel code={code} />}
      </div>
    </section>
  );
}
