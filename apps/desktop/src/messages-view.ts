import type { ChatAccount, ChatChannel, ChatMessage, ChatService, ContextItem, SpaceStatus } from '@mobius/shared';
import { MAX_CONTEXT_ITEM_CHARS } from '@mobius/shared';

export const SERVICE_NAMES: Record<ChatService, string> = { slack: 'Slack', matrix: 'Matrix', teams: 'Teams', discord: 'Discord', telegram: 'Telegram' };

/** How a channel is named in lists and headings: `#general` for a channel, the person's name for a direct message. */
export const channelLabel = (c: Pick<ChatChannel, 'name' | 'kind'>): string => (c.kind === 'channel' ? `#${c.name.replace(/^#/, '')}` : c.name);

/** Each account with its channels: channels first, then groups and direct messages, the most recent first in each. */
export function channelGroups(accounts: readonly ChatAccount[], channels: readonly ChatChannel[]): { account: ChatAccount; channels: ChatChannel[] }[] {
  const order = { channel: 0, group: 1, direct: 2 } as const;
  return accounts.map((account) => ({
    account,
    channels: channels
      .filter((c) => c.account === account.id)
      .sort((a, b) => order[a.kind] - order[b.kind] || (b.last ?? 0) - (a.last ?? 0) || a.name.localeCompare(b.name)),
  }));
}

/** One sender's messages close together are shown as one run, under one name. */
export interface Run { author: ChatMessage['author']; at: number; messages: ChatMessage[] }
export function runs(messages: readonly ChatMessage[], gapMs = 5 * 60_000): Run[] {
  const out: Run[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    const lastAt = last?.messages[last.messages.length - 1]?.at ?? 0;
    if (last && last.author.id === m.author.id && m.at - lastAt <= gapMs && sameDay(lastAt, m.at)) last.messages.push(m);
    else out.push({ author: m.author, at: m.at, messages: [m] });
  }
  return out;
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const ymd = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * The open channel as an attachment for "Catch me up". It is other people's words, so it goes as a file the agent treats
 * as data (as an email does), never as part of what the person typed. The newest messages are kept when it is long.
 */
export function chatItem(account: ChatAccount, channel: ChatChannel, messages: readonly ChatMessage[]): ContextItem {
  let day = '';
  const lines: string[] = [];
  for (const m of messages) {
    const d = ymd(m.at);
    if (d !== day) { day = d; lines.push(`## ${d}`); }
    const who = m.author.me ? `${m.author.name} (me)` : m.author.name;
    lines.push(`[${hhmm(m.at)}] ${who}${m.thread ? ' (in a thread)' : ''}: ${m.text.replace(/\s*\n\s*/g, ' ').trim()}`);
  }
  let text = lines.join('\n');
  if (text.length > MAX_CONTEXT_ITEM_CHARS) text = text.slice(text.length - MAX_CONTEXT_ITEM_CHARS).replace(/^[^\n]*\n/, '');
  return { kind: 'file', title: `${channelLabel(channel)} · ${SERVICE_NAMES[account.service]}`, source: `messages:${account.id}/${channel.id}`, text };
}

/** What "Catch me up" asks: a few lines, and replies drafted for the person to send. Mobius never sends. */
export function catchUpAsk(channel: ChatChannel, unread: number): string {
  const what = unread > 0 ? `the ${unread} message${unread === 1 ? '' : 's'} I haven't read` : 'the recent messages';
  return `Catch me up on ${channelLabel(channel)}: in at most five lines, what was said and decided in ${what} (attached). `
    + 'Then draft a short reply to anything that asks me something or waits on me, each under its own heading. Do not send anything; I will.';
}

/** The words for a channel's unread count in its row: mentions first, as the services show them. */
export const unreadLabel = (c: Pick<ChatChannel, 'unread' | 'mentions'>): string => (c.mentions > 0 ? `${c.mentions} mention${c.mentions === 1 ? '' : 's'}` : c.unread > 0 ? `${c.unread} unread` : '');

/** The person's own name in a conversation, from a message they wrote there; null when they have written none. */
export const myName = (messages: readonly ChatMessage[]): string | null => messages.find((m) => m.author.me)?.author.name ?? null;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A message's text cut at each mention of the person (@ and their full or first name, or @here and @channel, which
 * reach everyone), so those can show as chips. `mine` says whether any part is one.
 */
