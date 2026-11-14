import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { MAIN_BOT_ID, MAX_BOT_INSTRUCTIONS, MAX_BOT_NAME, botOfConversation, type Bot, type BotDraft, type BotResult, type ConversationInfo, type ScheduleInfo } from '@mobius/shared';
import { describeWhen } from './settings/Schedules';
import { relativeTime } from './relative-time';
import { dateTimeLabel } from './dates';
import { APP_ICONS } from './Rail';
import './activity.css';
import { agentSchedules, mayTouch, modelChoices } from './bot-view';
import { modeOf } from './approval-modes';
import { usePreferences } from './usePreferences';
import './agents.css';

/** What the Agents page shows: one agent (and whether it is being changed), or a new one being made. */
export type AgentView = { kind: 'show'; id: string; editing?: boolean } | { kind: 'new'; draft: BotDraft };

export const EMPTY_DRAFT: BotDraft = { name: '', instructions: '', model: '' };

/** The models Mobius can use, by name, for the Model field's suggestions. Empty until they are read, or if they cannot be. */
function useModelNames(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    const providers = window.mobius.providers;
    const read = providers
      ? providers.catalog().then((catalog) => modelChoices(catalog))
      : window.mobius.agent.models().then((r) => (r.ok && Array.isArray(r.models) ? r.models : []));
    void read.then((list) => live && setNames(list), () => undefined);
    return () => { live = false; };
  }, []);
  return names;
}

/** The schedules there are, kept current. */
export function useSchedules(): ScheduleInfo[] {
  const [list, setList] = useState<ScheduleInfo[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void window.mobius.schedules?.list().then((l) => live && setList(l)).catch(() => undefined);
    load();
    const off = window.mobius.schedules?.onChange(load);
    return () => { live = false; off?.(); };
  }, []);
  return list;
}

/** Making or changing an agent: its name, instructions, model, how it starts, and what it may touch. */
export function BotForm({ initial, submitLabel, onSubmit, onSaved, onCancel, onOpenSafety }: { initial: BotDraft; submitLabel: string; onSubmit: (draft: BotDraft) => Promise<BotResult<{ bot: Bot }>>; onSaved: (bot: Bot) => void; onCancel: () => void; onOpenSafety?: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // How it starts: when you ask, or also at a time of day (a schedule, as in Settings › Schedules).
  const [starts, setStarts] = useState<'ask' | 'schedule'>('ask');
  const [time, setTime] = useState('08:00');
  const [days, setDays] = useState<'weekdays' | 'daily'>('weekdays');
  const preferences = usePreferences();
  const models = useModelNames();
  const canSchedule = submitLabel === 'Create' && window.mobius.schedules !== undefined;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const saved = await onSubmit(draft);
    if (!saved.ok) { setProblem(saved.error); setSaving(false); return; }
    if (canSchedule && starts === 'schedule') {
      // The schedule runs as this agent: its instructions and model.
      const made = await window.mobius.schedules!.add({ title: draft.name.trim(), prompt: draft.instructions.trim() || draft.name.trim(), time, days: days === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5], enabled: true, bot: saved.bot.id }).catch(() => null);
      if (!made || !made.ok) { setProblem(made && !made.ok ? made.error : 'The agent was made, but its schedule was not.'); setSaving(false); return; }
    }
    setSaving(false);
    onSaved(saved.bot);
  };
  return (
    <form className="botform" aria-label={submitLabel === 'Create' ? 'New agent' : 'Edit agent'} onSubmit={submit} onKeyDown={(event) => event.key === 'Escape' && onCancel()}>
      <label>Name<input type="text" value={draft.name} maxLength={MAX_BOT_NAME} autoFocus placeholder="Weekly summary" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>Instructions<textarea rows={5} value={draft.instructions} maxLength={MAX_BOT_INSTRUCTIONS} placeholder="How this agent should behave. Added to the usual instructions." onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} /></label>
      <label>Model
        <input type="text" list="agent-models" value={draft.model} spellCheck={false} placeholder="The one in settings" onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
        <datalist id="agent-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
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
      <p className="botform-touch"><b>What it may touch</b> {mayTouch(preferences.value.appAccess, modeOf(preferences.value.approvalMode).name)}{' '}
        {onOpenSafety ? <button type="button" className="link-btn" onClick={onOpenSafety}>Change in Safety settings</button> : 'Change it in Settings › Safety.'}
      </p>
      {problem && <span className="field-error" role="alert">{problem}</span>}
      <span className="botform-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={saving || draft.name.trim() === ''}>{submitLabel}</button>
      </span>
    </form>
  );
}

