import { useContext, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppMenu, AppSidebar, PointMenu, SidebarRow, SidebarSearch, SidebarSection, ToolbarControls, UndoToast } from './ui';
import type { MailCategory, MailContent, MailDraft, MailMessage } from '@mobius/shared';
import type { MailBox, MailState } from './useMail';
import { TryAnotherContext } from './ReviewBar';
import { SideNew, newKeys, type Start } from './SideNew';
import { EmptyState } from './EmptyState';
import './mail.css';
import { AccountDialog } from './MailAccounts';
import { dayLabel, formatWith, timeLabel, weekdayLabel } from './dates';

const CATEGORIES: { id: MailCategory | 'all'; label: string }[] = [
  { id: 'primary', label: 'Primary' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'updates', label: 'Updates' },
  { id: 'all', label: 'All' },
];

/** "9:02" today, "Thu" this week, "3 Nov" before. */
export function when(ms: number, now = new Date()): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (d.toDateString() === now.toDateString()) return timeLabel(d);
  if (now.getTime() - ms < 6 * 86_400_000 && ms <= now.getTime()) return weekdayLabel(d);
  return dayLabel(d, { now });
}

/** Mail's own toolbar glyphs, drawn like the standard action icons (20 units, stroked). */
const MAIL_ICONS = {
  inbox: <><path d="M3 11.5 5 4.5h10l2 7v3.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15z" /><path d="M3 11.5h4l1 2h4l1-2h4" /></>,
  drafts: <><path d="M5.5 3h6l3.5 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 15.5v-11A1.5 1.5 0 0 1 5.5 3z" /><path d="M11 3v4h4M7 10.5h6M7 13.5h4" /></>,
  sent: <path d="M17 3 3 9l5.5 2.5L11 17zM8.5 11.5 17 3" />,
  reply: <path d="M8 5 3.5 9.5 8 14M3.5 9.5h7a6 6 0 0 1 6 6v.5" />,
  replyAll: <><path d="M10 5 5.5 9.5 10 14M5.5 9.5h5.5a5.5 5.5 0 0 1 5.5 5.5v.5" /><path d="M6 5 1.5 9.5 6 14" /></>,
  forward: <path d="M12 5l4.5 4.5L12 14M16.5 9.5h-7a6 6 0 0 0-6 6v.5" />,
  archive: <><rect x="3" y="4" width="14" height="3.5" rx="1" /><path d="M4.5 7.5v7A1.5 1.5 0 0 0 6 16h8a1.5 1.5 0 0 0 1.5-1.5v-7M8.5 10.5h3" /></>,
  unarchive: <><rect x="3" y="4" width="14" height="3.5" rx="1" /><path d="M4.5 7.5v7A1.5 1.5 0 0 0 6 16h8a1.5 1.5 0 0 0 1.5-1.5v-7M10 14v-4.5M8 11.5l2-2 2 2" /></>,
  flag: <path d="M5 17V3.5M5 4h9l-2 3.5 2 3.5H5" />,
  unread: <><rect x="3" y="5" width="14" height="10.5" rx="2" /><path d="m3.5 6 6.5 5 6.5-5" /><circle cx="16" cy="5" r="2.6" data-dot /></>,
  later: <><circle cx="10" cy="10.5" r="6.5" /><path d="M10 7v3.5l2.5 1.5" /></>,
  move: <><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M8.5 10.5h5M11.5 8.5l2 2-2 2" /></>,
} as const;
function Glyph({ name, filled = false }: { name: keyof typeof MAIL_ICONS; filled?: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true" data-filled={filled || undefined}>{MAIL_ICONS[name]}</svg>;
}


/** Where a mailbox's list comes from, as the sidebar names it. */
export const BOX_NAMES: Record<MailBox, string> = { inbox: 'Inbox', sent: 'Sent', flagged: 'Flagged', archive: 'Archive' };

const initials = (name: string, email: string) => (name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const shownName = (p: { name: string; email: string }) => p.name || p.email;


/** The window title's place: the mailbox, the label, or the drafts shown. */
export function mailPlace(v: MailState['view']): string {
  if (v.kind === 'drafts') return v.only === 'mobius' ? 'Suggested replies' : 'Drafts';
  if (v.box === 'inbox' && v.category !== 'all') return CATEGORIES.find((c) => c.id === v.category)?.label ?? 'Inbox';
  return BOX_NAMES[v.box];
}

/** Mailboxes, labels and what Mobius wrote, as plain rows. Accounts are in Settings › Mail. */
export function MailSidebar({ mail, pin }: { mail: MailState; pin?: ReactNode; starts?: readonly Start[]; onStart?: (prompt: string) => void }) {
  const v = mail.view;
  const inBox = (b: MailBox, category: MailCategory | 'all' = 'all') => v.kind === 'box' && v.box === b && (b !== 'inbox' || v.category === category);
  const box = (b: MailBox, count?: number) => <SidebarRow label={BOX_NAMES[b]} {...(count ? { count } : {})} current={inBox(b)} onSelect={() => mail.setView({ kind: 'box', box: b, category: 'all' })} />;
  const suggested = mail.drafts.filter((d) => d.by === 'mobius').length;
  return (
    <AppSidebar label="Mail sidebar">
      <SideNew item="message" onNew={mail.compose} disabled={mail.accounts.length === 0} title={mail.accounts.length === 0 ? 'Add a mail account first' : 'New message'} />
      <SidebarSearch label="Search mail" value={mail.query} onChange={mail.setQuery} />
      <SidebarSection title="Mailboxes" action={<>
        {pin}
        <button type="button" className="strip-btn" aria-label="Get mail" title="Get mail now" disabled={mail.syncing || mail.accounts.length === 0} onClick={() => void mail.sync()}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v4h-4" /></svg>
        </button>
      </>}>
        {box('inbox', mail.counts.all)}
        <SidebarRow label="Drafts" {...(mail.counts.drafts ? { count: mail.counts.drafts } : {})} current={v.kind === 'drafts' && !v.only} onSelect={() => mail.setView({ kind: 'drafts' })} />
        {box('flagged')}
        {box('sent')}
        {box('archive')}
      </SidebarSection>
      {/* Mobius sorts the Inbox into these; a message moves to another from its toolbar or right-click menu. */}
      <SidebarSection title="Labels">
        {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
          <SidebarRow key={c.id} label={c.label} {...(mail.counts[c.id as MailCategory] ? { count: mail.counts[c.id as MailCategory] } : {})} current={inBox('inbox', c.id)} onSelect={() => mail.setView({ kind: 'box', box: 'inbox', category: c.id })} />
        ))}
      </SidebarSection>
      <SidebarSection title="From Mobius">
        <SidebarRow label="Suggested replies" {...(suggested ? { count: suggested } : {})} title={suggested ? `${suggested} to review` : 'Suggested replies'} current={v.kind === 'drafts' && v.only === 'mobius'} onSelect={() => mail.setView({ kind: 'drafts', only: 'mobius' })} />
      </SidebarSection>
    </AppSidebar>
  );
}