export function mentionParts(text: string, me: string | null): { parts: { text: string; me?: true }[]; mine: boolean } {
  const names = ['here', 'channel', 'everyone'];
  if (me) { names.unshift(me); const first = me.split(/\s+/)[0]; if (first && first !== me) names.push(first); }
  const re = new RegExp(`@(?:${names.map(escapeRe).join('|')})(?![\\w-])`, 'gi');
  const parts: { text: string; me?: true }[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ text: m[0], me: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return { parts, mine: parts.some((p) => p.me) };
}

/** The id of the first message not yet read when the conversation opened, for the "New" line; null when none were. */
export function firstUnread(messages: readonly ChatMessage[], unread: number): string | null {
  const theirs = messages.filter((m) => !m.author.me);
  if (unread <= 0 || theirs.length === 0) return null;
  return theirs[Math.max(0, theirs.length - unread)]!.id;
}

/** "Last reply 2 h ago" style words for when a thread was last answered. */
export function lastReplyLabel(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 1) return 'Last reply just now';
  if (min < 60) return `Last reply ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `Last reply ${h} h ago`;
  const d = Math.round(h / 24);
  return `Last reply ${d} day${d === 1 ? '' : 's'} ago`;
}

/** A message's reactions with the person's own `emoji` added (`on`) or taken back. */
export function toggled(list: NonNullable<ChatMessage['reactions']>, emoji: string, on: boolean): NonNullable<ChatMessage['reactions']> {
  const had = list.find((r) => r.emoji === emoji);
  if (on) return had ? list.map((r) => (r.emoji === emoji ? { ...r, count: r.count + (r.mine ? 0 : 1), mine: true } : r)) : [...list, { emoji, count: 1, mine: true }];
  if (!had || !had.mine) return list;
  return had.count <= 1 ? list.filter((r) => r.emoji !== emoji) : list.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r));
}

/** The local Mobius space's own account (made by Mobius the first time the space opens). */
export const isSpaceAccount = (a: Pick<ChatAccount, 'service' | 'name'>): boolean => a.service === 'matrix' && a.name === 'Mobius space';

/** The rail down the left of Conversations, as in Discord: All, your own Mobius space, then each account. */
export type RailEntry = { id: 'all'; label: string } | { id: 'space'; label: string } | { id: string; label: string; account: ChatAccount };
export function railEntries(accounts: readonly ChatAccount[]): RailEntry[] {
  return [
    { id: 'all', label: 'All conversations' },
    { id: 'space', label: 'Mobius space' },
    ...accounts.filter((a) => !isSpaceAccount(a)).map((a): RailEntry => ({ id: a.id, label: `${a.name} · ${SERVICE_NAMES[a.service] ?? a.service}`, account: a })),
  ];
}
/** The accounts whose conversations show for the rail's choice; a choice that is gone falls back to All. */
export function accountsFor(rail: string, accounts: readonly ChatAccount[]): ChatAccount[] {
  if (rail === 'space') return accounts.filter(isSpaceAccount);
  const one = accounts.filter((a) => a.id === rail);
  return one.length > 0 ? one : [...accounts];
}

/** What the space is doing, in words, while it is not yet running; null once it is. */
export function spaceStatusText(s: SpaceStatus): string | null {
  const mb = (n: number) => Math.max(1, Math.round(n / 1_000_000));
  switch (s.state) {
    case 'running': return null;
    case 'idle': return 'Opening your Mobius space…';
    case 'downloading': return s.total > 0 ? `Getting your Mobius space ready, the first time only: ${mb(s.done)} of ${mb(s.total)} MB` : 'Getting your Mobius space ready, the first time only…';
    case 'starting': return 'Starting your Mobius space…';
    case 'failed': return s.offline ? 'Mobius couldn’t download your space. Check your connection, then try again.' : s.message;
  }
}
