import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ActivityEntry, ConversationInfo } from '@mobius/shared';
import { appName } from './apps';
import { APP_ICONS, OWN_ICONS } from './Rail';
import { activityBoard } from './activity-board';
import { appsIn, byDay, feedOf, matches, type ActivityFilter, type FeedItem } from './activity-feed';
import { ChangesWaiting, ScheduledList } from './ConversationSidebar';
import { Turns } from './Rewind';
import { EmptyState } from './EmptyState';
import { relativeTime } from './relative-time';
import './activity.css';

/** How many log entries the page reads: about a week of ordinary use. */
const LIMIT = 400;

/**
 * The Activity app's state: the log on this computer, read again whenever a conversation moves, and the filter the
 * sidebar sets. The sidebar and the page share it.
 */
export function useActivityFeed(conversations: readonly ConversationInfo[], active: boolean) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<ActivityFilter>('everything');
  const moved = conversations.reduce((n, c) => Math.max(n, c.updated_ms), 0);
  const load = useCallback(async () => {
    const got = await window.mobius.agent.activity(LIMIT).catch(() => null);
    setEntries(Array.isArray(got) ? got : []);
    setLoaded(true);
  }, []);
  useEffect(() => { if (active) void load(); }, [active, load, moved]);
  const items = useMemo(() => feedOf(entries), [entries]);
  return { items, loaded, filter, setFilter, reload: load };
}
export type ActivityFeed = ReturnType<typeof useActivityFeed>;