/** An email's HTML, shown without scripts and without loading anything from the web (no tracking pixels). */
function HtmlBody({ html }: { html: string }) {
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:0;color:#1d1d1f;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`, [html]);
  const [height, setHeight] = useState(400);
  return <iframe className="mail-html" title="Message" sandbox="allow-same-origin" srcDoc={doc} style={{ height }} onLoad={(e) => { const b = e.currentTarget.contentDocument?.body; if (b) setHeight(Math.min(6000, b.scrollHeight + 24)); }} />;
}

const sendTime = (ms: number) => formatWith(ms, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** `hour`:00 on the next `weekday` (0 Sunday … 6 Saturday), or tomorrow when there is none. */
export function nextAt(hour: number, weekday: number | null, now = new Date()): number {
  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  if (weekday === null) at.setDate(at.getDate() + 1);
  else { let add = (weekday - now.getDay() + 7) % 7; if (add === 0) add = 7; at.setDate(at.getDate() + add); }
  return at.getTime();
}

/** Send later: tomorrow at 8:00, Monday at 9:00, or when the person it is to is usually on mail (Mobius's suggestion). */
function SendLater({ mail, draft, onScheduled }: { mail: MailState; draft: MailDraft; onScheduled: (at: number) => void }) {
  const [open, setOpen] = useState(false);
  const [suggested, setSuggested] = useState<{ atMs: number; why: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void window.mobius.mail?.suggestSend?.(draft.id).then((s) => { if (live) setSuggested(s); }).catch(() => undefined);
    return () => { live = false; };
  }, [open, draft.id]);
  const pick = async (at: number) => { setOpen(false); if (await mail.schedule(draft.id, at)) onScheduled(at); };
  return (
    <span className="mail-later">
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Send later</button>
      {open && (
        <span className="mail-later-menu" role="group" aria-label="Send later">
          <button type="button" className="btn" onClick={() => void pick(nextAt(8, null))}>Tomorrow 8:00</button>
          <button type="button" className="btn" onClick={() => void pick(nextAt(9, 1))}>Monday 9:00</button>
          {suggested && <button type="button" className="btn mail-later-suggested" data-proposed title={suggested.why} onClick={() => void pick(suggested.atMs)}>{sendTime(suggested.atMs)} · {suggested.why}</button>}
        </span>
      )}
    </span>
  );
}

