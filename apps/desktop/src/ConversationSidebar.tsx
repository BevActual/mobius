import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { MAIN_BOT_ID, MAX_BOT_INSTRUCTIONS, MAX_BOT_NAME, botOfConversation, type Bot, type BotDraft, type BotResult, type ConversationInfo, type ScheduleInfo } from '@mobius/shared';
import { describeWhen } from './settings/Schedules';
import { relativeTime } from './relative-time';
import { activityBoard } from './activity-board';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { ReviewActions } from './ReviewBar';
import { Turns } from './Rewind';
import { botFromConversation, mayTouch } from './bot-view';
import { modeOf } from './approval-modes';
import { usePreferences } from './usePreferences';

interface Props {
  /** Open Settings › Schedules. */
  onOpenSchedules?: () => void;
  conversations: ConversationInfo[];
  active: string;
  canStartNew: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<string | null>;
  /** Conversations put away, and how to put one away or bring it back. Both absent when the shell has no archive. */
  archived?: string[];
  onArchive?: (id: string, archived: boolean) => void;
  /** The button that floats or attaches the list. */
  pin?: ReactNode;
  bots: Bot[];
  mode: SideMode;
  onMode: (mode: SideMode) => void;
  /** Start a conversation with this bot (or open its latest one). */
  onOpenBot: (bot: string) => void;
  onNewWithBot: (bot: string) => void;
  onCreateBot: (draft: BotDraft) => Promise<BotResult<{ bot: Bot }>>;
  onUpdateBot: (id: string, draft: BotDraft) => Promise<BotResult<{ bot: Bot }>>;
  onRemoveBot: (id: string) => Promise<BotResult<{ removedSessions: number }>>;
  onMoveBot: (id: string, direction: 'up' | 'down') => Promise<BotResult>;
}

export type SideMode = 'sessions' | 'activity' | 'bots';

const COLLAPSED_KEY = 'mobius.sidebar.collapsed';
function readCollapsed(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
  } catch {
    return [];
  }
}

const ACTIVITY_TEXT = { working: 'Working…', needs_you: 'Needs you' } as const;

