import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { AppSidebar, Avatar, Menu, PanelLayout, Popover, SidebarRow, SidebarSearch, SidebarSection, type MenuEntry, type PanelSpec } from './ui';
import { EmptyState } from './EmptyState';
import type { MessagesState } from './useMessages';
import { SERVICE_NAMES, accountsFor, channelGroups, isSpaceAccount, railEntries, spaceSizeText, spaceStatusText, type RailEntry, channelLabel, firstUnread, lastReplyLabel, mentionParts, myName, runs, unreadLabel } from './messages-view';
import { dayLabel, nearDayLabel, timeLabel } from './dates';
import { isNotesFailure, type ChatMessage, type SpaceStatus } from '@mobius/shared';
import { MobiusMark } from './MobiusMark';
import { siteHue } from './browser-spaces';
import { useSpace } from './useSpace';
import { ContactPanel } from './ContactPanel';
import './messages.css';

/** A conversation's leading slot: a # for a channel, the person's initials for a direct message or group. */
function ConversationLead({ name, kind }: { name: string; kind: 'channel' | 'direct' | 'group' }) {
  return <span className="msg-lead" aria-hidden="true">{kind !== 'direct' ? <svg viewBox="0 0 16 16"><path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M3 6h10.5M2.5 10H13" /></svg> : <Avatar name={name} size="chip" />}</span>;
}

const RAIL_KEY = 'mobius.messages.rail';
const readRail = (): string => { try { return localStorage.getItem(RAIL_KEY) ?? 'all'; } catch { return 'all'; } };
// The rail's choice, shared by the list and the middle panel (which shows the space while it is set up).
let railNow = readRail();
const railListeners = new Set<() => void>();
function setRailChoice(id: string) {
  railNow = id;
  try { localStorage.setItem(RAIL_KEY, id); } catch { /* kept for this session only */ }
  railListeners.forEach((l) => l());
}
/** The Messages rail's choice: 'all', 'space', or an account's id. */
export const useRailChoice = (): string => useSyncExternalStore((l) => { railListeners.add(l); return () => { railListeners.delete(l); }; }, () => railNow);

/** A rail entry's mark: the Mobius mark for your own space, stacked inboxes for All, the account's initial otherwise. */
function RailMark({ entry }: { entry: RailEntry }) {
  if (entry.id === 'space') return <MobiusMark size={18} />;
  if (entry.id === 'all') return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8.5h12v7.5H4zM4 12.5h3.5l1 1.5h3l1-1.5H16M5.5 6h9M7 3.5h6" /></svg>;
  return <span className="msg-rail-chip" data-hue={siteHue(entry.label)} aria-hidden="true">{entry.label.slice(0, 1).toUpperCase()}</span>;
}

/** The space while it is not running yet: what it is doing (the first download with its size), or why not and Try again. */
function SpaceStatusRow({ status, onRetry, className = 'msg-space-status' }: { status: SpaceStatus; onRetry: () => void; className?: string }) {
  const text = spaceStatusText(status);
  if (!text) return null;
  const failed = status.state === 'failed';
  const size = spaceSizeText(status);
  return (
    <div className={className} role={failed ? 'alert' : 'status'}>
      <p>{text}</p>
      {status.state === 'downloading' && status.total > 0 && <progress aria-label="Downloading your Mobius space" max={status.total} value={status.done} />}
      {size && <p className="msg-space-size">{size}</p>}
      {failed && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/**
 * The Messages list panel, Conversations: a rail down the left (All, your own Mobius space, then each account, as in
 * Discord), and beside it the chosen one's channels and people, unread ones in medium weight. Choosing the Mobius space
 * starts it, and the first time downloads it, with its progress shown here.
 */
export function MessagesSidebar({ messages, pin }: { messages: MessagesState; pin?: ReactNode }) {
  const [query, setQuery] = useState('');
  const rail = useRailChoice();
  const space = useSpace();
  const entries = railEntries(messages.accounts);
  const chosen = entries.some((e) => e.id === rail) ? rail : 'all';
  // Choosing the space (now, or on coming back to it) starts it; never before that.
  const openSpace = space.open;
  useEffect(() => { if (chosen === 'space') openSpace(); }, [chosen, openSpace]);
  const q = query.trim().toLowerCase();
  const groups = channelGroups(accountsFor(chosen, messages.accounts), messages.channels);
  const spaceWaiting = chosen === 'space' && (space.status.state !== 'running' || groups.length === 0);
  return (
    <AppSidebar label="Conversations" className="messages-side">
      <div className="msg-rail-wrap">
        <nav className="msg-rail" aria-label="Accounts">
          {entries.map((e) => (
            <button key={e.id} type="button" className="msg-rail-entry" aria-label={e.label} title={e.label} aria-pressed={chosen === e.id} onClick={() => setRailChoice(e.id)}>
              <RailMark entry={e} />
            </button>
          ))}
        </nav>
        <div className="msg-rail-list">
          <SidebarSearch label="Find a conversation" value={query} onChange={setQuery} />
          {chosen === 'space' && !space.available && <p className="side-empty">Your Mobius space runs in the desktop app.</p>}
          {chosen === 'space' && space.available && spaceWaiting && <p className="side-empty">{space.status.state === 'failed' ? 'Your Mobius space couldn’t start.' : 'Setting up your Mobius space…'}</p>}
          {chosen !== 'space' && groups.length === 0 && <p className="side-empty">{messages.available ? 'No accounts yet.' : 'Accounts are not set up yet.'}</p>}
          {groups.map(({ account, channels }, i) => {
            const shown = channels.filter((c) => !q || c.name.toLowerCase().includes(q));
            if (q && shown.length === 0) return null;
            return (
              <SidebarSection key={account.id} title={`${account.name} · ${SERVICE_NAMES[account.service]}`} {...(i === 0 && pin ? { action: pin } : {})}>
                {account.status !== 'ready' && <li className="side-empty">{account.message ?? (account.status === 'signed-out' ? 'Signed out. Sign in again in Settings.' : 'This account cannot be reached.')}</li>}
                {shown.map((c) => {
                  const count = c.mentions || c.unread;
                  return (
                    <SidebarRow key={c.id} icon={<ConversationLead name={c.name} kind={c.kind} />} label={c.name.replace(/^#/, '')} {...(count ? { count } : {})} {...(c.bridge ? { sub: c.bridge } : {})} title={unreadLabel(c) || channelLabel(c)}
                      current={messages.open?.account === account.id && messages.open.channel === c.id}
                      onSelect={() => messages.choose({ account: account.id, channel: c.id })} />
                  );
                })}
              </SidebarSection>
            );
          })}
        </div>
      </div>
    </AppSidebar>
  );
}

/** The text of a message, with each mention of the person as a chip. */
function MessageText({ text, me }: { text: string; me: string | null }) {
  const { parts } = mentionParts(text, me);
  return <>{parts.map((p, i) => (p.me ? <span key={i} className="messages-mention">{p.text}</span> : <Fragment key={i}>{p.text}</Fragment>))}</>;
}

/** A thread under a message: who replied (their initials), how many replies, and when the last came. Opens it beside. */
function ThreadLink({ m, onOpen }: { m: ChatMessage; onOpen: () => void }) {
  const n = m.replies ?? 0;
  const who = (m.repliers ?? []).slice(0, 3);
  return (
    <button type="button" className="messages-thread" onClick={onOpen}>
      {who.length > 0 && <span className="messages-thread-who" aria-hidden="true">{who.map((r) => <Avatar key={r.name} name={r.name} size="chip" />)}</span>}
      <span className="messages-thread-count">{n} {n === 1 ? 'reply' : 'replies'}</span>
      {m.lastReply !== undefined && <span className="messages-thread-last">{lastReplyLabel(m.lastReply)}</span>}
    </button>
  );
}

/** What can be done to a message besides replying and copying, where its service allows it. */
export interface MessageActions {
  react?: (m: ChatMessage, emoji: string) => void;
  link?: (m: ChatMessage) => Promise<string | null>;
  unread?: (m: ChatMessage) => void;
}

/** The quick reactions offered on a message. */
export const QUICK_REACTIONS = ['👍', '❤️', '😄', '🎉', '👀', '✅'] as const;

/** A message's tools, shown while the pointer or the keyboard is on it: react, reply in its thread, copy, and more. */
function MessageTools({ m, onThread, actions }: { m: ChatMessage; onThread?: (id: string) => void; actions?: MessageActions }) {
  const [copied, setCopied] = useState<'text' | 'link' | null>(null);
  const [picking, setPicking] = useState(false);
  const flash = (what: 'text' | 'link') => { setCopied(what); window.setTimeout(() => setCopied(null), 1200); };
  const copy = () => { void navigator.clipboard?.writeText(m.text).then(() => flash('text')).catch(() => undefined); };
  const copyLink = async () => {
    const url = await actions?.link?.(m);
    if (url) await navigator.clipboard?.writeText(url).then(() => flash('link')).catch(() => undefined);
  };
  const more: MenuEntry[] = [
    ...(actions?.link ? [{ label: copied === 'link' ? 'Link copied' : 'Copy link', run: () => { void copyLink(); } }] : []),
    ...(actions?.unread ? [{ label: 'Mark unread', run: () => actions.unread!(m) }] : []),
  ];
  return (
    <span className="messages-tools" role="toolbar" aria-label="Message" data-open={picking || undefined}>
      {actions?.react && (
        <Popover label="React" side="top" align="end" open={picking} onOpenChange={setPicking} className="messages-react-pick"
          trigger={<button type="button" className="icon-btn" aria-label="React" title="React"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /><path d="M5.8 9.4c.5.8 1.3 1.2 2.2 1.2s1.7-.4 2.2-1.2M6 6.4h.01M10 6.4h.01" /></svg></button>}>
          {QUICK_REACTIONS.map((e) => {
            const mine = (m.reactions ?? []).some((r) => r.emoji === e && r.mine);
            return <button key={e} type="button" aria-pressed={mine} aria-label={mine ? `Take back ${e}` : `React ${e}`} onClick={() => { setPicking(false); actions.react!(m, e); }}>{e}</button>;
          })}
        </Popover>
      )}
      {onThread && !m.thread && (
        <button type="button" className="icon-btn" aria-label="Reply in thread" title="Reply in thread" onClick={() => onThread(m.id)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg>
        </button>
      )}
      <button type="button" className="icon-btn" aria-label={copied === 'text' ? 'Copied' : 'Copy text'} title={copied === 'text' ? 'Copied' : 'Copy text'} onClick={copy}>
        {copied === 'text'
          ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
          : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" /><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h.5" /></svg>}
      </button>
      {more.length > 0 && (
        <Menu label="More for this message" side="bottom" align="end" entries={more}
            trigger={<button type="button" className="icon-btn" aria-label="More for this message" title="More"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.4" /></svg></button>} />
      )}
    </span>
  );
}

/**
 * Messages by sender, oldest first, stacked against the box to write in and kept scrolled to the newest; `onThread`
 * opens a message's replies. `newFrom` is the first message not read when the conversation opened, under a "New" line.
 */
function MessageLog({ label, list, onThread, onPerson, newFrom = null, actions }: { label: string; list: readonly ChatMessage[]; onThread?: (id: string) => void; actions?: MessageActions; /** Shows who wrote a run in the Person panel. */ onPerson?: (author: ChatMessage['author']) => void; newFrom?: string | null }) {
  const log = useRef<HTMLDivElement>(null);
  const grouped = useMemo(() => runs(list), [list]);
  const me = useMemo(() => myName(list), [list]);
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [list]);
  return (
    <div ref={log} className="messages-log" role="log" aria-label={label}>
      {grouped.length === 0 && <p className="messages-none">No messages here yet.</p>}
      {grouped.map((run, i) => {
        const isNew = newFrom !== null && run.messages.some((m) => m.id === newFrom);
        return (
        <Fragment key={run.messages[0]!.id}>
        {/* Each day starts under its name ("Today", "Yesterday", "Thu, 12 Nov"), so a run says only its time. */}
        {(i === 0 || new Date(grouped[i - 1]!.at).toDateString() !== new Date(run.at).toDateString()) && (
          <div className="messages-day" role="separator"><span>{nearDayLabel(run.at) ?? dayLabel(run.at, { weekday: 'short' })}</span></div>
        )}
        {isNew && run.messages[0]!.id === newFrom && <div className="messages-new" role="separator" aria-label="New messages"><span>New</span></div>}
        <article className="messages-run" data-me={run.author.me || undefined} data-mention={!run.author.me && run.messages.some((m) => mentionParts(m.text, me).mine) ? true : undefined}>
          <header>{onPerson && !run.author.me ? <button type="button" className="messages-author" title={`About ${run.author.name}`} onClick={() => onPerson(run.author)}><strong>{run.author.name}</strong></button> : <strong>{run.author.name}</strong>} <time dateTime={new Date(run.at).toISOString()}>{timeLabel(new Date(run.at))}</time></header>
          {run.messages.map((m, j) => (
            <Fragment key={m.id}>
            {isNew && j > 0 && m.id === newFrom && <div className="messages-new" role="separator" aria-label="New messages"><span>New</span></div>}
            <div className="messages-one">
              <p><MessageText text={m.text} me={m.author.me ? null : me} />{m.edited && <span className="messages-edited"> (edited)</span>}</p>
              {(m.reactions?.length ?? 0) > 0 && (
                <ul className="messages-reactions" aria-label="Reactions">{m.reactions!.map((r) => (
                  <li key={r.emoji} data-mine={r.mine || undefined}>
                    {actions?.react
                      ? <button type="button" aria-pressed={r.mine ?? false} aria-label={`${r.emoji} ${r.count}${r.mine ? ', yours: take back' : ''}`} onClick={() => actions.react!(m, r.emoji)}>{r.emoji} {r.count}</button>
                      : <>{r.emoji} {r.count}</>}
                  </li>
                ))}</ul>
              )}
              {onThread && (m.replies ?? 0) > 0 && <ThreadLink m={m} onOpen={() => onThread(m.id)} />}
              <MessageTools m={m} onThread={onThread} actions={actions} />
            </div>
            </Fragment>
          ))}
        </article>
        </Fragment>
        );
      })}
    </div>
  );
}

/** Someone in a chat: their address-book card when a contact has their name, else who they are on the service. */
function ChatPerson({ author, service }: { author: ChatMessage['author']; service: string }) {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const book = window.mobius.contacts;
    if (!book) { setEmail(null); return undefined; }
    let live = true;
    setEmail(undefined);
    void book.search(author.name, 5).then((found) => {
      if (!live) return;
      const same = isNotesFailure(found) ? undefined : found.find((c) => c.name.trim().toLowerCase() === author.name.trim().toLowerCase());
      setEmail(same?.emails[0]?.value ?? null);
    }).catch(() => { if (live) setEmail(null); });
    return () => { live = false; };
  }, [author.name]);
  if (email === undefined) return null;
  if (email) return <ContactPanel person={{ name: author.name, email }} />;
  return (
    <div className="contact-card" aria-label="Contact">
      <div className="contact-head">
        <span className="contact-initial" aria-hidden="true">{author.name.trim().charAt(0).toUpperCase() || '?'}</span>
        <div className="contact-who"><strong className="contact-name">{author.name}</strong><span className="contact-org">On {service}</span></div>
      </div>
      <p className="contact-note">Not in your contacts.</p>
    </div>
  );
}

/** What was written and not sent, by channel (or thread), kept while Mobius is open: going to look at another channel loses nothing. */
const DRAFTS = new Map<string, string>();

/**
 * A box to write in; Enter sends, Shift+Enter starts a new line. Only the person sends. Opening a channel from the list
 * puts the keyboard here, as in Slack, unless something else (Mobius's box, a search) has it.
 */
function Compose({ label, reset, onSend }: { label: string; reset: string; onSend: (text: string) => Promise<boolean> }) {
  const [draft, setDraftNow] = useState(() => DRAFTS.get(reset) ?? '');
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const setDraft = (text: string) => { setDraftNow(text); if (text) DRAFTS.set(reset, text); else DRAFTS.delete(reset); };
  useEffect(() => {
    setDraftNow(DRAFTS.get(reset) ?? '');
    const on = document.activeElement;
    if (!on || on === document.body || on.matches('main.stage') || on.closest('.app-side, .messages-log')) box.current?.focus({ preventScroll: true });
  }, [reset]);
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
      <div className="messages-box">
        <textarea ref={box} aria-label={label} placeholder={label} rows={1} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <button type="submit" className="messages-send" aria-label="Send" title="Send (Enter)" disabled={sending || !draft.trim()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.5 8 8 3.5 12.5 8" /></svg>
        </button>
      </div>
      {!draft && <p className="messages-hint" aria-hidden="true">Enter sends, Shift+Enter new line</p>}
    </form>
  );
}

/** The open channel: its messages by sender, threads to open beside it, and a box to write in. Only the person sends. */
export function MessagesPage({ messages, onAddAccount, listPanels = [] }: { messages: MessagesState; /** Opens Settings at Messages' accounts. */ onAddAccount?: () => void; /** The app's list, from the frame: its left panel. */ listPanels?: readonly PanelSpec[] }) {
  const { account, channel, open, thread } = messages;
  const rail = useRailChoice();
  const space = useSpace();
  const spaceChosen = rail === 'space' && space.available;
  const spaceAccount = messages.accounts.find(isSpaceAccount);
  const spaceFirst = spaceAccount ? messages.channels.find((c) => c.account === spaceAccount.id) : undefined;
  const spaceReady = space.status.state === 'running' && !!spaceFirst;
  // Once the space is ready, choosing it opens its first channel, unless one of its channels is open already.
  const choose = messages.choose;
  useEffect(() => {
    if (spaceChosen && spaceReady && spaceAccount && spaceFirst && open?.account !== spaceAccount.id) choose({ account: spaceAccount.id, channel: spaceFirst.id });
  }, [spaceChosen, spaceReady, spaceAccount, spaceFirst, open?.account, choose]);
  // Person (right, while someone is picked): who wrote a message, from the address book when they are in it.
  const [person, setPerson] = useState<ChatMessage['author'] | null>(null);
  useEffect(() => setPerson(null), [open?.account, open?.channel]);
  // Show conversations brings the list back when it is hidden; while it shows, the line points at it instead.
  const [reveal, setReveal] = useState(0);
  const lists = useMemo(() => (reveal ? listPanels.map((p) => (p.dock === 'left' ? { ...p, reveal } : p)) : listPanels), [listPanels, reveal]);
  const empty = (title: string, line: string, action?: { label: string; run: () => void }, choose = false) => (
    <PanelLayout app="messages" panels={lists}>
      <section className="messages-page empty" aria-label="Messages" data-choose={choose || undefined}>
        <EmptyState app="messages" title={title} line={line} action={action} />
        {choose && <p className="empty-state-line messages-with-list">Choose a channel or a person on the left.</p>}
        {choose && <button type="button" className="btn primary messages-without-list" onClick={() => setReveal((n) => n + 1)}>Show conversations</button>}
      </section>
    </PanelLayout>
  );
  if (!messages.loaded) return <PanelLayout app="messages" panels={lists}><section className="messages-page" aria-label="Messages" /></PanelLayout>;
  // The space, chosen and not ready yet: a quiet centred state with its progress, in place of a conversation.
  if (spaceChosen && !spaceReady) return (
    <PanelLayout app="messages" panels={lists}>
      <section className="messages-page empty" aria-label="Messages: Mobius space">
        <div className="msg-space-setup">
          <MobiusMark size={28} />
          {space.status.state === 'running'
            ? <div className="msg-space-status" role="status"><p>Setting up your Mobius space…</p></div>
            : <SpaceStatusRow status={space.status} onRetry={space.open} />}
        </div>
      </section>
    </PanelLayout>
  );
  if (messages.accounts.length === 0) return empty('No accounts yet', messages.available ? 'Add a Slack, Matrix or Teams account to see your channels here.' : 'Slack, Matrix, Teams and Telegram accounts are on their way. Your channels will show here.', messages.available && onAddAccount ? { label: 'Add an account…', run: onAddAccount } : undefined);
  // The last conversation opens again by itself, so this shows only before one has ever been chosen.
  // The first unread conversation, or the last one open, opens by itself, so this shows only when there is neither.
  if (!account || !channel) return empty('No conversation open', '', undefined, true);
  const name = channelLabel(channel);
  const actions: MessageActions = {
    ...(messages.can.react ? { react: (m: ChatMessage, e: string) => { void messages.react(m, e); } } : {}),
    ...(messages.can.link ? { link: messages.permalink } : {}),
    ...(messages.can.markUnread ? { unread: (m: ChatMessage) => { void messages.markUnread(m); } } : {}),
  };
  const where = `${open?.account}/${open?.channel}`;
  const from = thread ? messages.messages.find((m) => m.id === thread) : undefined;
  // Thread (right dock, while one is open): the message it hangs from, its replies, and a box to reply in.
  const threadPanel: PanelSpec | null = thread ? { id: 'thread', name: 'Thread', dock: 'right', group: 'side', shown: true, onHide: () => messages.openThread(null), render: () => (
    <div className="messages-thread-panel">
      <MessageLog label={`Thread in ${name}`} list={from ? [from, ...messages.replies.filter((r) => r.id !== from.id)] : messages.replies} actions={actions} />
      <Compose label="Reply in thread" reset={`${where}/${thread}`} onSend={(text) => messages.send(text, true)} />
    </div>
  ) } : null;
  const personPanel: PanelSpec | null = person ? { id: 'person', name: 'Person', dock: 'right', group: 'side', shown: true, onHide: () => setPerson(null), render: () => <ChatPerson author={person} service={SERVICE_NAMES[account.service] ?? account.service} /> } : null;
  const panels = [...lists, ...(threadPanel ? [threadPanel] : []), ...(personPanel ? [personPanel] : [])];
  return (
    <PanelLayout app="messages" panels={panels}>
    <section className="messages-page" aria-label={`Messages: ${name}`}>
      {channel.encrypted
        // A Matrix room this device can't read yet: one line, not a placeholder for each message.
        ? <p className="messages-encrypted" role="status">Encrypted: verify this device in Settings &gt; Messages to read</p>
        : (
          <>
            <MessageLog label={name} list={messages.messages} onThread={messages.openThread} onPerson={setPerson} newFrom={firstUnread(messages.messages, messages.unreadAtOpen)} actions={actions} />
            {messages.message && <p className="tasks-message" role="alert">{messages.message}</p>}
            <Compose label={`Message ${name}`} reset={where} onSend={(text) => messages.send(text)} />
          </>
        )}
    </section>
    </PanelLayout>
  );
}
