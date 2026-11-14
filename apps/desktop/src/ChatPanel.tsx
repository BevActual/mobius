import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MobiusMark } from './MobiusMark';
import { Welcome } from './Welcome';
import { describeAction, finalNote, finalVerb, groupSummary, pastAction, plainUse, previewArguments, toolTarget } from './actions';
import type { HubTarget } from './search-hub';
import { APPS } from './apps';
import { stepTag } from './step-access';
import { usePreferences } from './usePreferences';
import { ClaimChecks, RichText } from './RichText';
import { unsureClaims, withoutMarks } from './markdown';
import { ReviewStrip, TurnHistory } from './ReviewStrip';
import { splitContext, splitSteps, type AgentConfigureRequest, type AgentResult, type AgentSettings, type ContextItem, type ConversationInfo, type Duration, type EffortChoice, type TodoItem } from '@mobius/shared';
import { Composer } from './composer/Composer';
import { MailSources } from './MailPlan';
import { ActionsList, ActionsSlotContext, actionKey } from './ActionsSlot';
import { GlanceSlotContext, ResultSlotContext } from './PanelSlots';
import { stampLabel, startsGroup } from './time-stamps';
import { useSpeech } from './useSpeech';
import { isSpeaking, readAloudNow } from './speech';
import { EMPTY_QUEUE, afterTurn, clearQueue, editQueued, enqueue, removeQueued, resumeQueue, type MessageQueue, type Queued } from './message-queue';
import { isReadTool, proposedPlan, readsSummary, replySources, type ConversationState, type Item, type ToolStatus, type findToolResult } from './conversation';
import { relativeTime } from './relative-time';
import { RestingPanel } from './Resting';
import { attachmentLabel, hereOf, type SurfaceState } from './surface';
import { activityOf } from './activity';
import { WorkingIndicator } from './Working';
import { SettingsForm } from './settings/ModelForm';
import { SignInForTask } from './SignIn';

const STATUS_TEXT: Record<ToolStatus, string> = {
  running: 'Running…',
  waiting: 'Waiting for you',
  done: 'Done',
  failed: 'Failed',
  declined: 'Declined',
  cancelled: 'Stopped',
};

const MAX_ARGS_SHOWN = 700;

function describeArguments(args: unknown): string {
  if (args === undefined || (typeof args === 'object' && args !== null && Object.keys(args).length === 0)) return '';
  const text = JSON.stringify(args, null, 2) ?? '';
  return text.length > MAX_ARGS_SHOWN ? `${text.slice(0, MAX_ARGS_SHOWN)}…` : text;
}

type Details = { result: ReturnType<typeof findToolResult>; arguments: unknown };

const STEP_STATUS: Record<TodoItem['status'], string> = { pending: 'To do', in_progress: 'Working on it', done: 'Done' };