function DraftEditor({ mail, draft }: { mail: MailState; draft: MailDraft }) {
  const [d, setD] = useState(draft);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => setD(draft), [draft.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const to = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (draft.id) return;
    if (draft.to) { body.current?.focus({ preventScroll: true }); body.current?.setSelectionRange(0, 0); } else to.current?.focus({ preventScroll: true });
  }, [draft]);
  const keep = async (next: MailDraft) => { const saved = await mail.saveDraft({ ...next, by: 'you' }); if (saved) setD((cur) => ({ ...cur, id: saved.id, account: saved.account })); };
  const send = async () => {
    setSending(true);
    setProblem(await mail.send({ ...d, by: 'you' }));
    setSending(false);
  };
  return (
    <form className="mail-compose" aria-label={d.replyTo ? 'Reply' : 'New message'} onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label className="mail-field"><span>To</span><input ref={to} aria-label="To" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} onBlur={() => void keep(d)} /></label>
      <label className="mail-field"><span>Cc</span><input aria-label="Cc" value={d.cc} onChange={(e) => setD({ ...d, cc: e.target.value })} onBlur={() => void keep(d)} /></label>
      <label className="mail-field"><span>Subject</span><input aria-label="Subject" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} onBlur={() => void keep(d)} /></label>
      {/* A reply or forward starts above the quoted message, ready to type; a new message starts at To. */}
      <textarea ref={body} aria-label="Message" value={d.body} rows={12} onChange={(e) => setD({ ...d, body: e.target.value })} onBlur={() => void keep(d)} />
      {problem && <p className="tasks-message" role="alert">{problem}</p>}
      <div className="cal-editor-actions">
        {d.id && <button type="button" className="btn cal-delete" onClick={() => void mail.deleteDraft(d.id)}>Delete Draft</button>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => { void keep(d); mail.setEditing(null); }}>Close</button>
        {d.id && d.by === 'you' && <SendLater mail={mail} draft={d} onScheduled={(at) => setD((cur) => ({ ...cur, sendAtMs: at }))} />}
        <button type="submit" className="btn primary" disabled={sending || !d.to.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      </div>
      {d.sendAtMs ? (
        <p className="mail-scheduled" role="status">
          <span>Scheduled by you for {sendTime(d.sendAtMs)}</span>
          <button type="button" className="review-btn" onClick={() => void mail.schedule(d.id, null).then((ok) => { if (ok) setD((cur) => ({ ...cur, sendAtMs: null })); })}>Unschedule</button>
        </p>
      ) : null}
    </form>
  );
}

/**
 * A reply Mobius suggested, under the message: one dashed block until the person keeps it (it opens as their draft to
 * change and send), discards it or asks for another. Mobius never sends.
 */
