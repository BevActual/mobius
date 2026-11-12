import { useEffect, useState } from 'react';
import { isNotesFailure, type MailMessage, type MailPlan, type MailPlanRow, type Message } from '@mobius/shared';

const GROUPS: readonly { key: keyof MailPlan; verb: string }[] = [
  { key: 'archive', verb: 'Archive' },
  { key: 'reply', verb: 'Reply' },
  { key: 'todos', verb: 'To-dos' },
  { key: 'later', verb: 'Later' },
];

/**
 * Get to zero, in the Mobius panel while Mail is open: Mobius's plan for the whole inbox, dashed until kept. Keeping
 * it archives, marks what needs a reply, puts the rest off until tomorrow and adds the to-dos to Tasks; one Undo all
 * puts it all back. Questions about the mail go in the Mobius composer under it, which already sees Mail.
 */
export function MailPlanCard({ onChanged }: { onChanged?: () => void }) {
  const api = window.mobius.mail;
  const [plan, setPlan] = useState<MailPlan | null>(null);
  const [state, setState] = useState<'closed' | 'proposed' | 'kept'>('closed');
  const [open, setOpen] = useState<keyof MailPlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!api?.plan) return null;
  const propose = async () => {
    setProblem(null);
    const got = await api.plan!().catch(() => null);
    if (!got || isNotesFailure(got)) { setProblem(got ? got.message : 'The plan could not be made.'); return; }
    setPlan(got);
    setState('proposed');
  };
  const keep = async () => {
    if (!plan) return;
    const done = await api.keepPlan!(plan).catch(() => null);
    if (!done || isNotesFailure(done)) { setProblem(done ? done.message : 'The plan could not be kept.'); return; }
    setState('kept');
    onChanged?.();
  };
  const undo = async () => {
    const done = await api.undoPlan!().catch(() => null);
    if (!done || isNotesFailure(done)) { setProblem(done ? done.message : 'That could not be undone.'); return; }
    setState('closed');
    setPlan(null);
    onChanged?.();
  };
  const total = plan ? GROUPS.reduce((n, g) => n + plan[g.key].length, 0) : 0;
  return (
    <section className="mail-plan" aria-label="Get to zero">
      {state === 'closed' && <button type="button" className="btn mail-plan-start" onClick={() => void propose()}>Get to zero</button>}
      {state === 'proposed' && plan && (
        total === 0 ? <p className="mail-plan-empty" role="status">Your inbox is already at zero.</p> : (
          <div className="mail-plan-card" data-proposed role="group" aria-label="Mobius’s plan">
            <p className="mail-plan-head">A plan for {total === 1 ? '1 message' : `${total} messages`}</p>
            <ul className="mail-plan-rows" role="list">
              {GROUPS.filter((g) => plan[g.key].length > 0).map((g) => (
                <li key={g.key}>
                  <button type="button" className="mail-plan-row" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)}>
                    <span>{g.verb}</span><span className="mail-plan-count">{plan[g.key].length}</span>
                  </button>
                  {open === g.key && (
                    <ul className="mail-plan-items" role="list" aria-label={g.verb}>
                      {plan[g.key].map((r: MailPlanRow) => <li key={r.id}><b>{r.from}</b> {r.subject || '(no subject)'}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <div className="mail-plan-actions">
              <button type="button" className="review-btn" onClick={() => { setState('closed'); setPlan(null); }}>Discard plan</button>
              <button type="button" className="review-btn" data-kind="keep" onClick={() => void keep()}>Keep the plan</button>
            </div>
          </div>
        )
      )}
      {state === 'kept' && (
        <p className="mail-plan-done" role="status">
          <span>Kept the plan. {plan && plan.todos.length > 0 ? `To-dos are in Tasks, in From mail. ` : ''}Later comes back tomorrow at 8:00.</span>
          <button type="button" className="review-btn" onClick={() => void undo()}>Undo all</button>
        </p>
      )}
      {problem && <p className="field-error" role="alert">{problem}</p>}
    </section>
  );
}

/** The emails a reply was based on: the ones Mobius read in that turn, newest read first. */
export function mailReadIn(history: readonly Message[]): string[] {
  const start = history.map((m) => m.role).lastIndexOf('user');
  const ids: string[] = [];
  for (const m of start < 0 ? [] : history.slice(start)) {
    if (m.role !== 'assistant') continue;
    for (const call of m.tool_calls) {
      const id = call.name === 'mail.read' && call.arguments && typeof call.arguments === 'object' ? (call.arguments as { id?: unknown }).id : undefined;
      if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** Under an answer about the mail: the messages it came from, as rows that open each one. */
export function MailSources({ conversation, version, onOpen }: { conversation: string; version: number; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<MailMessage[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const history = await window.mobius.agent.history(conversation).catch(() => [] as Message[]);
      const ids = mailReadIn(history);
      if (ids.length === 0) { if (live) setRows([]); return; }
      const all = await window.mobius.mail?.list('all', 'all', '').catch(() => null);
      if (!live || !all || isNotesFailure(all)) return;
      setRows(ids.map((id) => all.find((m) => m.id === id)).filter((m): m is MailMessage => m !== undefined));
    })();
    return () => { live = false; };
  }, [conversation, version]);
  if (rows.length === 0) return null;
  return (
    <ul className="mail-sources" role="list" aria-label="From your mail">
      {rows.map((m) => (
        <li key={m.id}>
          <button type="button" className="mail-source" onClick={() => onOpen(m.id)}>
            <b>{m.from.name || m.from.email}</b><span>{m.subject || '(no subject)'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