interface Props {
  view: AgentView;
  bots: Bot[];
  /** The agents are still being read: placeholder bars rather than an empty page. */
  loading?: boolean;
  conversations: ConversationInfo[];
  onShow: (view: AgentView) => void;
  onCreate: (draft: BotDraft) => Promise<BotResult<{ bot: Bot }>>;
  onUpdate: (id: string, draft: BotDraft) => Promise<BotResult<{ bot: Bot }>>;
  /** Start a new session with this agent. */
  onNewSession: (bot: string) => void;
  onOpenSession: (conversation: string) => void;
  onOpenSafety?: () => void;
  onOpenSchedules?: () => void;
}

/** When an agent runs, in words, for the toolbar's grey line and the When it runs section. */
export function agentWhen(bot: { id: string; name: string }, schedules: readonly ScheduleInfo[]): string {
  if (bot.id === MAIN_BOT_ID) return 'When you ask';
  const runs = agentSchedules(bot, schedules);
  return runs.length === 0 ? 'When you ask' : `When you ask, and ${runs.map((s) => `${describeWhen(s.days, s.time).replace(/^(Every day|Weekdays|Weekends)/, (m) => m.toLowerCase())}${s.enabled ? '' : ' (off)'}`).join('; ')}`;
}

/**
 * One of an agent's runs, as a row of Activity: a mark while it waits on you or is working, the line icon, its title
 * with its state under it, and when it was last active at the trailing edge. Open opens the session.
 */
function RunRow({ c, onOpen }: { c: ConversationInfo; onOpen: (id: string) => void }) {
  const waiting = c.activity === 'needs_you' || c.waiting > 0;
  const state = waiting ? (c.waiting > 1 ? `${c.waiting} questions for you` : 'A question for you') : c.activity === 'working' ? 'Working…' : c.activity === 'failed' ? 'Failed' : 'Finished';
  return (
    <li className="act-row">
      <button type="button" className="act-main" onClick={() => onOpen(c.id)}>
        <span className="act-mark" data-state={waiting ? 'needs' : c.activity} aria-hidden="true" />
        <svg viewBox="0 0 20 20" aria-hidden="true" className="act-icon">{APP_ICONS.agent}</svg>
        <span className="act-text">
          <span className="act-what">{c.title || 'A session'}</span>
          <span className="act-sub" data-failed={(!waiting && c.activity === 'failed') || undefined}>{state}</span>
        </span>
        <time className="act-time" dateTime={new Date(c.updated_ms).toISOString()} title={dateTimeLabel(c.updated_ms)}>{relativeTime(c.updated_ms, Date.now())}</time>
      </button>
    </li>
  );
}

/** One titled part of the page: a plain heading over its content, parts divided by hairlines (no cards). */
function Part({ title, action, children, label }: { title: string; action?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section className="agent-part" aria-label={label ?? title}>
      <h2 className="agent-part-title"><span>{title}</span>{action}</h2>
      {children}
    </section>
  );
}

/**
 * The Agents page: in the main area while the sidebar shows Agents. Its name and Run now are in the toolbar; the page is
 * plain parts between hairlines, as in Mail: what it does, when it runs, what it can use, and its recent runs.
 */
