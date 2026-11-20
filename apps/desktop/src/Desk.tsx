import { useEffect, useState, type ReactNode } from 'react';
import type { AgentWaiting, ConversationInfo, ScheduleInfo } from '@mobius/shared';
import type { Activity } from './activity';
import { describeAction } from './actions';
import { appName, type AppId, type RecentItem } from './apps';
import type { DeskRow } from './desk-apps';
import type { HubTarget } from './search-hub';
import { agoLabel, deskGreeting, deskQuiet, deskTitle, upcoming, whenLabel } from './desk-view';
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
  /**
   * First run: which of Mail and Calendar have no account yet, and where to connect each. While one is missing, the
   * desk offers it first, so the first answers can be about the person's own mail and days.
   */
  connect?: { mail: boolean; calendar: boolean; onMail: () => void; onCalendar: () => void };
  /** The last things opened in any app (a note, a message, a document), newest first, for Continue. */
  opened?: readonly RecentItem[];
  onOpenRecent?: (item: RecentItem) => void;
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

/** An app is known by its line icon, never a coloured tile. */
const Icon = ({ app }: { app: AppId }) => <svg viewBox="0 0 20 20" aria-hidden="true" className="desk-glyph" data-app={app}>{APP_ICONS[app]}</svg>;

/**
 * The desk: the Agent app's home, where an empty conversation used to show nothing. One greeting with the date and what
 * is in flight, and the suggestions under it. What waits for you and what Mobius is doing come first, each answerable in
 * place; then what is open in your apps (an app Mobius changed carries its
 * dashed edge until you look); then the last things opened, to continue; then what is scheduled next.
 */
