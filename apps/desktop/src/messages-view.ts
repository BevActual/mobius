import type { ChatAccount, ChatChannel, ChatMessage, ChatService, ContextItem } from '@mobius/shared';
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
