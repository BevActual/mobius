import { useEffect, useState, type FormEvent } from 'react';
import { MAIN_BOT_ID, MAX_BOT_INSTRUCTIONS, MAX_BOT_NAME, botOfConversation, type Bot, type BotDraft, type BotResult, type ConversationInfo, type ScheduleInfo } from '@mobius/shared';
import { describeWhen } from './settings/Schedules';
import { relativeTime } from './relative-time';
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
function useSchedules(): ScheduleInfo[] {
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

/**
 * The Agents page: in the main area while the sidebar shows Agents. One agent's instructions, model, how it starts,
 * what it may touch and its sessions, as grouped rows in the manner of Apple's Settings; or the form for a new one.
 */
export function AgentPage({ view, bots, conversations, onShow, onCreate, onUpdate, onNewSession, onOpenSession, onOpenSafety, onOpenSchedules }: Props) {
  const preferences = usePreferences();
  const schedules = useSchedules();
  if (view.kind === 'new') {
    return (
      <section className="agent-page" aria-label="New agent">
        <header className="agent-head">
          <span className="agent-avatar" aria-hidden="true">{view.draft.name.trim().charAt(0).toUpperCase() || '+'}</span>
          <span className="agent-titles"><h1 className="agent-name">New agent</h1><span className="agent-sub">Mobius with its own instructions, and its own model if you like.</span></span>
        </header>
        <div className="agent-card">
          <BotForm key={`new:${view.draft.name}`} initial={view.draft} submitLabel="Create" {...(onOpenSafety ? { onOpenSafety } : {})}
            onCancel={() => onShow({ kind: 'show', id: MAIN_BOT_ID })}
            onSubmit={onCreate} onSaved={(made) => onNewSession(made.id)} />
        </div>
      </section>
    );
  }
  const bot = bots.find((b) => b.id === view.id) ?? bots.find((b) => b.id === MAIN_BOT_ID) ?? bots[0];
  if (!bot) return null;
  const main = bot.id === MAIN_BOT_ID;
  const known = bots.map((b) => b.id);
  const sessions = conversations.filter((c) => botOfConversation(c.id, known) === bot.id).sort((a, b) => b.updated_ms - a.updated_ms);
  const runs = main ? [] : agentSchedules(bot, schedules);
  const now = Date.now();
  return (
    <section className="agent-page" aria-label={bot.name}>
      <header className="agent-head">
        <span className="agent-avatar" data-main={main || undefined} aria-hidden="true">{bot.name.charAt(0).toUpperCase()}</span>
        <span className="agent-titles">
          <h1 className="agent-name">{bot.name}</h1>
          <span className="agent-sub">{main ? 'Built in. Uses your settings as they are.' : `Made ${relativeTime(bot.createdMs, now).toLowerCase() || 'earlier'}`}</span>
        </span>
        <span className="agent-actions">
          {!main && !view.editing && <button type="button" className="btn" onClick={() => onShow({ kind: 'show', id: bot.id, editing: true })}>Edit</button>}
          <button type="button" className="btn primary" onClick={() => onNewSession(bot.id)}>New session</button>
        </span>
      </header>
      {view.editing && !main ? (
        <div className="agent-card">
          <BotForm key={`edit:${bot.id}`} initial={{ name: bot.name, instructions: bot.instructions, model: bot.model }} submitLabel="Save" {...(onOpenSafety ? { onOpenSafety } : {})}
            onCancel={() => onShow({ kind: 'show', id: bot.id })}
            onSubmit={(draft) => onUpdate(bot.id, draft)} onSaved={() => onShow({ kind: 'show', id: bot.id })} />
        </div>
      ) : (
        <>
          <h2 className="agent-group-title">Instructions</h2>
          <div className="agent-card agent-instructions" aria-label="Instructions">
            {bot.instructions ? <p>{bot.instructions}</p> : <p className="agent-muted">{main ? 'Mobius’s usual instructions, with nothing added.' : 'Nothing added to the usual instructions yet.'}</p>}
          </div>
          <h2 className="agent-group-title">Details</h2>
          <dl className="agent-card agent-rows">
            <div className="agent-row"><dt>Model</dt><dd>{bot.model || 'The one in settings'}</dd></div>
            <div className="agent-row"><dt>How it starts</dt><dd>
              {runs.length === 0 ? 'When you ask' : `When you ask, and ${runs.map((s) => `${describeWhen(s.days, s.time)}${s.enabled ? '' : ' (off)'}`).join('; ')}`}
              {runs.length > 0 && onOpenSchedules && <button type="button" className="link-btn" onClick={onOpenSchedules}>Schedules</button>}
            </dd></div>
            <div className="agent-row"><dt>May touch</dt><dd>
              {mayTouch(preferences.value.appAccess, modeOf(preferences.value.approvalMode).name)}
              {onOpenSafety && <button type="button" className="link-btn" onClick={onOpenSafety}>Safety settings</button>}
            </dd></div>
          </dl>
        </>
      )}
      <h2 className="agent-group-title">Sessions <span className="agent-count">{sessions.length}</span></h2>
      {sessions.length === 0 ? (
        <p className="agent-card agent-muted agent-empty">No sessions yet. Start one with New session.</p>
      ) : (
        <ul className="agent-card agent-sessions" role="list" aria-label={`Sessions with ${bot.name}`}>
          {sessions.slice(0, 20).map((c) => (
            <li key={c.id}>
              <button type="button" className="agent-session" onClick={() => onOpenSession(c.id)}>
                <span className="agent-session-title">{c.title}</span>
                <span className="agent-session-when">{relativeTime(c.updated_ms, now)}</span>
                <svg className="agent-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