function Suggested({ mail, draft }: { mail: MailState; draft: MailDraft }) {
  const tryAnother = useContext(TryAnotherContext);
  return (
    <section className="mail-suggested" aria-label="Suggested reply">
      <p className="mail-suggested-body">{draft.body}</p>
      <div className="mail-suggested-actions">
        <span className="mail-suggested-head" title={draft.why ? `Why this: ${draft.why}. Mobius never sends; you press Send.` : 'Mobius never sends; you press Send.'}>Draft from Mobius</span>
        <button type="button" className="review-btn" title="Delete this suggestion" onClick={() => void mail.deleteDraft(draft.id)}>Discard</button>
        {tryAnother && <button type="button" className="review-btn" data-kind="again" title="Put it back and ask Mobius for another" onClick={() => void mail.deleteDraft(draft.id).then(tryAnother)}>Try another</button>}
        <button type="button" className="review-btn" data-kind="keep" title="Keep it: it opens as your draft, to change and send" onClick={() => mail.setEditing({ ...draft, by: 'you' })}>Keep and edit</button>
      </div>
    </section>
  );
}

/** A reply the person kept (from a suggestion or from Keep all), shown under the message it answers, ready to send. */
function KeptReply({ mail, draft }: { mail: MailState; draft: MailDraft }) {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const send = async () => {
    setSending(true);
    setProblem(await mail.send(draft));
    setSending(false);
  };
  return (
    <section className="mail-kept" aria-label="Your draft reply">
      <span className="mail-kept-head">Your draft reply{draft.to && <> · To: {draft.to}</>}</span>
      <p className="mail-suggested-body">{draft.body}</p>
      <div className="mail-suggested-actions">
        <button type="button" className="btn primary" disabled={sending || !draft.to.trim()} onClick={() => void send()}>{sending ? 'Sending…' : 'Send'}</button>
        <button type="button" className="btn" onClick={() => mail.setEditing(draft)}>Edit</button>
      </div>
      {problem && <p className="mail-kept-problem" role="alert">{problem}</p>}
    </section>
  );
}

/** The categories a message can move to, as menu items. */
const moveItems = (mail: MailState, id: string, now: MailCategory | undefined, then?: () => void) => CATEGORIES.filter((c) => c.id !== 'all').map((c, i) => ({
  label: `Move to ${c.label}`, disabled: (now ?? 'primary') === c.id, separated: i === 0,
  run: () => void mail.sort(id, c.id as MailCategory).then(then),
}));

/**
 * The open message's actions, in the window's toolbar row as in Apple Mail, in three capsules:
 * reply, reply all, forward | archive, flag, unread | remind me, move to.
 */
function MailToolbar({ mail }: { mail: MailState }) {
  if (!mail.open || mail.editing) return null;
  return <ToolbarControls label="Mail"><MessageTools mail={mail} content={mail.open} /></ToolbarControls>;
}

function MessageTools({ mail, content }: { mail: MailState; content: MailContent }) {
  const row = mail.messages.find((m) => m.id === content.id);
  const flagged = row?.flagged ?? false;
  const archived = row?.archived ?? (mail.view.kind === 'box' && mail.view.box === 'archive');
  const tool = (name: keyof typeof MAIL_ICONS, label: string, run: (e: ReactMouseEvent<HTMLButtonElement>) => void, extra: { keys?: string; pressed?: boolean; filled?: boolean } = {}) => (
    <button type="button" className="strip-btn" aria-label={label} title={extra.keys ? `${label} (${extra.keys})` : label} {...(extra.keys ? { 'aria-keyshortcuts': extra.keys } : {})} {...(extra.pressed !== undefined ? { 'aria-pressed': extra.pressed } : {})} onClick={run}>
      <Glyph name={name} filled={extra.filled ?? false} />
    </button>
  );
  return (
    <div className="mail-tools" role="toolbar" aria-label="Message">
      <span className="mail-tools-group">
        {tool('reply', 'Reply', () => mail.reply(content), { keys: 'R' })}
        {tool('replyAll', 'Reply All', () => mail.reply(content, true), { keys: 'Shift+R' })}
        {tool('forward', 'Forward', () => mail.forward(content), { keys: 'F' })}
      </span>
      <span className="mail-tools-group">
        {archived ? tool('unarchive', 'Move to Inbox', () => void mail.archive(content.id, false)) : tool('archive', 'Archive', () => void mail.archive(content.id), { keys: 'E' })}
        {tool('flag', flagged ? 'Unflag' : 'Flag', () => void mail.flag(content.id, 'flagged', !flagged), { pressed: flagged, filled: flagged })}
        {/* The rest, used less often, go at the top of the toolbar's one ⋯ (the shell's), which opens on them. */}
        <AppMenu label="Message" entries={[
          { label: 'Mark as Unread', icon: <Glyph name="unread" />, keys: 'U', run: () => { void mail.flag(content.id, 'seen', false); mail.setOpen(null); } },
          ...(!archived && row?.box !== 'sent' ? [{ label: 'Remind Me Tomorrow', icon: <Glyph name="later" />, keys: 'H', run: () => void mail.remindTomorrow(content.id) }] : []),
          ...moveItems(mail, content.id, content.category, () => void mail.read(content.id)),
        ]} />
      </span>
    </div>
  );
}

