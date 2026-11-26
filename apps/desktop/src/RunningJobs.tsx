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
  if (jobs.length === 0) return null;
  const background = new Set(readRuns().map((r) => r.conversation));
  return (
    <section className="msg-queue running-jobs" aria-label="Running jobs">
      <div className="msg-queue-head">
        <span className="msg-queue-title">{jobs.length === 1 ? 'Also running' : `Also running · ${jobs.length}`}</span>
      </div>
      <ul className="msg-queue-list">
        {jobs.map((c) => (
          <li key={c.id} className="msg-queue-item running-job" data-needs-you={jobState(c, background) === 'Needs you' || undefined}>
            <button type="button" className="running-job-open" onClick={() => onOpen(c.id)} title={`Open ${c.title}`}>
              <span className="running-job-mark" aria-hidden="true" />
              <span className="msg-queue-text">{c.title}</span>
              <span className="running-job-state">{jobState(c, background)}</span>
            </button>
            <button type="button" className="msg-action" aria-label={`Stop ${c.title}`} onClick={() => void window.mobius.agent.cancel(c.id)}>Stop</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
