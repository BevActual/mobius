import { useEffect, useState, type ReactNode } from 'react';
import type { AgentWaiting, ConversationInfo, ScheduleInfo } from '@mobius/shared';
import type { Activity } from './activity';
import { describeAction } from './actions';
import { appName, type AppId } from './apps';
import type { DeskRow } from './desk-apps';
import type { HubTarget } from './search-hub';
import { agoLabel, deskGreeting, deskTitle, recent, upcoming, whenLabel } from './desk-view';
import { APP_ICONS } from './Rail';
import './desk.css';

export type { DeskRow } from './desk-apps';

interface Props {
  /** What is open or due in each app right now. Apps with nothing to say are left out. */
  rows: readonly DeskRow[];
  /** Apps Mobius changed while you were somewhere else. */
  changed: ReadonlySet<AppId>;
  activity: Activity | null;
  conversations: readonly ConversationInfo[];
  onOpenApp: (app: AppId) => void;
  /** Opens the thing a row names (an event's day, a task's list, a page, a message). */
  onOpenTarget?: (target: HubTarget) => void;
  onOpenConversation: (id: string) => void;
  /** Settings › Schedules, for a row under Next. */
  onOpenSchedules?: () => void;
  /** Where the message box puts its suggestions, under the greeting. */
  starters?: ReactNode;
  now?: Date;
}

/** The first thing each waiting conversation asks for, so it can be allowed from the desk. Questions have no approval. */
function useFirstApprovals(waiting: readonly ConversationInfo[]): Record<string, AgentWaiting | null> {
  const [found, setFound] = useState<Record<string, AgentWaiting | null>>({});
  const key = waiting.map((c) => `${c.id}:${c.waiting}`).join('|');
  useEffect(() => {
    let live = true;
    void Promise.all(waiting.map(async (c) => [c.id, (await window.mobius.agent.waiting(c.id).catch(() => []))[0] ?? null] as const))
      .then((pairs) => { if (live) setFound(Object.fromEntries(pairs)); });
    return () => { live = false; };
    // The key stands for the list: it changes only when what waits changes.
  }, [key]);
  return found;
}

function useSchedules(): ScheduleInfo[] {
  const [list, setList] = useState<ScheduleInfo[]>([]);
  useEffect(() => {
    const api = window.mobius.schedules;
    if (!api) return undefined;
    let live = true;
    const load = () => void api.list().then((l) => { if (live) setList(l); }).catch(() => undefined);
    load();
    const off = api.onChange(load);
    return () => { live = false; off(); };
  }, []);
  return list;
}

const Icon = ({ app }: { app: AppId }) => <svg viewBox="0 0 20 20" aria-hidden="true" style={{ background: `var(--app-${app})` }}>{APP_ICONS[app]}</svg>;

/**
 * The desk: the Agent app's home, where an empty conversation used to show nothing. One greeting with the date and what
 * is in flight, and the suggestions under it. What waits for you and what Mobius is doing come first, each answerable in
 * place; then the conversations to pick up again; then what is open in your apps (an app Mobius changed carries its
 * dashed edge until you look); then what is scheduled next.
 */
