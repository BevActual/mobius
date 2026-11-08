import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MobiusMark } from './MobiusMark';
import { Welcome } from './Welcome';
import { describeAction, previewArguments } from './actions';
import { stepTag } from './step-access';
import { usePreferences } from './usePreferences';
import { ClaimChecks, RichText } from './RichText';
import { unsureClaims, withoutMarks } from './markdown';
import { ReviewStrip, TurnHistory } from './ReviewStrip';
import { splitContext, type AgentConfigureRequest, type AgentResult, type AgentSettings, type ContextItem, type ConversationInfo, type Duration, type EffortChoice, type TodoItem } from '@mobius/shared';
import { Composer } from './composer/Composer';
import { appsSeen, proposedPlan, replySources, type ConversationState, type Item, type ToolStatus, type findToolResult } from './conversation';
import { relativeTime } from './relative-time';
import type { SurfaceState } from './surface';
import { activityOf } from './activity';
import { SettingsForm } from './settings/ModelForm';

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

/** A question the model asked: pick a choice or answer in your own words. */
function QuestionCard({ item, onReply }: { item: Extract<Item, { kind: 'question' }>; onReply: (callId: string, text: string) => Promise<string | null> }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const open = item.status === 'open';
  const reply = async (answer: string) => {
    if (!answer.trim()) return;
    setProblem(await onReply(item.callId, answer.trim()));
  };
  return (
    <section className="question-card" role="group" aria-label="Mobius asks" data-status={item.status}>
      <p className="question-text">{item.question}</p>
      {open ? (
        <>
          {item.choices.length > 0 && (
            <div className="question-choices">
              {item.choices.map((c) => <button key={c} type="button" className="btn" onClick={() => void reply(c)}>{c}</button>)}
            </div>
          )}
          <form className="question-own" onSubmit={(e) => { e.preventDefault(); void reply(text); }}>
            <input className="input" aria-label="Your answer" placeholder={item.choices.length > 0 ? 'Or answer in your own words' : 'Your answer'} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="btn primary" disabled={!text.trim()}>Answer</button>
          </form>
        </>
      ) : (
        <p className="question-answer" role="status">{item.status === 'cancelled' ? 'Not answered' : `You answered: ${item.answer ?? ''}`}</p>
      )}
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </section>
  );
}

