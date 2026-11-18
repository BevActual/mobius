import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type ChatAccount, type ChatChannel, type ChatMessage } from '@mobius/shared';

export interface OpenChannel { account: string; channel: string; thread?: string }

/**
 * The Messages app's state: accounts, their channels, and the open channel's messages. Messages are read from the
 * services as they are shown; nothing is kept by Mobius beyond what the service gives back.
 */
export function useMessages(active = true) {
  const api = window.mobius.messages;
  const [accounts, setAccounts] = useState<ChatAccount[]>([]);
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [open, setOpen] = useState<OpenChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const openNow = useRef(open);
  openNow.current = open;

  const refresh = useCallback(async () => {
    if (!api) { setLoaded(true); return; }
    const got = await api.accounts();
    if (isNotesFailure(got)) { setMessage(got.message); setLoaded(true); return; }
    setAccounts(got);
    const lists = await Promise.all(got.filter((a) => a.status === 'ready').map((a) => api.channels(a.id)));
    setChannels(lists.flatMap((l) => (isNotesFailure(l) ? [] : l)));
    setLoaded(true);
  }, [api]);

  const read = useCallback(async (to: OpenChannel | null) => {
    if (!api || !to) { setMessages([]); return; }
    const got = await api.history(to.account, to.channel, { limit: 200, ...(to.thread ? { thread: to.thread } : {}) });
    const now = openNow.current;
    if (!now || now.account !== to.account || now.channel !== to.channel || now.thread !== to.thread) return;
    if (isNotesFailure(got)) { setMessage(got.message); return; }
    setMessage(null);
    setMessages(got);
    const last = got[got.length - 1];
    if (last && !to.thread) {
      void api.markRead(to.account, to.channel, last.id);
      setChannels((list) => list.map((c) => (c.account === to.account && c.id === to.channel ? { ...c, unread: 0, mentions: 0 } : c)));
    }
  }, [api]);

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  useEffect(() => { void read(open); }, [open, read]);
  useEffect(() => api?.onChanged((change) => {
    void refresh();
    const now = openNow.current;
    if (now && now.account === change.account && (!change.channel || change.channel === now.channel)) void read(now);
  }), [api, refresh, read]);

  const choose = useCallback((to: OpenChannel | null) => { setMessages([]); setOpen(to); }, []);

  /** Sends what the person wrote. Only ever called from the person's own Send. */
  const send = useCallback(async (text: string): Promise<boolean> => {
    const to = openNow.current;
    if (!api || !to || !text.trim()) return false;
    const sent = await api.send(to.account, to.channel, text.trim(), to.thread);
    if (isNotesFailure(sent)) { setMessage(sent.message); return false; }
    setMessages((list) => [...list, sent]);
    return true;
  }, [api]);

  const account = accounts.find((a) => a.id === open?.account) ?? null;
  const channel = channels.find((c) => c.account === open?.account && c.id === open?.channel) ?? null;
  return { available: api !== undefined, loaded, accounts, channels, open, account, channel, messages, message, choose, send, refresh };
}

export type MessagesState = ReturnType<typeof useMessages>;
