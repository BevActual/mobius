import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ActivityEntry, ConversationInfo } from '@mobius/shared';
import { appName, type AppId } from './apps';
import { APP_ICONS, OWN_ICONS } from './Rail';
import { appOf } from './review-view';
import { MobiusMark } from './MobiusMark';
import { activityBoard } from './activity-board';
import { appsIn, byDay, byWho, feedOf, inPlace, type ActivityPlace, type ActivityWho, type FeedItem } from './activity-feed';
import { ChangesWaiting, ScheduledList } from './ConversationSidebar';
import { Turns } from './Rewind';
import { EmptyState } from './EmptyState';
import { relativeTime } from './relative-time';
import { dateTimeLabel, longDateLabel, timeLabel } from './dates';
import { AppSidebar, SidebarRow, SidebarSection, ToolbarControls, ViewSwitch, type ViewChoice } from './ui';
import './activity.css';

/** How many log entries the page reads: about a week of ordinary use. */
const LIMIT = 400;

/** What is open on the right: a conversation (with its turns, maybe asking to rewind to one), or one line of the history. */
type Picked = { kind: 'conversation'; id: string; rewindTo?: string } | { kind: 'item'; seq: number } | null;

/**
 * Where to rewind to so that a line of the history is undone: the turn before the one it happened in, in the
 * conversation that was working then. Only conversations that moved after it are read. Null when there is none (it
 * happened in a conversation's first turn, or no turn is saved).
 */
async function rewindFor(when: number, conversations: readonly ConversationInfo[]): Promise<{ id: string; start: string } | null> {
  const api = window.mobius.changes;
  if (!api?.turns) return null;
  let best: { id: string; start: string; at: number } | null = null;
  for (const c of conversations.filter((x) => x.updated_ms >= when).slice(0, 12)) {
    const r = await api.turns(c.id).catch(() => null);
    const turns = r && r.ok ? r.turns.filter((t) => t.ended) : [];
    const i = turns.findLastIndex((t) => t.when <= when);
    const before = i > 0 ? turns[i - 1] : undefined;
    if (before && (!best || turns[i]!.when > best.at)) best = { id: c.id, start: before.start, at: turns[i]!.when };
  }
  return best && { id: best.id, start: best.start };
}