function Reader({ mail, content, onDraftReply }: { mail: MailState; content: MailContent; onDraftReply?: (m: MailContent) => void }) {
  const suggestions = mail.drafts.filter((d) => d.by === 'mobius' && d.replyTo === content.id);
  const kept = mail.drafts.filter((d) => d.by === 'you' && d.replyTo === content.id);
  const [showHtml, setShowHtml] = useState(true);
  // The keyboard follows the message opened: E, R and H act on it straight away, whatever was clicked to open it.
  const reader = useRef<HTMLElement>(null);
  // Each read (a click on a row, even the one already open) gives the message the keyboard again.
  useEffect(() => { reader.current?.focus({ preventScroll: true }); }, [content]);
  return (
    <article ref={reader} tabIndex={-1} className="mail-reader" aria-label={content.subject || 'Message'} data-comment-id={content.id} data-comment-label={content.subject || 'Message'}>
      <h1 className="mail-subject">{content.subject || '(no subject)'}</h1>
      <header className="mail-reader-head">
        <span className="mail-avatar" aria-hidden="true">{initials(content.from.name, content.from.email)}</span>
        <div className="mail-reader-who">
          <div><b title={content.from.email}>{shownName(content.from)}</b> <span className="mail-to">to {content.to.map(shownName).join(', ') || 'you'}{content.cc.length > 0 && <>, cc {content.cc.map(shownName).join(', ')}</>}</span></div>
          <div className="mail-when">{content.dateMs ? sendTime(content.dateMs) : ''}</div>
        </div>
        {content.html && <button type="button" className="btn mail-format" aria-pressed={!showHtml} onClick={() => setShowHtml((s) => !s)}>{showHtml ? 'Plain text' : 'Formatted'}</button>}
      </header>
      {content.html && showHtml ? <HtmlBody html={content.html} /> : <pre className="mail-text">{content.text}</pre>}
      {content.attachments.length > 0 && <p className="mail-attachments">Attached: {content.attachments.join(', ')}</p>}
      {/* What Mobius wrote, and what the person kept, come after the message, where a reply goes. */}
      {suggestions.map((d) => <Suggested key={d.id} mail={mail} draft={d} />)}
      {kept.map((d) => <KeptReply key={d.id} mail={mail} draft={d} />)}
      {onDraftReply && suggestions.length === 0 && kept.length === 0 && (
        <div className="mail-reader-actions"><button type="button" className="btn mail-draft-it" onClick={() => onDraftReply(content)}>Draft a reply with Mobius</button></div>
      )}
    </article>
  );
}

function Row({ m, on, onOpen, onMenu }: { m: MailMessage; on: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const who = m.box === 'sent' ? `To ${m.to.map(shownName).join(', ')}` : shownName(m.from);
  return (
    <button type="button" role="option" aria-selected={on} className="mail-row" data-unread={!m.seen || undefined} data-flagged={m.flagged || undefined} data-id={m.id} onClick={onOpen}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
      onKeyDown={(e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); onMenu(r.left + 16, r.bottom); } }}>
      <span className="mail-row-who">{who}</span>
      <span className="mail-row-what"><span className="mail-row-subject">{m.subject || '(no subject)'}</span>{m.needsReply && <span className="mail-needs-reply"> · Reply</span>}<span className="mail-row-preview">{m.preview}</span></span>
      <span className="mail-row-end">{m.flagged && <span className="mail-row-flag" role="img" aria-label="Flagged"><Glyph name="flag" filled /></span>}<span className="mail-when">{when(m.dateMs)}</span></span>
    </button>
  );
}

