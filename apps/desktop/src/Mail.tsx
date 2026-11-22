import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppMenu, AppSidebar, Button, EmptyState, IconButton, KeyHintBar, Menu, PointMenu, SidebarRow, SidebarSearch, SidebarSection, TOOL_ICONS, ToolbarControls, ToolGroup, UndoToast, type EmptyKind } from './ui';
import { useAddressSuggestions, useMeetingsWith } from './ContactPanel';
import { isNotesFailure, type MailCategory, type MailContent, type MailDraft, type MailFollowUp, type MailMessage } from '@mobius/shared';
import { backAt, IMPORTANT, type MailBox, type MailState, type MailView } from './useMail';
import { laterChoices, parseLater } from './mail-later';
import { localDate } from './calendar-view';
import { ChangeBar } from './ReviewBar';
import { SideNew, newKeys, type Start } from './SideNew';
import { MobiusMark } from './MobiusMark';
import { REMIND_AFTER, remindAt, remindDay, useFollowUps, waitingOn } from './mail-follow-ups';

import './mail.css';
import { AccountDialog } from './MailAccounts';
import { dayLabel, formatWith, timeLabel, weekdayLabel } from './dates';

const CATEGORIES: { id: MailCategory | 'all'; label: string }[] = [
  { id: 'primary', label: 'Primary' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'updates', label: 'Updates' },
  { id: 'all', label: 'All' },
];

/** The message list's keys, shown in the key-hint bar until they are learned. */
const MAIL_KEYS = [{ keys: 'E', label: 'Done' }, { keys: 'R', label: 'Reply' }, { keys: 'H', label: 'Later' }] as const;

/** The inbox's split, as Superhuman's split inbox: Important (from people), Waiting (sent, no reply yet), Other. */
type Split = 'important' | 'waiting' | 'other';
const SPLITS: { id: Split; label: string; view: MailView }[] = [
  { id: 'important', label: 'Important', view: IMPORTANT },
  { id: 'waiting', label: 'Waiting', view: { kind: 'waiting' } },
  { id: 'other', label: 'Other', view: { kind: 'box', box: 'inbox', category: 'other' } },
];
/** Which split tab a view is, or null when the list shows something else (a label, Sent, Drafts…). */
export function splitOf(v: MailView): Split | null {
  if (v.kind === 'waiting') return 'waiting';
  if (v.kind === 'box' && v.box === 'inbox') return v.category === 'primary' ? 'important' : v.category === 'other' ? 'other' : null;
  return null;
}

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
export const BOX_NAMES: Record<MailBox, string> = { inbox: 'Inbox', sent: 'Sent', flagged: 'Flagged', later: 'Later', archive: 'Done' };