/** What starting a plan says to the agent: the plan as it stands, so steps you changed are the ones done. */
export function startMessage(steps: string[], edited: boolean): string {
  return edited ? `Go ahead with this plan, as I changed it:\n${steps.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : 'Go ahead with the plan.';
}

/**
 * The model's plan for the task, as a checklist the person can follow. A proposed plan (asked for with Plan first, so
 * every step is still to do and the turn has ended) waits for you: Start it, change the steps first, or do it yourself.
 */
function PlanCard({ item, proposal, busy, onStart, onDrive, onStop }: {
  item: Extract<Item, { kind: 'plan' }>;
  proposal: boolean;
  busy: boolean;
  onStart: (text: string) => void;
  onDrive?: (steps: string[]) => Promise<string | null>;
  onStop: () => void;
}) {
  const preferences = usePreferences();
  const [draft, setEditing] = useState<string[] | null>(null);
  // Changing the steps only makes sense while the plan waits for you.
  const editing = proposal ? draft : null;
  const [problem, setProblem] = useState<string | null>(null);
  const [driving, setDriving] = useState(false);
  const done = item.items.filter((i) => i.status === 'done').length;
  const at = item.items.findIndex((i) => i.status === 'in_progress');
  const working = busy && at >= 0;
  const steps = item.items.map((i) => i.text);
  const kept = (editing ?? steps).map((t) => t.trim()).filter(Boolean);
  const edited = editing !== null && kept.join('\n') !== steps.join('\n');
  const title = proposal ? 'Plan' : working ? 'Working' : 'Plan';
  const meta = proposal ? `${item.items.length} ${item.items.length === 1 ? 'step' : 'steps'}` : working ? `Step ${at + 1} of ${item.items.length}` : `${done} of ${item.items.length} done`;
  // The steps not yet done, including the one in hand, become yours.
  const takeOver = async () => {
    onStop();
    setDriving(true);
    if (onDrive) setProblem(await onDrive(item.items.filter((i) => i.status !== 'done').map((i) => i.text)));
    setDriving(false);
  };
  const drive = async () => {
    setDriving(true);
    if (onDrive) setProblem(await onDrive(kept));
    setDriving(false);
  };
  return (
    <section className="plan-card" aria-label="Plan" data-proposal={proposal || undefined}>
      <header className="plan-head"><span>{title}</span><span className="plan-count">{meta}</span></header>
      {editing ? (
        <ol className="plan-steps plan-edit">
          {editing.map((text, i) => (
            <li key={i} className="plan-step">
              <span className="plan-num" aria-hidden="true">{i + 1}</span>
              <input className="plan-input" value={text} aria-label={`Step ${i + 1}`} autoFocus={i === 0}
                onChange={(e) => setEditing((list) => list && list.map((t, k) => (k === i ? e.target.value : t)))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditing((list) => list && [...list.slice(0, i + 1), '', ...list.slice(i + 1)]); } }} />
              <button type="button" className="msg-action" aria-label={`Remove step ${i + 1}`} onClick={() => setEditing((list) => list && list.filter((_, k) => k !== i))}>Remove</button>
            </li>
          ))}
          <li><button type="button" className="msg-action" onClick={() => setEditing((list) => list && [...list, ''])}>Add a step</button></li>
        </ol>
      ) : (
        <ol className="plan-steps">
          {item.items.map((step, i) => (
            <li key={i} className="plan-step" data-status={step.status} aria-label={`${step.text}: ${STEP_STATUS[step.status]}`}>
              {proposal ? <span className="plan-num" aria-hidden="true">{i + 1}</span> : <span className="plan-mark" aria-hidden="true" />}
              <span className="plan-text">{step.text}</span>
              {proposal && (() => { const t = stepTag(step.text, preferences.value.appAccess, preferences.value.approvalMode); return t ? <span className="plan-tag" data-tag={t.tag.startsWith('Asks') ? 'ask' : t.tag === 'Off' ? 'off' : 'act'} title={`${t.app}: ${t.tag.toLowerCase()}, from Settings › Safety. Clicking, typing and deleting always ask.`}>{t.tag}</span> : null; })()}
            </li>
          ))}
        </ol>
      )}
      {proposal && (
        <footer className="plan-foot">
          <p className="plan-note">Nothing happens until you start it. You can change any step, or do it yourself.</p>
          {problem && <p className="plan-note" role="alert">{problem}</p>}
          <div className="plan-actions">
            {editing ? (
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
            ) : (
              <button type="button" className="btn" onClick={() => setEditing(steps)}>Edit Plan</button>
            )}
            {onDrive && <button type="button" className="btn" disabled={driving || kept.length === 0} title="Put the steps in Tasks, to do them yourself" onClick={() => void drive()}>I’ll Drive</button>}
            <button type="button" className="btn primary" disabled={kept.length === 0} onClick={() => onStart(startMessage(kept, edited))}>Start</button>
          </div>
        </footer>
      )}
      {working && (
        <footer className="plan-foot">
          <p className="plan-note">Stop anytime: finished steps stay. Take Over stops Mobius and puts the steps left in Tasks for you.</p>
          {problem && <p className="plan-note" role="alert">{problem}</p>}
          <div className="plan-actions">
            {onDrive && <button type="button" className="btn" disabled={driving} onClick={() => void takeOver()}>Take Over</button>}
            <button type="button" className="btn primary" aria-label="Stop the plan" onClick={onStop}>Stop</button>
          </div>
        </footer>
      )}
    </section>
  );
}


/** A question the model asked (the Asking state): its choices as numbered rows, the first one outlined as the
 * suggestion, and number keys to pick one. Your own words go in the message box below. */
function QuestionCard({ item, onReply }: { item: Extract<Item, { kind: 'question' }>; onReply: (callId: string, text: string) => Promise<string | null> }) {
  const [problem, setProblem] = useState<string | null>(null);
  const card = useRef<HTMLElement>(null);
  const open = item.status === 'open';
  const reply = async (answer: string) => {
    if (!answer.trim()) return;
    setProblem(await onReply(item.callId, answer.trim()));
  };
  const replyNow = useRef(reply);
  replyNow.current = reply;
  // Number keys pick a choice while the panel has the focus and nothing is being typed.
  useEffect(() => {
    if (!open || item.choices.length === 0) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const panel = card.current?.closest('aside.chat');
      if (!panel || !target || !(panel.contains(target) || target === document.body)) return;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
      const n = actionKey(event, typing);
      const choice = n === null ? undefined : item.choices[n - 1];
      if (choice === undefined) return;
      event.preventDefault();
      void replyNow.current(choice);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, item.choices]);
  return (
    <section ref={card} className="question-card" role="group" aria-label="Mobius asks" data-status={item.status}>
      <p className="question-text">{item.question}</p>
      {open ? (
        item.choices.length > 0 ? (
          <div className="question-choices">
            {item.choices.map((c, k) => (
              <button key={c} type="button" className="question-choice" data-suggested={k === 0 || undefined} onClick={() => void reply(c)}>
                <span className="question-choice-text">{c}</span>
                {k < 4 && <kbd className="ui-keycap question-key" aria-hidden="true">{k + 1}</kbd>}
              </button>
            ))}
            <p className="question-note">{item.choices.length > 1 ? 'I suggest the first. ' : ''}Or type your own answer below.</p>
          </div>
        ) : <p className="question-note">Type your answer below.</p>
      ) : (
        <p className="question-answer" role="status">{item.status === 'cancelled' ? 'Not answered' : `You answered: ${item.answer ?? ''}`}</p>
      )}
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </section>
  );
}

/** A tool call as a sentence a person reads, when the tool is one Mobius knows; null otherwise. */
function plainAction(name: string, args: unknown): string | null {
  const words = describeAction(name, args);
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

/** App names ("Tasks · Calendar"), each a link that opens the app, when there is somewhere to open them. */
function AppLinks({ names, onOpenItem }: { names: readonly string[]; onOpenItem?: ((target: HubTarget) => void) | undefined }) {
  return (
    <>
      {names.map((name, i) => {
        const id = APPS.find((a) => a.name === name)?.id;
        return (
          <Fragment key={name}>
            {i > 0 && ' · '}
            {id && onOpenItem ? <button type="button" className="link-btn app-link" title={`Open ${name}`} onClick={() => onOpenItem({ app: 'open', id })}>{name}</button> : name}
          </Fragment>
        );
      })}
    </>
  );
}

/** Three or more of the same finished call in a row, or two or more finished reads, as one line ("Added 6 tasks to P2
 * build", "Read your mail and calendar") that opens to show each. */
function ToolGroup({ items, onAnswer, onDetails, onOpenItem }: { items: Extract<Item, { kind: 'tool' }>[]; onAnswer: (requestId: number, approve: boolean, duration: Duration) => Promise<string | null>; onDetails: (callId: string) => Promise<Details>; onOpenItem?: ((target: HubTarget) => void) | undefined }) {
  const [open, setOpen] = useState(false);
  const first = items[0]!;
  // Reads only say what was read; what was changed keeps its own rows, each a link to what it made.
  const reads = items.every((i) => isReadTool(i.name)) && items.some((i) => i.name !== first.name);
  const target = onOpenItem && !reads ? toolTarget(first.name, first.args) : null;
  const sameTarget = target && items.every((i) => JSON.stringify(toolTarget(i.name, i.args)) === JSON.stringify(target));
  const summary = reads ? readsSummary(items) : groupSummary(first.name, items.map((i) => i.args));
  return (
    <div className="tool tool-group" data-status="done">
      <div className="tool-line">
        <span className="tool-dot" aria-hidden="true" />
        {sameTarget
          ? <button type="button" className="tool-name link-btn" data-plain title={`Open it (${first.name})`} onClick={() => onOpenItem?.(target)}>{summary}</button>
          : <span className="tool-name" data-plain title={reads ? items.map((i) => i.name).join(', ') : first.name}>{summary}</span>}
        <button type="button" className="msg-action tool-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : `Show all ${items.length}`}</button>
      </div>
      {open && items.map((i) => <ToolRow key={i.id} item={i} onAnswer={onAnswer} onDetails={onDetails} onOpenItem={onOpenItem} />)}
    </div>
  );
}

/** Where each run of three or more of the same finished call starts, and how long it is. */
function toolRuns(items: readonly Item[]): Map<number, number> {
  const runs = new Map<number, number>();
  for (let i = 0; i < items.length;) {
    const it = items[i]!;
    let j = i;
    // Finished reads in a row fold into one line whatever they read; other calls when three or more are the same.
    const reading = it.kind === 'tool' && it.status === 'done' && isReadTool(it.name);
    if (it.kind === 'tool' && it.status === 'done') {
      while (j + 1 < items.length) { const next = items[j + 1]!; if (next.kind === 'tool' && next.status === 'done' && (reading ? isReadTool(next.name) : next.name === it.name)) j++; else break; }
    }
    if (j - i + 1 >= (reading ? 2 : 3)) runs.set(i, j - i + 1);
    i = j + 1;
  }
  return runs;
}

function ToolRow({ item, onAnswer, onDetails, onOpenItem }: { item: Extract<Item, { kind: 'tool' }>; onAnswer: (requestId: number, approve: boolean, duration: Duration) => Promise<string | null>; onDetails: (callId: string) => Promise<Details>; onOpenItem?: ((target: HubTarget) => void) | undefined }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [open, setOpen] = useState(false);
  const finished = item.status !== 'running' && item.status !== 'waiting';
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void onDetails(item.callId).then(setDetails, () => setDetails({ result: null, arguments: undefined }));
  };
  const [sending, setSending] = useState(false);
  const shownArgs = describeArguments(item.args);
  const respond = async (approve: boolean, duration: Duration) => {
    if (item.requestId === undefined) return;
    setSending(true);
    setProblem(await onAnswer(item.requestId, approve, duration));
    setSending(false);
  };
  return (
    <div className="tool" data-status={item.status}>
      <div className="tool-line">
        <span className="tool-dot" aria-hidden="true" />
        {/* What it did, in words ("Add “Book the film” to Inbox in Tasks"); the tool's own name stays in the tooltip and Details. */}
        {(() => {
          const said = (item.status === 'done' ? pastAction(item.name, item.args) : null) ?? plainAction(item.name, item.args);
          const target = item.status === 'done' && onOpenItem ? toolTarget(item.name, item.args) : null;
          return target
            ? <button type="button" className="tool-name link-btn" data-plain title={`Open it (${item.name})`} onClick={() => onOpenItem?.(target)}>{said ?? item.name}</button>
            : <span className="tool-name" data-plain={said ? true : undefined} title={item.name}>{said ?? item.name}</span>;
        })()}
        <span className="tool-status">{STATUS_TEXT[item.status]}</span>
        {finished && <button type="button" className="msg-action tool-toggle" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} details of ${item.name}`} onClick={toggle}>{open ? 'Hide' : 'Details'}</button>}
      </div>
      {open && (
        <div className="tool-details" role="group" aria-label={`Details of ${item.name}`}>
          {!details ? <p className="dl-sub">Loading…</p> : (
            <>
              <h4 className="tool-h">Asked</h4>
              <pre className="approval-args" tabIndex={0}>{describeArguments(details.arguments) || 'Nothing in particular.'}</pre>
              <h4 className="tool-h">{details.result?.isError ? 'It failed with' : 'Returned'}</h4>
              <pre className="approval-args" tabIndex={0} data-error={details.result?.isError ? 'true' : undefined}>{details.result ? details.result.text || 'Nothing.' : 'No result was saved.'}</pre>
              {details.result?.truncated && <p className="dl-sub">Shortened. The model saw the whole result.</p>}
            </>
          )}
        </div>
      )}
      {item.status === 'waiting' && item.requestId !== undefined && (
        <div className="approval" role="group" aria-label={`Approval needed: ${item.name}`} data-final={finalNote(item.name) ? 'true' : undefined}>
          <p className="approval-head">Needs you</p>
          {item.origin && <p className="approval-origin" role="note">Asked by text in {item.origin}, not by you. <span className="approval-why">Why: this came from {item.origin}.</span></p>}
          <p className="approval-text" title={item.name}>Mobius wants to {plainUse(item.name, item.args)}.{item.onceOnly ? ' You are asked every time for this.' : ''}</p>
          {(() => {
            // In plain words first, as the Approvals board asks: the text it would write, the statement it would run.
            const preview = previewArguments(item.name, item.args);
            if (!preview) return shownArgs && <pre className="approval-args" tabIndex={0} aria-label="What it will use">{shownArgs}</pre>;
            return (
              <>
                <div className="approval-preview-label">{preview.label}</div>
                <pre className="approval-preview" data-mono={preview.mono || undefined} tabIndex={0} aria-label={preview.label}>{preview.text}</pre>
                {shownArgs && (
                  <details className="approval-raw">
                    <summary>Exactly what it sends</summary>
                    <pre className="approval-args" tabIndex={0} aria-label="What it will use">{shownArgs}</pre>
                  </details>
                )}
              </>
            );
          })()}
          {finalNote(item.name) && <p className="approval-final">{finalNote(item.name)}</p>}
          {/* Quiet choices on the left, the one that goes ahead in ink on the right (Instrument, the Asking state). */}
          <div className="approval-actions">
            <button type="button" className="btn approval-quiet" disabled={sending} onClick={() => void respond(false, 'once')}>Decline</button>
            {item.onceOnly || finalVerb(item.name) ? null : <button type="button" className="btn approval-quiet" disabled={sending} onClick={() => void respond(true, 'always')}>Always allow</button>}
            {/* Named by what it does when that can't be undone ("Send"); its full name still says it allows it once. */}
            <button type="button" className="btn primary approval-go" disabled={sending} onClick={() => void respond(true, 'once')}>{finalVerb(item.name) ? <><span className="sr-only">Allow once: </span>{finalVerb(item.name)}</> : 'Allow once'}</button>
          </div>
          {problem && <p className="field-error" role="alert">{problem}</p>}
        </div>
      )}
    </div>
  );
}