export function Desk({ rows, changed, activity, conversations, onOpenApp, onOpenTarget, onOpenConversation, onOpenSchedules, starters, connect, opened = [], onOpenRecent, now = new Date() }: Props) {
  const waiting = conversations.filter((c) => c.waiting > 0);
  const working = conversations.filter((c) => c.activity === 'working' && c.waiting === 0);
  const approvals = useFirstApprovals(waiting);
  const next = upcoming(useSchedules(), now);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const apps = [...rows];
  for (const app of changed) if (!apps.some((row) => row.app === app)) apps.push({ app, text: 'Changed by Mobius' });
  const title = deskTitle(now, { waiting: waiting.length, working: working.length, changed: changed.size });
  // Chats are in the Chats panel; Continue is what was open in the other apps.
  const resume = onOpenRecent ? opened.filter((r) => r.app !== 'agent').slice(0, 5) : [];
  const quiet = waiting.length === 0 && working.length === 0 && changed.size === 0;
  const hold = (id: string, run: () => Promise<unknown>) => {
    setBusy((cur) => new Set(cur).add(id));
    void run().finally(() => setBusy((cur) => { const left = new Set(cur); left.delete(id); return left; }));
  };
  const name = (c: ConversationInfo) => c.title.trim() || 'New chat';
  // A quiet word at the row's end on hover says what a press does.
  const go = (word: string) => <span className="desk-go" aria-hidden="true">{word}</span>;
  return (
    <section className="desk" aria-label="Desk">
      <header className="desk-hello">
        <h2 className="greeting">{deskGreeting(now)}</h2>
        <p className="desk-title">{title.map((part, i) => <span key={part}>{i > 0 && <span aria-hidden="true"> · </span>}{part}</span>)}{quiet && <span><span aria-hidden="true"> · </span>{deskQuiet(rows)}</span>}</p>
        {starters}
      </header>
      {connect && (connect.mail || connect.calendar) && (
        <div className="desk-group" role="group" aria-label="Get started">
          <h3 className="desk-head">Get started</h3>
          <ul className="desk-rows">
            <li className="desk-row" data-connect>
              <Icon app={connect.mail ? 'mail' : 'calendar'} />
              <span className="desk-stack">
                <span className="desk-name">{connect.mail && connect.calendar ? 'Connect your mail and calendar' : connect.mail ? 'Connect your mail' : 'Connect your calendar'}</span>
                <span className="desk-sub">Mobius can then plan around your real days.</span>
              </span>
              {connect.mail && <button type="button" className="desk-act" data-primary onClick={connect.onMail}>Add mail</button>}
              {connect.calendar && <button type="button" className="desk-act" {...(connect.mail ? {} : { 'data-primary': true })} onClick={connect.onCalendar}>Add calendar</button>}
            </li>
          </ul>
        </div>
      )}
      {(waiting.length > 0 || working.length > 0) && (
        <div className="desk-group" role="group" aria-label="Now">
          <h3 className="desk-head">Now</h3>
          <ul className="desk-rows">
            {waiting.map((c) => {
              const ask = approvals[c.id];
              const plain = ask ? describeAction(ask.tool, ask.arguments) : null;
              return (
                <li key={c.id} className="desk-row" data-needs aria-label={`${name(c)}: needs you`}>
                  <button type="button" className="desk-open" aria-label={`Answer ${name(c)}`} onClick={() => onOpenConversation(c.id)}>
                    <Icon app="agent" />
                    <span className="desk-name">{name(c)}</span>
                    <span className="desk-text">{ask ? `Wants to ${plain ?? `use ${ask.tool}`}` : 'Needs your answer'}</span>
                    {go('Answer')}
                  </button>
                  {ask && <button type="button" className="desk-act" data-primary disabled={busy.has(c.id)} aria-label={`Allow ${name(c)} once`} onClick={() => hold(c.id, () => window.mobius.agent.resolve(ask.requestId, true, 'once'))}>Allow</button>}
                </li>
              );
            })}
            {working.map((c, i) => (
              <li key={c.id} className="desk-row" data-working aria-label={`${name(c)}: Mobius is working`}>
                <button type="button" className="desk-open" aria-label={`Open ${name(c)}`} onClick={() => onOpenConversation(c.id)}>
                  <Icon app="agent" />
                  <span className="desk-name">{name(c)}</span>
                  <span className="desk-text" role="status">{i === 0 && activity && !activity.needsYou ? `${activity.label}${activity.step ? ` · step ${activity.step.done + 1} of ${activity.step.total}` : ''}` : 'Working'}</span>
                  {go('Open')}
                </button>
                <button type="button" className="desk-act" disabled={busy.has(c.id)} aria-label={`Stop ${name(c)}`} onClick={() => hold(c.id, () => window.mobius.agent.cancel(c.id))}>Stop</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {apps.length > 0 && (
        <div className="desk-group" role="group" aria-label="In your apps">
          <h3 className="desk-head">In your apps</h3>
          <ul className="desk-rows">
            {apps.map(({ app, item, text, more, target }) => (
              <li key={app}>
                <button type="button" className="desk-row" data-changed={changed.has(app) || undefined} data-more={more ? true : undefined} onClick={() => (target && onOpenTarget ? onOpenTarget(target) : onOpenApp(app))}>
                  <Icon app={app} />
                  <span className="desk-name">{appName(app)}</span>
                  {item && <span className="desk-item" title={item}>{item}</span>}
                  <span className="desk-text">
                    {changed.has(app) && text !== 'Changed by Mobius' ? `${text} · changed by Mobius` : text}
                    {more && <span className="desk-more">{more}</span>}
                  </span>
                  {go('Open')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {resume.length > 0 && (
        <div className="desk-group" role="group" aria-label="Continue">
          <h3 className="desk-head">Continue</h3>
          <ul className="desk-rows">
            {resume.map((r) => (
              <li key={`${r.app}:${r.ref}`}>
                <button type="button" className="desk-row" aria-label={`${r.label}, ${appName(r.app)}, ${agoLabel(r.at, now)}`} onClick={() => onOpenRecent?.(r)}>
                  <Icon app={r.app} />
                  <span className="desk-name">{r.label}</span>
                  <span className="desk-text">{agoLabel(r.at, now)}</span>
                  {go('Open')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {next.length > 0 && (
        <div className="desk-group" role="group" aria-label="Next">
          <h3 className="desk-head">Next</h3>
          <ul className="desk-rows">
            {next.map(({ schedule, at }) => (
              <li key={schedule.id}>
                <button type="button" className="desk-row" onClick={onOpenSchedules} disabled={!onOpenSchedules}>
                  <svg viewBox="0 0 20 20" aria-hidden="true" className="desk-glyph"><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.6" /></svg>
                  <span className="desk-name">{schedule.title}</span>
                  <span className="desk-text">{whenLabel(at, now)}</span>
                  {go('Edit')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* A short day still ends composed: one plain line, not leftover grey. */}
      {/* With nothing at all to show (no chats, nothing connected), only the greeting, the suggestions and Get started. */}
      {waiting.length === 0 && working.length === 0 && (apps.length > 0 || resume.length > 0 || next.length > 0) && <p className="desk-end">That's everything for today.</p>}
    </section>
  );
}
