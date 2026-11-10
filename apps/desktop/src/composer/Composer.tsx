import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MobiusMark } from '../MobiusMark';
import { MAX_CONTEXT_ITEMS, MAX_CONTEXT_ITEM_CHARS, MAX_CONTEXT_TOTAL_CHARS, MAX_TYPED_CHARS, type AgentSettings, type ContextItem, type EffortChoice, type ModelCatalog, type ModelGroup } from '@mobius/shared';
import { usePreferences } from '../usePreferences';
import { filterCatalog } from './model-catalog';
import { PopMenu } from './PopMenu';
import type { Activity } from '../activity';
import { CameraDialog } from './CameraDialog';
import { MAX_PICTURES, pictureFromFile, pictureFromUrl, pictureOfWindow } from '../picture';
import { isStarter, mailItem, noteContext, sheetItem, suggestionsFor, tasksItem, type Suggestion, type SurfaceState } from '../surface';
import { useDictation } from './useDictation';
import { MODES, modeOf, nextMode } from '../approval-modes';

const EFFORTS: Array<{ id: EffortChoice; label: string }> = [
  { id: '', label: 'Default' },
  { id: 'none', label: 'Off' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];


const PLAN_FIRST_KEY = 'mobius.planFirst';
const KIND_NOTE: Record<ModelGroup['kind'], string> = { subscription: 'Plan', provider: 'Key', local: 'On this computer', server: 'Server' };

type ModelList = { state: 'idle' | 'loading' } | { state: 'ready'; catalog: ModelCatalog };

export interface ComposerProps {
  /** In an empty conversation: where three starters go, as plain text under the greeting, instead of chips here. */
  startersIn?: HTMLElement | null;
  /** Suggestions are for starting: once the conversation has begun there are none. */
  started?: boolean;
  /** How full the model's window is, when the core has said: a small ring with its percent. */
  contextUse?: { used: number; limit: number };
  /** Whether the message box takes the keyboard when it appears (not when a floating panel is only peeked at). */
  takeFocus?: boolean;
  draft: string;
  onDraft: (text: string) => void;
  context: ContextItem[];
  onContext: (items: ContextItem[]) => void;
  canType: boolean;
  busy: boolean;
  configured: boolean;
  coreReady: boolean;
  settings: AgentSettings | null;
  effort: EffortChoice;
  onEffort: (effort: EffortChoice) => void;
  onSend: (text: string, context: ContextItem[], options?: { plan?: boolean; images?: string[] }) => void;
  onStop: () => void;
  /** While it works: take over, so Mobius pauses at the next safe point and the apps are yours. */
  onTakeOver?: () => Promise<string | null>;
  /** The model on the server was changed from here. */
  onModelChanged: () => void;
  onOpenSettings: () => void;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  /** Where the person is: the message box suggests what is worth asking there. */
  surface?: SurfaceState;
  /** What the agent is doing while it works: the box turns into a live status line with Stop. */
  activity?: Activity | null;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const total = (items: ContextItem[]) => items.reduce((sum, item) => sum + item.text.length, 0);

export function Composer({ takeFocus = true, draft, onDraft, context, onContext, canType, busy, configured, coreReady, settings, effort, onEffort, onSend, onStop, onTakeOver, onModelChanged, onOpenSettings, fieldRef, surface, activity, contextUse, startersIn, started = false }: ComposerProps) {
  // Plan first: the agent proposes the steps and nothing runs until you start them. Kept on this computer.
  const [planFirst, setPlanFirst] = useState(() => { try { return window.localStorage.getItem(PLAN_FIRST_KEY) === '1'; } catch { return false; } });
  const togglePlanFirst = () => setPlanFirst((on) => { try { window.localStorage.setItem(PLAN_FIRST_KEY, on ? '0' : '1'); } catch { /* Not kept. */ } return !on; });
  const [problem, setProblem] = useState<string | null>(null);
  const [models, setModels] = useState<ModelList>({ state: 'idle' });
  const [find, setFind] = useState('');
  const preferences = usePreferences();
  const [adding, setAdding] = useState(false);
  // Pictures for this message, for models that read them; sent with it and then cleared.
  const [pictures, setPictures] = useState<string[]>([]);
  const pictureInput = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  const addPictures = async (files: readonly Blob[]) => {
    const made = (await Promise.all(files.map(pictureFromFile))).filter((p): p is string => p !== null);
    if (made.length === 0) return;
    setPictures((was) => {
      const next = [...was, ...made];
      if (next.length > MAX_PICTURES) setProblem(`You can attach up to ${MAX_PICTURES} pictures to one message.`);
      return next.slice(0, MAX_PICTURES);
    });
  };
  const lookAtWindow = async () => {
    setProblem(null);
    const result = await pictureOfWindow();
    if (!result.ok) { setProblem(result.error); return; }
    setPictures((was) => [...was, result.picture].slice(0, MAX_PICTURES));
    queueMicrotask(() => fieldRef.current?.focus());
  };
  const latest = useRef(draft);
  latest.current = draft;

  const dictation = useDictation((text) => {
    const before = latest.current;
    onDraft(before === '' || /\s$/.test(before) ? before + text : `${before} ${text}`);
    queueMicrotask(() => fieldRef.current?.focus());
  });
  const listening = dictation.state !== 'idle';
  const shownProblem = problem ?? dictation.problem;
  const canSend = canType && !busy && !listening && draft.trim().length > 0;

  useLayoutEffect(() => {
    const element = fieldRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [draft, fieldRef]);

  useEffect(() => {
    if (!busy) return;
    dictation.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    setProblem(null);
    const options = { ...(planFirst ? { plan: true } : {}), ...(pictures.length > 0 ? { images: pictures } : {}) };
    onSend(draft, context, Object.keys(options).length > 0 ? options : undefined);
    setPictures([]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
    // Shift+Tab goes to the next way of working: Ask first, Propose, Act.
    if (event.key === 'Tab' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      void preferences.set({ approvalMode: nextMode(preferences.value.approvalMode) });
    }
  };
  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape' && dictation.state === 'recording') {
      event.preventDefault();
      dictation.cancel();
    }
  };

  const attach = async (kind: 'page' | 'file') => {
    setProblem(null);
    dictation.clearProblem();
    if (context.length >= MAX_CONTEXT_ITEMS) {
      setProblem(`You can attach up to ${MAX_CONTEXT_ITEMS} things to one message.`);
      return;
    }
    setAdding(true);
    const result = kind === 'page' ? await window.mobius.context.page() : await window.mobius.context.file();
    setAdding(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    const item = result.item;
    if (item === null) return;
    if (total(context) + item.text.length > MAX_CONTEXT_TOTAL_CHARS) {
      setProblem('That is too much to attach to one message along with what is already attached.');
      return;
    }
    onContext([...context, item]);
    fieldRef.current?.focus();
  };

  const suggestions = surface && !started && canType && !busy && !listening && draft === '' ? suggestionsFor(surface) : [];
  const suggest = async (s: Suggestion) => {
    setProblem(null);
    if (isStarter(s)) {
      onDraft(s.prompt);
      queueMicrotask(() => fieldRef.current?.focus());
      return;
    }
    let item: ContextItem | null = null;
    if (s.attach === 'note' && surface?.note) item = noteContext(surface.note);
    if (s.attach === 'tasks' && surface?.tasks) item = tasksItem(surface.tasks);
    if (s.attach === 'sheet' && surface?.sheet) item = sheetItem(surface.sheet);
    if (s.attach === 'code' && surface?.code) item = sheetItem(surface.code);
    if (s.attach === 'photo' && surface?.photo) item = sheetItem(surface.photo);
    if (s.attach === 'cut' && surface?.cut) item = sheetItem(surface.cut);
    if (s.attach === 'mail' && surface?.mail) item = mailItem(surface.mail);
    if (s.attach === 'page') {
      const result = await window.mobius.context.page();
      if (!result.ok) { setProblem(result.error); return; }
      item = result.item;
    }
    const items = item ? [...context, item].slice(0, MAX_CONTEXT_ITEMS) : context;
    // A photo goes as the picture itself too, for models that read pictures.
    const photo = s.attach === 'photo' && surface?.photo?.picture ? await pictureFromUrl(surface.photo.picture) : null;
    const images = [...pictures, ...(photo ? [photo] : [])].slice(0, MAX_PICTURES);
    onSend(s.prompt, items, images.length > 0 ? { images } : undefined);
    setPictures([]);
  };

  const loadModels = () => {
    setFind('');
    setModels({ state: 'loading' });
    const providers = window.mobius.providers;
    if (providers) {
      void providers.catalog().then((catalog) => setModels({ state: 'ready', catalog }));
      return;
    }
    // Without the provider catalog (the browser preview), list what the server in use offers.
    void window.mobius.agent.models().then((result) => setModels({ state: 'ready', catalog: { current: settings?.model ?? '', groups: [{ kind: 'server', id: 'server', name: 'This server', active: true, models: result.ok ? result.models.map((m) => ({ id: m, label: m })) : [], error: result.ok ? null : result.error }] } }));
  };
  const isCurrent = (group: ModelGroup, model: { id: string; current?: boolean }) =>
    group.active && (group.kind === 'local' ? model.current === true : models.state === 'ready' && model.id === models.catalog.current);
  const chooseModel = async (group: ModelGroup, model: { id: string; current?: boolean }, close: () => void) => {
    close();
    if (isCurrent(group, model)) return;
    setProblem(null);
    const result =
      group.kind === 'local' ? await window.mobius.models.start(model.id, preferences.value.localContext)
      : group.kind === 'server' ? await window.mobius.agent.setModel(model.id)
      : window.mobius.providers ? await window.mobius.providers.use(group.id, model.id)
      : { ok: false as const, error: 'That cannot be used here.' };
    if (result.ok) onModelChanged();
    else setProblem(result.error);
  };

  const modelName = settings?.configured || settings?.model ? settings.model : '';
  const effortLabel = EFFORTS.find((e) => e.id === effort)?.label ?? 'Default';
  const approval = modeOf(preferences.value.approvalMode);
  const shown = models.state === 'ready' ? filterCatalog(models.catalog.groups, find) : [];

  return (
    <form className="composer" onSubmit={submit} onKeyDown={onFormKeyDown} data-listening={listening || undefined} data-working={activity ? (activity.needsYou ? 'you' : 'agent') : undefined}>
      {activity && (
        <div className="working" role="status" aria-label="Agent activity" aria-live="polite">
          <MobiusMark size={16} turning={!activity.needsYou} className="working-mark" />
          <span className="working-label" key={activity.label}>{activity.label}</span>
          {activity.step && (
            <span className="working-step" aria-label={`Step ${Math.min(activity.step.done + 1, activity.step.total)} of ${activity.step.total}`}>
              <span className="working-track"><span style={{ width: `${(activity.step.done / activity.step.total) * 100}%` }} /></span>
              {activity.step.done} of {activity.step.total}
            </span>
          )}
        </div>
      )}
      {suggestions.length > 0 && startersIn && createPortal(
        <div className="starters" role="group" aria-label="Suggestions">
          {suggestions.slice(0, 3).map((s) => (
            <button key={s.label} type="button" className="starter" onClick={() => void suggest(s)}>{s.label}</button>
          ))}
        </div>,
        startersIn,
      )}
      {suggestions.length > 0 && !startersIn && (
        <div className="suggest" role="group" aria-label="Suggestions">
          {suggestions.map((s) => (
            <button key={s.label} type="button" className="suggest-chip" title={s.attach === 'page' ? 'Attaches this page' : s.attach === 'note' ? 'Attaches this note' : s.attach === 'tasks' ? 'Attaches this list' : s.attach === 'sheet' ? 'Attaches this sheet' : s.attach === 'mail' ? 'Attaches this email' : s.attach === 'code' ? 'Attaches this file' : s.attach === 'photo' ? 'Attaches this photo, described, and its edits' : s.attach === 'cut' ? 'Attaches the clips and the cut' : undefined} onClick={() => void suggest(s)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {pictures.length > 0 && (
        <ul className="picture-chips" aria-label="Pictures for this message">
          {pictures.map((src, index) => (
            <li key={index} className="picture-chip">
              <img src={src} alt={`Picture ${index + 1}`} />
              <button type="button" className="chip-remove" aria-label={`Remove picture ${index + 1}`} onClick={() => setPictures((was) => was.filter((_, i) => i !== index))}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {context.length > 0 && (
        <ul className="chips" aria-label="Attached to this message">
          {context.map((item, index) => (
            <li key={`${item.kind}-${index}-${item.title}`} className="chip" data-kind={item.kind} title={item.source}>
              <span className="chip-kind" aria-hidden="true">{item.kind === 'page' ? 'Page' : item.kind === 'note' ? 'Note' : 'File'}</span>
              <span className="chip-title">{item.title}</span>
              <button type="button" className="chip-remove" aria-label={`Remove ${item.title}`} onClick={() => onContext(context.filter((_, i) => i !== index))}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={fieldRef}
        aria-label="Message Mobius"
        rows={1}
        maxLength={MAX_TYPED_CHARS}
        value={draft}
        disabled={!canType}
        autoFocus={takeFocus}
        placeholder={canType ? 'Message Mobius' : configured ? 'Starting up…' : coreReady ? 'Connect a model to start' : 'Starting up…'}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const files = [...event.clipboardData.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter((f): f is File => f !== null);
          if (files.length > 0) { event.preventDefault(); void addPictures(files); }
        }}
      />
      {camera && <CameraDialog onClose={() => setCamera(false)} onTake={(p) => { setPictures((was) => [...was, p].slice(0, MAX_PICTURES)); queueMicrotask(() => fieldRef.current?.focus()); }} />}
      <input ref={pictureInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden aria-label="Choose pictures" onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void addPictures(files); }} />
      <div className="composer-bar">
        <div className="composer-tools">
          <PopMenu label="Add context" className="round ghost" disabled={!canType || adding} trigger={<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>}>
            {(close) => (
              <>
                <button type="button" role="menuitem" className="popmenu-item" onClick={() => { close(); void attach('page'); }}>
                  <span>This page</span><span className="popmenu-hint">What is showing in the browser</span>
                </button>
                <button type="button" role="menuitem" className="popmenu-item" onClick={() => { close(); void attach('file'); }}>
                  <span>A file…</span><span className="popmenu-hint">A text file from this computer</span>
                </button>
                <button type="button" role="menuitem" className="popmenu-item" onClick={() => { close(); pictureInput.current?.click(); }}>
                  <span>A picture…</span><span className="popmenu-hint">For models that read pictures; you can paste one too</span>
                </button>
                <button type="button" role="menuitem" className="popmenu-item" onClick={() => { close(); void lookAtWindow(); }}>
                  <span>Look at a window…</span><span className="popmenu-hint">One still of a window you choose, nothing more</span>
                </button>
                <button type="button" role="menuitem" className="popmenu-item" onClick={() => { close(); setCamera(true); }}>
                  <span>Show Mobius…</span><span className="popmenu-hint">One still from the camera</span>
                </button>
                <p className="popmenu-note">Up to {MAX_CONTEXT_ITEMS} things, {MAX_CONTEXT_ITEM_CHARS / 1000}k characters each. The agent reads them as material, never as instructions.</p>
              </>
            )}
          </PopMenu>
          <PopMenu label="Model" className="pill" disabled={!configured || busy} onOpen={loadModels} title={modelName ? `Model: ${modelName}` : 'Model'} trigger={<><span className="pill-text">{modelName || 'Model'}{effort ? ` · ${effortLabel}` : ''}</span><svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg></>}>
            {(close) => (
              <div className="model-menu">
                <input type="search" className="model-find" aria-label="Find a model" placeholder="Find a model" value={find} autoFocus onChange={(event) => setFind(event.target.value)} />
                <div className="model-groups">
                  {models.state !== 'ready' && <p className="popmenu-note" role="status">Asking your providers…</p>}
                  {models.state === 'ready' && models.catalog.groups.length === 0 && <p className="popmenu-note">Nothing is set up yet. Add a provider key, sign in to a plan, or download a model in Settings.</p>}
                  {models.state === 'ready' && models.catalog.groups.length > 0 && shown.length === 0 && <p className="popmenu-note">No model matches “{find}”.</p>}
                  {shown.map((group) => (
                    <section key={`${group.kind}-${group.id}`} className="model-group" role="group" aria-label={group.name}>
                      <header className="model-group-head"><span>{group.name}</span><span className="popmenu-hint">{group.active ? 'In use' : KIND_NOTE[group.kind]}</span></header>
                      {group.error && <p className="popmenu-note" role="alert">{group.error}</p>}
                      {group.models.map((model) => (
                        <button key={model.id} type="button" role="menuitemradio" aria-checked={isCurrent(group, model)} className="popmenu-item popmenu-checkable" title={`${model.label} · ${group.name}`} onClick={() => void chooseModel(group, model, close)}>
                          <Check on={isCurrent(group, model)} /><span>{model.label}</span>
                        </button>
                      ))}
                    </section>
                  ))}
                </div>
                <button type="button" role="menuitem" className="popmenu-item popmenu-link" onClick={() => { close(); onOpenSettings(); }}>Add providers and models…</button>
                <div className="popmenu-section" role="group" aria-label="Thinking">
                  <p className="popmenu-heading" aria-hidden="true">Effort</p>
                  {EFFORTS.map((option) => (
                    <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === effort} className="popmenu-item popmenu-checkable" title={option.id === 'none' ? 'Thinking off, for models on this computer' : undefined} onClick={() => { close(); onEffort(option.id); }}>
                      <Check on={option.id === effort} /><span>{option.label}</span>
                    </button>
                  ))}
                  <button type="button" role="menuitemcheckbox" aria-checked={planFirst} className="popmenu-item popmenu-checkable popmenu-split" title="See the steps before Mobius does anything" onClick={() => { close(); togglePlanFirst(); }}>
                    <Check on={planFirst} /><span>Plan first</span>
                  </button>
                </div>
              </div>
            )}
          </PopMenu>
          <PopMenu label="Approvals" className="pill pill-compact" title={`${approval.name}: ${approval.hint}. Shift+Tab in the message box changes it.`} trigger={<><svg className="pill-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 3 4v4c0 3 2.2 5 5 6 2.8-1 5-3 5-6V4z" /></svg><span className="pill-text">{approval.name}</span><svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg></>}>
            {(close) => (
              <>
                {MODES.map((option) => (
                  <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === approval.id} className="popmenu-item popmenu-checkable" onClick={() => { close(); void preferences.set({ approvalMode: option.id }); }}>
                    <Check on={option.id === approval.id} /><span>{option.name}</span><span className="popmenu-hint">{option.hint}</span>
                  </button>
                ))}
                <p className="popmenu-note">In every mode, paying, sending, deleting and running commands ask first, and what you blocked stays blocked. Shift+Tab in the message box changes it.</p>
              </>
            )}
          </PopMenu>
          {planFirst && (
            <button type="button" className="pill pill-compact" aria-label="Plan first" aria-pressed="true" data-on disabled={busy} onClick={togglePlanFirst} title="Plan first is on: Mobius shows its steps, and nothing happens until you start them. Click to turn it off.">
              <span className="pill-text">Plan first</span>
            </button>
          )}
        </div>
        <div className="composer-actions">
          {contextUse && <ContextRing used={contextUse.used} limit={contextUse.limit} />}
          {dictation.state === 'recording' && <span className="rec" role="status" aria-label={`Recording ${clock(dictation.seconds)}`}><span className="rec-dot" aria-hidden="true" />{clock(dictation.seconds)}</span>}
          {dictation.state === 'transcribing' && <span className="rec" role="status">Turning speech into text…</span>}
          <button type="button" className="round ghost" data-recording={dictation.state === 'recording' || undefined} aria-label={dictation.state === 'recording' ? 'Stop dictation' : 'Dictate'} title={dictation.state === 'recording' ? 'Stop and insert the words (Esc cancels)' : 'Dictate'} disabled={!canType || busy || dictation.state === 'transcribing'} onClick={dictation.toggle}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7.5" y="3" width="5" height="9" rx="2.5" /><path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17" /></svg>
          </button>
          {busy && onTakeOver && <button type="button" className="btn take-over" title="Mobius pauses at the next safe point and the apps are yours" onClick={() => void onTakeOver()}>Take over</button>}
          {busy ? (
            <button type="button" className="round stop" aria-label="Stop" title="Stop" onClick={onStop}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" /></svg>
            </button>
          ) : (
            <button type="submit" className="round send" aria-label="Send" title="Send" disabled={!canSend}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5M5.5 9.5 10 5l4.5 4.5" /></svg>
            </button>
          )}
        </div>
      </div>
      {shownProblem && <p className="composer-problem" role="alert">{shownProblem}</p>}
    </form>
  );
}

/** How much of the model's window the conversation takes: a 13px ring that fills, with its percent. */
function ContextRing({ used, limit }: { used: number; limit: number }) {
  const share = Math.min(1, Math.max(0, used / limit));
  const percent = Math.round(share * 100);
  const r = 5;
  const around = 2 * Math.PI * r;
  return (
    <span className="context-ring" role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      title={`Context used: ${percent}% (about ${used.toLocaleString()} of ${limit.toLocaleString()} tokens). Mobius summarises older messages when it fills.`}>
      <svg viewBox="0 0 13 13" width="13" height="13" aria-hidden="true">
        <circle cx="6.5" cy="6.5" r={r} className="context-ring-track" />
        <circle cx="6.5" cy="6.5" r={r} className="context-ring-fill" strokeDasharray={`${share * around} ${around}`} transform="rotate(-90 6.5 6.5)" />
      </svg>
      <span className="context-ring-text">{percent}%</span>
    </span>
  );
}

/** The mark beside the chosen item of a menu, as macOS menus have. */
function Check({ on }: { on: boolean }) {
  return <svg className="popmenu-check" viewBox="0 0 12 12" aria-hidden="true">{on && <path d="M2.5 6.5 5 9l4.5-6" />}</svg>;
}
