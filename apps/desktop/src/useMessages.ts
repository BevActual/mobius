import { useCallback, useEffect, useRef, useState } from 'react';
import { channelGroups, toggled } from './messages-view';
import { isNotesFailure, type ChatAccount, type ChatChannel, type ChatMessage } from '@mobius/shared';

export interface OpenChannel { account: string; channel: string; thread?: string }

/** The conversation last open, so Messages opens on it again rather than on an empty page. Only its ids are kept. */
const LAST_KEY = 'mobius.messages.last';
const readLast = (): OpenChannel | null => {
  try { const v = JSON.parse(window.localStorage.getItem(LAST_KEY) ?? 'null') as unknown; return v && typeof v === 'object' && typeof (v as OpenChannel).account === 'string' && typeof (v as OpenChannel).channel === 'string' ? { account: (v as OpenChannel).account, channel: (v as OpenChannel).channel } : null; } catch { return null; }
};
const keepLast = (to: OpenChannel | null) => { try { if (to) window.localStorage.setItem(LAST_KEY, JSON.stringify({ account: to.account, channel: to.channel })); } catch { /* not kept */ } };

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
  // The open thread, beside its channel: the message it hangs from and its replies.
  const [thread, setThread] = useState<string | null>(null);
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  const threadNow = useRef(thread);
  threadNow.current = thread;
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const openNow = useRef(open);
  openNow.current = open;
  const messagesNow = useRef(messages);
  messagesNow.current = messages;
  const channelsNow = useRef(channels);
  channelsNow.current = channels;
  // How many messages were unread when the conversation was opened: reading it marks them read at once, but the
  // "New" line and Catch me up still need to know where the unread ones began.
  const [unreadAtOpen, setUnreadAtOpen] = useState(0);
  const counted = useRef('');

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
    const key = `${to.account}/${to.channel}`;
    if (counted.current !== key) {
      counted.current = key;
      setUnreadAtOpen(channelsNow.current.find((c) => c.account === to.account && c.id === to.channel)?.unread ?? 0);
    }
    const last = got[got.length - 1];
    if (last && !to.thread) {
      void api.markRead(to.account, to.channel, last.id);
      setChannels((list) => list.map((c) => (c.account === to.account && c.id === to.channel ? { ...c, unread: 0, mentions: 0 } : c)));
    }
  }, [api]);

  const readThread = useCallback(async (to: OpenChannel | null, id: string | null) => {
    if (!api || !to || !id) { setReplies([]); return; }
    const got = await api.history(to.account, to.channel, { limit: 200, thread: id });
    const now = openNow.current;
    if (!now || now.account !== to.account || now.channel !== to.channel || threadNow.current !== id) return;
    if (isNotesFailure(got)) { setMessage(got.message); return; }
    setReplies(got);
  }, [api]);

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  // Once the channels are in, the first conversation with something unread opens, in the list's order; failing that,
  // the one last open, if it is still there.
  const restored = useRef(false);
  useEffect(() => {
    if (!active || !loaded || restored.current || openNow.current) return;
    restored.current = true;
    const unread = channelGroups(accounts, channels).flatMap((g) => g.channels).find((c) => c.unread > 0 && !c.encrypted);
    const last = readLast();
    if (unread) setOpen({ account: unread.account, channel: unread.id });
    else if (last && channels.some((c) => c.account === last.account && c.id === last.channel)) setOpen(last);
  }, [active, loaded, accounts, channels]);
  useEffect(() => { void read(open); }, [open, read]);
  useEffect(() => { void readThread(openNow.current, thread); }, [open, thread, readThread]);
  useEffect(() => api?.onChanged((change) => {
    void refresh();
    const now = openNow.current;
    if (now && now.account === change.account && (!change.channel || change.channel === now.channel)) { void read(now); void readThread(now, threadNow.current); }
  }), [api, refresh, read, readThread]);

  /** Opens a channel; with `thread`, that thread opens beside it. */
  const choose = useCallback((to: OpenChannel | null) => {
    const same = to && openNow.current && to.account === openNow.current.account && to.channel === openNow.current.channel;
    if (!same) { setMessages([]); setUnreadAtOpen(0); counted.current = ''; setOpen(to ? { account: to.account, channel: to.channel } : null); }
    restored.current = true;
    keepLast(to);
    setReplies([]);
    setThread(to?.thread ?? null);
  }, []);
  const openThread = useCallback((id: string | null) => { setReplies([]); setThread(id); }, []);

  /** Sends what the person wrote. Only ever called from the person's own Send. */
  const send = useCallback(async (text: string, inThread = false): Promise<boolean> => {
    const to = openNow.current;
    const id = inThread ? threadNow.current : null;
    if (!api || !to || !text.trim() || (inThread && !id)) return false;
    const sent = await api.send(to.account, to.channel, text.trim(), id ?? undefined);
    if (isNotesFailure(sent)) { setMessage(sent.message); return false; }
    // The service may already have said it changed, and the channel been read again with it in: it is not added twice.
    const add = (list: ChatMessage[]) => (list.some((m) => m.id === sent.id) ? list : [...list, sent]);
    if (id) {
      setReplies(add);
      setMessages((list) => list.map((m) => (m.id === id ? { ...m, replies: (m.replies ?? 0) + 1 } : m)));
    } else setMessages(add);
    return true;
  }, [api]);

  /** Adds or takes back the person's own reaction, shown at once and put back if the service says no. */
  const react = useCallback(async (m: ChatMessage, emoji: string) => {
    const to = openNow.current;
    if (!api?.react || !to) return;
    const on = !(m.reactions ?? []).some((r) => r.emoji === emoji && r.mine);
    const flip = (list: ChatMessage[]) => list.map((x) => (x.id === m.id ? { ...x, reactions: toggled(x.reactions ?? [], emoji, on) } : x));
    const undo = (list: ChatMessage[]) => list.map((x) => (x.id === m.id ? { ...x, reactions: toggled(x.reactions ?? [], emoji, !on) } : x));
    setMessages(flip); setReplies(flip);
    const done = await api.react(to.account, to.channel, m.id, emoji, on);
    if (isNotesFailure(done)) { setMessages(undo); setReplies(undo); setMessage(done.message); }
  }, [api]);

  /** A link to one message, or null when the service gives none (the reason is shown). */
  const permalink = useCallback(async (m: ChatMessage): Promise<string | null> => {
    const to = openNow.current;
    if (!api?.permalink || !to) return null;
    const got = await api.permalink(to.account, to.channel, m.id);
    if (isNotesFailure(got)) { setMessage(got.message); return null; }
    return got.url;
  }, [api]);

  /** Unread from this message on. The conversation closes, since reading it would mark it read again. */
  const markUnread = useCallback(async (m: ChatMessage) => {
    const to = openNow.current;
    if (!api?.markUnread || !to) return;
    const done = await api.markUnread(to.account, to.channel, m.id);
    if (isNotesFailure(done)) { setMessage(done.message); return; }
    const after = messagesNow.current.filter((x) => x.at >= m.at).length;
    setChannels((list) => list.map((c) => (c.account === to.account && c.id === to.channel ? { ...c, unread: Math.max(c.unread, after) } : c)));
    setMessages([]); setUnreadAtOpen(0); counted.current = ''; setReplies([]); setThread(null); setOpen(null);
  }, [api]);

  const account = accounts.find((a) => a.id === open?.account) ?? null;
  const channel = channels.find((c) => c.account === open?.account && c.id === open?.channel) ?? null;
  // Reacting and marking unread are Slack's; a link to a message, Slack's and Matrix's.
  const can = {
    react: api?.react !== undefined && account?.service === 'slack',
    markUnread: api?.markUnread !== undefined && account?.service === 'slack',
    link: api?.permalink !== undefined && (account?.service === 'slack' || account?.service === 'matrix'),
  };
  return { available: api !== undefined, loaded, accounts, channels, open, account, channel, messages, message, unreadAtOpen, choose, send, refresh, thread, replies, openThread, react, permalink, markUnread, can };
}

export type MessagesState = ReturnType<typeof useMessages>;