export interface ChatPanelProps {
  /** Where the person is, for the suggestions the message box offers. */
  surface?: SurfaceState;
  /** Opens what a finished tool made or changed (a task list, a note, a sheet). */
  onOpenItem?: (target: HubTarget) => void;
  state: ConversationState;
  settings: AgentSettings | null;
  coreReady: boolean;
  onSend: (text: string, context: ContextItem[], options?: { plan?: boolean; ask?: boolean; quick?: boolean; mode?: string; model?: string; images?: string[] }) => void;
  /** Show a browser tab to the person (to sign in themselves). */
  onShowTab?: (tab: string) => void;
  onStop: () => void;
  /** Take over the running task, and hand it back; each resolves with what went wrong, or null. */
  onTakeOver?: () => Promise<string | null>;
  onHandBack?: () => Promise<string | null>;
  onAnswer: (requestId: number, approve: boolean, duration: Duration) => Promise<string | null>;
  /** Answer a question the model asked. Resolves with an explanation when it could not be sent. */
  onReply: (callId: string, text: string) => Promise<string | null>;
  onSaveSettings: (request: AgentConfigureRequest) => Promise<AgentResult>;
  /** Text to place in the composer, for example from elsewhere in the window. Each value is used once. */
  focusToken?: number;
  /** False for a floating panel that slid in because the pointer reached the edge: it must not take the keyboard. */
  takeFocus?: boolean;
  /** Material handed over from elsewhere in the window (text selected in a note): added as a chip, then the box is focused. */
  /** Something to attach, or words to put in the message box (a start from an app's New row). */
  incoming?: { token: number; item?: ContextItem; text?: string } | null;
  conversations: ConversationInfo[];
  activeConversation: string;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onOpenSettings: (section?: 'safety') => void;
  /** Abilities, from the plus menu. */
  onOpenAbilities?: (() => void) | undefined;
  /** `full` is the Agent app: no conversation menu (the list is beside it) and a wide reading column. */
  variant?: 'panel' | 'full';
  /** Take back the last exchange and send it again. Resolves with a reason when it could not be done. */
  /** What a finished tool call was asked and what it returned. */
  onDetails: (callId: string) => Promise<Details>;
  /** The button that floats or attaches the panel. */
  pin?: ReactNode;
  /** The desk: the Agent app's home, shown in place of the greeting of an empty conversation. It is given the slot where the suggestions go. */
  desk?: (starters: ReactNode) => ReactNode;
  /** The open app's own card above the conversation (Get to zero in Mail). */
  appCard?: ReactNode;
  /** Open one email in Mail, from the rows under an answer about the mail. */
  onOpenMail?: (id: string) => void;
  /** The app the panel sits beside, for the line under its title ("In Notes"). */
  place?: string;
  /** Put the panel away. */
  onHide?: () => void;
  /** Little Mobius: the chat in a small window of its own. */
  onPopOut?: () => void;
  /** Settings, Voice: where listening and speaking are chosen. */
  onOpenVoice?: () => void;
  /** What the message box suggests asking in the app beside it ("Ask about your mail"). */
  hint?: string;
  /** Before the title: the app switcher, when the panel takes the sidebar. */
  lead?: ReactNode;
  /** In the sidebar: "In Notes" opens the app switcher. */
  onPlace?: () => void;
  /** More for the All chats menu (Float the agent panel). */
  menuItems?: Array<{ label: string; onSelect: () => void }>;
  /** Under the head: the page's controls, when the panel takes the sidebar. */
  below?: ReactNode;
  effort: EffortChoice;
  onEffort: (effort: EffortChoice) => void;
  /** The model on the server was changed from the composer. */
  onModelChanged: () => void;
  /** Put a proposed plan's steps in Tasks, to do them yourself. Resolves with a reason when it could not be done. */
  onDrive?: (steps: string[]) => Promise<string | null>;
  onRetry: () => Promise<string | null>;
  /** Take back the last exchange and hand back the message so it can be changed. */
  onEdit: () => Promise<{ text: string } | { error: string }>;
}

