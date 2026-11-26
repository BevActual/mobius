import { useEffect, useRef } from 'react';
import type { ConversationInfo } from '@mobius/shared';
import { readRuns } from './background';

/** The other chats Mobius is working on now: one handed off to the background, one a schedule started, any left running. */
export function runningElsewhere(conversations: readonly ConversationInfo[], open: string): ConversationInfo[] {
  return conversations.filter((c) => c.id !== open && (c.activity === 'working' || c.activity === 'needs_you'));
}

/** What a row says it is: needs you first, then handed off, then just working. */
export function jobState(c: ConversationInfo, background: ReadonlySet<string>): string {
  if (c.activity === 'needs_you' || c.waiting > 0) return 'Needs you';
  return background.has(c.id) ? 'In the background' : 'Working';
}

/**
 * Running jobs (docs/design/mobius-agent.md, "The panel"): the work Mobius is doing in other chats, listed under this
 * one, each with Stop and a press to open it. No tabs: it is a short list, and gone when nothing else runs.
 */
export function RunningJobs({ conversations, open, onOpen }: { conversations: readonly ConversationInfo[]; open: string; onOpen: (id: string) => void }) {
  const jobs = runningElsewhere(conversations, open);
  // A stopped row goes with the focus on it: the next row's Stop, or the message box, takes it.
  const list = useRef<HTMLUListElement>(null);
  const stopped = useRef<string | null>(null);
  const ids = jobs.map((c) => c.id).join('\u0000');
  useEffect(() => {
    if (!stopped.current || jobs.some((c) => c.id === stopped.current)) return;
    stopped.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    (list.current?.querySelector<HTMLElement>('.msg-action') ?? document.querySelector<HTMLElement>('[aria-label="Message Mobius"]'))?.focus();
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const background = new Set(readRuns().map((r) => r.conversation));
  // Said politely as it changes: a job that starts, one that now needs you.
  const needing = jobs.filter((c) => jobState(c, background) === 'Needs you');
  const said = jobs.length === 0 ? '' : needing.length > 0 ? `${needing.map((c) => c.title).join(', ')} ${needing.length === 1 ? 'needs' : 'need'} you` : `Also running: ${jobs.map((c) => c.title).join(', ')}`;
  // One status that stays on the page, its words changing: a live region added with its words already set can go unsaid.
  const status = <span className="sr-only" role="status" aria-label="Running jobs status">{said}</span>;
  return (
    <>
    {status}
    {jobs.length > 0 && <section className="msg-queue running-jobs" aria-label="Running jobs">
      <div className="msg-queue-head">
        <span className="msg-queue-title" aria-hidden="true">{jobs.length === 1 ? 'Also running' : `Also running · ${jobs.length}`}</span>
      </div>
      <ul ref={list} className="msg-queue-list">
        {jobs.map((c) => (
          <li key={c.id} className="msg-queue-item running-job" data-needs-you={jobState(c, background) === 'Needs you' || undefined}>
            <button type="button" className="running-job-open" onClick={() => onOpen(c.id)} title={`Open ${c.title}`}>
              <span className="running-job-mark" aria-hidden="true" />
              <span className="msg-queue-text">{c.title}</span>
              <span className="running-job-state">{jobState(c, background)}</span>
            </button>
            <button type="button" className="msg-action" aria-label={`Stop ${c.title}`} onClick={() => { stopped.current = c.id; void window.mobius.agent.cancel(c.id); }}>Stop</button>
          </li>
        ))}
      </ul>
    </section>}
    </>
  );
}