export function Desk({ rows, changed, activity, conversations, onOpenApp, onOpenTarget, onOpenConversation, onOpenSchedules, starters, now = new Date() }: Props) {
  const waiting = conversations.filter((c) => c.waiting > 0);
  const working = conversations.filter((c) => c.activity === 'working' && c.waiting === 0);
  const approvals = useFirstApprovals(waiting);
  const next = upcoming(useSchedules(), now);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const apps = [...rows];
  for (const app of changed) if (!apps.some((row) => row.app === app)) apps.push({ app, text: 'Changed by Mobius' });
  const title = deskTitle(now, { waiting: waiting.length, working: working.length, changed: changed.size });
  const earlier = recent(conversations, new Set([...waiting, ...working].map((c) => c.id)));
  const quiet = waiting.length === 0 && working.length === 0 && changed.size === 0;
  const hold = (id: string, run: () => Promise<unknown>) => {
    setBusy((cur) => new Set(cur).add(id));
    void run().finally(() => setBusy((cur) => { const left = new Set(cur); left.delete(id); return left; }));
  };
  const name = (c: ConversationInfo) => c.title.trim() || 'New conversation';
  return (
    <section className="desk" aria-label="Desk">
      <header className="desk-hello">
        <h2 className="greeting">{deskGreeting(now)}</h2>
        <p className="desk-title">{title.map((part, i) => <span key={part}>{i > 0 && <span aria-hidden="true"> · </span>}{part}</span>)}{quiet && <span><span aria-hidden="true"> · </span>Nothing waiting for you</span>}</p>
        {starters}
      </header>
      {(waiting.length > 0 || working.length > 0) && (
        <div className="desk-group" role="group" aria-label="Now">
          <h3 className="desk-head">Now</h3>
          <ul className="desk-rows">
            {waiting.map((c) => {
              const ask = approvals[c.id];
              const plain = ask ? describeAction(ask.tool, ask.arguments) : null;
              return (
                <li key={c.id} className="desk-row" data-needs aria-label={`${name(c)}: needs you`}>
                  <Icon app="agent" />
                  <span className="desk-name">{name(c)}</span>
                  <span className="desk-text">{ask ? `Wants to ${plain ?? `use ${ask.tool}`}` : 'Has a question for you'}</span>
                  {ask && <button type="button" className="desk-act" data-primary disabled={busy.has(c.id)} aria-label={`Allow ${name(c)} once`} onClick={() => hold(c.id, () => window.mobius.agent.resolve(ask.requestId, true, 'once'))}>Allow</button>}
                  <button type="button" className="desk-act" aria-label={`Open ${name(c)}`} onClick={() => onOpenConversation(c.id)}>Open</button>
                </li>
              );
            })}
            {working.map((c, i) => (
              <li key={c.id} className="desk-row" data-working aria-label={`${name(c)}: Mobius is working`}>
                <Icon app="agent" />
                <span className="desk-name">{name(c)}</span>
                <span className="desk-text" role="status">{i === 0 && activity && !activity.needsYou ? `${activity.label}${activity.step ? ` · step ${activity.step.done + 1} of ${activity.step.total}` : ''}` : 'Working'}</span>
                <button type="button" className="desk-act" disabled={busy.has(c.id)} aria-label={`Stop ${name(c)}`} onClick={() => hold(c.id, () => window.mobius.agent.cancel(c.id))}>Stop</button>
                <button type="button" className="desk-act" aria-label={`Open ${name(c)}`} onClick={() => onOpenConversation(c.id)}>Open</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {earlier.length > 0 && (
        <div className="desk-group" role="group" aria-label="Recent">
          <h3 className="desk-head">Recent</h3>
          <ul className="desk-rows" data-columns>
            {earlier.map((c) => (
              <li key={c.id}>
                <button type="button" className="desk-row" aria-label={`${name(c)}, ${agoLabel(c.updated_ms, now)}`} onClick={() => onOpenConversation(c.id)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true" className="desk-glyph"><path d="M4 5.5A2 2 0 0 1 6 3.5h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-3.5 3v-3H6a2 2 0 0 1-2-2z" /></svg>
                  <span className="desk-name">{name(c)}</span>
                  <span className="desk-text">{agoLabel(c.updated_ms, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {apps.length > 0 && (
        <div className="desk-group" role="group" aria-label="In your apps">
          <h3 className="desk-head">In your apps</h3>
          <ul className="desk-rows">
            {apps.map(({ app, item, text, target }) => (
              <li key={app}>
                <button type="button" className="desk-row" data-changed={changed.has(app) || undefined} onClick={() => (target && onOpenTarget ? onOpenTarget(target) : onOpenApp(app))}>
                  <Icon app={app} />
                  <span className="desk-name">{appName(app)}</span>
                  {item && <span className="desk-item" title={item}>{item}</span>}
                  <span className="desk-text">{changed.has(app) && text !== 'Changed by Mobius' ? `${text} · changed by Mobius` : text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {next.length > 0 && (
        <div className="desk-group" role="group" aria-label="Next">
          <h3 className="desk-head">Next</h3>
          <ul className="desk-rows" data-columns>
            {next.map(({ schedule, at }) => (
              <li key={schedule.id}>
                <button type="button" className="desk-row" onClick={onOpenSchedules} disabled={!onOpenSchedules}>
                  <svg viewBox="0 0 20 20" aria-hidden="true" className="desk-glyph"><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.6" /></svg>
                  <span className="desk-name">{schedule.title}</span>
                  <span className="desk-text">{whenLabel(at, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