export function AgentPage({ view, bots, loading = false, conversations, onShow, onCreate, onUpdate, onNewSession, onOpenSession, onOpenSafety, onOpenSchedules }: Props) {
  const preferences = usePreferences();
  const schedules = useSchedules();
  if (view.kind === 'new') {
    return (
      <section className="agent-page" aria-label="New agent">
        <p className="agent-lede">Mobius with its own instructions, and its own model if you like.</p>
        <BotForm key={`new:${view.draft.name}`} initial={view.draft} submitLabel="Create" {...(onOpenSafety ? { onOpenSafety } : {})}
          onCancel={() => onShow({ kind: 'show', id: MAIN_BOT_ID })}
          onSubmit={onCreate} onSaved={(made) => onNewSession(made.id)} />
      </section>
    );
  }
  const bot = bots.find((b) => b.id === view.id) ?? bots.find((b) => b.id === MAIN_BOT_ID) ?? bots[0];
  if (!bot || loading) {
    return (
      <section className="agent-page" aria-label="Agents" aria-busy="true">
        <div className="agent-loading" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <span key={i} />)}</div>
      </section>
    );
  }
  const main = bot.id === MAIN_BOT_ID;
  const known = bots.map((b) => b.id);
  const sessions = conversations.filter((c) => botOfConversation(c.id, known) === bot.id).sort((a, b) => b.updated_ms - a.updated_ms);
  const runs = main ? [] : agentSchedules(bot, schedules);
  if (view.editing && !main) {
    return (
      <section className="agent-page" aria-label={`Edit ${bot.name}`}>
        <BotForm key={`edit:${bot.id}`} initial={{ name: bot.name, instructions: bot.instructions, model: bot.model }} submitLabel="Save" {...(onOpenSafety ? { onOpenSafety } : {})}
          onCancel={() => onShow({ kind: 'show', id: bot.id })}
          onSubmit={(draft) => onUpdate(bot.id, draft)} onSaved={() => onShow({ kind: 'show', id: bot.id })} />
      </section>
    );
  }
  return (
    <section className="agent-page" aria-label={bot.name}>
      <Part title="What it does" action={!main && <button type="button" className="link-btn" onClick={() => onShow({ kind: 'show', id: bot.id, editing: true })}>Edit</button>}>
        {bot.instructions ? <p className="agent-text">{bot.instructions}</p> : <p className="agent-text agent-muted">{main ? 'Mobius’s usual instructions, with nothing added.' : 'Nothing added to the usual instructions yet.'}</p>}
        <p className="agent-meta">{bot.model ? `Uses ${bot.model}` : 'Uses the model in settings'}{main ? '. Built in.' : ''}</p>
      </Part>
      <Part title="When it runs" action={runs.length > 0 && onOpenSchedules && <button type="button" className="link-btn" onClick={onOpenSchedules}>Schedules</button>}>
        <p className="agent-text agent-when">{agentWhen(bot, schedules)}</p>
      </Part>
      <Part title="What it can use" action={onOpenSafety && <button type="button" className="link-btn" onClick={onOpenSafety}>Safety settings</button>}>
        <p className="agent-text">{mayTouch(preferences.value.appAccess, modeOf(preferences.value.approvalMode).name)}</p>
      </Part>
      <Part title="Recent runs" label="Recent runs" action={sessions.length > 0 && <button type="button" className="link-btn" onClick={() => onNewSession(bot.id)}>New session</button>}>
        {sessions.length === 0 ? (
          <p className="agent-text agent-muted agent-empty">No runs yet.<button type="button" className="btn" onClick={() => onNewSession(bot.id)}>New session</button></p>
        ) : (
          <ul className="act-list" role="list" aria-label={`Sessions with ${bot.name}`}>
            {sessions.slice(0, 20).map((c) => <RunRow key={c.id} c={c} onOpen={onOpenSession} />)}
          </ul>
        )}
      </Part>
    </section>
  );
}