const SHOW: readonly { id: ActivityFilter; name: string; icon: ReactNode }[] = [
  { id: 'everything', name: 'Everything', icon: OWN_ICONS.activity },
  { id: 'needs', name: 'Needs you', icon: <><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5v4M10 13.5h.01" /></> },
  { id: 'mobius', name: 'By Mobius', icon: APP_ICONS.agent },
  { id: 'you', name: 'By you', icon: <><circle cx="10" cy="7.5" r="3" /><path d="M4.5 16a5.5 5.5 0 0 1 11 0" /></> },
  { id: 'final', name: 'Can’t be undone', icon: <><rect x="5" y="9" width="10" height="7.5" rx="2" /><path d="M7.5 9V7a2.5 2.5 0 0 1 5 0v2" /></> },
];

/** The Activity app's sidebar: what to show, then the apps things happened in. */
export function ActivitySidebar({ feed, conversations, pin }: { feed: ActivityFeed; conversations: readonly ConversationInfo[]; pin?: ReactNode }) {
  const board = activityBoard(conversations, new Date());
  const count = (id: ActivityFilter): number => (id === 'needs' ? board.needsYou.length : feed.items.filter((i) => matches(i, id)).length);
  const apps = appsIn(feed.items);
  const row = (id: ActivityFilter, name: string, icon: ReactNode, tile?: string) => {
    const n = count(id);
    return (
      <li key={id}>
        <button type="button" className="list-row act-row" aria-current={feed.filter === id ? 'page' : undefined} onClick={() => feed.setFilter(id)}>
          <svg viewBox="0 0 20 20" aria-hidden="true" className="act-row-icon" data-tile={tile ? true : undefined} style={tile ? { background: `var(--app-${tile})` } : undefined}>{icon}</svg>
          <span className="list-name">{name}</span>
          <span className="list-count" data-tone={id === 'needs' && n > 0 ? 'warn' : undefined}>{n || ''}</span>
        </button>
      </li>
    );
  };
  return (
    <aside className="side act-side" aria-label="Activity sidebar">
      <div className="side-head">
        <span className="side-title">Show</span>
        <span className="side-actions">{pin}</span>
      </div>
      <nav className="task-lists" aria-label="Show">
        <ul role="list">{SHOW.map((s) => row(s.id, s.name, s.icon))}</ul>
        {apps.length > 0 && (
          <>
            <h2 className="act-side-heading">By app</h2>
            <ul role="list" aria-label="By app">{apps.map(({ app }) => row(`app:${app}`, appName(app), APP_ICONS[app], app))}</ul>
          </>
        )}
      </nav>
      <p className="act-side-foot">Kept on this computer. Nothing here is sent anywhere.</p>
    </aside>
  );
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function Line({ item }: { item: FeedItem }) {
  const tile = item.app ?? 'agent';
  return (
    <li className="act-item" data-warn={item.warn || undefined}>
      <svg viewBox="0 0 20 20" aria-hidden="true" className="act-tile" style={{ background: `var(--app-${tile})` }}>{APP_ICONS[tile]}</svg>
      <span className="act-text">
        <span className="act-what">{item.text}</span>
        <span className="act-sub">
          {item.app ? appName(item.app) : 'Mobius'}
          {item.by === 'you' && ' · You'}
          {item.final && <span className="act-final"> · Can’t be undone</span>}
        </span>
      </span>
      <time className="act-time" dateTime={new Date(item.when).toISOString()} title={new Date(item.when).toLocaleString()}>{time(item.when)}</time>
    </li>
  );
}

function ConversationRow({ c, onOpen }: { c: ConversationInfo; onOpen: (id: string) => void }) {
  const state = c.activity === 'needs_you' || c.waiting > 0
    ? (c.waiting > 1 ? `${c.waiting} questions for you` : 'A question for you')
    : c.activity === 'working' ? 'Working…' : relativeTime(c.updated_ms, Date.now());
  return (
    <li>
      <button type="button" className="act-convo" data-state={c.activity} onClick={() => onOpen(c.id)}>
        <span className="act-dot" aria-hidden="true" />
        <span className="act-what">{c.title || 'A conversation'}</span>
        <span className="act-state">{state}</span>
        <span className="act-open">Open</span>
      </button>
    </li>
  );
}

const TITLES: Record<string, string> = { everything: 'Activity', needs: 'Needs you', mobius: 'By Mobius', you: 'By you', final: 'Can’t be undone' };

/**
 * The Activity app's page: what is waiting for you and what is running, the changes still to keep, the open
 * conversation's turns with Rewind, and then everything that happened, a day at a time.
 */
export function ActivityPage({ feed, conversations, active, onOpenConversation, onOpenSchedules }: {
  feed: ActivityFeed;
  conversations: readonly ConversationInfo[];
  /** The open conversation: its turns can be rewound from here. */
  active: string;
  onOpenConversation: (id: string) => void;
  onOpenSchedules?: () => void;
}) {
  const now = new Date();
  const board = activityBoard(conversations, now);
  const { filter } = feed;
  const title = filter.startsWith('app:') ? appName(filter.slice(4) as never) : TITLES[filter] ?? 'Activity';
  const overview = filter === 'everything' || filter === 'needs';
  const shown = filter === 'needs' ? [] : feed.items.filter((i) => matches(i, filter));
  const days = byDay(shown, now);
  const open = conversations.find((c) => c.id === active);
  const nothing = overview && board.needsYou.length + board.running.length === 0 && (filter === 'needs' || shown.length === 0);
  return (
    <section className="skills-page act-page" aria-label="Activity">
      <header className="act-head">
        <h1 className="ext-title">{title}</h1>
        <p className="act-lede">{filter === 'needs' ? 'Questions Mobius is waiting on, and changes it made that you haven’t kept yet.' : 'What Mobius did across your apps, and what you allowed. Sending, paying, deleting and running commands always ask first.'}</p>
      </header>
      {overview && board.needsYou.length > 0 && (
        <section className="act-card" aria-label="Needs you" data-tone="warn">
          <h2 className="ext-heading">Needs you</h2>
          <ul className="act-list" role="list" aria-label="Needs you">{board.needsYou.map((c) => <ConversationRow key={c.id} c={c} onOpen={onOpenConversation} />)}</ul>
        </section>
      )}
      {overview && board.running.length > 0 && (
        <section className="act-card" aria-label="Running">
          <h2 className="ext-heading">Running</h2>
          <ul className="act-list" role="list" aria-label="Running">{board.running.map((c) => <ConversationRow key={c.id} c={c} onOpen={onOpenConversation} />)}</ul>
        </section>
      )}
      {overview && (
        <div className="act-card act-embed">
          <ChangesWaiting conversations={board.doneToday.slice(0, 10)} onSelect={onOpenConversation} />
        </div>
      )}
      {filter === 'everything' && board.doneToday.length > 0 && (
        <section className="act-card" aria-label="Done today">
          <h2 className="ext-heading">Done today</h2>
          <ul className="act-list" role="list" aria-label="Done today">{board.doneToday.map((c) => <ConversationRow key={c.id} c={c} onOpen={onOpenConversation} />)}</ul>
        </section>
      )}
      {filter === 'everything' && onOpenSchedules && <div className="act-card act-embed"><ScheduledList onOpen={onOpenSchedules} /></div>}
      {filter === 'everything' && open && open.messages > 0 && (
        <div className="act-card act-embed" aria-label={`Turns in ${open.title}`}>
          <Turns conversation={open.id} busy={open.activity === 'working'} version={open.updated_ms} />
        </div>
      )}
      {days.map((d) => (
        <section key={d.label} className="act-day" aria-label={d.label}>
          <h2 className="act-day-label">{d.label}</h2>
          <ul className="act-list" role="list">{d.items.map((item) => <Line key={item.seq} item={item} />)}</ul>
        </section>
      ))}
      {feed.loaded && shown.length === 0 && filter !== 'needs' && !nothing && <p className="note-empty">Nothing here yet.</p>}
      {nothing && (
        <EmptyState icon={OWN_ICONS.activity} title={filter === 'needs' ? 'Nothing needs you' : 'Nothing has happened yet'}
          line={filter === 'needs' ? 'When Mobius has a question or a change to keep, it waits here.' : 'What Mobius does in your apps is listed here, newest first.'}
          {...(onOpenSchedules && filter !== 'needs' ? { action: { label: 'Schedule something', run: onOpenSchedules } } : {})} />
      )}
    </section>
  );
}
