import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { historyStep, promptPath, tail } from './terminal-view';
import type { TerminalState } from './useTerminal';

/** Places to go to, and the commands that keep running. */
export function TerminalSidebar({ term, pin }: { term: TerminalState; pin: ReactNode }) {
  const running = term.processes.filter((p) => p.running);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <aside className="side term-side" aria-label="Terminal sidebar">
      <div className="side-head">
        <span className="side-title">Places</span>
        <span className="side-actions">{pin}</span>
      </div>
      <ul className="term-places" aria-label="Places">
        {term.places.map((p) => (
          <li key={p.cwd}>
            <button type="button" className="note-row term-place" data-within={p.within ? true : undefined} aria-current={term.cwd === p.cwd ? 'page' : undefined} title={promptPath(p.cwd)} onClick={() => void term.go(`/${p.cwd}`)}>
              {p.name}
            </button>
          </li>
        ))}
      </ul>
      {term.processes.length > 0 && (
        <>
          <div className="side-head"><span className="side-title">Running</span></div>
          <ul className="term-procs" aria-label="Running commands">
            {term.processes.map((p) => (
              <li key={p.id} data-running={p.running || undefined}>
                <button type="button" className="term-proc" aria-expanded={open === p.id} onClick={() => setOpen((o) => (o === p.id ? null : p.id))}>
                  <span className="term-dot" aria-hidden="true" />
                  <code>{p.command}</code>
                  <span className="term-state">{p.running ? 'running' : p.code === null ? 'stopped' : `ended (${p.code})`}</span>
                </button>
                {p.running && <button type="button" className="btn" onClick={() => void term.stop(p.id)}>Stop</button>}
                {open === p.id && <pre className="term-proc-out" aria-label={`Output of ${p.command}`}>{tail(p.output, 60).text || '(nothing yet)'}</pre>}
              </li>
            ))}
          </ul>
          {running.length === 0 && <p className="design-hint term-hint">Nothing is running now.</p>}
        </>
      )}
    </aside>
  );
}

/** The terminal: what was run and what it printed, and the line to type the next command on. */
export function TerminalPage({ term, focusToken, onAsk }: { term: TerminalState; focusToken?: number; /** Puts a block beside the message box, for a question about it. */ onAsk?: (title: string, text: string) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => { void navigator.clipboard?.writeText(text).then(() => { setCopied(key); window.setTimeout(() => setCopied(null), 1400); }); };
  const [line, setLine] = useState('');
  const [keep, setKeep] = useState(false);
  const [at, setAt] = useState(-1);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, [focusToken]);
  // The screen follows what was printed last.
  useLayoutEffect(() => { const s = screen.current; if (s) s.scrollTop = s.scrollHeight; }, [term.entries]);
  const submit = async () => {
    const text = line;
    setLine('');
    setAt(-1);
    setBusy(true);
    await term.run(text, keep);
    setBusy(false);
    input.current?.focus();
  };
  return (
    <section className="term-page" aria-label="Terminal" onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('term-screen')) input.current?.focus(); }}>
      <div className="term-screen" ref={screen} role="log" aria-label="Terminal output">
        {term.entries.length === 0 && <p className="term-welcome">Commands run in your workspace, in the folder on the prompt, one line at a time. <code>cd</code> moves around inside the workspace; Keep running starts a server or a watcher. Mobius cannot use this terminal.</p>}
        {term.entries.map((e) => {
          const out = e.result ? tail(e.result.output.replace(/\s+$/, '')) : null;
          return (
            <div key={e.id} className="term-entry" data-failed={e.result && !e.result.passed ? true : undefined}>
              <div className="term-line">
                <span className="term-prompt">{promptPath(e.cwd)} $</span> <span className="term-command">{e.command}</span>
                {/* Each block's own actions, as in Warp: copy what was run or what it printed, run it again, ask about it. */}
                <span className="term-actions" role="group" aria-label={`Actions for ${e.command}`}>
                  <button type="button" onClick={() => copy(`c${e.id}`, e.command)}>{copied === `c${e.id}` ? 'Copied' : 'Copy command'}</button>
                  {e.result && <button type="button" onClick={() => copy(`o${e.id}`, e.result!.output)}>{copied === `o${e.id}` ? 'Copied' : 'Copy output'}</button>}
                  <button type="button" disabled={busy} onClick={() => { setBusy(true); void term.run(e.command).finally(() => setBusy(false)); }}>Run again</button>
                  {onAsk && e.result && <button type="button" onClick={() => onAsk(`Terminal: ${e.command}`.slice(0, 120), `$ ${e.command}   (in ${promptPath(e.cwd)})\n${e.result!.output.slice(-20_000)}\n${e.result!.passed ? 'Exit code 0' : `Exit code ${e.result!.code ?? 'none'}`}`)}>Ask Mobius</button>}
                </span>
              </div>
              {e.note && <div className="term-note">{e.note}</div>}
              {!e.result && e.note === undefined && <div className="term-note">Running…</div>}
              {out && (
                <>
                  {out.hidden > 0 && <div className="term-note">{out.hidden} earlier lines not shown</div>}
                  {out.text && <pre className="term-out">{out.text}</pre>}
                  {!e.result!.passed && <div className="term-exit">{e.result!.timedOut ? 'Stopped: it took too long' : `Exit code ${e.result!.code ?? 'none'}`}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
      <form className="term-input" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="term-prompt" htmlFor="term-line">{promptPath(term.cwd)} $</label>
        <input
          id="term-line"
          ref={input}
          aria-label="Command"
          autoComplete="off"
          spellCheck={false}
          value={line}
          disabled={busy}
          onChange={(e) => { setLine(e.target.value); setAt(-1); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const n = historyStep(term.history, at, e.key === 'ArrowUp');
              setAt(n);
              setLine(n < 0 ? '' : term.history[n] ?? '');
            } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); term.clear(); }
          }}
        />
        <label className="term-keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep running</label>
      </form>
    </section>
  );
}