/** Rewind to here, on a line Mobius changed: shown once the conversation and turn it came from are found. */
function RewindButton({ when, conversations, onRewind }: { when: number; conversations: readonly ConversationInfo[]; onRewind: (id: string, start: string) => void }) {
  const [to, setTo] = useState<{ id: string; start: string } | null>(null);
  useEffect(() => {
    let live = true;
    setTo(null);
    void rewindFor(when, conversations).then((r) => { if (live) setTo(r); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when]);
  if (!to) return null;
  return <button type="button" className="btn" onClick={() => onRewind(to.id, to.start)}>Rewind to here</button>;
}

/**
 * The Activity app's state: the log on this computer, read again whenever a conversation moves, where the sidebar
 * looks, who the toolbar shows, and what is open. The sidebar, the toolbar and the page share it.
 */
export function useActivityFeed(conversations: readonly ConversationInfo[], active: boolean) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [place, setPlace] = useState<ActivityPlace>('today');
  const [who, setWho] = useState<ActivityWho>('everything');
  const [picked, setPicked] = useState<Picked>(null);
  const moved = conversations.reduce((n, c) => Math.max(n, c.updated_ms), 0);
  const load = useCallback(async () => {
    const got = await window.mobius.agent.activity(LIMIT).catch(() => null);
    setEntries(Array.isArray(got) ? got : []);
    setLoaded(true);
  }, []);
  useEffect(() => { if (active) void load(); }, [active, load, moved]);
  const items = useMemo(() => feedOf(entries), [entries]);
  const go = useCallback((p: ActivityPlace) => { setPlace(p); setPicked(null); }, []);
  return { items, loaded, place, setPlace: go, who, setWho, picked, setPicked, reload: load };
}
export type ActivityFeed = ReturnType<typeof useActivityFeed>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The toolbar's grey line: how much happened today, and what is waiting. */
export function activitySub(feed: ActivityFeed, conversations: readonly ConversationInfo[], now = new Date()): string {
  const today = feed.items.filter((i) => inPlace(i, 'today', now)).length;
  const waiting = activityBoard(conversations, now).needsYou.length;
  const parts = [today === 0 ? 'Nothing today' : `${plural(today, 'thing')} today`];
  if (waiting > 0) parts.push(`${waiting} need${waiting === 1 ? 's' : ''} you`);
  return parts.join(' · ');
}

/** The Activity app's sidebar: what needs you and when, then each app things happened in. */
export function ActivitySidebar({ feed, conversations, pin }: { feed: ActivityFeed; conversations: readonly ConversationInfo[]; pin?: ReactNode }) {
  const now = new Date();
  const board = activityBoard(conversations, now);
  const count = (p: ActivityPlace) => feed.items.filter((i) => inPlace(i, p, now) && byWho(i, feed.who)).length;
  const row = (p: ActivityPlace, label: string, n: number) => (
    <SidebarRow key={p} label={label} {...(n ? { count: n } : {})} current={feed.place === p} onSelect={() => feed.setPlace(p)} />
  );
  return (
    <AppSidebar label="Activity sidebar" className="act-side">
      <SidebarSection title="Show" action={pin}>
        {row('needs', 'Needs you', board.needsYou.length)}
        {row('today', 'Today', count('today'))}
        {row('week', 'This week', count('week'))}
        {row('all', 'Everything', 0)}
      </SidebarSection>
      {appsIn(feed.items).length > 0 && (
        <SidebarSection title="Apps">
          {appsIn(feed.items).map(({ app }) => row(`app:${app}`, appName(app), count(`app:${app}`)))}
        </SidebarSection>
      )}
    </AppSidebar>
  );
}

const WHO_VIEWS: readonly ViewChoice<ActivityWho>[] = [
  { id: 'everything', name: 'All' },
  { id: 'mobius', name: 'Mobius' },
  { id: 'you', name: 'You' },
  { id: 'final', name: 'Can’t undo' },
];

/** A change row's icon: the app its files are in, or the Mobius mark when they span apps. */
const changesGlyph = (files: string[]) => {
  const apps = new Set(files.map((f) => appOf(f)));
  const app = apps.size === 1 ? [...apps][0] ?? null : null;
  return app ? <svg viewBox="0 0 20 20" aria-hidden="true" className="act-icon">{APP_ICONS[app]}</svg> : <span className="act-icon act-icon-mark"><MobiusMark size={18} /></span>;
};
const Glyph = ({ app }: { app: AppId | null }) => <svg viewBox="0 0 20 20" aria-hidden="true" className="act-icon">{app ? APP_ICONS[app] : OWN_ICONS.activity}</svg>;

function Line({ item, picked, onPick, onOpenApp }: { item: FeedItem; picked: boolean; onPick: () => void; onOpenApp: (app: AppId) => void }) {
  return (
    <li className="act-row" data-picked={picked || undefined} data-warn={item.warn || undefined}>
      <button type="button" className="act-main" aria-current={picked || undefined} onClick={onPick}>
        <span className="act-mark" data-mobius={item.changed || undefined} aria-label={item.changed ? 'Changed by Mobius' : undefined} />
        <Glyph app={item.app} />
        <span className="act-text">
          <span className="act-what">{item.text}</span>
          <span className="act-sub">{item.app ? appName(item.app) : 'Mobius'}{item.by === 'you' ? ' · You' : ''}{item.final ? ' · Can’t be undone' : ''}</span>
        </span>
        <time className="act-time" dateTime={new Date(item.when).toISOString()} title={dateTimeLabel(item.when)}>{timeLabel(item.when)}</time>
      </button>
      {item.app && <button type="button" className="act-act" title={`Open ${appName(item.app)}`} onClick={() => onOpenApp(item.app!)}>Open</button>}
    </li>
  );
}

function ConversationLine({ c, picked, onPick, onOpen }: { c: ConversationInfo; picked: boolean; onPick: () => void; onOpen: () => void }) {
  const waiting = c.activity === 'needs_you' || c.waiting > 0;
  const state = waiting ? (c.waiting > 1 ? `${c.waiting} questions for you` : 'A question for you') : c.activity === 'working' ? 'Working…' : relativeTime(c.updated_ms, Date.now());
  return (
    <li className="act-row" data-picked={picked || undefined}>
      <button type="button" className="act-main" aria-current={picked || undefined} onClick={onPick}>
        <span className="act-mark" data-state={waiting ? 'needs' : c.activity} aria-hidden="true" />
        <Glyph app="agent" />
        <span className="act-text">
          <span className="act-what">{c.title || 'A conversation'}</span>
          <span className="act-sub">{state}</span>
        </span>
      </button>
      <button type="button" className="act-act" title="Open the conversation" onClick={onOpen}>Open</button>
    </li>
  );
}

const PLACE_EMPTY: Record<string, [string, string]> = {
  needs: ['Nothing needs you', 'When Mobius has a question or a change to keep, it waits here.'],
  today: ['Nothing yet today', 'What Mobius does in your apps is listed here, newest first.'],
  week: ['Nothing this week', 'What Mobius does in your apps is listed here, newest first.'],
  all: ['Nothing has happened yet', 'What Mobius does in your apps is listed here, newest first.'],
};

/** The right side: the open conversation with its turns and Rewind, or one line of the history and where it was. */
function Detail({ feed, picked: p, conversations, onOpenConversation, onOpenApp }: { feed: ActivityFeed; picked: Picked; conversations: readonly ConversationInfo[]; onOpenConversation: (id: string) => void; onOpenApp: (app: AppId) => void }) {
  if (p?.kind === 'conversation') {
    const c = conversations.find((x) => x.id === p.id);
    if (c) {
      return (
        <section className="act-detail" aria-label={c.title || 'Conversation'}>
          <h2 className="act-detail-title">{c.title || 'A conversation'}</h2>
          <p className="act-detail-sub">Last active {relativeTime(c.updated_ms, Date.now()).toLowerCase()}</p>
          <div className="act-detail-actions"><button type="button" className="btn" onClick={() => onOpenConversation(c.id)}>Open conversation</button></div>
          <Turns conversation={c.id} busy={c.activity === 'working'} version={c.updated_ms} {...(p.rewindTo ? { rewindTo: p.rewindTo } : {})} />
        </section>
      );
    }
  }
  if (p?.kind === 'item') {
    const item = feed.items.find((i) => i.seq === p.seq);
    if (item) {
      return (
        <section className="act-detail" aria-label="What happened">
          <h2 className="act-detail-title">{item.text}</h2>
          <dl className="act-facts">
            <dt>App</dt><dd>{item.app ? appName(item.app) : 'Mobius'}</dd>
            <dt>By</dt><dd>{item.by === 'you' ? 'You' : item.by === 'mobius' ? 'Mobius' : 'A connected app'}</dd>
            <dt>When</dt><dd>{longDateLabel(item.when, { year: false })}, {timeLabel(item.when)}</dd>
          </dl>
          {item.final && <p className="act-detail-note">This can’t be undone, so Mobius asked before doing it.</p>}
          <div className="act-detail-actions">
            {item.app && <button type="button" className="btn" onClick={() => onOpenApp(item.app!)}>Open {appName(item.app)}</button>}
            {item.changed && !item.final && <RewindButton when={item.when} conversations={conversations} onRewind={(id, start) => feed.setPicked({ kind: 'conversation', id, rewindTo: start })} />}
          </div>
        </section>
      );
    }
  }
  return <section className="act-detail act-detail-empty" aria-label="Details"><p>Choose something on the left to see where it happened.</p></section>;
}

/**
 * The Activity app's page, as Mail lays out its inbox: a list on the left, what is chosen on the right. The list leads
 * with what needs you and what is running, then the changes still to keep, then everything that happened, a day at a
 * time. Who did it is chosen in the toolbar.
 */
export function ActivityPage({ feed, conversations, active, onOpenConversation, onOpenApp, onOpenSchedules }: {
  feed: ActivityFeed;
  conversations: readonly ConversationInfo[];
  /** The conversation open before Activity was: shown on the right until something else is chosen. */
  active?: string;
  onOpenConversation: (id: string) => void;
  onOpenApp: (app: AppId) => void;
  onOpenSchedules?: () => void;
}) {
  const now = new Date();
  const board = activityBoard(conversations, now);
  const { place, who } = feed;
  const picked: Picked = feed.picked ?? (active && conversations.some((c) => c.id === active) ? { kind: 'conversation', id: active } : null);
  const needs = place === 'needs';
  const lead = place === 'today' || needs;
  const shown = needs ? [] : feed.items.filter((i) => inPlace(i, place, now) && byWho(i, who));
  const days = byDay(shown, now);
  const [reviewing, setReviewing] = useState<string[]>([]);
  const pick = (p: Picked) => feed.setPicked(p);
  const isPicked = (p: Picked) => !!p && !!picked && (p.kind === 'item' ? picked.kind === 'item' && picked.seq === p.seq : picked.kind === 'conversation' && picked.id === p.id);
  const convo = (title: string, list: ConversationInfo[]) => list.length > 0 && (
    <section className="act-group" aria-label={title}>
      <h2 className="act-label">{title}</h2>
      <ul className="act-list" role="list" aria-label={title}>
        {list.map((c) => <ConversationLine key={c.id} c={c} picked={isPicked({ kind: 'conversation', id: c.id })} onPick={() => pick({ kind: 'conversation', id: c.id })} onOpen={() => onOpenConversation(c.id)} />)}
      </ul>
    </section>
  );
  const nothing = shown.length === 0 && (!lead || board.needsYou.length + board.running.length + (needs ? 0 : board.doneToday.length) === 0);
  const [title, line] = PLACE_EMPTY[place] ?? [`Nothing in ${appName(place.slice(4) as AppId)}`, 'Nothing has happened here yet.'];
  return (
    <section className="act-page" aria-label="Activity">
      {!needs && <ToolbarControls label="Who"><ViewSwitch label="Who did it" views={WHO_VIEWS} value={who} onChange={feed.setWho} /></ToolbarControls>}
      <div className="act-scroll">
        {lead && convo('Needs you', board.needsYou)}
        {lead && convo('Running', board.running)}
        {lead && <div className="act-embed"><ChangesWaiting conversations={board.doneToday.slice(0, 10)} onSelect={(id) => pick({ kind: 'conversation', id })} onRows={setReviewing} glyph={changesGlyph} /></div>}
        {/* A conversation with changes to review is listed there until they are kept or discarded, not twice. */}
        {place === 'today' && convo('Done today', board.doneToday.filter((c) => !reviewing.includes(c.id)))}
        {place === 'today' && onOpenSchedules && <div className="act-embed"><ScheduledList onOpen={onOpenSchedules} glyph={<svg viewBox="0 0 20 20" aria-hidden="true" className="act-icon"><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.6" /></svg>} /></div>}
        {days.map((d) => (
          <section key={d.label} className="act-group" aria-label={d.label}>
            <h2 className="act-label">{place === 'today' ? 'What happened' : d.label}</h2>
            <ul className="act-list" role="list">{d.items.map((item) => <Line key={item.seq} item={item} picked={isPicked({ kind: 'item', seq: item.seq })} onPick={() => pick({ kind: 'item', seq: item.seq })} onOpenApp={onOpenApp} />)}</ul>
          </section>
        ))}
        {!feed.loaded && (
          <ul className="act-list act-loading" aria-label="Loading" aria-busy="true">
            {[62, 48, 70, 55, 40, 66].map((w, i) => <li key={i} className="act-row"><span className="act-bar" style={{ width: `${w}%` }} /></li>)}
          </ul>
        )}
        {feed.loaded && nothing && <EmptyState icon={OWN_ICONS.activity} title={title} line={line} />}
      </div>
      <Detail feed={feed} picked={picked} conversations={conversations} onOpenConversation={onOpenConversation} onOpenApp={onOpenApp} />
    </section>
  );
}