const initials = (name: string, email: string) => (name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const shownName = (p: { name: string; email: string }) => p.name || p.email;


/** The window title's place: the mailbox, the label, or the drafts shown. */
export function mailPlace(v: MailState['view']): string {
  if (v.kind === 'drafts') return v.only === 'mobius' ? 'Suggested replies' : 'Drafts';
  const split = splitOf(v);
  if (split) return SPLITS.find((x) => x.id === split)!.label;
  if (v.kind !== 'box') return 'Inbox';
  if (v.box === 'inbox' && v.category !== 'all') return CATEGORIES.find((c) => c.id === v.category)?.label ?? 'Inbox';
  return BOX_NAMES[v.box];
}

/** A folder's mark in the Mailboxes panel, drawn like Tasks' smart lists. */
function FolderIcon({ of }: { of: MailBox | 'drafts' | 'label' }) {
  const glyph = of === 'label' ? <><path d="M3.5 4.5v5l7 7 6-6-7-7z" /><circle cx="7" cy="8" r="1" /></> : of === 'later' ? MAIL_ICONS.later : of === 'flagged' ? MAIL_ICONS.flag : of === 'archive' ? MAIL_ICONS.archive : of === 'sent' ? MAIL_ICONS.sent : of === 'drafts' ? MAIL_ICONS.drafts : MAIL_ICONS.inbox;
  return <span className="mail-folder-icon" aria-hidden="true"><svg viewBox="0 0 20 20">{glyph}</svg></span>;
}

/** Mailboxes, labels and what Mobius wrote, as plain rows. Accounts are in Settings › Mail. */
export function MailSidebar({ mail, pin }: { mail: MailState; pin?: ReactNode; starts?: readonly Start[]; onStart?: (prompt: string) => void }) {
  const v = mail.view;
  const inBox = (b: MailBox, category: MailCategory | 'all' = 'all') => v.kind === 'box' && v.box === b && (b !== 'inbox' || v.category === category);
  // Inbox opens on Important, and stays the current row on any of its split tabs.
  const box = (b: MailBox, count?: number) => <SidebarRow icon={<FolderIcon of={b} />} label={BOX_NAMES[b]} {...(count ? { count } : {})} current={b === 'inbox' ? splitOf(v) !== null || inBox('inbox') : inBox(b)} onSelect={() => mail.setView(b === 'inbox' ? IMPORTANT : { kind: 'box', box: b, category: 'all' })} />;
  const suggested = mail.drafts.filter((d) => d.by === 'mobius').length;
  return (
    <AppSidebar label="Mailboxes">
      <SideNew item="message" onNew={mail.compose} disabled={mail.accounts.length === 0} title={mail.accounts.length === 0 ? 'Add a mail account first' : 'New message'} />
      <SidebarSearch label="Search mail" value={mail.query} onChange={mail.setQuery} />
      <SidebarSection title="Folders" action={<>
        {pin}
        <button type="button" className="strip-btn" aria-label="Get mail" title="Get mail now" disabled={mail.syncing || mail.accounts.length === 0} onClick={() => void mail.sync()}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v4h-4" /></svg>
        </button>
      </>}>
        {box('inbox', mail.counts.all)}
        {box('later')}
        <SidebarRow icon={<FolderIcon of="drafts" />} label="Drafts" {...(mail.counts.drafts ? { count: mail.counts.drafts } : {})} current={v.kind === 'drafts' && !v.only} onSelect={() => mail.setView({ kind: 'drafts' })} />
        {box('sent')}
        {box('flagged')}
        {box('archive')}
      </SidebarSection>
      {/* Mobius sorts the Inbox into these; a message moves to another from its toolbar or right-click menu. */}
      <SidebarSection title="Labels">
        {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
          <SidebarRow key={c.id} icon={<FolderIcon of="label" />} label={c.label} {...(mail.counts[c.id as MailCategory] ? { count: mail.counts[c.id as MailCategory] } : {})} current={c.id !== 'primary' && inBox('inbox', c.id)} onSelect={() => mail.setView(c.id === 'primary' ? IMPORTANT : { kind: 'box', box: 'inbox', category: c.id })} />
        ))}
      </SidebarSection>
      <SidebarSection title="From Mobius">
        <SidebarRow icon={<span className="mail-folder-icon"><MobiusMark size={16} /></span>} label="Suggested replies" {...(suggested ? { count: suggested } : {})} title={suggested ? `${suggested} to review` : 'Suggested replies'} current={v.kind === 'drafts' && v.only === 'mobius'} onSelect={() => mail.setView({ kind: 'drafts', only: 'mobius' })} />
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

/** Remind if no reply, beside Send later: once sent, Mail brings it back on that day unless someone has answered. */
function RemindNoReply({ at, onPick }: { at: number | null | undefined; onPick: (at: number | null) => void }) {
  return (
    <Menu label="Remind if no reply" entries={[
      ...REMIND_AFTER.map((r) => ({ label: r.label, checked: at === remindAt(r.days), run: () => onPick(remindAt(r.days)) })),
      ...(at ? [{ label: 'Don’t remind me', separated: true, run: () => onPick(null) }] : []),
    ]} trigger={<button type="button" className="btn mail-remind" aria-pressed={Boolean(at)} title="Remind me if no one replies">{at ? `No reply by ${remindDay(at)}` : 'Remind if no reply'}</button>} />
  );
}

/** Writing a message. `inline`: a reply in the box under the message it answers, as Gmail and Superhuman open one. */
function DraftEditor({ mail, draft, inline = false }: { mail: MailState; draft: MailDraft; inline?: boolean }) {
  const [d, setD] = useState(draft);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => setD(draft), [draft.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const to = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const toPeople = useAddressSuggestions(d.to);
  const ccPeople = useAddressSuggestions(d.cc);
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
  // Esc closes an empty message; one with words in it asks first: Discard, or Keep as draft.
  const [leaving, setLeaving] = useState(false);
  const close = () => { void keep(d); mail.setEditing(null); };
  const discard = () => { if (d.id) void mail.deleteDraft(d.id); mail.setEditing(null); };
  const answering = d.replyTo ? mail.messages.find((m) => m.id === d.replyTo) : undefined;
  const heading = d.replyTo ? `Reply to ${answering ? answering.from.name || answering.from.email : d.to || 'message'}` : 'New message';
  return (
    <form className="mail-compose" data-inline={inline || undefined} aria-label={d.replyTo ? 'Reply' : 'New message'} onSubmit={(e) => { e.preventDefault(); void send(); }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented || (e.target as HTMLElement).closest('.mail-later-menu')) return;
        e.preventDefault();
        // A new message left as it opened (its signature, or a quote) goes without asking; nothing is kept of it.
        if (!draft.id && d.body === draft.body && d.to === draft.to && d.cc === draft.cc && d.subject === draft.subject) discard();
        else if (!d.body.trim()) close(); else setLeaving(true);
      }}>
      {inline ? <p className="mail-reply-head"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h6a4 4 0 0 1 4 4" /></svg>{heading}</p> : <h1 className="mail-subject mail-compose-title">{heading}</h1>}
      <label className="mail-field"><span>To</span><input ref={to} aria-label="To" list="mail-to-people" autoComplete="off" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} onBlur={() => void keep(d)} /></label>
      <label className="mail-field"><span>Cc</span><input aria-label="Cc" list="mail-cc-people" autoComplete="off" value={d.cc} onChange={(e) => setD({ ...d, cc: e.target.value })} onBlur={() => void keep(d)} /></label>
      {/* Names from the address book as an address is typed. */}
      <datalist id="mail-to-people">{toPeople.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="mail-cc-people">{ccPeople.map((v) => <option key={v} value={v} />)}</datalist>
      <label className="mail-field"><span>Subject</span><input aria-label="Subject" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} onBlur={() => void keep(d)} /></label>
      {/* A reply or forward starts above the quoted message, ready to type; a new message starts at To. */}
      <textarea ref={body} aria-label="Message" value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} onBlur={() => void keep(d)} />
      {problem && <p className="tasks-message" role="alert">{problem}</p>}
      {/* One bar at the foot of the pane, the same for a new message and a reply: Send first, then Close. */}
      {leaving ? (
        <div className="mail-compose-bar" role="alertdialog" aria-label="Close this message?">
          <span className="mail-compose-ask">Close this message?</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={discard}>Discard</button>
          <button type="button" className="btn primary" autoFocus onClick={close}>Keep as draft</button>
        </div>
      ) : (
        <div className="mail-compose-bar">
          <button type="submit" className="btn primary" disabled={sending || !d.to.trim()}>{sending ? 'Sending…' : 'Send'}</button>
          {/* Close sits next to Send: Send later appears once the draft is saved, and must not move Close under the pointer. */}
          <button type="button" className="btn" title="Close (Esc)" onClick={close}>Close</button>
          {d.id && d.by === 'you' && <SendLater mail={mail} draft={d} onScheduled={(at) => setD((cur) => ({ ...cur, sendAtMs: at }))} />}
          <RemindNoReply at={d.remindMs} onPick={(at) => { const next = { ...d, remindMs: at }; setD(next); void keep(next); }} />
          <span className="spacer" />
          {d.id && <button type="button" className="btn cal-delete" onClick={() => void mail.deleteDraft(d.id)}>Delete Draft</button>}
        </div>
      )}
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
  return (
    <section className="mail-suggested" aria-label="Suggested reply">
      {/* One indigo line above the box, as Notes and Docs mark a change: who, then Discard, Try another and Keep and edit. */}
      <ChangeBar
        who={<span className="mail-suggested-head" title={draft.why ? `Why this: ${draft.why}. Mobius never sends; you press Send.` : 'Mobius never sends; you press Send.'}><MobiusMark size={14} />Mobius drafted this</span>}
        onDiscard={() => mail.deleteDraft(draft.id)} discardTitle="Delete this suggestion"
        onKeep={() => mail.setEditing({ ...draft, by: 'you' })} keepText="Keep and edit" keepTitle="Keep it: it opens as your draft, to change and send" />
      <p className="mail-suggested-body">{draft.body}</p>
    </section>
  );
}