/** A message row's right-click menu: what the toolbar does, without opening it first. */
function rowItems(mail: MailState, m: MailMessage) {
  const reopen = () => { if (mail.open?.id === m.id) void mail.read(m.id); };
  return [
    { label: 'Open', run: () => void mail.read(m.id) },
    { label: m.seen ? 'Mark as Unread' : 'Mark as Read', keys: 'U', separated: true, run: () => void mail.flag(m.id, 'seen', !m.seen) },
    { label: m.flagged ? 'Unflag' : 'Flag', run: () => void mail.flag(m.id, 'flagged', !m.flagged) },
    m.archived ? { label: 'Move to Inbox', run: () => void mail.archive(m.id, false) } : { label: 'Archive', keys: 'E', run: () => void mail.archive(m.id) },
    ...(m.box === 'inbox' && !m.archived ? [{ label: 'Remind Me Tomorrow', keys: 'H', run: () => void mail.remindTomorrow(m.id) }] : []),
    ...(m.box === 'inbox' ? moveItems(mail, m.id, m.category, reopen) : []),
  ];
}

/** While the first list is on its way: grey bars the shape of the rows that are coming, not a spinner. */
function ListLoading() {
  return (
    <div className="mail-loading" role="status" aria-label="Loading mail">
      {[62, 48, 70, 55, 66].map((w, i) => <span key={i} className="mail-loading-row" aria-hidden="true"><span className="mail-bar" style={{ width: '24%' }} /><span className="mail-bar" style={{ width: `${w - 24}%` }} /><span className="mail-bar mail-bar-when" /></span>)}
    </div>
  );
}

/** What a view says when it is empty, and, quieter, under a short list: one plain line and New message. */
export function listEndLine(v: MailState['view'], count: number, query: string): string {
  if (query) return count === 0 ? 'Nothing matches.' : 'That’s everything that matches.';
  if (v.kind === 'drafts') return v.only ? (count === 0 ? 'No suggested replies to review.' : 'That’s every suggested reply.') : (count === 0 ? 'No drafts.' : 'That’s every draft.');
  if (count > 0) return v.box === 'inbox' ? 'That’s everything in your inbox.' : `That’s everything in ${BOX_NAMES[v.box]}.`;
  if (v.box === 'flagged') return 'No flagged mail. Flag a message to keep it here.';
  if (v.box === 'archive') return 'Nothing archived. Press E on a message to archive it.';
  if (v.box === 'sent') return 'Nothing sent yet.';
  return 'Your inbox is empty.';
}

function ListEnd({ mail, count }: { mail: MailState; count: number }) {
  const canWrite = mail.accounts.length > 0;
  return (
    <div className="mail-list-end" data-empty={count === 0 || undefined}>
      <p>{listEndLine(mail.view, count, mail.query)}</p>
      {canWrite && <button type="button" className="btn" title={`New message (${newKeys()})`} onClick={mail.compose}>New message</button>}
    </div>
  );
}

