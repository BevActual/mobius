import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MailCategory, MailContent, MailDraft, MailMessage } from '@mobius/shared';
import type { MailState } from './useMail';
import { ReviewActions } from './ReviewBar';

const CATEGORIES: { id: MailCategory | 'all'; label: string }[] = [
  { id: 'primary', label: 'Primary' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'updates', label: 'Updates' },
  { id: 'all', label: 'All' },
];

const PRESETS = [
  { id: 'icloud', name: 'iCloud', help: 'Use an app-specific password, made at account.apple.com under Sign-In and Security.' },
  { id: 'fastmail', name: 'Fastmail', help: 'Use an app password from Settings › Privacy & Security › Manage app passwords, with access to mail.' },
  { id: 'gmail', name: 'Gmail', help: 'Turn on 2-Step Verification, then make an app password at myaccount.google.com/apppasswords.' },
  { id: 'yahoo', name: 'Yahoo', help: 'Make an app password in Yahoo Account Security.' },
  { id: 'other', name: 'Another provider', help: 'Your provider lists its IMAP and SMTP servers; most need an app password.' },
] as const;

/** "9:02" today, "Thu" this week, "3 Nov" before. */
export function when(ms: number, now = new Date()): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (now.getTime() - ms < 6 * 86_400_000 && ms <= now.getTime()) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const initials = (name: string, email: string) => (name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const shownName = (p: { name: string; email: string }) => p.name || p.email;

function AccountDialog({ mail, onClose }: { mail: MailState; onClose: () => void }) {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['id']>('icloud');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [imap, setImap] = useState('');
  const [smtp, setSmtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const p = PRESETS.find((x) => x.id === preset)!;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    const host = (t: string, port: number) => { const [h, n] = t.trim().split(':'); return { host: h ?? '', port: Number(n) || port }; };
    const i = host(imap, 993);
    const s = host(smtp, 465);
    const failed = await mail.connect({ preset, email: email.trim(), password, ...(preset === 'other' ? { imapHost: i.host, imapPort: i.port, smtpHost: s.host, smtpPort: s.port } : {}) });
    setBusy(false);
    if (failed) setProblem(failed); else onClose();
  };
  return createPortal(
    <div className="cal-modal-layer">
      <div className="cal-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <form className="cal-editor" role="dialog" aria-modal="true" aria-label="Add a mail account" onSubmit={(e) => void submit(e)} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
          <h2 className="cal-editor-heading">Add a mail account</h2>
          <label className="cal-editor-row"><span>Provider</span>
            <select aria-label="Provider" value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}>{PRESETS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          <input aria-label="Email address" placeholder="Email address" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <input aria-label="App password" placeholder="App password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {preset === 'other' && (
            <>
              <input aria-label="Incoming server (IMAP)" placeholder="imap.example.com:993" required value={imap} onChange={(e) => setImap(e.target.value)} />
              <input aria-label="Outgoing server (SMTP)" placeholder="smtp.example.com:465" required value={smtp} onChange={(e) => setSmtp(e.target.value)} />
            </>
          )}
          <p className="cal-editor-note">{p.help} The password is kept in this computer's secret store. Mail from the last 45 days is kept here; Mobius never sends mail itself.</p>
          {problem && <p className="tasks-message" role="alert">{problem}</p>}
          <div className="cal-editor-actions">
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/** Mailboxes, drafts and accounts. */
export function MailSidebar({ mail, pin }: { mail: MailState; pin?: ReactNode }) {
  const [adding, setAdding] = useState(false);
  const v = mail.view;
  const here = (kind: 'inbox' | 'sent' | 'drafts') => (kind === 'drafts' ? v.kind === 'drafts' : v.kind === 'box' && v.box === kind) ? 'page' : undefined;
  return (
    <aside className="side mail-side" aria-label="Mail sidebar">
      <div className="side-head">
        <span className="side-title">Mailboxes</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="Get mail" title="Get mail now" disabled={mail.syncing || mail.accounts.length === 0} onClick={() => void mail.sync()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v4h-4" /></svg>
          </button>
        </span>
      </div>
      <nav className="task-lists" aria-label="Mailboxes">
        <button type="button" className="side-new-row" aria-label="New message" title={mail.accounts.length === 0 ? 'Add a mail account first' : 'New message'} disabled={mail.accounts.length === 0} onClick={mail.compose}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
          <span>New message</span>
        </button>
        <ul role="list">
          <li><button type="button" className="list-row" aria-current={here('inbox')} onClick={() => mail.setView({ kind: 'box', box: 'inbox', category: v.kind === 'box' ? v.category : 'primary' })}><span className="list-name">Inbox</span><span className="list-count">{mail.counts.all || ''}</span></button></li>
          <li><button type="button" className="list-row" aria-current={here('drafts')} onClick={() => mail.setView({ kind: 'drafts' })}><span className="list-name">Drafts</span><span className="list-count">{mail.counts.drafts + mail.counts.suggested || ''}</span></button></li>
          <li><button type="button" className="list-row" aria-current={here('sent')} onClick={() => mail.setView({ kind: 'box', box: 'sent', category: 'all' })}><span className="list-name">Sent</span></button></li>
        </ul>
        <div className="list-divider" role="separator" />
        <ul role="list" aria-label="Mail accounts">
          {mail.accounts.map((a) => (
            <li key={a.id} className="mail-account">
              <span className="list-name" title={a.email}>{a.email}</span>
              <button type="button" className="strip-btn" aria-label={`Remove ${a.email}`} title="Remove this account from Mobius" onClick={() => void mail.removeAccount(a.id)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
              </button>
              {a.problem && <p className="calendar-account-problem" role="alert">{a.problem}</p>}
            </li>
          ))}
        </ul>
        <button type="button" className="calendar-add-account" onClick={() => setAdding(true)}>Add a mail account…</button>
      </nav>
      {adding && <AccountDialog mail={mail} onClose={() => setAdding(false)} />}
    </aside>
  );
}

/** An email's HTML, shown without scripts and without loading anything from the web (no tracking pixels). */
function HtmlBody({ html }: { html: string }) {
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:0;color:#1d1d1f;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`, [html]);
  const [height, setHeight] = useState(400);
  return <iframe className="mail-html" title="Message" sandbox="allow-same-origin" srcDoc={doc} style={{ height }} onLoad={(e) => { const b = e.currentTarget.contentDocument?.body; if (b) setHeight(Math.min(6000, b.scrollHeight + 24)); }} />;
}

function DraftEditor({ mail, draft }: { mail: MailState; draft: MailDraft }) {
  const [d, setD] = useState(draft);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => setD(draft), [draft.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = async (next: MailDraft) => { const saved = await mail.saveDraft({ ...next, by: 'you' }); if (saved) setD((cur) => ({ ...cur, id: saved.id, account: saved.account })); };
  const send = async () => {
    setSending(true);
    setProblem(await mail.send({ ...d, by: 'you' }));
    setSending(false);
  };
  return (
    <form className="mail-compose" aria-label={d.replyTo ? 'Reply' : 'New message'} onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label className="mail-field"><span>To</span><input aria-label="To" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} onBlur={() => void keep(d)} /></label>
      <label className="mail-field"><span>Cc</span><input aria-label="Cc" value={d.cc} onChange={(e) => setD({ ...d, cc: e.target.value })} onBlur={() => void keep(d)} /></label>
      <label className="mail-field"><span>Subject</span><input aria-label="Subject" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} onBlur={() => void keep(d)} /></label>
      <textarea aria-label="Message" value={d.body} rows={12} onChange={(e) => setD({ ...d, body: e.target.value })} onBlur={() => void keep(d)} />
      {problem && <p className="tasks-message" role="alert">{problem}</p>}
      <div className="cal-editor-actions">
        {d.id && <button type="button" className="btn cal-delete" onClick={() => void mail.deleteDraft(d.id)}>Delete Draft</button>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => { void keep(d); mail.setEditing(null); }}>Close</button>
        <button type="submit" className="btn primary" disabled={sending || !d.to.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      </div>
    </form>
  );
}

/** A reply Mobius suggested: dashed until the person keeps it (it opens as their draft), discards it or asks for another. */
function Suggested({ mail, draft }: { mail: MailState; draft: MailDraft }) {
  return (
    <div className="mail-suggested" aria-label="Suggested reply">
      <span className="mail-suggested-head">Suggested reply</span>
      {draft.why && <span className="review-why">Why this: {draft.why}</span>}
      <p className="mail-suggested-body">{draft.body}</p>
      <div className="mail-suggested-actions">
        <ReviewActions onKeep={() => mail.setEditing({ ...draft, by: 'you' })} onDiscard={() => mail.deleteDraft(draft.id)} keepTitle="Keep it: it opens as your draft, to change and send" discardTitle="Delete this suggestion" />
        <span>Mobius never sends. You press Send.</span>
      </div>
    </div>
  );
}

function Reader({ mail, content, onDraftReply }: { mail: MailState; content: MailContent; onDraftReply?: (m: MailContent) => void }) {
  const suggestions = mail.drafts.filter((d) => d.by === 'mobius' && d.replyTo === content.id);
  const [showHtml, setShowHtml] = useState(true);
  return (
    <article className="mail-reader" aria-label={content.subject || 'Message'}>
      <header className="mail-reader-head">
        <span className="mail-avatar" aria-hidden="true">{initials(content.from.name, content.from.email)}</span>
        <div className="mail-reader-who">
          <div><b>{shownName(content.from)}</b> <span className="mail-when">{content.dateMs ? new Date(content.dateMs).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</span></div>
          <div className="mail-subject">{content.subject || '(no subject)'}</div>
          <div className="mail-to">To: {content.to.map(shownName).join(', ') || 'you'}</div>
        </div>
      </header>
      <div className="mail-reader-actions">
        <button type="button" className="btn" onClick={() => mail.reply(content)}>Reply</button>
        {onDraftReply && <button type="button" className="btn mobius" onClick={() => onDraftReply(content)}>Draft a reply with Mobius</button>}
        <select aria-label="Category" value={content.category ?? 'primary'} onChange={(e) => void mail.sort(content.id, e.target.value as MailCategory).then(() => mail.read(content.id))}>
          {CATEGORIES.filter((c) => c.id !== 'all').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        {content.html && <button type="button" className="btn" aria-pressed={!showHtml} onClick={() => setShowHtml((s) => !s)}>{showHtml ? 'Plain text' : 'Formatted'}</button>}
      </div>
      {suggestions.map((d) => <Suggested key={d.id} mail={mail} draft={d} />)}
      {content.html && showHtml ? <HtmlBody html={content.html} /> : <pre className="mail-text">{content.text}</pre>}
      {content.attachments.length > 0 && <p className="mail-attachments">Attached: {content.attachments.join(', ')}</p>}
    </article>
  );
}

function Row({ m, on, onOpen }: { m: MailMessage; on: boolean; onOpen: () => void }) {
  const who = m.box === 'sent' ? `To ${m.to.map(shownName).join(', ')}` : shownName(m.from);
  return (
    <button type="button" role="option" aria-selected={on} className="mail-row" data-unread={!m.seen || undefined} onClick={onOpen}>
      <span className="mail-row-top"><b>{who}</b><span className="mail-when">{when(m.dateMs)}</span></span>
      <span className="mail-row-subject">{m.subject || '(no subject)'}</span>
      <span className="mail-row-preview">{m.preview}</span>
    </button>
  );
}

/** The Mail app: categories, the list, and the message or draft open beside it. */
export function MailPage({ mail, onDraftReply }: { mail: MailState; onDraftReply?: (m: MailContent) => void }) {
  const v = mail.view;
  if (!mail.available) return <section className="mail-page empty" aria-label="Mail"><p className="note-empty">Mail is not available here.</p></section>;
  if (mail.accounts.length === 0) {
    return (
      <section className="mail-page empty" aria-label="Mail">
        <p className="note-empty">Add a mail account in the sidebar to see your mail here. Mobius reads and drafts; only you send.</p>
      </section>
    );
  }
  return (
    <section className="mail-page" aria-label="Mail">
      <div className="mail-list-pane">
        {v.kind === 'box' && v.box === 'inbox' && (
          <div className="mail-cats" role="tablist" aria-label="Categories">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={v.category === c.id} onClick={() => mail.setView({ kind: 'box', box: 'inbox', category: c.id })}>
                {c.label}{c.id !== 'all' && mail.counts[c.id] ? <span className="mail-cat-count">{mail.counts[c.id]}</span> : null}
              </button>
            ))}
          </div>
        )}
        <input className="side-search mail-search" type="search" aria-label="Search mail" placeholder="Search" value={mail.query} onChange={(e) => mail.setQuery(e.target.value)} />
        {v.kind === 'drafts' ? (
          <div role="listbox" aria-label="Drafts" className="mail-list">
            {mail.drafts.length === 0 && <p className="side-empty">No drafts.</p>}
            {mail.drafts.map((d) => (
              <button key={d.id} type="button" role="option" aria-selected={mail.editing?.id === d.id} className="mail-row" data-suggested={d.by === 'mobius' || undefined} onClick={() => { mail.setOpen(null); mail.setEditing(d); }}>
                <span className="mail-row-top"><b>{d.to || 'No one yet'}</b><span className="mail-when">{d.by === 'mobius' ? 'Suggested' : when(d.updatedMs)}</span></span>
                <span className="mail-row-subject">{d.subject || '(no subject)'}</span>
                <span className="mail-row-preview">{d.body.slice(0, 160)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div role="listbox" aria-label="Messages" className="mail-list">
            {mail.messages.length === 0 && <p className="side-empty">{mail.query ? 'Nothing matches.' : 'Nothing here.'}</p>}
            {mail.messages.map((m) => <Row key={m.id} m={m} on={mail.open?.id === m.id} onOpen={() => void mail.read(m.id)} />)}
          </div>
        )}
      </div>
      <div className="mail-reading-pane">
        {mail.message && <p className="tasks-message" role="alert">{mail.message}</p>}
        {mail.editing ? <DraftEditor key={mail.editing.id || 'new'} mail={mail} draft={mail.editing} />
          : mail.open ? <Reader mail={mail} content={mail.open} {...(onDraftReply ? { onDraftReply } : {})} />
            : <p className="note-empty">Choose a message.</p>}
      </div>
    </section>
  );
}