/** The title of the conversation, which opens the list of the others. */
function ConversationMenu({ conversations, active, onSelect, onNew, openToken = 0, extra = [], asTitle = false }: { conversations: ConversationInfo[]; active: string; onSelect: (id: string) => void; onNew: () => void; /** The panel's plain "Mobius" title opens the list, so the head has no list icon. */ asTitle?: boolean; /** Changes when something outside asks for the list (the needs-you capsule). */ openToken?: number; extra?: Array<{ label: string; onSelect: () => void }> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (openToken) setOpen(true); }, [openToken]);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const title = conversations.find((c) => c.id === active)?.title ?? 'New conversation';

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <div className="convo">
      <button ref={trigger} type="button" className={asTitle ? 'chat-title chat-title-btn' : 'head-icon'} aria-label="All chats" aria-haspopup="menu" aria-expanded={open} title={asTitle ? `All chats · now: ${title}` : 'History'} onClick={() => setOpen((value) => !value)}>
        {asTitle ? 'Mobius' : <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.8" /></svg>}
      </button>
      {open && (
        <div ref={menu} className="convo-menu" role="menu" aria-label="Conversations" onKeyDown={move}>
          <button type="button" role="menuitem" className="convo-item" onClick={() => choose(onNew)}>New conversation</button>
          <div className="convo-sep" role="separator" />
          {conversations.length === 0 && <p className="convo-empty">Nothing saved yet</p>}
          {conversations.map((conversation) => (
            <button key={conversation.id} type="button" role="menuitem" className="convo-item" aria-current={conversation.id === active ? 'true' : undefined} onClick={() => choose(() => onSelect(conversation.id))}>
              <span className="convo-item-title">{conversation.title}</span>
              <span className="convo-item-time">{relativeTime(conversation.updated_ms, Date.now())}</span>
            </button>
          ))}
          {extra.length > 0 && <div className="convo-sep" role="separator" />}
          {extra.map((item) => <button key={item.label} type="button" role="menuitem" className="convo-item" onClick={() => choose(item.onSelect)}>{item.label}</button>)}
        </div>
      )}
    </div>
  );
}

