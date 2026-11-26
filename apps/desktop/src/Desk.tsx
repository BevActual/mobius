import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AgentWaiting, ConversationInfo, MailFollowUp, ScheduleInfo } from '@mobius/shared';
import type { Activity } from './activity';
import { describeAction } from './actions';
import { appName, type AppId, type RecentItem } from './apps';
import type { DeskRow } from './desk-apps';
import type { HubTarget } from './search-hub';
import { agoLabel, deskGreeting, deskQuiet, deskTitle, upcoming, whenLabel } from './desk-view';
import { APP_ICONS } from './Rail';
import { useFollowUps, waitingOn } from './mail-follow-ups';
import { LATER, laterUntil, sortInbox, trimKept, type InboxItem, type InboxKept } from './inbox';
import { Menu } from './ui';
import { foldAway } from './app-motion';
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
  /** Replies Mobius drafted in Mail that wait for the person, and where they are looked at. */
  suggested?: { count: number; onOpen: () => void };
  /**
   * The rest of the Inbox: tasks due, invitations, mail to answer, project updates due and suggested Knowledge changes.
   * `onOpen` goes to an item; `onDone` does what Done means for it (a task is ticked off) and says whether it worked.
   */
  inbox?: { items: readonly InboxItem[]; onOpen: (item: InboxItem) => void; onDone: (item: InboxItem) => Promise<boolean> };
  now?: Date;
}

const KEPT_KEY = 'mobius.inbox';
function readKept(): InboxKept {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEPT_KEY) ?? '{}') as Partial<InboxKept>;
    return { done: Array.isArray(v.done) ? v.done.filter((k): k is string => typeof k === 'string') : [], later: v.later && typeof v.later === 'object' ? v.later : {} };
  } catch { return { done: [], later: {} }; }
}

/** Done and Later, kept on this device; a Later whose time comes shows the item again (checked each minute). */
function useInboxKept() {
  const [kept, setKept] = useState<InboxKept>(readKept);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  // From what is kept now, not what this render saw: two rows done in quick succession both stay done.
  const put = (change: (was: InboxKept) => InboxKept) => setKept((was) => {
    const trimmed = trimKept(change(was), Date.now());
    try { window.localStorage.setItem(KEPT_KEY, JSON.stringify(trimmed)); } catch { /* Not kept. */ }
    return trimmed;
  });
  const without = (later: Readonly<Record<string, number>>, key: string) => Object.fromEntries(Object.entries(later).filter(([k]) => k !== key));
  return {
    kept, now,
    done: (key: string) => put((k) => ({ done: [...k.done.filter((d) => d !== key), key], later: without(k.later, key) })),
    later: (key: string, until: number) => put((k) => ({ ...k, later: { ...k.later, [key]: until } })),
    back: (key: string) => put((k) => ({ ...k, later: without(k.later, key) })),
  };
}

