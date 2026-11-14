import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { MAIN_BOT_ID, botOfConversation, conversationIdFor, splitContext, type ContextItem, type ConversationInfo, type CoreStatus, type Duration } from '@mobius/shared';
import { preferencesSettled } from './usePreferences';
import { findToolArguments, findToolResult, initialConversation, reduce, type ConversationState } from './conversation';

const STORAGE_KEY = 'mobius.conversation';
const newId = (bot: string = MAIN_BOT_ID) => conversationIdFor(bot, crypto.randomUUID());

export interface Conversation {
  state: ConversationState;
  id: string;
  list: ConversationInfo[];
  /** `plan` asks for a plan only: the agent proposes steps and nothing runs until they are started. */
  send(text: string, context?: ContextItem[], options?: { plan?: boolean; ask?: boolean; images?: string[] }): Promise<void>;
  stop(): void;
  /** Take over the running task, and hand it back. Resolve with what went wrong, or null. */
  takeOver(): Promise<string | null>;
  handBack(): Promise<string | null>;
  /** Resolves with an explanation when the answer could not be used, otherwise null. */
  answer(requestId: number, approve: boolean, duration: Duration): Promise<string | null>;
  /** Answer a question the model asked. Resolves with an explanation when it could not be sent, otherwise null. */
  reply(callId: string, text: string): Promise<string | null>;
  /** Take back the last exchange and send the same message again. */
  retry(): Promise<string | null>;
  /** Take back the last exchange and give back the message, to be changed. Resolves null when it could not be done. */
  edit(): Promise<{ text: string } | { error: string }>;
  /** What a tool call returned, read from the saved conversation. */
  toolDetails(callId: string): Promise<{ result: ReturnType<typeof findToolResult>; arguments: unknown }>;
  /** A new, empty conversation, for the bot you are talking to or the one named. */
  newConversation(bot?: string): void;
  /** Switch to a new, empty conversation even before the open one has loaded. For start-up. */
  startFresh(bot?: string): void;
  select(id: string): void;
  /** Resolves with an explanation when it could not be deleted, otherwise null. */
  remove(id: string): Promise<string | null>;
  refresh(): Promise<void>;
  /** The app showing, set as it changes: a message counts its tokens there (Settings, Usage). */
  sentFrom: { current: string | undefined };
}

