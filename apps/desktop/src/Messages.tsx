import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AppSidebar, SidebarRow, SidebarSearch, SidebarSection, ToolbarControls } from './ui';
import { EmptyState } from './EmptyState';
import type { MessagesState } from './useMessages';
import { SERVICE_NAMES, catchUpAsk, channelGroups, channelLabel, chatItem, runs, unreadLabel } from './messages-view';
import { formatWith, timeLabel } from './dates';
import type { ContextItem } from '@mobius/shared';
import './messages.css';

/** The Messages list panel: each account's channels and direct messages, unread ones marked. */
export function MessagesSidebar({ messages, pin }: { messages: MessagesState; pin?: ReactNode }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = channelGroups(messages.accounts, messages.channels);
  return (
    <AppSidebar label="Messages sidebar">
      <SidebarSearch label="Find a channel" value={query} onChange={setQuery} />
      {groups.length === 0 && <p className="side-empty">{messages.available ? 'No accounts yet.' : 'Accounts are not set up yet.'}</p>}
      {groups.map(({ account, channels }, i) => {
        const shown = channels.filter((c) => !q || c.name.toLowerCase().includes(q));
        if (q && shown.length === 0) return null;
        return (
          <SidebarSection key={account.id} title={`${account.name} · ${SERVICE_NAMES[account.service]}`} {...(i === 0 && pin ? { action: pin } : {})}>
            {account.status !== 'ready' && <li className="side-empty">{account.message ?? (account.status === 'signed-out' ? 'Signed out. Sign in again in Settings.' : 'This account cannot be reached.')}</li>}
            {shown.map((c) => {
              const count = c.mentions || c.unread;
              return (
                <SidebarRow key={c.id} label={channelLabel(c)} {...(count ? { count } : {})} title={unreadLabel(c) || channelLabel(c)}
                  current={messages.open?.account === account.id && messages.open.channel === c.id && !messages.open.thread}
                  onSelect={() => messages.choose({ account: account.id, channel: c.id })} />
              );
            })}
          </SidebarSection>
        );
      })}
    </AppSidebar>
  );
}

/** The open channel: its messages by sender, threads to open, and a box to write in. Only the person sends. */
export function MessagesPage({ messages, onAsk }: { messages: MessagesState; /** Puts a message in Mobius's box with the channel attached, ready to send. */ onAsk?: (prompt: string, item: ContextItem) => void }) {
  const { account, channel, open } = messages;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const grouped = useMemo(() => runs(messages.messages), [messages.messages]);
  useEffect(() => { setDraft(''); }, [open?.account, open?.channel, open?.thread]);
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.messages]);

  if (!messages.loaded) return <section className="messages-page" aria-label="Messages" />;
  if (messages.accounts.length === 0) {
    return (
      <section className="messages-page empty" aria-label="Messages">
        <EmptyState app="messages" title="No accounts yet" line={messages.available ? 'Add Slack, Discord or Telegram in Settings to see your channels here.' : 'Slack, Discord and Telegram accounts are on their way. Your channels will show here.'} />
      </section>
    );
  }
  if (!account || !channel) {
    return (
      <section className="messages-page empty" aria-label="Messages">
        <EmptyState app="messages" title="No channel open" line="Choose a channel or a person on the left." />
      </section>
    );
  }
  const unread = channel.unread;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (sending || !draft.trim()) return;
    setSending(true);
    const ok = await messages.send(draft);
    setSending(false);
    if (ok) setDraft('');
  };
  const name = channelLabel(channel);
  return (
    <section className="messages-page" aria-label={`Messages: ${name}`}>
      <ToolbarControls label="Messages">
        {open?.thread && <button type="button" className="btn" onClick={() => messages.choose({ account: account.id, channel: channel.id })}>Back to {name}</button>}
        <span className="spacer" />
        {onAsk && (
          <button type="button" className="btn" title="Mobius sums up this channel and drafts replies for you to send" disabled={messages.messages.length === 0}
            onClick={() => onAsk(catchUpAsk(channel, unread), chatItem(account, channel, messages.messages))}>Catch me up</button>
        )}
      </ToolbarControls>
      <div ref={log} className="messages-log" role="log" aria-label={open?.thread ? `Thread in ${name}` : name}>
        {grouped.length === 0 && <p className="messages-none">No messages here yet.</p>}
        {grouped.map((run) => (
          <article key={run.messages[0]!.id} className="messages-run" data-me={run.author.me || undefined}>
            <header><strong>{run.author.name}</strong> <time dateTime={new Date(run.at).toISOString()}>{formatWith(new Date(run.at), { weekday: 'short', day: 'numeric', month: 'short' })}, {timeLabel(new Date(run.at))}</time></header>
            {run.messages.map((m) => (
              <div key={m.id} className="messages-one">
                <p>{m.text}{m.edited && <span className="messages-edited"> (edited)</span>}</p>
                {(m.reactions?.length ?? 0) > 0 && (
                  <ul className="messages-reactions" aria-label="Reactions">{m.reactions!.map((r) => <li key={r.emoji} data-mine={r.mine || undefined}>{r.emoji} {r.count}</li>)}</ul>
                )}
                {!open?.thread && (m.replies ?? 0) > 0 && (
                  <button type="button" className="messages-thread" onClick={() => messages.choose({ account: account.id, channel: channel.id, thread: m.id })}>{m.replies} {m.replies === 1 ? 'reply' : 'replies'}</button>
                )}
              </div>
            ))}
          </article>
        ))}
      </div>
      {messages.message && <p className="tasks-message" role="alert">{messages.message}</p>}
      <form className="messages-compose" onSubmit={(e) => void send(e)}>
        <textarea aria-label={open?.thread ? 'Reply in thread' : `Message ${name}`} placeholder={open?.thread ? 'Reply in thread' : `Message ${name}`} rows={2} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <button type="submit" className="btn primary" disabled={sending || !draft.trim()}>Send</button>
      </form>
    </section>
  );
}