function Shell({ variant, empty, children }: { variant: 'panel' | 'full'; empty: boolean; children: React.ReactNode }) {
  return variant === 'full' ? (
    <section className="chat full" role="region" aria-label="Agent conversation" data-empty={empty || undefined}>{children}</section>
  ) : (
    <aside className="chat" aria-label="Agent" data-empty={empty || undefined}>{children}</aside>
  );
}

/** While you have control of a running task: where Mobius paused, Hand back and Stop. */
function ControlBar({ control, onHandBack, onStop }: { control: { step: number; of?: number }; onHandBack?: () => Promise<string | null>; onStop: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="control-bar" role="status" aria-label="You have control">
      <span className="control-text">You have control · Mobius paused at step {control.step}{control.of ? ` of ${control.of}` : ''}</span>
      {onHandBack && <button type="button" className="btn primary" onClick={() => void onHandBack().then(setProblem)}>Hand back</button>}
      <button type="button" className="btn" onClick={onStop}>Stop</button>
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </div>
  );
}

export function ChatPanel({ takeFocus = true, surface, onOpenItem, state, settings, coreReady, onSend, onShowTab, onStop, onTakeOver, onHandBack, onAnswer, onReply, onSaveSettings, focusToken, incoming, conversations, activeConversation, onNewConversation, onSelectConversation, onOpenSettings, onOpenAbilities, variant = 'panel', onRetry, onEdit, onDetails, pin, desk, effort, onEffort, onModelChanged, onDrive, appCard, onOpenMail, place, onHide, onPopOut, lead, onPlace, menuItems = [], below, onOpenVoice, hint }: ChatPanelProps) {
  const [context, setContext] = useState<ContextItem[]>([]);
  const [draft, setDraft] = useState('');
  const [actionProblem, setActionProblem] = useState<string | null>(null);
  const [chatsToken, setChatsToken] = useState(0);
  const preferences = usePreferences();
  const [starterSlot, setStarterSlot] = useState<HTMLDivElement | null>(null);
  // Reading replies aloud: a Speak button on each, and, when chosen in Settings, Voice, each new reply by itself.
  const { speech, speak, stop: stopSpeaking, dismiss: dismissSpeech } = useSpeech();
  // Messages written while Mobius works: kept above the box and sent in order as each turn ends. Stop keeps them, paused.
  const [queue, setQueue] = useState<MessageQueue>(EMPTY_QUEUE);
  const queueWasBusy = useRef(state.busy);
  const sendQueued = useRef<(item: Queued) => void>(() => undefined);
  sendQueued.current = (item) => onSend(item.text, item.context, item.options);
  useEffect(() => {
    const before = queueWasBusy.current;
    queueWasBusy.current = state.busy;
    const step = afterTurn(queue, before, state.busy, state.ended);
    if (step.queue !== queue) setQueue(step.queue);
    if (step.send) sendQueued.current(step.send);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.busy, state.ended]);
  // A queue belongs to its conversation: another one starts without it.
  useEffect(() => { setQueue((q) => clearQueue(q)); }, [state.conversation]);
  const sendNextQueued = () => {
    const step = resumeQueue(queue, state.busy);
    setQueue(step.queue);
    if (step.send) sendQueued.current(step.send);
  };
  const wasBusy = useRef(state.busy);
  const lastRead = useRef<string | null>(null);
  useEffect(() => {
    const busy = state.busy;
    const before = wasBusy.current;
    wasBusy.current = busy;
    // A new message stops whatever is being read.
    if (busy && !before) stopSpeaking();
    const last = state.items.findLast((i) => i.kind === 'assistant');
    const reply = last && last.kind === 'assistant' ? { id: last.id, text: last.text } : null;
    if (readAloudNow(preferences.value.readAloud, before, busy, reply, lastRead.current) && reply) {
      lastRead.current = reply.id;
      void speak(reply.id, withoutMarks(reply.text));
    }
  }, [state.busy, state.items, preferences.value.readAloud, speak, stopSpeaking]);
  const [copied, setCopied] = useState<string | null>(null);
  // Not-sure facts the person checked, per reply: a reply with unchecked ones is not copied out of Mobius.
  const [checkedClaims, setCheckedClaims] = useState<Record<string, ReadonlySet<string>>>({});
  const lastUser = state.items.findLastIndex((item) => item.kind === 'user');
  const lastAssistant = state.items.findLastIndex((item) => item.kind === 'assistant');
  const proposalAt = proposedPlan(state);
  const settled = !state.busy;
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((current) => (current === id ? null : current)), 1500);
    } catch {
      setActionProblem('Mobius could not copy that.');
    }
  };
  const retry = async () => {
    setActionProblem(null);
    const problem = await onRetry();
    if (problem) setActionProblem(problem);
  };
  const edit = async () => {
    setActionProblem(null);
    const back = await onEdit();
    if ('error' in back) setActionProblem(back.error);
    else {
      const parts = splitContext(back.text);
      setDraft(parts.text);
      setContext(parts.items);
      queueMicrotask(() => field.current?.focus());
    }
  };
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const configured = settings?.configured ?? false;
  const needsSetup = settings !== null && !configured && !settings.baseUrl;
  const showSettings = settings !== null && needsSetup;
  const canType = configured && coreReady;
  // A time above the first message, and above any sent more than fifteen minutes after the one before.
  const stamps = new Set<string>();
  {
    let previous: number | undefined;
    for (const item of state.items) {
      if (item.kind !== 'user') continue;
      if (startsGroup(item.at, previous)) stamps.add(item.id);
      if (item.at !== undefined) previous = item.at;
    }
  }
  // Questions waiting for the person, in every conversation: the head says so, and opens the list.
  const waiting = conversations.reduce((n, c) => n + (c.waiting > 0 ? 1 : 0), 0);
  // What Mobius sees here: what is open beside it now ("Sees this note"); failing that, the apps it worked in during
  // this conversation ("Has used Tasks"), which is not what it is looking at.
  // It says it sees only what actually goes with the message: the chip for what is open here, unless it was removed.
  const runs = toolRuns(state.items);
  const inRun = new Set([...runs].flatMap(([at, n]) => Array.from({ length: n - 1 }, (_, k) => at + k + 1)));
  const here = hereOf(surface);
  // The Asking state: a question waits, so what you type in the message box answers it.
  const openQuestion = state.items.find((item): item is Extract<Item, { kind: 'question' }> => item.kind === 'question' && item.status === 'open');
  // The resting panel's Actions list: an app's own actions go in first (Mail's Get to zero), then the ideas.
  const [appSlot, setAppSlot] = useState<HTMLDivElement | null>(null);
  const resting = state.items.length === 0 && configured && !desk && variant === 'panel';
  const actionsHere = resting ? appSlot : null;
  // The Glance and Result slots: Glance at the top of the resting panel and after a result; Result under the last
  // reply once the turn is done. One host element each, placed where the panel is now (null when there is no place).
  const [glanceSlot, setGlanceSlot] = useState<HTMLDivElement | null>(null);
  const [resultSlot, setResultSlot] = useState<HTMLDivElement | null>(null);
  const done = variant === 'panel' && !desk && settled && lastAssistant >= 0 && lastAssistant === state.items.length - 1 && (state.items[lastAssistant] as Extract<Item, { kind: 'assistant' }>).streaming !== true;
  const glanceHere = resting || done ? glanceSlot : null;
  const resultHere = done ? resultSlot : null;
  // Number keys pick an action while the panel has the focus and nothing is being typed.
  useEffect(() => {
    if (!resting) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('aside.chat')) return;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
      const n = actionKey(event, typing);
      if (n === null) return;
      const row = target.closest('aside.chat')?.querySelectorAll<HTMLButtonElement>('.actions-list .action-row:not([hidden])')[n - 1];
      if (!row) return;
      event.preventDefault();
      row.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resting]);
  const [hereOff, setHereOff] = useState<string | null>(null);
  const hereShown = here && here.key !== hereOff ? here : null;

  // An empty conversation opens at the top, so the desk is the first thing seen; once there are messages it follows the
  // newest, as any chat does.
  const blank = state.items.length === 0;
  const wasBlank = useRef(blank);
  useLayoutEffect(() => {
    const element = log.current;
    if (!element) return;
    if (blank) { element.scrollTop = 0; stuck.current = false; wasBlank.current = true; return; }
    if (wasBlank.current) { stuck.current = true; wasBlank.current = false; }
    if (stuck.current) element.scrollTop = element.scrollHeight;
  }, [state.items, blank]);
  // What arrives after the reply (the review strip, a tool row filling in) keeps the end in view too, when it was.
  useEffect(() => {
    const element = log.current;
    if (!element || typeof MutationObserver === 'undefined') return undefined;
    const follow = new MutationObserver(() => { if (stuck.current) element.scrollTop = element.scrollHeight; });
    follow.observe(element, { childList: true, subtree: true });
    return () => follow.disconnect();
  }, []);

  useEffect(() => {
    if (focusToken) field.current?.focus();
  }, [focusToken]);

  useEffect(() => {
    if (!incoming) return;
    const { item, text } = incoming;
    if (text !== undefined) setDraft(text);
    if (item) setContext((items) => (items.some((i) => i.source === item.source && i.text === item.text) ? items : [...items, item].slice(-5)));
    queueMicrotask(() => field.current?.focus());
  }, [incoming]);

  return (
    <Shell variant={variant} empty={state.items.length === 0}>
      <div className="chat-head" data-lead={lead || onPlace ? true : undefined}>
        {lead}
        {variant === 'full' && !needsSetup ? (
          <span className="chat-titles">
            <span className="chat-title">{conversations.find((c) => c.id === activeConversation)?.title ?? 'New conversation'}</span>
            <span className="chat-sub">Mobius</span>
          </span>
        ) : (
          <span className="chat-titles">
            <span className="chat-title">Mobius</span>
          </span>
        )}
        <div className="chat-head-actions">
          {/* The head's four buttons (Instrument): New chat, History (every chat), Pop out, Close. */}
          {variant === 'panel' && !needsSetup && (
            <button type="button" className="head-icon" aria-label="New chat" title="New chat" onClick={onNewConversation}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
            </button>
          )}
          {variant === 'panel' && (!needsSetup || menuItems.length > 0) && <ConversationMenu conversations={conversations} active={activeConversation} onSelect={onSelectConversation} onNew={onNewConversation} openToken={chatsToken} extra={menuItems} />}
          {variant === 'panel' && onPopOut && !lead && (
            <button type="button" className="head-icon" aria-label="Pop out" title="Pop out Mobius into its own window" onClick={onPopOut}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4.5h4.5V9M15.5 4.5 9.5 10.5M8 5.5H5.5v9h9V12" /></svg>
            </button>
          )}
          {pin}
          {variant === 'panel' && onHide && !lead && (
            <button type="button" className="head-icon" aria-label="Hide" title="Hide Mobius" onClick={onHide}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
            </button>
          )}
        </div>
      </div>
      {below}
      {/* What Mobius sees is the chip in the message box (Instrument: context lives in one place). */}
      {showSettings && settings ? (
        <div className="chat-scroll">
          <Welcome />
          <SettingsForm key={`${settings.baseUrl}|${settings.model}`} settings={settings} onSave={onSaveSettings} />
        </div>
      ) : (
        <>
          <ActionsSlotContext.Provider value={actionsHere}>
            <GlanceSlotContext.Provider value={glanceHere}>
              <ResultSlotContext.Provider value={resultHere}>{appCard}</ResultSlotContext.Provider>
            </GlanceSlotContext.Provider>
          </ActionsSlotContext.Provider>
          <div
            ref={log}
            className="chat-scroll messages"
            role="log"
            aria-label="Conversation"
            aria-live="polite"
            onScroll={(event) => {
              const element = event.currentTarget;
              stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
            }}
          >
            {state.items.length === 0 && (
              configured && desk ? (
                <div className="empty" data-desk>{desk(<div ref={setStarterSlot} className="empty-starters" />)}</div>
              ) : configured && variant === 'panel' ? (
                // Beside an app, never empty: what waits for you, ideas for what is open, then earlier chats.
                <RestingPanel conversations={conversations} active={activeConversation} onSelect={onSelectConversation} onOpenItem={onOpenItem}
                  glance={<div ref={setGlanceSlot} className="glance-slot" />}
                  ideas={<ActionsList title={here ? `For ${here.what}` : 'Ideas'} appSlot={setAppSlot} ideaSlot={setStarterSlot} />} />
              ) : (
                <div className="empty">
                  <MobiusMark size={44} turning={!configured} className="empty-mark" />
                  <h2 className="greeting">{configured ? 'What can I help with?' : coreReady ? 'Connecting…' : 'Starting up…'}</h2>
                  {configured && <div ref={setStarterSlot} className="empty-starters" />}
                </div>
              )
            )}
            {state.items.map((item, index) =>
              item.kind === 'user' ? (
                <Fragment key={item.id}>
                  {stamps.has(item.id) && item.at !== undefined && <p className="msg-stamp"><time dateTime={new Date(item.at).toISOString()}>{stampLabel(item.at, Date.now())}</time></p>}
                  {(() => { const { shown, steps } = splitSteps(item.text); return (
                    <div className="msg user">{shown}{steps !== null && <details className="msg-steps"><summary>Details</summary><p>{steps}</p></details>}</div>
                  ); })()}
                  {item.images && item.images.length > 0 && (
                    <ul className="msg-images" aria-label="Pictures attached">
                      {item.images.map((src, i) => <li key={i}><img src={src} alt={`Picture ${i + 1}`} /></li>)}
                    </ul>
                  )}
                  {item.attachments && item.attachments.length > 0 && (
                    <ul className="msg-chips" aria-label="Attached">
                      {item.attachments.map((a, i) => { const shown = attachmentLabel(a); return <li key={i} className="chip" data-kind={a.kind} title={a.source}><span className="chip-kind" aria-hidden="true">{shown.kind}</span><span className="chip-title">{shown.title}</span></li>; })}
                    </ul>
                  )}
                  {settled && index === lastUser && (
                    <div className="msg-actions user">
                      <button type="button" className="msg-action" aria-label="Edit message" onClick={() => void edit()}>Edit</button>
                    </div>
                  )}
                </Fragment>
              ) : item.kind === 'assistant' ? (
                <Fragment key={item.id}>
                  <ClaimChecks.Provider value={{ checked: checkedClaims[item.id] ?? new Set(), check: (key) => setCheckedClaims((cur) => ({ ...cur, [item.id]: new Set([...(cur[item.id] ?? []), key]) })) }}>
                    <div className="msg assistant" data-streaming={item.streaming}><RichText text={item.text} /></div>
                  </ClaimChecks.Provider>
                  {!item.streaming && item.text !== '' && (() => { const from = replySources(state.items, index); return from.length > 0 ? <p className="msg-sources" title="The apps Mobius used for this reply">Based on <AppLinks names={from} onOpenItem={onOpenItem} /></p> : null; })()}
                  {!item.streaming && item.text !== '' && onOpenMail && !state.busy && index === state.items.findLastIndex((i) => i.kind === 'assistant') && replySources(state.items, index).includes('Mail') && <MailSources conversation={state.conversation} version={state.items.length} onOpen={onOpenMail} />}
                  {!item.streaming && item.text !== '' && (
                    <div className="msg-actions assistant">
                      {(() => {
                        const left = unsureClaims(item.text).filter((k) => !(checkedClaims[item.id]?.has(k) ?? false)).length;
                        return left > 0
                          ? <span className="msg-gate" title="Click each one marked Not sure to see why, and say when you have checked it">{left === 1 ? 'Check 1 unsure fact before copying' : `Check ${left} unsure facts before copying`}</span>
                          : <button type="button" className="msg-action" aria-label="Copy reply" onClick={() => void copy(item.id, withoutMarks(item.text))}>{copied === item.id ? 'Copied' : 'Copy'}</button>;
                      })()}
                      <button type="button" className="msg-action" aria-busy={(speech.state === 'loading' && speech.id === item.id) || undefined} onClick={() => (isSpeaking(speech, item.id) ? stopSpeaking() : void speak(item.id, withoutMarks(item.text)))}>
                        {speech.state === 'loading' && speech.id === item.id ? 'Getting the voice…' : isSpeaking(speech, item.id) ? 'Stop reading' : 'Read aloud'}
                      </button>
                      {settled && index === lastAssistant && <button type="button" className="msg-action" aria-label="Try again" onClick={() => void retry()}>Try again</button>}
                      {/* Honesty: the model that answered, in small grey text (a switch to the second model says so above). */}
                      {(() => { const asked = state.items.slice(0, index).findLast((i) => i.kind === 'user'); return asked?.kind === 'user' && asked.model ? <span className="msg-model" title="The model this was sent to">{asked.model}</span> : null; })()}
                    </div>
                  )}
                  {done && index === lastAssistant && (
                    <>
                      <div ref={setResultSlot} className="result-slot" />
                      <div ref={setGlanceSlot} className="glance-slot" />
                    </>
                  )}
                  {speech.state === 'failed' && speech.id === item.id && (
                    <p className="msg-voice-problem" role="alert">
                      {speech.error}
                      {speech.setup && onOpenVoice && <> <button type="button" className="link-btn" onClick={() => { dismissSpeech(); onOpenVoice(); }}>Voice settings</button></>}
                    </p>
                  )}
                </Fragment>
              ) : item.kind === 'plan' ? (
                <PlanCard key={item.id} item={item} busy={state.busy} proposal={index === proposalAt} onStart={(text) => onSend(text, [])} onDrive={onDrive} onStop={onStop} />
              ) : item.kind === 'question' ? (
                <QuestionCard key={item.id} item={item} onReply={onReply} />
              ) : item.kind === 'notice' ? (
                <div key={item.id} className="msg-notice" role="status">{item.text}</div>
              ) : item.kind === 'error' ? (
                <Fragment key={item.id}>
                  <div className="msg error" role="alert" data-failed={item.failed || undefined}><svg className="msg-error-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3M8 11.3v.2" /></svg><span>{item.text}</span></div>
                  {settled && index === state.items.length - 1 && lastUser >= 0 && (
                    <div className="msg-actions assistant">
                      <button type="button" className="msg-action" aria-label="Try again" onClick={() => void retry()}>Try again</button>
                    </div>
                  )}
                </Fragment>
              ) : runs.has(index) ? (
                <ToolGroup key={item.id} items={state.items.slice(index, index + runs.get(index)!) as Extract<Item, { kind: 'tool' }>[]} onAnswer={onAnswer} onDetails={onDetails} onOpenItem={onOpenItem} />
              ) : inRun.has(index) ? null : (
                <ToolRow key={item.id} item={item} onAnswer={onAnswer} onDetails={onDetails} onOpenItem={onOpenItem} />
              ),
            )}
            {state.items.length > 0 && <ReviewStrip conversation={state.conversation} busy={state.busy} onOpenItem={onOpenItem} since={(() => { const last = state.items.findLast((item) => item.kind === 'user'); return last?.kind === 'user' ? last.at : undefined; })()} />}
            {actionProblem && <div className="msg error" role="alert">{actionProblem}</div>}
            {state.busy && !state.items.some((item) => (item.kind === 'tool' && item.status === 'waiting') || (item.kind === 'question' && item.status === 'open')) && state.items.at(-1)?.kind !== 'assistant' && (
              <WorkingIndicator state={state} onStop={onStop} />
            )}
          </div>
          <SignInForTask conversation={state.conversation} onShowPage={(tab) => (onShowTab ? onShowTab(tab) : window.mobius.browser.activate(tab))} onSay={(text) => onSend(text, [])} />
          <TurnHistory conversation={state.conversation} busy={state.busy} />
          {state.control && <ControlBar control={state.control} onHandBack={onHandBack} onStop={onStop} />}
          {queue.items.length > 0 && (
            <QueuePanel
              queue={queue}
              onEdit={(id, text) => setQueue((q) => editQueued(q, id, text))}
              onRemove={(id) => setQueue((q) => removeQueued(q, id))}
              onClear={() => setQueue((q) => clearQueue(q))}
              onSendNext={sendNextQueued}
            />
          )}
          <Composer
            takeFocus={takeFocus}
            contextUse={state.context}
            {...(onOpenVoice ? { onOpenVoice } : {})}
            {...(hint ? { hint } : {})}
            startersIn={state.items.length === 0 ? starterSlot : null}
            startersAs={resting ? 'rows' : 'chips'}
            started={state.items.length > 0}
            draft={draft}
            onDraft={setDraft}
            context={context}
            onContext={setContext}
            canType={canType}
            busy={state.busy}
            configured={configured}
            coreReady={coreReady}
            settings={settings}
            effort={effort}
            onEffort={onEffort}
            onSend={(text, items, options) => { onSend(text, items, options); setDraft(''); setContext([]); }}
            onQueue={(text, items, options) => { setQueue((q) => enqueue(q, text, items, options)); setDraft(''); setContext([]); }}
            onStop={onStop}
            {...(onTakeOver && !state.control ? { onTakeOver } : {})}
            onModelChanged={onModelChanged}
            onOpenSettings={onOpenSettings}
            onOpenAbilities={onOpenAbilities}
            fieldRef={field}
            surface={surface}
            here={hereShown}
            onRemoveHere={() => setHereOff(here?.key ?? null)}
            activity={activityOf(state)}
            onAnswer={openQuestion ? (text) => { void onReply(openQuestion.callId, text).then((p) => { if (!p) setDraft(''); }); } : undefined}
          />
        </>
      )}
    </Shell>
  );
}