function Row({ conversation, current, onSelect, onDelete, onArchive, isArchived, onMakeBot }: { conversation: ConversationInfo; current: boolean; onSelect: () => void; onDelete: () => Promise<string | null>; onArchive?: (archived: boolean) => void; isArchived?: boolean; onMakeBot?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <li className="clist-item" data-current={current || undefined}>
      <button type="button" className="clist-main" aria-current={current ? 'true' : undefined} onClick={onSelect}>
        <span className="clist-title">{conversation.title}</span>
        <span className="clist-sub">
          {conversation.activity !== 'idle' && <span className="badge" data-tone={conversation.activity === 'needs_you' ? 'warn' : 'good'}>{ACTIVITY_TEXT[conversation.activity]}</span>}
          {relativeTime(conversation.updated_ms, Date.now())}
        </span>
      </button>
      {confirming ? (
        <span className="clist-confirm">
          <button type="button" className="btn danger" onClick={() => void onDelete().then((error) => { setProblem(error); setConfirming(false); })}>Confirm delete</button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
        </span>
      ) : (
        <>
          {onMakeBot && (
            <button type="button" className="clist-delete" aria-label={`Make ${conversation.title} an agent`} title="Make this an agent" onClick={onMakeBot}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="7" width="11" height="8.5" rx="2.5" /><path d="M10 7V4.5M8 11h.01M12 11h.01" /></svg>
            </button>
          )}
          {onArchive && (
            <button type="button" className="clist-delete" aria-label={`${isArchived ? 'Unarchive' : 'Archive'} ${conversation.title}`} title={isArchived ? 'Bring back' : 'Put away'} onClick={() => onArchive(!isArchived)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14v3H3zM4 8v8h12V8M8 11h4" /></svg>
            </button>
          )}
        <button type="button" className="clist-delete" aria-label={`Delete ${conversation.title}`} title="Delete" onClick={() => setConfirming(true)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2M7 6l.5 10h5L13 6" /></svg>
        </button>
        </>
      )}
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </li>
  );
}

function BotForm({ initial, submitLabel, onSubmit, onCancel }: { initial: BotDraft; submitLabel: string; onSubmit: (draft: BotDraft) => Promise<string | null>; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // How it starts: when you ask, or also at a time of day (a schedule, as in Settings › Schedules).
  const [starts, setStarts] = useState<'ask' | 'schedule'>('ask');
  const [time, setTime] = useState('08:00');
  const [days, setDays] = useState<'weekdays' | 'daily'>('weekdays');
  const preferences = usePreferences();
  const canSchedule = submitLabel === 'Create' && window.mobius.schedules !== undefined;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    let error = await onSubmit(draft);
    if (!error && canSchedule && starts === 'schedule') {
      const made = await window.mobius.schedules!.add({ title: draft.name.trim(), prompt: draft.instructions.trim() || draft.name.trim(), time, days: days === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5], enabled: true }).catch(() => null);
      if (!made || !made.ok) error = made && !made.ok ? made.error : 'The agent was made, but its schedule was not.';
    }
    setProblem(error);
    setSaving(false);
  };
  return (
    <form className="botform" aria-label={submitLabel === 'Create' ? 'New agent' : 'Edit agent'} onSubmit={submit} onKeyDown={(event) => event.key === 'Escape' && onCancel()}>
      <label>Name<input type="text" value={draft.name} maxLength={MAX_BOT_NAME} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>Instructions<textarea rows={4} value={draft.instructions} maxLength={MAX_BOT_INSTRUCTIONS} placeholder="How this agent should behave. Added to the usual instructions." onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} /></label>
      <label>Model<input type="text" value={draft.model} spellCheck={false} placeholder="The one in settings" onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></label>
      {canSchedule && (
        <div className="botform-starts" role="group" aria-label="How it starts">
          <span className="botform-label">How it starts</span>
          <span className="seg botform-seg" role="radiogroup" aria-label="How it starts">
            {([['ask', 'When you ask'], ['schedule', 'On a schedule']] as const).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={starts === value} className="seg-btn" onClick={() => setStarts(value)}>{label}</button>
            ))}
          </span>
          {starts === 'schedule' && <span className="botform-hint">It still starts whenever you ask, too.</span>}
          {starts === 'schedule' && (
            <span className="botform-when">
              <select aria-label="Which days" value={days} onChange={(e) => setDays(e.target.value as typeof days)}><option value="weekdays">Weekdays</option><option value="daily">Every day</option></select>
              <input type="time" aria-label="At" value={time} required onChange={(e) => setTime(e.target.value)} />
            </span>
          )}
        </div>
      )}
      <p className="botform-touch"><b>What it may touch</b> {mayTouch(preferences.value.appAccess, modeOf(preferences.value.approvalMode).name)} Change it in Settings › Safety.</p>
      {problem && <span className="field-error" role="alert">{problem}</span>}
      <span className="botform-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={saving || draft.name.trim() === ''}>{submitLabel}</button>
      </span>
    </form>
  );
}

/** How many sessions, in words: "No sessions", "1 session", "4 sessions". */
const sessionCount = (n: number) => (n === 0 ? 'No sessions' : n === 1 ? '1 session' : `${n} sessions`);

function BotRow({ bot, sessions, current, first, last, onOpen, onNew, onUpdate, onRemove, onMove }: { bot: Bot; sessions: number; current: boolean; first: boolean; last: boolean; onOpen: () => void; onNew: () => void; onUpdate: Props['onUpdateBot']; onRemove: Props['onRemoveBot']; onMove: Props['onMoveBot'] }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The row's actions live in one menu, from the More button or a right-click, so the name keeps the whole row.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const main = bot.id === MAIN_BOT_ID;
  if (editing) {
    return (
      <li className="clist-item">
        <BotForm initial={{ name: bot.name, instructions: bot.instructions, model: bot.model }} submitLabel="Save" onCancel={() => setEditing(false)} onSubmit={async (draft) => { const r = await onUpdate(bot.id, draft); if (r.ok) setEditing(false); return r.ok ? null : r.error; }} />
      </li>
    );
  }
  const items: ContextMenuItem[] = [
    { label: 'New session', run: onNew },
    ...(main ? [] : [
      { action: 'rename' as const, label: 'Edit…', run: () => setEditing(true) },
      { label: 'Move up', disabled: first, separated: true, run: () => void onMove(bot.id, 'up') },
      { label: 'Move down', disabled: last, run: () => void onMove(bot.id, 'down') },
      { action: 'delete' as const, label: 'Remove…', danger: true, separated: true, run: () => setConfirming(true) },
    ]),
  ];
  const openMenu = (x: number, y: number) => setMenu({ x, y });
  return (
    <li className="clist-item bot-row" data-current={current || undefined} data-bot={bot.id}
      onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY); }}
      onKeyDown={(e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left + 12, r.bottom); } }}>
      <button type="button" className="clist-main" aria-current={current ? 'true' : undefined} onClick={onOpen}>
        <span className="clist-title">{bot.name}</span>
        <span className="clist-sub">{main ? 'Built in' : bot.model || 'Model from settings'} · {sessionCount(sessions)}</span>
      </button>
      <button type="button" className="bot-more" aria-label={`More for ${bot.name}`} aria-haspopup="menu" aria-expanded={menu !== null} title="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu((m) => (m ? null : { x: r.left, y: r.bottom + 4 })); }}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="1.2" /><circle cx="10" cy="10" r="1.2" /><circle cx="15" cy="10" r="1.2" /></svg>
      </button>
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} label={bot.name} items={items} onClose={() => setMenu(null)} />, document.body)}
      {confirming && (
        <div className="bot-confirm" role="alertdialog" aria-label={`Remove ${bot.name}?`}>
          <p>{sessions > 0 ? `Remove ${bot.name} and its ${sessions === 1 ? 'session' : `${sessions} sessions`}?` : `Remove ${bot.name}?`}</p>
          <span className="botform-actions">
            <button type="button" className="btn" autoFocus onClick={() => setConfirming(false)}>Keep</button>
            <button type="button" className="btn danger" onClick={() => void onRemove(bot.id).then((r) => { if (!r.ok) setProblem(r.error); setConfirming(false); })}>Remove</button>
          </span>
        </div>
      )}
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </li>
  );
}