/** Undo send with the seconds left in view, so it is plain how long Undo still takes it back. */
function SendCountdown({ text, until, onUndo, onDismiss }: { text: string; until: number; onUndo: () => void; onDismiss: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return <UndoToast text={left > 0 ? `${text} in ${left} s` : text} onUndo={onUndo} onDismiss={onDismiss} />;
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
function MailToolbar({ mail, onLater }: { mail: MailState; onLater: (id: string) => void }) {
  if (!mail.open || mail.editing) return null;
  return <ToolbarControls label="Mail"><MessageTools mail={mail} content={mail.open} onLater={onLater} /></ToolbarControls>;
}

function MessageTools({ mail, content, onLater }: { mail: MailState; content: MailContent; onLater: (id: string) => void }) {
  const row = mail.messages.find((m) => m.id === content.id);
  const flagged = row?.flagged ?? false;
  const archived = row?.archived ?? (mail.view.kind === 'box' && mail.view.box === 'archive');
  const follow = useFollowUps(row?.box === 'sent');
  const waiting = follow.of(content.id);
  // Icons for the familiar actions, from the shared set; the tooltip names each and its key ("Done (E)").
  return (
    <div className="mail-tools" role="toolbar" aria-label="Message">
      <ToolGroup label="Reply">
        <IconButton label="Reply" keys="R" icon={TOOL_ICONS.reply} onClick={() => mail.reply(content)} />
        <IconButton label="Reply All" keys="Shift+R" icon={TOOL_ICONS.replyAll} onClick={() => mail.reply(content, true)} />
        <IconButton label="Forward" keys="F" icon={TOOL_ICONS.forward} onClick={() => mail.forward(content)} />
      </ToolGroup>
      <ToolGroup label="Triage">
        {archived ? <IconButton label="Move to Inbox" icon={TOOL_ICONS.done} onClick={() => void mail.archive(content.id, false)} /> : <IconButton label="Done" keys="E" icon={TOOL_ICONS.done} onClick={() => void mail.archive(content.id)} />}
        {!archived && row?.box !== 'sent' && <IconButton label="Later" keys="H" icon={TOOL_ICONS.later} onClick={() => onLater(content.id)} />}
        <IconButton label={flagged ? 'Unflag' : 'Flag'} pressed={flagged} icon={TOOL_ICONS.flag} onClick={() => void mail.flag(content.id, 'flagged', !flagged)} />
        {row?.box === 'sent' && follow.available && (
          <Menu label="Remind if no reply" entries={[
            ...REMIND_AFTER.map((r) => ({ label: r.label, checked: waiting?.remindMs === remindAt(r.days), run: () => void follow.set(content.id, remindAt(r.days)) })),
            ...(waiting ? [{ label: 'Stop waiting for a reply', separated: true, run: () => void follow.set(content.id, null) }] : []),
          ]} trigger={<IconButton label="Remind if no reply" pressed={Boolean(waiting)} icon={TOOL_ICONS.later} title={waiting ? `Reminding you ${remindDay(waiting.remindMs).toLowerCase()} if no one replies` : 'Remind if no reply'} />} />
        )}
        {/* The rest, used less often, go at the top of the toolbar's one ⋯ (the shell's), which opens on them. */}
        <AppMenu label="Message" entries={[
          { label: 'Mark as Unread', icon: <Glyph name="unread" />, keys: 'U', run: () => { void mail.flag(content.id, 'seen', false); mail.setOpen(null); } },
          ...moveItems(mail, content.id, content.category, () => void mail.read(content.id)),
        ]} />
      </ToolGroup>
    </div>
  );
}

/** What Mail knows around the sender, read from all mail: earlier messages from them, and when you last wrote. */
function useSenderMail(email: string, id: string): { earlier: number; wrote: number | null } {
  const [found, setFound] = useState<{ earlier: number; wrote: number | null }>({ earlier: 0, wrote: null });
  useEffect(() => {
    const api = window.mobius.mail;
    const who = email.trim().toLowerCase();
    if (!api || !who) { setFound({ earlier: 0, wrote: null }); return undefined; }
    let live = true;
    void api.list('all', 'all', who).then((all) => {
      if (!live || isNotesFailure(all)) return;
      const self = all.find((m) => m.id === id);
      const before = (m: MailMessage) => !self || m.dateMs < self.dateMs;
      const earlier = all.filter((m) => m.id !== id && m.box === 'inbox' && m.from.email.toLowerCase() === who && before(m)).length;
      const wrote = all.filter((m) => m.box === 'sent' && m.to.some((p) => p.email.toLowerCase() === who)).reduce<number | null>((at, m) => (at === null || m.dateMs > at ? m.dateMs : at), null);
      setFound({ earlier, wrote });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [email, id]);
  return found;
}

/** What Mail knows around the sender, as small pills under their name: earlier mail, your last note, the next meeting. */
function Facts({ mail, content }: { mail: MailState; content: MailContent }) {
  const { earlier, wrote } = useSenderMail(content.from.email, content.id);
  const meeting = useMeetingsWith(content.from.email)[0];
  if (!earlier && !wrote && !meeting) return null;
  return (
    <ul className="mail-facts" aria-label="About the sender">
      {earlier > 0 && <li><button type="button" className="mail-fact" title={`Find mail from ${content.from.email}`} onClick={() => mail.setQuery(content.from.email)}>{earlier} earlier message{earlier === 1 ? '' : 's'}</button></li>}
      {wrote !== null && <li><span className="mail-fact">You wrote {when(wrote)}</span></li>}
      {meeting && <li><span className="mail-fact">Meeting {formatWith(localDate(meeting.start).getTime(), { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span></li>}
    </ul>
  );
}

/**
 * The reply box under the message, as Gmail and Superhuman open a reply: one quiet box to start writing in, with
 * Draft with Mobius inside it. R opens it, as does a click; the reply is written right here.
 */
function ReplyBox({ mail, content, onDraftReply }: { mail: MailState; content: MailContent; onDraftReply: ((m: MailContent) => void) | undefined }) {
  const name = shownName(content.from);
  return (
    <div className="mail-reply-box" data-closed>
      <button type="button" className="mail-reply-start" aria-keyshortcuts="R" onClick={() => mail.reply(content)}>
        <span className="mail-reply-head"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h6a4 4 0 0 1 4 4" /></svg>Reply to {name}</span>
        <span className="mail-reply-hint">Write a reply…</span>
      </button>
      {onDraftReply && <button type="button" className="btn mail-draft-it" onClick={() => onDraftReply(content)}><MobiusMark size={14} />Draft with Mobius</button>}
    </div>
  );
}

function Reader({ mail, content, replying, onDraftReply }: { mail: MailState; content: MailContent; replying: MailDraft | null; onDraftReply?: (m: MailContent) => void }) {
  const suggestions = mail.drafts.filter((d) => d.by === 'mobius' && d.replyTo === content.id);
  const kept = mail.drafts.filter((d) => d.by === 'you' && d.replyTo === content.id);
  const [showHtml, setShowHtml] = useState(true);
  // The keyboard follows the message opened: E, R and H act on it straight away, whatever was clicked to open it.
  const reader = useRef<HTMLElement>(null);
  // Each read (a click on a row, even the one already open) gives the message the keyboard again.
  useEffect(() => { if (!replying) reader.current?.focus({ preventScroll: true }); }, [content]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <article ref={reader} tabIndex={-1} className="mail-reader" aria-label={content.subject || 'Message'} data-comment-id={content.id} data-comment-label={content.subject || 'Message'}>
      <h1 className="mail-subject">{content.subject || '(no subject)'}</h1>
      <header className="mail-reader-head">
        <span className="mail-avatar" aria-hidden="true">{initials(content.from.name, content.from.email)}</span>
        <div className="mail-reader-who">
          <div><b title={content.from.email}>{shownName(content.from)}</b> <span className="mail-to">to {content.to.map(shownName).join(', ') || 'you'}{content.cc.length > 0 && <>, cc {content.cc.map(shownName).join(', ')}</>}</span></div>
          <div className="mail-when">{content.dateMs ? sendTime(content.dateMs) : ''}</div>
          <Facts mail={mail} content={content} />
        </div>
        {content.html && <button type="button" className="btn mail-format" aria-pressed={!showHtml} onClick={() => setShowHtml((s) => !s)}>{showHtml ? 'Plain text' : 'Formatted'}</button>}
      </header>
      {content.html && showHtml ? <HtmlBody html={content.html} /> : <pre className="mail-text">{content.text}</pre>}
      {content.attachments.length > 0 && <p className="mail-attachments">Attached: {content.attachments.join(', ')}</p>}
      {/* What Mobius wrote, and what the person kept, come after the message, where a reply goes. */}
      {suggestions.map((d) => <Suggested key={d.id} mail={mail} draft={d} />)}
      {/* While a reply is being written here, its saved copy is that reply: it is not shown again above it. */}
      {!replying && kept.map((d) => <KeptReply key={d.id} mail={mail} draft={d} />)}
      {replying ? <DraftEditor key={replying.id || 'reply'} mail={mail} draft={replying} inline />
        : suggestions.length === 0 && kept.length === 0 && <ReplyBox mail={mail} content={content} onDraftReply={onDraftReply} />}
    </article>
  );
}

/** The Waiting tab: sent mail that waits on an answer, those past their day first. Opens the sent message. */
function WaitingList({ mail, waiting, onStop }: { mail: MailState; waiting: readonly MailFollowUp[]; onStop: (f: MailFollowUp, x: number, y: number) => void }) {
  const shown = [...waiting].sort((a, b) => Number(b.status === 'due') - Number(a.status === 'due') || a.remindMs - b.remindMs);
  return (
    <div role="listbox" aria-label="Waiting on a reply" className="mail-list">
      {shown.map((f) => (
        <button key={f.messageId} type="button" role="option" aria-selected={Boolean(f.sentId) && mail.open?.id === f.sentId} className="mail-row" data-due={f.status === 'due' || undefined}
          onClick={() => { if (f.sentId) void mail.read(f.sentId); }}
          onContextMenu={(e) => { e.preventDefault(); onStop(f, e.clientX, e.clientY); }}>
          <span className="mail-row-who">To {waitingOn(f.to)}</span>
          <span className="mail-row-what"><span className="mail-row-subject">{f.subject || '(no subject)'}</span><span className="mail-row-preview">{f.status === 'due' ? 'No reply yet' : `Reminding you ${remindDay(f.remindMs).toLowerCase()} if no reply`}</span></span>
          <span className="mail-row-end"><span className="mail-when">{when(f.sentMs)}</span></span>
        </button>
      ))}
    </div>
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
      <span className="mail-row-end">{m.flagged && <span className="mail-row-flag" role="img" aria-label="Flagged"><Glyph name="flag" filled /></span>}<span className="mail-when">{(m.laterMs ?? 0) > Date.now() ? `Back ${backAt(m.laterMs!)}` : when(m.dateMs)}</span></span>
    </button>
  );
}

/** A message row's right-click menu: what the toolbar does, without opening it first. */
function rowItems(mail: MailState, m: MailMessage, onLater: (id: string) => void) {
  const reopen = () => { if (mail.open?.id === m.id) void mail.read(m.id); };
  return [
    { label: 'Open', run: () => void mail.read(m.id) },
    { label: m.seen ? 'Mark as Unread' : 'Mark as Read', keys: 'U', separated: true, run: () => void mail.flag(m.id, 'seen', !m.seen) },
    { label: m.flagged ? 'Unflag' : 'Flag', run: () => void mail.flag(m.id, 'flagged', !m.flagged) },
    m.archived ? { label: 'Move to Inbox', run: () => void mail.archive(m.id, false) } : { label: 'Done', keys: 'E', run: () => void mail.archive(m.id) },
    ...(m.box === 'inbox' && !m.archived ? [(m.laterMs ?? 0) > Date.now() ? { label: 'Back to Inbox Now', run: () => void mail.later(m.id, null) } : { label: 'Later…', keys: 'H', run: () => onLater(m.id) }] : []),
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

/** A draft's address as a name, when a message from that address says who it is. */
export function nameFor(address: string, messages: readonly MailMessage[]): string {
  const first = address.split(',')[0]!.trim();
  const email = (/<([^>]+)>/.exec(first)?.[1] ?? first).toLowerCase();
  const known = messages.find((m) => m.from.email.toLowerCase() === email && m.from.name)?.from.name;
  return known ?? (/^"?([^"<]+?)"?\s*</.exec(first)?.[1] ?? first);
}

/** What a view says when it is empty, and, quieter, under a short list: one plain line and New message. */
export function listEndLine(v: MailState['view'], count: number, query: string): string {
  if (query) return count === 0 ? 'Nothing matches.' : 'That’s everything that matches.';
  if (v.kind === 'drafts') return v.only ? (count === 0 ? 'No suggested replies to review.' : 'That’s every suggested reply.') : (count === 0 ? 'No drafts.' : 'That’s every draft.');
  if (v.kind === 'waiting') return count === 0 ? 'Nothing waiting on a reply. Pick Remind if no reply when you send.' : 'That’s everything waiting on a reply.';
  if (v.box === 'inbox' && v.category === 'primary') return count > 0 ? 'That’s everything that matters.' : 'Nothing important left. You’re done.';
  if (v.box === 'inbox' && v.category === 'other') return count > 0 ? 'That’s everything else.' : 'Nothing else in your inbox.';
  if (count > 0) return v.box === 'inbox' ? 'That’s everything in your inbox.' : `That’s everything in ${BOX_NAMES[v.box]}.`;
  if (v.box === 'flagged') return 'No flagged mail. Flag a message to keep it here.';
  if (v.box === 'later') return 'Nothing put off. Press H on a message to bring it back later.';
  if (v.box === 'archive') return 'Nothing done yet. Press E on a message when you’re done with it.';
  if (v.box === 'sent') return 'Nothing sent yet.';
  return 'Your inbox is empty.';
}

/** The drawing an empty list shows: what was searched for, a cleared inbox, or the kind of thing missing. */
export function listEndKind(v: MailState['view'], query: string): EmptyKind {
  if (query) return 'search';
  if ((v.kind === 'box' && v.box === 'inbox') || v.kind === 'waiting') return 'done';
  return 'mail';
}

function ListEnd({ mail, count }: { mail: MailState; count: number }) {
  const canWrite = mail.accounts.length > 0;
  return (
    <EmptyState className="mail-list-end" quiet={count > 0} kind={listEndKind(mail.view, mail.query)}
      action={canWrite && count === 0 && !mail.query ? <Button keys={newKeys()} onClick={mail.compose}>New message</Button> : undefined}>
      {listEndLine(mail.view, count, mail.query)}
    </EmptyState>
  );
}

/**
 * Later (H): when it comes back. The quick choices, each with its time, and a field that takes a time in words
 * ("monday 9am", "in 2 hours"), as Superhuman's Remind Me does.
 */
function LaterPicker({ onPick, onClose }: { onPick: (at: number) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const choices = useMemo(() => laterChoices(), []);
  const typed = text.trim() ? parseLater(text) : null;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector('button')?.focus(); }, []);
  return (
    <div className="mail-later-picker" role="dialog" aria-label="Later" ref={box}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose(); }}>
      <p className="mail-later-title">Bring it back</p>
      {choices.map((c) => (
        <button key={c.id} type="button" className="mail-later-choice" onClick={() => onPick(c.at)}>
          <span>{c.label}</span><span className="mail-when">{c.id === 'today' ? formatWith(c.at, { hour: 'numeric', minute: '2-digit' }) : formatWith(c.at, c.at - Date.now() > 6 * 86_400_000 ? { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
        </button>
      ))}
      <form className="mail-later-words" onSubmit={(e) => { e.preventDefault(); if (typed) onPick(typed); }}>
        <input aria-label="When, in words" placeholder="Monday 9am, in 2 hours…" value={text} onChange={(e) => setText(e.target.value)} />
        <span className="mail-when" role="status">{text.trim() ? (typed ? sendTime(typed) : 'Not a time I know') : ''}</span>
      </form>
    </div>
  );
}

/** The list's header: the inbox's split tabs with their counts, or the name of what the list shows. */
function ListHead({ mail, waiting }: { mail: MailState; waiting: number }) {
  const split = splitOf(mail.view);
  if (!split) return <div className="mail-list-head"><h2 className="mail-list-name">{mailPlace(mail.view)}</h2></div>;
  const count = (id: Split) => (id === 'important' ? mail.counts.primary : id === 'other' ? mail.counts.transactions + mail.counts.updates : waiting);
  return (
    <div className="mail-list-head" role="tablist" aria-label="Inbox" aria-keyshortcuts="Tab Shift+Tab">
      {SPLITS.map((x) => (
        <button key={x.id} type="button" role="tab" className="mail-split" aria-selected={split === x.id} title={`${x.label} (Tab, Shift+Tab)`} onClick={() => mail.setView(x.view)}>
          {x.label}{count(x.id) > 0 && <span className="mail-split-count">{count(x.id)}</span>}
        </button>
      ))}
    </div>
  );
}

/** The Mail app: the list with its split tabs, and the message (with its reply box) or a draft beside it. */
export function MailPage({ mail, onDraftReply }: { mail: MailState; onDraftReply?: (m: MailContent) => void }) {
  const v = mail.view;
  const [adding, setAdding] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ m: MailMessage; x: number; y: number } | null>(null);
  const [waitMenu, setWaitMenu] = useState<{ f: MailFollowUp; x: number; y: number } | null>(null);
  const [laterFor, setLaterFor] = useState<string | null>(null);
  const follow = useFollowUps();
  const waiting = follow.list.filter((f) => f.status !== 'replied');
  const drafts = v.kind === 'drafts' && v.only ? mail.drafts.filter((d) => d.by === v.only) : mail.drafts;
  // A reply to the open message is written in its box under it; any other draft takes the pane.
  const replying = mail.editing && mail.open && mail.editing.replyTo === mail.open.id ? mail.editing : null;
  // J and K (or the arrows) move through the list. E is Done, R replies (Shift+R to all), F forwards, U marks unread, H
  // asks when to bring the open message back. Tab and Shift+Tab move between Important, Waiting and Other. Not while
  // typing, and not with Ctrl or Alt.
  const keys = useRef({ mail, setLaterFor });
  keys.current = { mail, setLaterFor };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { mail: m, setLaterFor: later } = keys.current;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role=menu]');
      // Ctrl+Z (or Z, as in Gmail) takes back the Done, Later or send the toast offers to undo.
      if (m.undo && !typing && !m.editing && !e.defaultPrevented && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); void m.undo.run(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typing || m.editing) return;
      const onList = !t || t === document.body || t.matches('main.stage') || Boolean(t.closest('.mail-page'));
      // Tab moves between the split tabs, from the list or the open message (not from the page's other buttons).
      const split = splitOf(m.view);
      if (e.key === 'Tab' && split && (!t || t === document.body || t.matches('main.stage, .mail-reader, .mail-row, .mail-split'))) {
        e.preventDefault();
        const i = SPLITS.findIndex((x) => x.id === split);
        m.setView(SPLITS[(i + (e.shiftKey ? SPLITS.length - 1 : 1)) % SPLITS.length]!.view);
        return;
      }
      // The up and down arrows (or J and K, as in Gmail) open the message before or after the one open, as in Apple
      // Mail's list. Also from the stage itself, which has the keys once Mail is opened from Ctrl+K.
      const down = e.key === 'ArrowDown' || (e.key === 'j' && !e.shiftKey);
      const up = e.key === 'ArrowUp' || (e.key === 'k' && !e.shiftKey);
      if ((down || up) && m.view.kind === 'box' && m.messages.length > 0 && onList) {
        e.preventDefault();
        const i = m.open ? m.messages.findIndex((x) => x.id === m.open!.id) : -1;
        const next = m.messages[i < 0 ? 0 : Math.max(0, Math.min(m.messages.length - 1, i + (down ? 1 : -1)))]!;
        if (next.id !== m.open?.id) void m.read(next.id).then(() => document.querySelector(`.mail-row[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
        return;
      }
      if (!m.open) return;
      const key = e.key.toLowerCase();
      if (key === 'e') { e.preventDefault(); void m.archive(m.open.id); }
      else if (key === 'r') { e.preventDefault(); m.reply(m.open, e.shiftKey); }
      else if (key === 'f') { e.preventDefault(); m.forward(m.open); }
      else if (key === 'u') { e.preventDefault(); void m.flag(m.open.id, 'seen', false); m.setOpen(null); }
      else if (key === 'h') { e.preventDefault(); later(m.open.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!mail.available) return <section className="mail-page empty" aria-label="Mail"><EmptyState kind="mail">Mail is not available here.</EmptyState></section>;
  // With no account and no drafts there is nothing to show; a draft Mobius kept before any account was added is shown.
  if (mail.accounts.length === 0 && mail.drafts.length === 0) {
    return (
      <section className="mail-page empty" aria-label="Mail">
        <EmptyState kind="mail" action={<Button kind="primary" onClick={() => setAdding(true)}>Add a mail account…</Button>}>Add an account to see your mail here. Mobius reads and drafts; only you send.</EmptyState>
        {adding && <AccountDialog connect={mail.connect} onClose={() => setAdding(false)} />}
      </section>
    );
  }
  const count = v.kind === 'drafts' ? drafts.length : v.kind === 'waiting' ? waiting.length : mail.messages.length;
  const pickLater = (at: number) => { const id = laterFor; setLaterFor(null); if (id) void mail.later(id, at); };
  return (
    <section className="mail-page" aria-label="Mail" data-open={mail.open || mail.editing ? true : undefined}>
      <div className="mail-list-pane">
        <ListHead mail={mail} waiting={waiting.length} />
        {v.kind === 'drafts' ? (
          <div role="listbox" aria-label={mailPlace(v)} className="mail-list">
            {drafts.map((d) => (
              <button key={d.id} type="button" role="option" aria-selected={mail.editing?.id === d.id} className="mail-row" data-suggested={d.by === 'mobius' || undefined} onClick={() => { mail.setOpen(null); mail.setEditing(d); }}>
                <span className="mail-row-who">{d.by === 'mobius' && <MobiusMark size={12} className="mail-row-mark" label="From Mobius" />}{d.to ? `To ${nameFor(d.to, mail.messages)}` : 'No one yet'}</span>
                <span className="mail-row-what"><span className="mail-row-subject">{d.subject || '(no subject)'}</span><span className="mail-row-preview">{d.body.slice(0, 160)}</span></span>
                <span className="mail-row-end"><span className="mail-when">{when(d.updatedMs)}</span></span>
              </button>
            ))}
          </div>
        ) : v.kind === 'waiting' ? (
          <WaitingList mail={mail} waiting={waiting} onStop={(f, x, y) => setWaitMenu({ f, x, y })} />
        ) : (
          <div role="listbox" aria-label="Messages" className="mail-list" aria-keyshortcuts="E R Shift+R F U H">
            {mail.messages.map((m) => <Row key={m.id} m={m} on={mail.open?.id === m.id} onOpen={() => void mail.read(m.id)} onMenu={(x, y) => setRowMenu({ m, x, y })} />)}
          </div>
        )}
        {!mail.loaded ? <ListLoading /> : <ListEnd mail={mail} count={count} />}
      </div>
      <div className="mail-reading-pane">
        {/* Too narrow for the list and a readable message side by side: the message takes the list's place, with Back. */}
        {(mail.open || mail.editing) && <button type="button" className="btn mail-back" onClick={() => { if (mail.editing) mail.setEditing(null); else mail.setOpen(null); }}>‹ Back to {mailPlace(v)}</button>}
        {mail.message && <p className="tasks-message" role="alert">{mail.message}</p>}
        {mail.editing && !replying ? <DraftEditor key={mail.editing.id || 'new'} mail={mail} draft={mail.editing} />
          : mail.open ? <Reader mail={mail} content={mail.open} replying={replying} {...(onDraftReply ? { onDraftReply } : {})} />
            : mail.accounts.length === 0
              ? <EmptyState kind="mail" action={<Button kind="primary" onClick={() => setAdding(true)}>Add a mail account…</Button>}>Drafts are kept here on this computer. Add an account to send them.</EmptyState>
              // Nothing open: the list says where things stand; the reading panel waits quietly with the keys.
              : count > 0 && <p className="mail-reading-idle">↑ ↓ or J K to open a message</p>}
        {laterFor && <LaterPicker onPick={pickLater} onClose={() => setLaterFor(null)} />}
        {adding && mail.accounts.length === 0 && <AccountDialog connect={mail.connect} onClose={() => setAdding(false)} />}
        {/* The keys act on the open message, so their bar sits at the foot of the pane that shows it, and only then. */}
        {/* Not under the Undo toast: both sit at the foot of the message. */}
        {mail.open && !mail.editing && !mail.undo && <KeyHintBar id="mail" label="Mail keys" hints={MAIL_KEYS} />}
      </div>
      {rowMenu && <PointMenu x={rowMenu.x} y={rowMenu.y} label={`${rowMenu.m.subject || 'Message'} menu`} onClose={() => setRowMenu(null)} entries={rowItems(mail, rowMenu.m, setLaterFor)} />}
      {waitMenu && <PointMenu x={waitMenu.x} y={waitMenu.y} label={`${waitMenu.f.subject || 'Message'} menu`} onClose={() => setWaitMenu(null)} entries={[
        ...(waitMenu.f.sentId ? [{ label: 'Open', run: () => void mail.read(waitMenu.f.sentId!) }] : []),
        { label: 'Stop Waiting for a Reply', separated: Boolean(waitMenu.f.sentId), run: () => void follow.set(waitMenu.f.messageId, null) },
      ]} />}
      {mail.undo && (mail.undo.until ? <SendCountdown key={mail.undo.until} text={mail.undo.text} until={mail.undo.until} onUndo={() => void mail.undo?.run()} onDismiss={mail.clearUndo} /> : <UndoToast text={mail.undo.text} onUndo={() => void mail.undo?.run()} onDismiss={mail.clearUndo} />)}
      <MailToolbar mail={mail} onLater={setLaterFor} />
    </section>
  );
}