/** Up and Down (or J and K) move through the Inbox's rows, as in Linear's; E is Done and H is Later (tomorrow). */
function inboxKeys(e: KeyboardEvent<HTMLUListElement>, act: (key: string, what: 'done' | 'later') => void) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(':scope > li:not([data-leaving]) > .desk-open, :scope > li:not([data-leaving]) > button.desk-row')];
  const at = rows.findIndex((r) => r === document.activeElement);
  const k = e.key.toLowerCase();
  if (k === 'arrowdown' || k === 'j' || k === 'arrowup' || k === 'k') {
    if (at < 0) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, at + (k === 'arrowdown' || k === 'j' ? 1 : -1)))]?.focus();
    return;
  }
  const key = (document.activeElement?.closest('li[data-key]') as HTMLElement | null)?.dataset.key;
  if (!key || (k !== 'e' && k !== 'h')) return;
  e.preventDefault();
  // Focus goes to the row that takes this one's place.
  const next = rows[at + 1] ?? rows[at - 1];
  act(key, k === 'e' ? 'done' : 'later');
  requestAnimationFrame(() => next?.focus());
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
export function Desk({ rows, changed, activity, conversations, onOpenApp, onOpenTarget, onOpenConversation, onOpenSchedules, starters, connect, opened = [], onOpenRecent, suggested, inbox, now = new Date() }: Props) {
  const waiting = conversations.filter((c) => c.waiting > 0);
  const working = conversations.filter((c) => c.activity === 'working' && c.waiting === 0);
  const approvals = useFirstApprovals(waiting);
  const next = upcoming(useSchedules(), now);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // Sent mail whose reminder came with no answer: it waits on the person to nudge or let go.
  const follow = useFollowUps();
  const noReply: MailFollowUp[] = follow.due;
  const drafted = suggested && suggested.count > 0 ? suggested : null;
  const kept = useInboxKept();
  const { shown: more, later: setAside } = sortInbox(inbox?.items ?? [], kept.kept, kept.now);
  const [showLater, setShowLater] = useState(false);
  // Said to screen readers once Done or Later has acted, since the row itself goes.
  const [said, setSaid] = useState('');
  // A row that goes folds away first, so the rows under it slide up rather than jump.
  const rowOf = (key: string) => document.querySelector<HTMLElement>(`li[data-key="${CSS.escape(key)}"]`);
  const doneWith = (item: InboxItem) => hold(item.key, async () => {
    if (!(await inbox!.onDone(item))) return;
    await foldAway(rowOf(item.key));
    kept.done(item.key);
    setSaid(`${item.kind === 'task' ? 'Completed' : 'Done with'} ${item.name}`);
  });
  const setAsideUntil = async (item: InboxItem, choice: string) => {
    const until = laterUntil(choice, new Date());
    await foldAway(rowOf(item.key));
    kept.later(item.key, until);
    setSaid(`${item.name} set aside, back ${whenLabel(new Date(until), new Date()).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}`);
  };
  const act = (key: string, what: 'done' | 'later') => {
    const item = more.find((i) => i.key === key);
    if (!item) return;
    if (what === 'done') doneWith(item); else void setAsideUntil(item, 'tomorrow');
  };
  // The Inbox: everything across apps that waits on the person, in one list. What Mobius changed is here, not in
  // In your apps, so it is said once.
  const inboxCount = waiting.length + changed.size + noReply.length + (drafted ? 1 : 0) + more.length;
  const apps = rows;
  const title = deskTitle(now, { waiting: inboxCount, working: working.length, changed: 0 });
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
      {(inboxCount > 0 || setAside.length > 0) && (
        <div className="desk-group" role="group" aria-label="Inbox">
          <h3 className="desk-head">Inbox {inboxCount > 0 && <span className="desk-count">{inboxCount}</span>}</h3>
          <span className="sr-only" role="status">{said}</span>
          <ul className="desk-rows" onKeyDown={(e) => inboxKeys(e, act)}>
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
            {[...changed].map((app) => (
              <li key={`changed:${app}`}>
                <button type="button" className="desk-row" data-changed aria-label={`${appName(app)}: changed by Mobius while you were away`} onClick={() => onOpenApp(app)}>
                  <Icon app={app} />
                  <span className="desk-name">{appName(app)}</span>
                  <span className="desk-text">Changed by Mobius while you were away</span>
                  {go('Look')}
                </button>
              </li>
            ))}
            {drafted && (
              <li>
                <button type="button" className="desk-row" data-changed aria-label={`${drafted.count} suggested ${drafted.count === 1 ? 'reply' : 'replies'} in Mail`} onClick={drafted.onOpen}>
                  <Icon app="mail" />
                  <span className="desk-name">{drafted.count === 1 ? '1 suggested reply' : `${drafted.count} suggested replies`}</span>
                  <span className="desk-text">Drafted by Mobius, not sent</span>
                  {go('Look')}
                </button>
              </li>
            )}
            {noReply.map((f) => (
              <li key={`noreply:${f.messageId}`} className="desk-row">
                <button type="button" className="desk-open" aria-label={`Open ${f.subject || 'the message'}, no reply from ${waitingOn(f.to)}`} disabled={!f.sentId || !onOpenTarget} onClick={() => { if (f.sentId && onOpenTarget) onOpenTarget({ app: 'mail', id: f.sentId }); }}>
                  <Icon app="mail" />
                  <span className="desk-name">{f.subject || '(no subject)'}</span>
                  <span className="desk-text">No reply from {waitingOn(f.to)}</span>
                  {go('Open')}
                </button>
                <button type="button" className="desk-act" disabled={busy.has(f.messageId)} aria-label={`Stop waiting for a reply to ${f.subject || 'this message'}`} onClick={() => hold(f.messageId, () => follow.set(f.messageId, null))}>Stop waiting</button>
              </li>
            ))}
            {more.map((item) => (
              <li key={item.key} className="desk-row" data-key={item.key} data-kind={item.kind}>
                <button type="button" className="desk-open" aria-label={`${item.name}: ${item.text}`} aria-keyshortcuts="E H" title="E: Done · H: Later" onClick={() => inbox?.onOpen(item)}>
                  <Icon app={item.app} />
                  <span className="desk-name">{item.name}</span>
                  <span className="desk-text" data-late={item.text.startsWith('Overdue') || undefined}>{item.text}</span>
                  {go(item.go)}
                </button>
                <Menu label={`Later: ${item.name}`} align="end" entries={LATER.map((l) => ({ label: l.label, run: () => void setAsideUntil(item, l.id) }))}
                  trigger={<button type="button" className="desk-act" aria-label={`Later: ${item.name}`} aria-keyshortcuts="H" title="Set it aside until later (H)">Later</button>} />
                <button type="button" className="desk-act" disabled={busy.has(item.key)} aria-label={`${item.kind === 'task' ? 'Complete' : 'Done with'} ${item.name}`} aria-keyshortcuts="E" title={item.kind === 'task' ? 'Tick it off (E)' : 'Clear it from the Inbox (E)'} onClick={() => doneWith(item)}>Done</button>
              </li>
            ))}
          </ul>
          {setAside.length > 0 && (
            <>
              <button type="button" className="btn link desk-later-toggle" aria-expanded={showLater} aria-controls={showLater ? 'desk-set-aside' : undefined} onClick={() => setShowLater((v) => !v)}>
                {showLater ? 'Hide what is set aside' : `${setAside.length} set aside for later`}
              </button>
              {showLater && (
                <ul id="desk-set-aside" className="desk-rows" aria-label="Set aside for later">
                  {setAside.map((item) => (
                    <li key={item.key} className="desk-row" data-later>
                      <button type="button" className="desk-open" aria-label={`${item.name}, back ${whenLabel(new Date(item.until), now).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}`} onClick={() => inbox?.onOpen(item)}>
                        <Icon app={item.app} />
                        <span className="desk-name">{item.name}</span>
                        <span className="desk-text">Back {whenLabel(new Date(item.until), now).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}</span>
                        {go(item.go)}
                      </button>
                      <button type="button" className="desk-act" aria-label={`Bring back ${item.name}`} onClick={() => kept.back(item.key)}>Bring back</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      {working.length > 0 && (
        <div className="desk-group" role="group" aria-label="Working">
          <h3 className="desk-head">Working</h3>
          <ul className="desk-rows">
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
                <button type="button" className="desk-row" data-more={more ? true : undefined} onClick={() => (target && onOpenTarget ? onOpenTarget(target) : onOpenApp(app))}>
                  <Icon app={app} />
                  <span className="desk-name">{appName(app)}</span>
                  {item && <span className="desk-item" title={item}>{item}</span>}
                  <span className="desk-text">
                    {text}
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
      {inboxCount === 0 && working.length === 0 && (apps.length > 0 || resume.length > 0 || next.length > 0) && <p className="desk-end">That's everything for today.</p>}
    </section>
  );
}