export function useConversation(coreStatus: CoreStatus, knownBots: readonly string[] = [MAIN_BOT_ID]): Conversation {
  const knownRef = useRef(knownBots);
  knownRef.current = knownBots;
  const appRef = useRef<string | undefined>(undefined);
  const botRef = useRef<string>(MAIN_BOT_ID);
  const [id, setId] = useState<string>(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && /^[A-Za-z0-9_-]{1,64}$/.test(stored) ? stored : newId();
  });
  const [state, dispatch] = useReducer(reduce, id, initialConversation);
  const [list, setList] = useState<ConversationInfo[]>([]);
  const busy = useRef(false);
  busy.current = state.busy;
  const active = useRef(id);
  active.current = id;
  /** The conversation whose request is on its way to the core, and one Stop was pressed for meanwhile. */
  const sending = useRef<string | null>(null);
  const stopWanted = useRef<string | null>(null);
  const stateNow = useRef(state);
  stateNow.current = state;
  botRef.current = botOfConversation(id, knownBots);

  const refresh = useCallback(async () => {
    setList(await window.mobius.agent.conversations());
  }, []);

  useEffect(
    () =>
      window.mobius.agent.onNotification((notification) => {
        dispatch({ type: 'notification', notification });
        if (notification.method === 'agent.event' && ['done', 'failed', 'cancelled', 'needs_approval', 'tool_result', 'question'].includes(notification.params.event.kind)) void refresh();
        // A turn started elsewhere (a schedule, Little Mobius) was opened while it ran, before its request was saved:
        // once it ends, read it again so the request shows above the reply.
        const ended = notification.method === 'agent.event' && ['done', 'failed', 'cancelled'].includes(notification.params.event.kind);
        if (ended && notification.params.conversation === active.current && !stateNow.current.items.some((item) => item.kind === 'user')) {
          const id = active.current;
          void window.mobius.agent.history(id).then((messages) => { if (active.current === id) dispatch({ type: 'loaded', messages, conversation: id }); });
        }
      }),
    [refresh],
  );

  // Bring back what was said, and anything still waiting for a person, whenever a conversation is opened.
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, id);
    let live = true;
    void Promise.all([window.mobius.agent.history(id), window.mobius.agent.waiting(id), window.mobius.agent.question(id), window.mobius.agent.control?.(id).catch(() => null) ?? Promise.resolve(null), refresh()]).then(([messages, requests, question, control]) => {
      if (!live) return;
      // On a busy computer this can come back after a whole turn has been sent and answered here; it is then older than
      // what is shown, and the reducer leaves it (it once took the reply and the review strip away).
      dispatch({ type: 'loaded', messages, onOpen: true, conversation: id });
      dispatch({ type: 'pending', requests });
      dispatch({ type: 'question-open', question });
      if (control?.theirs && typeof control.step === 'number') dispatch({ type: 'control', control: { step: control.step, ...(typeof control.of === 'number' ? { of: control.of } : {}) } });
    });
    return () => {
      live = false;
    };
  }, [id, refresh]);

  // A restarting core has lost the turn that was running.
  useEffect(() => {
    if (coreStatus === 'restarting' && busy.current) {
      dispatch({ type: 'reset-busy' });
      dispatch({ type: 'send-failed', message: 'Mobius restarted its core, so that request was lost. Ask again.' });
    }
  }, [coreStatus]);

  const send = useCallback(
    async (text: string, context: ContextItem[] = [], options: { plan?: boolean; ask?: boolean; images?: string[] } = {}) => {
      const images = options.images ?? [];
      dispatch({ type: 'sent', text, context, images });
      const id = active.current;
      sending.current = id;
      const extra = { ...(options.plan ? { plan: true } : {}), ...(options.ask ? { ask: true } : {}), ...(images.length > 0 ? { images } : {}), ...(appRef.current ? { app: appRef.current } : {}) };
      // A choice made just before sending (the effort, say) reaches the core first.
      await preferencesSettled();
      const result = await window.mobius.agent.send(id, text, context, Object.keys(extra).length > 0 ? extra : undefined);
      sending.current = null;
      if (!result.ok) dispatch({ type: 'send-failed', message: result.error });
      // Stop was pressed before the core had the request: the cancel could have arrived first and been lost.
      else if (stopWanted.current === id) void window.mobius.agent.cancel(id);
      stopWanted.current = null;
      void refresh();
    },
    [refresh],
  );

  const stop = useCallback(() => {
    if (sending.current === active.current) stopWanted.current = active.current;
    void window.mobius.agent.cancel(active.current);
  }, []);

  const takeOver = useCallback(async () => {
    const result = await window.mobius.agent.takeOver?.(active.current).catch(() => null);
    return result?.ok ? null : result && !result.ok ? result.error : 'Taking over is not available here.';
  }, []);
  const handBack = useCallback(async () => {
    const result = await window.mobius.agent.handBack?.(active.current).catch(() => null);
    return result?.ok ? null : result && !result.ok ? result.error : 'Handing back is not available here.';
  }, []);

  const answer = useCallback(async (requestId: number, approve: boolean, duration: Duration) => {
    // Show the answer straight away: the news that follows it can arrive before the reply to this call does.
    dispatch({ type: 'answered', requestId, approve });
    const result = await window.mobius.agent.resolve(requestId, approve, duration);
    if (result.ok) return null;
    dispatch({ type: 'answer-failed', requestId });
    return result.error;
  }, []);

  const reply = useCallback(async (callId: string, text: string) => {
    dispatch({ type: 'question-answered', callId, text });
    const result = await window.mobius.agent.answer(active.current, callId, text);
    if (result.ok) return null;
    dispatch({ type: 'question-failed', callId });
    return result.error;
  }, []);

  const rewind = useCallback(async (): Promise<{ text: string } | { error: string }> => {
    const result = await window.mobius.agent.rewind(active.current);
    if (!result.ok) return { error: result.error };
    dispatch({ type: 'rewound' });
    void refresh();
    return { text: result.text };
  }, [refresh]);

  const edit = rewind;

  const retry = useCallback(async (): Promise<string | null> => {
    const back = await rewind();
    if ('error' in back) return back.error;
    const parts = splitContext(back.text);
    await send(parts.text, parts.items);
    return null;
  }, [rewind, send]);

  const toolDetails = useCallback(async (callId: string) => {
    const messages = await window.mobius.agent.history(active.current);
    return { result: findToolResult(messages, callId), arguments: findToolArguments(messages, callId) };
  }, []);

  const select = useCallback((next: string) => {
    if (next === active.current) return;
    dispatch({ type: 'switch', conversation: next });
    setId(next);
  }, []);

  const newConversation = useCallback((forBot?: string) => {
    const target = typeof forBot === 'string' ? forBot : botRef.current;
    // An empty conversation of the same bot is already a fresh start.
    if (state.items.length === 0 && !state.busy && target === botRef.current) return;
    const next = newId(target);
    dispatch({ type: 'switch', conversation: next });
    setId(next);
  }, [state.items.length, state.busy]);

  const startFresh = useCallback((forBot?: string) => {
    const next = newId(forBot ?? botRef.current);
    dispatch({ type: 'switch', conversation: next });
    setId(next);
  }, []);

  const remove = useCallback(
    async (target: string) => {
      const result = await window.mobius.agent.deleteConversation(target);
      if (!result.ok) return result.error;
      const rest = (await window.mobius.agent.conversations()).filter((c) => c.id !== target);
      setList(rest);
      if (target === active.current) {
        const next = rest.find((c) => botOfConversation(c.id, knownRef.current) === botRef.current)?.id ?? newId(botRef.current);
        dispatch({ type: 'switch', conversation: next });
        setId(next);
      }
      return null;
    },
    [],
  );

  return { state, id, list, send, stop, takeOver, handBack, answer, reply, retry, edit, toolDetails, newConversation, startFresh, select, remove, refresh, sentFrom: appRef };
}