/** The messages waiting for Mobius to finish, each one editable and removable, with Clear queue (and Send next after Stop). */
function QueuePanel({ queue, onEdit, onRemove, onClear, onSendNext }: { queue: MessageQueue; onEdit: (id: number, text: string) => void; onRemove: (id: number) => void; onClear: () => void; onSendNext: () => void }) {
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const save = () => { if (editing) onEdit(editing.id, editing.text); setEditing(null); };
  return (
    <section className="msg-queue" aria-label="Queued messages">
      <div className="msg-queue-head">
        <span className="msg-queue-title">{queue.paused ? `Stopped · ${queue.items.length} waiting` : `${queue.items.length} waiting · sent when Mobius finishes`}</span>
        {queue.paused && <button type="button" className="link-btn" onClick={onSendNext}>Send next</button>}
        <button type="button" className="link-btn" onClick={onClear}>Clear queue</button>
      </div>
      <ol className="msg-queue-list">
        {queue.items.map((item, index) => (
          <li key={item.id} className="msg-queue-item">
            {editing?.id === item.id ? (
              <form className="msg-queue-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
                <input type="text" aria-label={`Edit queued message ${index + 1}`} value={editing.text} autoFocus onChange={(e) => setEditing({ id: item.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(null); } }} onBlur={save} />
              </form>
            ) : (
              <>
                <span className="msg-queue-text" title={item.text}>{item.text}</span>
                {(item.context.length > 0 || item.options?.images?.length) ? <><span className="msg-queue-more" aria-hidden="true" title="With attachments">+</span><span className="sr-only">, with attachments</span></> : null}
                <button type="button" className="msg-action" aria-label={`Edit queued message ${index + 1}`} onClick={() => setEditing({ id: item.id, text: item.text })}>Edit</button>
              </>
            )}
            <button type="button" className="chip-remove msg-queue-remove" aria-label={`Remove queued message ${index + 1}`} title="Remove" onMouseDown={(e) => e.preventDefault()} onClick={() => { setEditing(null); onRemove(item.id); }}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