/** What is scheduled, under the conversations, as in the design's Agent sidebar. Choosing one opens Settings › Schedules. */
function ScheduledList({ onOpen }: { onOpen: () => void }) {
  const [list, setList] = useState<ScheduleInfo[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void window.mobius.schedules?.list().then((l) => live && setList(l)).catch(() => undefined);
    load();
    const off = window.mobius.schedules?.onChange(load);
    return () => { live = false; off?.(); };
  }, []);
  if (list.length === 0) return null;
  return (
    <section aria-label="Scheduled">
      <h3 className="clist-group"><span className="group-toggle"><span>Scheduled</span><span className="group-count">{list.filter((s) => s.enabled).length}</span></span></h3>
      <ul className="clist" role="list" aria-label="Scheduled requests">
        {list.map((s) => (
          <li key={s.id}>
            <button type="button" className="clist-item scheduled-item" data-off={!s.enabled || undefined} onClick={onOpen} title="Change in Settings › Schedules">
              <span className="clist-title">{s.title}</span>
              <span className="scheduled-when">{describeWhen(s.days, s.time)}{s.enabled ? '' : ' · Off'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Changes not yet kept or discarded, from today's conversations, one row per conversation: the design's Activity
 * history with Undo, for each conversation's last turn. Keep and Discard do what they do in the strip.
 */
function ChangesWaiting({ conversations, onSelect }: { conversations: ConversationInfo[]; onSelect: (id: string) => void }) {
  const [rows, setRows] = useState<{ conversation: ConversationInfo; turn: string | null; files: string[] }[]>([]);
  const [tick, setTick] = useState(0);
  const ids = conversations.map((c) => c.id).join(',');
  useEffect(() => {
    let live = true;
    void Promise.all(conversations.map(async (conversation) => {
      const r = await window.mobius.changes?.lastTurn(conversation.id).catch(() => null);
      const changes = r && 'files' in r ? r : null;
      const turn = turnId(conversation.id, changes?.checkpoint ?? null);
      return { conversation, turn, files: changes && !(turn && keptTurns().includes(turn)) ? changes.files : [] };
    })).then((all) => live && setRows(all.filter((r) => r.files.length > 0)));
    const again = () => setTick((n) => n + 1);
    window.addEventListener(KEPT_EVENT, again);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, again); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, tick]);
  if (rows.length === 0) return null;
  const discard = async (id: string, files: string[], turn: string | null) => {
    for (const path of files) await window.mobius.changes?.undoFile(id, path).catch(() => undefined);
    // The row goes at once (reading the turns again is slow on some computers). The core still lists a turn after it
    // is put back: settle it, and everything showing it reads it again.
    setRows((cur) => cur.filter((r) => r.conversation.id !== id));
    if (turn) keepTurn(turn); else window.dispatchEvent(new CustomEvent(KEPT_EVENT));
  };
  return (
    <section aria-label="Changes to review">
      <h3 className="clist-group"><span className="group-toggle"><span>Changes to review</span><span className="group-count">{rows.length}</span></span></h3>
      <ul className="clist" role="list" aria-label="Changes to review">
        {rows.map(({ conversation, turn, files }) => (
          <li key={conversation.id} className="clist-item change-row">
            <button type="button" className="clist-main" onClick={() => onSelect(conversation.id)}>
              <span className="clist-title">{conversation.title}</span>
              <span className="clist-sub">Changed {files.length === 1 ? '1 item' : `${files.length} items`}</span>
            </button>
            <span className="change-actions">
              <ReviewActions onDiscard={() => discard(conversation.id, files, turn)} onKeep={() => { if (turn) keepTurn(turn); }} discardLabel={`Discard the changes from ${conversation.title}`} keepLabel={`Keep the changes from ${conversation.title}`} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Activity tab: what needs you, what is running, what is scheduled, and what finished today. */
function ActivityBoard({ conversations, active, onSelect, onDelete, onOpenSchedules }: { conversations: ConversationInfo[]; active: string; onSelect: (id: string) => void; onDelete: (id: string) => Promise<string | null>; onOpenSchedules?: () => void }) {
  const board = activityBoard(conversations, new Date());
  const group = (label: string, list: ConversationInfo[]) => list.length > 0 && (
    <section aria-label={label}>
      <h3 className="clist-group"><span className="group-toggle"><span>{label}</span><span className="group-count">{list.length}</span></span></h3>
      <ul className="clist" role="list" aria-label={label}>
        {list.map((conversation) => <Row key={conversation.id} conversation={conversation} current={conversation.id === active} onSelect={() => onSelect(conversation.id)} onDelete={() => onDelete(conversation.id)} />)}
      </ul>
    </section>
  );
  const quiet = board.needsYou.length + board.running.length + board.doneToday.length === 0;
  const recent = [...board.doneToday].slice(0, 10);
  return (
    <>
      {group('Needs you', board.needsYou)}
      {group('Running', board.running)}
      {onOpenSchedules && <ScheduledList onOpen={onOpenSchedules} />}
      <ChangesWaiting conversations={recent} onSelect={onSelect} />
      {active && <Turns conversation={active} busy={conversations.find((c) => c.id === active)?.activity === 'working'} version={conversations.find((c) => c.id === active)?.updated_ms ?? 0} />}
      {group('Done today', board.doneToday)}
      {quiet && <p className="srow-empty side-empty">Nothing is running or waiting. Ask Mobius something, or schedule it for later.</p>}
    </>
  );
}

export function ConversationSidebar({ conversations: everything, archived = [], onArchive, active, canStartNew, onNew, onSelect, onDelete, pin, bots, mode, onMode, onOpenBot, onNewWithBot, onCreateBot, onUpdateBot, onRemoveBot, onMoveBot, onOpenSchedules }: Props) {
  const [adding, setAdding] = useState(false);
  // A bot being made from a conversation: the form opens filled in from it.
  const [fromConversation, setFromConversation] = useState<BotDraft | null>(null);
  const makeBot = async (conversation: ConversationInfo) => {
    const history = await window.mobius.agent.history(conversation.id).catch(() => []);
    const first = history.find((m) => m.role === 'user');
    setFromConversation(botFromConversation(conversation.title, first && first.role === 'user' ? first.text : null));
    onMode('bots');
  };
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const [query, setQuery] = useState('');
  const toggle = (id: string) => setCollapsed((now) => {
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    try { window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* kept for this session */ }
    return next;
  });
  const needle = query.trim().toLowerCase();
  const known = bots.map((bot) => bot.id);
  const activeBot = botOfConversation(active, known);
  const grouped = bots.length > 1;
  const conversations = everything.filter((c) => !archived.includes(c.id));
  const putAway = everything.filter((c) => archived.includes(c.id));
  const [showArchived, setShowArchived] = useState(false);
  const sessionsOf = (id: string) => conversations.filter((c) => botOfConversation(c.id, known) === id);
  return (
    <aside className="side" aria-label="Conversation list">
      <div className="side-head">
        <div className="seg" role="tablist" aria-label="Show">
          {(['sessions', 'activity', 'bots'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className="seg-btn" onClick={() => onMode(m)}>{m === 'sessions' ? 'Sessions' : m === 'activity' ? 'Activity' : 'Agents'}</button>
          ))}
        </div>
        <span className="side-actions">
          {pin}
          {mode !== 'bots' ? (
            <button type="button" className="strip-btn" aria-label="New conversation" title={grouped ? `New session with ${bots.find((b) => b.id === activeBot)?.name ?? 'Mobius'}` : 'New conversation'} disabled={!canStartNew} onClick={onNew}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            </button>
          ) : (
            <button type="button" className="strip-btn" aria-label="New agent" title="New agent" onClick={() => setAdding(true)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            </button>
          )}
        </span>
      </div>
      {mode === 'activity' ? (
        <ActivityBoard conversations={conversations} active={active} onSelect={onSelect} onDelete={onDelete} onOpenSchedules={onOpenSchedules} />
      ) : mode === 'bots' ? (
        <>
          {(adding || fromConversation) && (
            <BotForm key={fromConversation ? `from:${fromConversation.name}` : 'new'} initial={fromConversation ?? { name: '', instructions: '', model: '' }} submitLabel="Create" onCancel={() => { setAdding(false); setFromConversation(null); }} onSubmit={async (draft) => { const r = await onCreateBot(draft); if (!r.ok) return r.error; setAdding(false); setFromConversation(null); onNewWithBot(r.bot.id); onMode('sessions'); return null; }} />
          )}
          <ul className="clist" role="list" aria-label="Agents">
            {bots.map((bot, index) => (
              <BotRow key={bot.id} bot={bot} first={index <= 1} last={index === bots.length - 1} onMove={onMoveBot} sessions={sessionsOf(bot.id).length} current={bot.id === activeBot} onOpen={() => { onOpenBot(bot.id); onMode('sessions'); }} onNew={() => { onNewWithBot(bot.id); onMode('sessions'); }} onUpdate={onUpdateBot} onRemove={onRemoveBot} />
            ))}
          </ul>
          <p className="srow-empty side-empty">An agent is Mobius with its own instructions, and optionally its own model. Each keeps its own sessions.</p>
        </>
      ) : everything.length === 0 ? (
        <p className="srow-empty side-empty">Nothing saved yet. Conversations appear here once you send a message.</p>
      ) : (
        <>
          <input type="search" className="side-search" aria-label="Search sessions" placeholder="Search sessions" value={query} onChange={(e) => setQuery(e.target.value)} />
          {bots.map((bot) => {
            const all = sessionsOf(bot.id);
            const rows = needle ? all.filter((c) => c.title.toLowerCase().includes(needle)) : all;
            if (rows.length === 0) return null;
            const shut = grouped && !needle && collapsed.includes(bot.id);
            const working = all.filter((c) => c.activity === 'working').length;
            const waiting = all.filter((c) => c.activity === 'needs_you').length;
            return (
              <section key={bot.id} aria-label={grouped ? bot.name : undefined}>
                {grouped && (
                  <h3 className="clist-group">
                    <button type="button" className="group-toggle" aria-expanded={!shut} onClick={() => toggle(bot.id)}>
                      <svg className="chev" viewBox="0 0 12 12" aria-hidden="true" data-open={!shut || undefined}><path d="M4.5 3 7.5 6 4.5 9" /></svg>
                      <span>{bot.name}</span>
                      {shut && waiting > 0 && <span className="badge" data-tone="warn">Needs you</span>}
                      {shut && waiting === 0 && working > 0 && <span className="badge" data-tone="good">Working…</span>}
                      <span className="group-count">{rows.length}</span>
                    </button>
                  </h3>
                )}
                {!shut && (
                  <ul className="clist" role="list">
                    {rows.map((conversation) => (
                      <Row key={conversation.id} conversation={conversation} current={conversation.id === active} onSelect={() => onSelect(conversation.id)} onDelete={() => onDelete(conversation.id)} {...(onArchive ? { onArchive: (on: boolean) => onArchive(conversation.id, on) } : {})} onMakeBot={() => void makeBot(conversation)} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {onOpenSchedules && !needle && <ScheduledList onOpen={onOpenSchedules} />}
          {onArchive && putAway.length > 0 && (
            <section aria-label="Archived">
              <h3 className="clist-group">
                <button type="button" className="group-toggle" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
                  <svg className="chev" viewBox="0 0 12 12" aria-hidden="true" data-open={showArchived || undefined}><path d="M4.5 3 7.5 6 4.5 9" /></svg>
                  <span>Archived</span>
                  <span className="group-count">{putAway.length}</span>
                </button>
              </h3>
              {showArchived && (
                <ul className="clist" role="list" aria-label="Archived sessions">
                  {putAway.map((conversation) => (
                    <Row key={conversation.id} conversation={conversation} current={conversation.id === active} isArchived onSelect={() => onSelect(conversation.id)} onDelete={() => onDelete(conversation.id)} onArchive={(on) => onArchive(conversation.id, on)} />
                  ))}
                </ul>
              )}
            </section>
          )}
          {needle && bots.every((bot) => !sessionsOf(bot.id).some((c) => c.title.toLowerCase().includes(needle))) && <p className="srow-empty side-empty">No session matches “{query.trim()}”.</p>}
        </>
      )}
    </aside>
  );
}
