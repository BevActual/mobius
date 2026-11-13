import { useCallback, useEffect, useRef, useState } from 'react';
import type { TurnRecord } from '@mobius/shared';
import { describeChange } from './ReviewStrip';
import { timeLabel } from './dates';
import { UndoToast } from './ui';

const APP_OF_KIND: Record<string, string> = {
  Note: 'Notes', Doc: 'Docs', Deck: 'Slides', Sheet: 'Sheets', Tasks: 'Tasks', Calendar: 'Calendar', Code: 'Code', Design: 'Design',
  Board: 'Canvas', Report: 'Research', Article: 'Reader', Database: 'Database', Photo: 'Photo', Song: 'Music', Cut: 'Video', Skill: 'Skills', File: 'Files',
};

/** The apps a set of workspace files belong to, each once, in the order first seen. */
export function appsOf(files: readonly string[]): string[] {
  return [...new Set(files.map((f) => APP_OF_KIND[describeChange(f).kind] ?? 'Files'))];
}

/** "Rewind 3 later turns? Mail, Sheets will change." */
export function rewindQuestion(later: number, apps: readonly string[]): string {
  const turns = later === 0 ? 'Rewind to here?' : `Rewind ${later === 1 ? '1 later turn' : `${later} later turns`}?`;
  const change = apps.length === 0 ? 'Nothing in your apps will change.' : `${apps.join(', ')} will change.`;
  return `${turns} ${change}`;
}

const when = (ms: number) => timeLabel(ms);

/**
 * The open conversation's turns, newest first, in Activity. "Rewind to here" puts every app back as it was right after
 * that turn and takes out the turns after it; it asks once, naming what will change, and can be undone for a moment.
 */
export function Turns({ conversation, busy, version = 0 }: { conversation: string; busy: boolean; /** Changes when the conversation does, so the list is read again. */ version?: number }) {
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [asking, setAsking] = useState<{ start: string; question: string } | null>(null);
  const [rewound, setRewound] = useState<{ undo: string; ask: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const api = window.mobius.changes;
  // Reading the turns can be slow, and several reads can be under way at once (after a turn, a moment later, after
  // a rewind). Only the newest read is shown: one that began before a rewind would bring back the turns it took out.
  const reading = useRef(0);
  const load = useCallback(async () => {
    const mine = ++reading.current;
    const result = await api?.turns?.(conversation).catch(() => null);
    if (mine !== reading.current) return;
    // Every turn is listed; a turn whose end is still being saved has no Rewind yet.
    setTurns(result && result.ok ? result.turns : []);
  }, [api, conversation]);
  useEffect(() => { setAsking(null); setProblem(null); }, [conversation]);
  useEffect(() => { if (!busy) void load(); }, [busy, load, version]);
  // The end of the turn just finished is saved a moment after it: read the list again then.
  useEffect(() => { const t = window.setTimeout(() => void load(), 1500); return () => window.clearTimeout(t); }, [load, version]);
  useEffect(() => { if (!rewound) return undefined; const t = window.setTimeout(() => setRewound(null), 10_000); return () => window.clearTimeout(t); }, [rewound]);
  if (!api?.rewind || (turns.length === 0 && !rewound)) return null;

  const ask = async (start: string) => {
    setProblem(null);
    const preview = await api.rewindPreview?.(conversation, start).catch(() => null);
    if (!preview || !preview.ok) { setProblem(preview && !preview.ok ? preview.error : 'That turn cannot be rewound to.'); return; }
    setAsking({ start, question: rewindQuestion(preview.later, appsOf(preview.files)) });
  };
  const rewind = async (turn: TurnRecord) => {
    setAsking(null);
    reading.current += 1;
    const result = await api.rewind!(conversation, turn.start).catch(() => null);
    if (!result || !result.ok) { setProblem(result && !result.ok ? result.error : 'That could not be rewound.'); return; }
    setRewound({ undo: result.undo, ask: turn.ask });
    await load();
  };
  const undo = async () => {
    if (!rewound) return;
    reading.current += 1;
    const result = await api.undoRewind?.(conversation, rewound.undo).catch(() => null);
    setRewound(null);
    if (!result || !result.ok) setProblem(result && !result.ok ? result.error : 'That could not be undone.');
    await load();
  };
  return (
    <section aria-label="Turns">
      <h3 className="clist-group"><span className="group-toggle"><span>Turns</span><span className="group-count">{turns.length}</span></span></h3>
      {rewound && (
        <UndoToast text={`Rewound to “${rewound.ask || 'that turn'}”`} onUndo={() => void undo()} onDismiss={() => setRewound(null)} />
      )}
      {problem && <p className="review-problem" role="alert">{problem}</p>}
      <ul className="clist turn-list" role="list" aria-label="Turns of this conversation">
        {turns.map((t, i) => (
          <li key={`${t.start}-${t.when}`} className="clist-item turn-row" aria-label={`Turn at ${when(t.when)}`}>
            <span className="turn-ask">{t.ask ? `“${t.ask}”` : 'A turn'}</span>
            <span className="turn-when">{when(t.when)}</span>
            {asking?.start === t.start ? (
              <span className="turn-confirm" role="group" aria-label="Rewind">
                <span>{asking.question}</span>
                <button type="button" className="review-btn" onClick={() => setAsking(null)}>Cancel</button>
                <button type="button" className="review-btn" data-kind="keep" onClick={() => void rewind(t)}>Rewind</button>
              </span>
            ) : i > 0 && t.ended && (
              <button type="button" className="review-btn turn-rewind" disabled={busy} title="Put every app back as it was right after this turn" onClick={() => void ask(t.start)}>Rewind to here</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