/** The Mail app: categories, the list, and the message or draft open beside it. */
export function MailPage({ mail, onDraftReply }: { mail: MailState; onDraftReply?: (m: MailContent) => void }) {
  const v = mail.view;
  const [adding, setAdding] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ m: MailMessage; x: number; y: number } | null>(null);
  const drafts = v.kind === 'drafts' && v.only ? mail.drafts.filter((d) => d.by === v.only) : mail.drafts;
  // E archives, R replies (Shift+R to all), F forwards, U marks unread, H puts the open message off until tomorrow at 8:00. Not while typing, and not with Ctrl or Alt.
  const keys = useRef(mail);
  keys.current = mail;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = keys.current;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role=menu]') || m.editing) return;
      // The up and down arrows open the message before or after the one open, as in Apple Mail's list.
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && m.view.kind === 'box' && m.messages.length > 0 && (!t || t === document.body || t.closest('.mail-page'))) {
        e.preventDefault();
        const i = m.open ? m.messages.findIndex((x) => x.id === m.open!.id) : -1;
        const next = m.messages[i < 0 ? 0 : Math.max(0, Math.min(m.messages.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]!;
        if (next.id !== m.open?.id) void m.read(next.id).then(() => document.querySelector(`.mail-row[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
        return;
      }
      if (!m.open) return;
      const key = e.key.toLowerCase();
      if (key === 'e') { e.preventDefault(); void m.archive(m.open.id); }
      else if (key === 'r') { e.preventDefault(); m.reply(m.open, e.shiftKey); }
      else if (key === 'f') { e.preventDefault(); m.forward(m.open); }
      else if (key === 'u') { e.preventDefault(); void m.flag(m.open.id, 'seen', false); m.setOpen(null); }
      else if (key === 'h') { e.preventDefault(); void m.remindTomorrow(m.open.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!mail.available) return <section className="mail-page empty" aria-label="Mail"><EmptyState icon={MAIL_ICONS.inbox} title="Mail is not available here" /></section>;
  // With no account and no drafts there is nothing to show; a draft Mobius kept before any account was added is shown.
  if (mail.accounts.length === 0 && mail.drafts.length === 0) {
    return (
      <section className="mail-page empty" aria-label="Mail">
        <EmptyState icon={MAIL_ICONS.inbox} title="No mail account yet" line="Add one to see your mail here. Mobius reads and drafts; only you send." action={{ label: 'Add a mail account…', run: () => setAdding(true) }} />
        {adding && <AccountDialog connect={mail.connect} onClose={() => setAdding(false)} />}
      </section>
    );
  }
  return (
    <section className="mail-page" aria-label="Mail">
      <div className="mail-list-pane">
        {v.kind === 'drafts' ? (
          <div role="listbox" aria-label={mailPlace(v)} className="mail-list">
            {drafts.map((d) => (
              <button key={d.id} type="button" role="option" aria-selected={mail.editing?.id === d.id} className="mail-row" data-suggested={d.by === 'mobius' || undefined} onClick={() => { mail.setOpen(null); mail.setEditing(d); }}>
                <span className="mail-row-who">{d.to || 'No one yet'}</span>
                <span className="mail-row-what"><span className="mail-row-subject">{d.subject || '(no subject)'}</span><span className="mail-row-preview">{d.body.slice(0, 160)}</span></span>
                <span className="mail-row-end"><span className="mail-when">{d.by === 'mobius' ? 'Suggested' : when(d.updatedMs)}</span></span>
              </button>
            ))}
          </div>
        ) : (
          <div role="listbox" aria-label="Messages" className="mail-list" aria-keyshortcuts="E R Shift+R F U H">
            {mail.messages.map((m) => <Row key={m.id} m={m} on={mail.open?.id === m.id} onOpen={() => void mail.read(m.id)} onMenu={(x, y) => setRowMenu({ m, x, y })} />)}
          </div>
        )}
        {!mail.loaded ? <ListLoading /> : <ListEnd mail={mail} count={v.kind === 'drafts' ? drafts.length : mail.messages.length} />}
      </div>
      <div className="mail-reading-pane">
        {mail.message && <p className="tasks-message" role="alert">{mail.message}</p>}
        {mail.editing ? <DraftEditor key={mail.editing.id || 'new'} mail={mail} draft={mail.editing} />
          : mail.open ? <Reader mail={mail} content={mail.open} {...(onDraftReply ? { onDraftReply } : {})} />
            : mail.accounts.length === 0
              ? <EmptyState icon={MAIL_ICONS.inbox} label="No mail account yet" title="No mail account yet" line="Drafts are kept here on this computer. Add an account to send them." action={{ label: 'Add a mail account…', run: () => setAdding(true) }} />
              : <EmptyState icon={MAIL_ICONS.inbox} label="No message open" title="No message open" line="Choose one in the list." />}
        {adding && mail.accounts.length === 0 && <AccountDialog connect={mail.connect} onClose={() => setAdding(false)} />}
      </div>
      {rowMenu && <PointMenu x={rowMenu.x} y={rowMenu.y} label={`${rowMenu.m.subject || 'Message'} menu`} onClose={() => setRowMenu(null)} entries={rowItems(mail, rowMenu.m)} />}
      {mail.undo && <UndoToast text={mail.undo.text} onUndo={() => void mail.undo?.run()} onDismiss={mail.clearUndo} />}
      <MailToolbar mail={mail} />
    </section>
  );
}
