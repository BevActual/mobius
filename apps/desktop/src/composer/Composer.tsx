import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { MAX_CONTEXT_ITEMS, MAX_CONTEXT_ITEM_CHARS, MAX_CONTEXT_TOTAL_CHARS, MAX_TYPED_CHARS, type AgentSettings, type ContextItem, type EffortChoice } from '@mobius/shared';
import { PopMenu } from './PopMenu';
import { useDictation } from './useDictation';

const EFFORTS: Array<{ id: EffortChoice; label: string }> = [
  { id: '', label: 'Default' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

type ModelList = { state: 'idle' | 'loading' } | { state: 'ready'; models: string[] } | { state: 'failed'; error: string };

export interface ComposerProps {
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
  onSend: (text: string, context: ContextItem[]) => void;
  onStop: () => void;
  /** The model on the server was changed from here. */
  onModelChanged: () => void;
  onOpenSettings: () => void;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const total = (items: ContextItem[]) => items.reduce((sum, item) => sum + item.text.length, 0);

export function Composer({ draft, onDraft, context, onContext, canType, busy, configured, coreReady, settings, effort, onEffort, onSend, onStop, onModelChanged, onOpenSettings, fieldRef }: ComposerProps) {
  const [problem, setProblem] = useState<string | null>(null);
  const [models, setModels] = useState<ModelList>({ state: 'idle' });
  const [adding, setAdding] = useState(false);
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
    onSend(draft, context);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
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

  const loadModels = () => {
    setModels({ state: 'loading' });
    void window.mobius.agent.models().then((result) => setModels(result.ok ? { state: 'ready', models: result.models } : { state: 'failed', error: result.error }));
  };
  const chooseModel = async (name: string, close: () => void) => {
    close();
    if (name === settings?.model) return;
    setProblem(null);
    const result = await window.mobius.agent.setModel(name);
    if (result.ok) onModelChanged();
    else setProblem(result.error);
  };

  const modelName = settings?.configured || settings?.model ? settings.model : '';
  const effortLabel = EFFORTS.find((e) => e.id === effort)?.label ?? 'Default';

  return (
    <form className="composer" onSubmit={submit} onKeyDown={onFormKeyDown} data-listening={listening || undefined}>
      {context.length > 0 && (
        <ul className="chips" aria-label="Attached to this message">
          {context.map((item, index) => (
            <li key={`${item.kind}-${index}-${item.title}`} className="chip" data-kind={item.kind} title={item.source}>
              <span className="chip-kind" aria-hidden="true">{item.kind === 'page' ? 'Page' : 'File'}</span>
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
        autoFocus
        placeholder={canType ? 'Message Mobius' : configured ? 'Starting up…' : coreReady ? 'Connect a model to start' : 'Starting up…'}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
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
                <p className="popmenu-note">Up to {MAX_CONTEXT_ITEMS} things, {MAX_CONTEXT_ITEM_CHARS / 1000}k characters each. The agent reads them as material, never as instructions.</p>
              </>
            )}
          </PopMenu>
          <PopMenu label="Model" className="pill" disabled={!configured || busy} onOpen={loadModels} title={modelName ? `Model: ${modelName}` : 'Model'} trigger={<><span className="pill-text">{modelName || 'Model'}</span><svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg></>}>
            {(close) => (
              <>
                {models.state === 'loading' && <p className="popmenu-note" role="status">Asking the server…</p>}
                {models.state === 'failed' && <p className="popmenu-note" role="alert">{models.error}</p>}
                {models.state === 'ready' && models.models.length === 0 && <p className="popmenu-note">The server did not list any models.</p>}
                {models.state === 'ready' && models.models.map((name) => (
                  <button key={name} type="button" role="menuitemradio" aria-checked={name === settings?.model} className="popmenu-item" onClick={() => void chooseModel(name, close)}>
                    <span>{name}</span>{name === settings?.model && <span className="popmenu-hint">In use</span>}
                  </button>
                ))}
                {models.state !== 'loading' && !(models.state === 'ready' && models.models.includes(settings?.model ?? '')) && settings?.model && (
                  <button type="button" role="menuitemradio" aria-checked="true" className="popmenu-item"><span>{settings.model}</span><span className="popmenu-hint">In use</span></button>
                )}
                <button type="button" role="menuitem" className="popmenu-item popmenu-link" onClick={() => { close(); onOpenSettings(); }}>Model settings…</button>
              </>
            )}
          </PopMenu>
          <PopMenu label="Effort" className="pill" disabled={busy} title={`Effort: ${effortLabel}. How hard the model thinks.`} trigger={<><span className="pill-text">Effort{effort ? `: ${effortLabel}` : ''}</span><svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg></>}>
            {(close) => (
              <>
                {EFFORTS.map((option) => (
                  <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === effort} className="popmenu-item" onClick={() => { close(); onEffort(option.id); }}>
                    <span>{option.label}</span>{option.id === effort && <span className="popmenu-hint">Chosen</span>}
                  </button>
                ))}
                <p className="popmenu-note">How hard the model is asked to think. Only models that can reason use this.</p>
              </>
            )}
          </PopMenu>
        </div>
        <div className="composer-actions">
          {dictation.state === 'recording' && <span className="rec" role="status" aria-label={`Recording ${clock(dictation.seconds)}`}><span className="rec-dot" aria-hidden="true" />{clock(dictation.seconds)}</span>}
          {dictation.state === 'transcribing' && <span className="rec" role="status">Turning speech into text…</span>}
          <button type="button" className="round ghost" data-recording={dictation.state === 'recording' || undefined} aria-label={dictation.state === 'recording' ? 'Stop dictation' : 'Dictate'} title={dictation.state === 'recording' ? 'Stop and insert the words (Esc cancels)' : 'Dictate'} disabled={!canType || busy || dictation.state === 'transcribing'} onClick={dictation.toggle}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7.5" y="3" width="5" height="9" rx="2.5" /><path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17" /></svg>
          </button>
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
