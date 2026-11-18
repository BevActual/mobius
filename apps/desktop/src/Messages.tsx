import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AppSidebar, PanelLayout, SidebarRow, SidebarSearch, SidebarSection, ToolbarControls, type PanelSpec } from './ui';
import { EmptyState } from './EmptyState';
import type { MessagesState } from './useMessages';
import { SERVICE_NAMES, catchUpAsk, channelGroups, channelLabel, chatItem, runs, unreadLabel } from './messages-view';
import { formatWith, timeLabel } from './dates';
import type { ChatMessage, ContextItem } from '@mobius/shared';
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
                  current={messages.open?.account === account.id && messages.open.channel === c.id}
                  onSelect={() => messages.choose({ account: account.id, channel: c.id })} />
              );
            })}
          </SidebarSection>
        );
      })}
    </AppSidebar>
  );
}

/** Messages by sender, oldest first, kept scrolled to the newest; `onThread` opens a message's replies. */
function MessageLog({ label, list, onThread }: { label: string; list: readonly ChatMessage[]; onThread?: (id: string) => void }) {
  const log = useRef<HTMLDivElement>(null);
  const grouped = useMemo(() => runs(list), [list]);
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [list]);
  return (
    <div ref={log} className="messages-log" role="log" aria-label={label}>
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
              {onThread && (m.replies ?? 0) > 0 && (
                <button type="button" className="messages-thread" onClick={() => onThread(m.id)}>{m.replies} {m.replies === 1 ? 'reply' : 'replies'}</button>
              )}
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

/** A box to write in; Enter sends, Shift+Enter starts a new line. Only the person sends. */
function Compose({ label, reset, onSend }: { label: string; reset: string; onSend: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => { setDraft(''); }, [reset]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (sending || !draft.trim()) return;
    setSending(true);
    const ok = await onSend(draft);
    setSending(false);
    if (ok) setDraft('');
  };
  return (
    <form className="messages-compose" onSubmit={(e) => void send(e)}>
      <textarea aria-label={label} placeholder={label} rows={2} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      <button type="submit" className="btn primary" disabled={sending || !draft.trim()}>Send</button>
    </form>
  );
}

/** The open channel: its messages by sender, threads to open beside it, and a box to write in. Only the person sends. */
export function MessagesPage({ messages, onAsk, listPanels = [] }: { messages: MessagesState; /** Puts a message in Mobius's box with the channel attached, ready to send. */ onAsk?: (prompt: string, item: ContextItem) => void; /** The app's list, from the frame: its left panel. */ listPanels?: readonly PanelSpec[] }) {
  const { account, channel, open, thread } = messages;
  const empty = (title: string, line: string) => (
    <PanelLayout app="messages" panels={listPanels}>
      <section className="messages-page empty" aria-label="Messages"><EmptyState app="messages" title={title} line={line} /></section>
    </PanelLayout>
  );
  if (!messages.loaded) return <PanelLayout app="messages" panels={listPanels}><section className="messages-page" aria-label="Messages" /></PanelLayout>;
  if (messages.accounts.length === 0) return empty('No accounts yet', messages.available ? 'Add a Slack account in Settings to see your channels here.' : 'Slack, Discord and Telegram accounts are on their way. Your channels will show here.');
  if (!account || !channel) return empty('No channel open', 'Choose a channel or a person on the left.');
  const unread = channel.unread;
  const name = channelLabel(channel);
  const where = `${open?.account}/${open?.channel}`;
  const from = thread ? messages.messages.find((m) => m.id === thread) : undefined;
  // Thread (right dock, while one is open): the message it hangs from, its replies, and a box to reply in.
  const threadPanel: PanelSpec | null = thread ? { id: 'thread', name: 'Thread', dock: 'right', shown: true, onHide: () => messages.openThread(null), render: () => (
    <div className="messages-thread-panel">
      <MessageLog label={`Thread in ${name}`} list={from ? [from, ...messages.replies.filter((r) => r.id !== from.id)] : messages.replies} />
      <Compose label="Reply in thread" reset={`${where}/${thread}`} onSend={(text) => messages.send(text, true)} />
    </div>
  ) } : null;
  return (
    <PanelLayout app="messages" panels={threadPanel ? [...listPanels, threadPanel] : listPanels}>
    <section className="messages-page" aria-label={`Messages: ${name}`}>
      <ToolbarControls label="Messages">
        <span className="spacer" />
        {onAsk && (
          <button type="button" className="btn" title="Mobius sums up this channel and drafts replies for you to send" disabled={messages.messages.length === 0}
            onClick={() => onAsk(catchUpAsk(channel, unread), chatItem(account, channel, messages.messages))}>Catch me up</button>
        )}
      </ToolbarControls>
      <MessageLog label={name} list={messages.messages} onThread={messages.openThread} />
      {messages.message && <p className="tasks-message" role="alert">{messages.message}</p>}
      <Compose label={`Message ${name}`} reset={where} onSend={(text) => messages.send(text)} />
    </section>
    </PanelLayout>
  );
}