function ToolRow({ item, onAnswer, onDetails }: { item: Extract<Item, { kind: 'tool' }>; onAnswer: (requestId: number, approve: boolean, duration: Duration) => Promise<string | null>; onDetails: (callId: string) => Promise<Details> }) {
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
        <span className="tool-name">{item.name}</span>
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
        <div className="approval" role="group" aria-label={`Approval needed: ${item.name}`}>
          <p className="approval-text">{(() => { const plain = describeAction(item.name, item.args); return plain ? <>Mobius wants to {plain}. <span className="approval-tool">{item.name}</span></> : <>Mobius wants to use <strong>{item.name}</strong>.</>; })()}{item.onceOnly ? ' You are asked every time for this.' : ''}</p>
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
          <div className="approval-actions">
            <button type="button" className="btn primary" disabled={sending} onClick={() => void respond(true, 'once')}>Allow once</button>
            {item.onceOnly ? null : <button type="button" className="btn" disabled={sending} onClick={() => void respond(true, 'always')}>Always allow</button>}
            <button type="button" className="btn" disabled={sending} onClick={() => void respond(false, 'once')}>Decline</button>
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
  state: ConversationState;
  settings: AgentSettings | null;
  coreReady: boolean;
  onSend: (text: string, context: ContextItem[], options?: { plan?: boolean; images?: string[] }) => void;
  onStop: () => void;
  onAnswer: (requestId: number, approve: boolean, duration: Duration) => Promise<string | null>;
  /** Answer a question the model asked. Resolves with an explanation when it could not be sent. */
  onReply: (callId: string, text: string) => Promise<string | null>;
  onSaveSettings: (request: AgentConfigureRequest) => Promise<AgentResult>;
  /** Text to place in the composer, for example from elsewhere in the window. Each value is used once. */
  focusToken?: number;
  /** False for a floating panel that slid in because the pointer reached the edge: it must not take the keyboard. */
  takeFocus?: boolean;
  /** Material handed over from elsewhere in the window (text selected in a note): added as a chip, then the box is focused. */
  incoming?: { token: number; item: ContextItem } | null;
  conversations: ConversationInfo[];
  activeConversation: string;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onOpenSettings: () => void;
  /** `full` is the Agent app: no conversation menu (the list is beside it) and a wide reading column. */
  variant?: 'panel' | 'full';
  /** Take back the last exchange and send it again. Resolves with a reason when it could not be done. */
  /** What a finished tool call was asked and what it returned. */
  onDetails: (callId: string) => Promise<Details>;
  /** The button that floats or attaches the panel. */
  pin?: ReactNode;
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
function ConversationMenu({ conversations, active, onSelect, onNew }: { conversations: ConversationInfo[]; active: string; onSelect: (id: string) => void; onNew: () => void }) {
  const [open, setOpen] = useState(false);
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
      <button ref={trigger} type="button" className="convo-trigger" aria-label="Conversations" aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen((value) => !value)}>
        <span className="convo-title">{title}</span>
        <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
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

export function ChatPanel({ takeFocus = true, surface, state, settings, coreReady, onSend, onStop, onAnswer, onReply, onSaveSettings, focusToken, incoming, conversations, activeConversation, onNewConversation, onSelectConversation, onOpenSettings, variant = 'panel', onRetry, onEdit, onDetails, pin, effort, onEffort, onModelChanged, onDrive }: ChatPanelProps) {
  const [context, setContext] = useState<ContextItem[]>([]);
  const [draft, setDraft] = useState('');
  const [actionProblem, setActionProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Not-sure facts the person checked, per reply: a reply with unchecked ones is not copied out of Mobius.
  const [checkedClaims, setCheckedClaims] = useState<Record<string, ReadonlySet<string>>>({});
  const lastUser = state.items.findLastIndex((item) => item.kind === 'user');
  const lastAssistant = state.items.findLastIndex((item) => item.kind === 'assistant');
  const proposalAt = proposedPlan(state);
  const seen = appsSeen(state);
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

  useLayoutEffect(() => {
    const element = log.current;
    if (element && stuck.current) element.scrollTop = element.scrollHeight;
  }, [state.items]);

  useEffect(() => {
    if (focusToken) field.current?.focus();
  }, [focusToken]);

  useEffect(() => {
    if (!incoming) return;
    const { item } = incoming;
    setContext((items) => (items.some((i) => i.source === item.source && i.text === item.text) ? items : [...items, item].slice(-5)));
    queueMicrotask(() => field.current?.focus());
  }, [incoming]);

  return (
    <Shell variant={variant} empty={state.items.length === 0}>
      <div className="chat-head">
        {needsSetup ? <span className="chat-brand"><MobiusMark size={20} /><span className="chat-title">Mobius</span></span> : variant === 'full' ? <span className="chat-title">{conversations.find((c) => c.id === activeConversation)?.title ?? 'New conversation'}</span> : <ConversationMenu conversations={conversations} active={activeConversation} onSelect={onSelectConversation} onNew={onNewConversation} />}
        <div className="chat-head-actions">
          {pin}
          {variant === 'panel' && <button type="button" className="strip-btn" aria-label="New conversation" title="New conversation" disabled={!configured || state.items.length === 0} onClick={onNewConversation}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>}
        </div>
      </div>
      {!showSettings && seen.length > 0 && (
        <p className="chat-sees" title="What Mobius has read from or worked in during this conversation">
          <span className="chat-sees-label">Sees:</span> {seen.join(' · ')}
        </p>
      )}
      {showSettings && settings ? (
        <div className="chat-scroll">
          <Welcome />
          <SettingsForm key={`${settings.baseUrl}|${settings.model}`} settings={settings} onSave={onSaveSettings} />
        </div>
      ) : (
        <>
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
              <div className="empty">
                <MobiusMark size={44} turning={!configured} className="empty-mark" />
                <h2 className="greeting">{configured ? 'What can I help with?' : coreReady ? 'Connecting…' : 'Starting up…'}</h2>
                {configured && <p className="greeting-note">Mobius asks before it uses a tool, unless you change that below.</p>}
              </div>
            )}
            {state.items.map((item, index) =>
              item.kind === 'user' ? (
                <Fragment key={item.id}>
                  <div className="msg user">{item.text}</div>
                  {item.images && item.images.length > 0 && (
                    <ul className="msg-images" aria-label="Pictures attached">
                      {item.images.map((src, i) => <li key={i}><img src={src} alt={`Picture ${i + 1}`} /></li>)}
                    </ul>
                  )}
                  {item.attachments && item.attachments.length > 0 && (
                    <ul className="msg-chips" aria-label="Attached">
                      {item.attachments.map((a, i) => <li key={i} className="chip" data-kind={a.kind} title={a.source}><span className="chip-kind" aria-hidden="true">{a.kind === 'page' ? 'Page' : a.kind === 'note' ? 'Note' : 'File'}</span><span className="chip-title">{a.title}</span></li>)}
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
                  {!item.streaming && item.text !== '' && (() => { const from = replySources(state.items, index); return from.length > 0 ? <p className="msg-sources" title="The apps Mobius used for this reply">Based on {from.join(' · ')}</p> : null; })()}
                  {!item.streaming && item.text !== '' && (
                    <div className="msg-actions assistant">
                      {(() => {
                        const left = unsureClaims(item.text).filter((k) => !(checkedClaims[item.id]?.has(k) ?? false)).length;
                        return left > 0
                          ? <span className="msg-gate" title="Click each one marked Not sure to see why, and say when you have checked it">{left === 1 ? 'Check 1 unsure fact before copying' : `Check ${left} unsure facts before copying`}</span>
                          : <button type="button" className="msg-action" aria-label="Copy reply" onClick={() => void copy(item.id, withoutMarks(item.text))}>{copied === item.id ? 'Copied' : 'Copy'}</button>;
                      })()}
                      {settled && index === lastAssistant && <button type="button" className="msg-action" aria-label="Try again" onClick={() => void retry()}>Try again</button>}
                    </div>
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
                  <div className="msg error" role="alert">{item.text}</div>
                  {settled && index === state.items.length - 1 && lastUser >= 0 && (
                    <div className="msg-actions assistant">
                      <button type="button" className="msg-action" aria-label="Try again" onClick={() => void retry()}>Try again</button>
                    </div>
                  )}
                </Fragment>
              ) : (
                <ToolRow key={item.id} item={item} onAnswer={onAnswer} onDetails={onDetails} />
              ),
            )}
            {actionProblem && <div className="msg error" role="alert">{actionProblem}</div>}
            {state.busy && !state.items.some((item) => (item.kind === 'tool' && item.status === 'waiting') || (item.kind === 'question' && item.status === 'open')) && state.items.at(-1)?.kind !== 'assistant' && (
              <div className="thinking" role="status" aria-label="Mobius is working"><MobiusMark size={22} turning /></div>
            )}
          </div>
          <ReviewStrip conversation={state.conversation} busy={state.busy} />
          <TurnHistory conversation={state.conversation} busy={state.busy} />
          <Composer
            takeFocus={takeFocus}
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
            onStop={onStop}
            onModelChanged={onModelChanged}
            onOpenSettings={onOpenSettings}
            fieldRef={field}
            surface={surface}
            activity={activityOf(state)}
          />
        </>
      )}
    </Shell>
  );
}
