import { useEffect, useMemo, useState } from 'react';
import type { NoteVersion } from '@mobius/shared';
import { diffCounts, diffLines } from './line-diff';
import { daysFrom, formatWith, timeLabel } from './dates';

/** "Today", "Yesterday", or the date in this computer's regional format: the heading a version sits under. */
export function dayOf(ms: number, now: number): string {
  const diff = -daysFrom(ms, now);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return formatWith(ms, { ...(diff < 7 ? { weekday: 'long' as const } : {}), day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' as const }) });
}

/** What restoring would do, in words: "2 lines come back, 1 goes". */
export function restoreSummary({ added, removed }: { added: number; removed: number }): string {
  const parts = [
    added ? `${added} ${added === 1 ? 'line comes' : 'lines come'} back` : '',
    removed ? `${removed} ${removed === 1 ? 'line goes' : 'lines go'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'The same as the page now';
}

const timeOf = (ms: number) => timeLabel(ms);

/** Versions grouped under their day, newest first. */
export function byDay(versions: readonly NoteVersion[], now: number): { day: string; versions: NoteVersion[] }[] {
  const out: { day: string; versions: NoteVersion[] }[] = [];
  for (const v of versions) {
    const day = dayOf(v.whenMs, now);
    const last = out[out.length - 1];
    if (last?.day === day) last.versions.push(v);
    else out.push({ day, versions: [v] });
  }
  return out;
}

/**
 * A page's History, in place of the page: its earlier versions down the side, the chosen one compared with the page
 * now, and Restore. Restoring is saved like typing, so the page as it is now becomes a version too and can be put back.
 */
export function NoteHistory({ path, text, onRestore, onClose, kind = 'notes' }: { path: string; text: string; onRestore: (content: string, whenMs: number) => void; onClose: () => void; kind?: 'notes' | 'docs' }) {
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState(0);
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    let live = true;
    setVersions(null);
    setChosen(0);
    const read = window.mobius[kind]?.versions;
    if (!read) { setVersions([]); return; }
    void read(path).then((v) => {
      if (!live) return;
      if (Array.isArray(v)) setVersions(v);
      else { setVersions([]); setProblem(v.message); }
    }).catch(() => { if (live) { setVersions([]); setProblem('The earlier versions could not be read.'); } });
    return () => { live = false; };
  }, [path]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const now = Date.now();
  const shown = versions?.[chosen] ?? null;
  // From the page now to the version: + lines come back, − lines go, if it is restored.
  const diff = useMemo(() => (shown ? diffLines(text, shown.content) : []), [shown, text]);
  const counts = diffCounts(diff);
  const move = (list: HTMLElement, by: number) => {
    const next = Math.min(Math.max(0, chosen + by), (versions?.length ?? 1) - 1);
    setChosen(next);
    list.querySelector<HTMLElement>(`[data-i="${next}"]`)?.focus();
  };
  return (
    <section className="note-history" aria-label="History">
      <header className="note-history-head">
        <h2>History</h2>
        <span className="note-history-sub">{versions === null ? 'Reading…' : versions.length === 0 ? '' : `${versions.length} earlier ${versions.length === 1 ? 'version' : 'versions'}`}</span>
        <span className="spacer" />
        {shown && <button type="button" className="btn primary" onClick={() => onRestore(shown.content, shown.whenMs)}>Restore this version</button>}
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </header>
      {versions !== null && versions.length === 0 ? (
        <div className="note-history-empty">
          <p>{problem ?? 'No earlier versions yet.'}</p>
          <p className="note-history-hint">A version is kept every few minutes as you write, and before Mobius changes the page.</p>
        </div>
      ) : (
        <div className="note-history-body">
          <nav className="note-history-list" aria-label="Versions" onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1); } }}>
            {byDay(versions ?? [], now).map((group) => (
              <div key={group.day} role="group" aria-label={group.day}>
                <h3>{group.day}</h3>
                {group.versions.map((v) => {
                  const i = versions!.indexOf(v);
                  return (
                    <button key={`${v.whenMs}-${v.source}`} type="button" className="note-history-row" aria-current={i === chosen ? 'true' : undefined} data-i={i} onClick={() => setChosen(i)}>
                      <span className="note-history-time">{timeOf(v.whenMs)}</span>
                      <span className="note-history-why">{v.source === 'checkpoint' ? 'Before Mobius changed it' : 'While you wrote'}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          {shown && (
            <div className="note-history-view">
              <div className="note-history-bar">
                <span>{`${dayOf(shown.whenMs, now)}, ${timeOf(shown.whenMs)}`}</span>
                {!whole && <span className="note-history-counts">{restoreSummary(counts)}</span>}
                <span className="spacer" />
                <div className="seg" role="group" aria-label="Show">
                  <button type="button" className="seg-btn" aria-pressed={!whole} onClick={() => setWhole(false)}>Changes</button>
                  <button type="button" className="seg-btn" aria-pressed={whole} onClick={() => setWhole(true)}>Whole page</button>
                </div>
              </div>
              {whole ? (
                <pre className="note-history-page" aria-label="That version">{shown.content}</pre>
              ) : (
                <ol className="note-diff note-history-diff" aria-label="What restoring changes">
                  {diff.map((line, i) => (
                    <li key={i} data-kind={line.kind}>
                      <span className="note-diff-sign" aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}</span>
                      <span className="note-diff-text">{line.kind === 'removed' ? <del>{line.text || ' '}</del> : line.kind === 'added' ? <ins>{line.text || ' '}</ins> : (line.text || ' ')}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
