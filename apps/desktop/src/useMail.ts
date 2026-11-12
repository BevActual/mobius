import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type MailAccount, type MailCategory, type MailContent, type MailCounts, type MailDraft, type MailMessage } from '@mobius/shared';

/** Inbox and Sent are mirrored mailboxes; Flagged and Archive are the person's flagged and archived mail from both. */
export type MailBox = 'inbox' | 'sent' | 'flagged' | 'archive';
export type MailView = { kind: 'box'; box: MailBox; category: MailCategory | 'all' } | { kind: 'drafts' };

/** What the list shows for a mailbox: Flagged and Archive are read from all mail and picked here. */
export function inBox(box: MailBox, all: readonly MailMessage[]): MailMessage[] {
  if (box === 'flagged') return all.filter((m) => m.flagged);
  if (box === 'archive') return all.filter((m) => m.archived && m.box === 'inbox');
  return [...all];
}

const quoteDate = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const who = (p: { name: string; email: string }) => (p.name ? `${p.name} <${p.email}>` : p.email);

/** A reply's body: room to write, then the message quoted, as Apple Mail does. */
export function quoted(m: MailContent): string {
  const lines = m.text.replace(/\s+$/, '').split('\n').map((l) => (l ? `> ${l}` : '>'));
  return `\n\nOn ${quoteDate(m.dateMs)}, ${who(m.from)} wrote:\n${lines.join('\n')}`;
}

/** A forward's body: room to write, then the message with who it was from and to. */
export function forwarded(m: MailContent): string {
  const head = ['Begin forwarded message:', '', `From: ${who(m.from)}`, `Subject: ${m.subject}`, `Date: ${quoteDate(m.dateMs)}`, `To: ${m.to.map(who).join(', ')}`];
  if (m.cc.length) head.push(`Cc: ${m.cc.map(who).join(', ')}`);
  return `\n\n${head.join('\n')}\n\n${m.text.replace(/\s+$/, '')}`;
}

/** Everyone on a message except you, for Reply All: the sender in To, the rest in Cc. */
export function replyAllTo(m: MailContent, mine: readonly string[]): { to: string; cc: string } {
  const me = new Set(mine.map((e) => e.toLowerCase()));
  const seen = new Set<string>();
  const keep = (p: { email: string }) => { const e = p.email.toLowerCase(); if (!e || me.has(e) || seen.has(e)) return false; seen.add(e); return true; };
  const to = [m.from].filter(keep).map((p) => p.email);
  const cc = [...m.to, ...m.cc].filter(keep).map((p) => p.email);
  return { to: to.join(', ') || m.from.email, cc: cc.join(', ') };
}
const reSubject = (s: string) => (/^re:/i.test(s) ? s : `Re: ${s}`);
const fwdSubject = (s: string) => (/^(fwd?|fw):/i.test(s) ? s : `Fwd: ${s}`);
const NO_COUNTS: MailCounts = { primary: 0, transactions: 0, updates: 0, all: 0, drafts: 0, suggested: 0 };

/** The Mail app's state: accounts, the list on screen, the message open, and drafts. */
export function useMail() {
  const api = window.mobius.mail;
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [view, setView] = useState<MailView>({ kind: 'box', box: 'inbox', category: 'primary' });
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [counts, setCounts] = useState<MailCounts>(NO_COUNTS);
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [open, setOpen] = useState<MailContent | null>(null);
  const [editing, setEditing] = useState<MailDraft | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const live = useRef({ view, query, open });
  live.current = { view, query, open };

  // Several reads of the list can be under way at once (after a change, and when Mail says it changed). Only the
  // newest is shown: one that began before a change would bring back what the change took out of the inbox.
  const reading = useRef(0);
  const refresh = useCallback(async () => {
    if (!api) return;
    const mine = ++reading.current;
    const v = live.current.view;
    const [a, list, c, d] = await Promise.all([api.accounts(), v.kind === 'box' ? (v.box === 'inbox' || v.box === 'sent' ? api.list(v.box, v.category, live.current.query) : api.list('all', 'all', live.current.query))  : Promise.resolve([] as MailMessage[]), api.counts(), api.drafts()]);
    if (mine !== reading.current) return;
    if (!isNotesFailure(a)) setAccounts(a);
    if (!isNotesFailure(list)) setMessages(v.kind === 'box' ? inBox(v.box, list) : list);
    if (!isNotesFailure(c)) setCounts(c);
    if (!isNotesFailure(d)) setDrafts(d);
  }, [api]);

  useEffect(() => { void refresh(); }, [view, query, refresh]);
  useEffect(() => api?.onChanged(() => void refresh()), [api, refresh]);

  const read = useCallback(async (id: string) => {
    const got = await api?.read(id);
    if (!got) return;
    if (isNotesFailure(got)) { setMessage(got.message); return; }
    setOpen(got);
    setEditing(null);
    setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, seen: true } : m)));
    void api?.counts().then((c) => { if (!isNotesFailure(c)) setCounts(c); });
  }, [api]);

  const connect = useCallback(async (account: Parameters<NonNullable<typeof api>['connect']>[0]): Promise<string | null> => {
    if (!api) return 'Mail is not available.';
    const result = await api.connect(account);
    if (isNotesFailure(result)) return result.message;
    await refresh();
    return null;
  }, [api, refresh]);

  const sync = useCallback(async () => {
    if (!api) return;
    setSyncing(true);
    try { await api.sync(null); await refresh(); } finally { setSyncing(false); }
  }, [api, refresh]);

  const removeAccount = useCallback(async (id: string) => { await api?.removeAccount(id); setOpen(null); await refresh(); }, [api, refresh]);
  const sort = useCallback(async (id: string, category: MailCategory) => { await api?.sort(id, category); await refresh(); }, [api, refresh]);
  /** Flag, or Mark as Unread / Read: shown at once, then kept. */
  const flag = useCallback(async (id: string, which: 'flagged' | 'seen', on: boolean) => {
    setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, [which]: on } : m)));
    const done = await api?.flag(id, which, on);
    if (done && isNotesFailure(done)) setMessage(done.message);
    await refresh();
  }, [api, refresh]);

  /** Saves a draft (the person's), returning it as kept. */
  const saveDraft = useCallback(async (draft: Partial<MailDraft>) => {
    const got = await api?.saveDraft(draft);
    if (!got) return null;
    if (isNotesFailure(got)) { setMessage(got.message); return null; }
    setDrafts((cur) => [got, ...cur.filter((d) => d.id !== got.id)]);
    return got;
  }, [api]);

  const deleteDraft = useCallback(async (id: string) => {
    await api?.deleteDraft(id);
    setDrafts((cur) => cur.filter((d) => d.id !== id));
    setEditing((cur) => (cur?.id === id ? null : cur));
  }, [api]);

  /** Sends, only when the person presses Send. */
  const send = useCallback(async (draft: MailDraft): Promise<string | null> => {
    if (!api) return 'Mail is not available.';
    const saved = await api.saveDraft(draft);
    if (isNotesFailure(saved)) return saved.message;
    const done = await api.send(saved.id);
    if (isNotesFailure(done)) return done.message;
    setEditing(null);
    await refresh();
    return null;
  }, [api, refresh]);

  /** The message after this one in the list (or the one before, at the end), to open when this one leaves it. */
  const after = (id: string): string | null => {
    const i = messages.findIndex((m) => m.id === id);
    if (i < 0) return null;
    return messages[i + 1]?.id ?? messages[i - 1]?.id ?? null;
  };
  /** E: out of the inbox (still in Archive and search), or back in it. The next message opens. */
  const archive = useCallback(async (id: string, on = true) => {
    const next = live.current.open?.id === id ? after(id) : null;
    reading.current += 1;
    const done = await api?.archive?.(id, on);
    if (!done || isNotesFailure(done)) { if (done) setMessage(done.message); return; }
    setOpen((cur) => (cur?.id === id ? null : cur));
    await refresh();
    if (next) await read(next);
  }, [api, refresh, read, messages]); // eslint-disable-line react-hooks/exhaustive-deps
  /** H: back in the inbox tomorrow at 8:00. */
  const remindTomorrow = useCallback(async (id: string) => {
    const at = new Date(); at.setDate(at.getDate() + 1); at.setHours(8, 0, 0, 0);
    const next = live.current.open?.id === id ? after(id) : null;
    reading.current += 1;
    const done = await api?.remind?.(id, at.getTime());
    if (!done || isNotesFailure(done)) { if (done) setMessage(done.message); return; }
    setOpen((cur) => (cur?.id === id ? null : cur));
    await refresh();
    if (next) await read(next);
  }, [api, refresh, read, messages]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Send later, as the person chose (null: unschedule). True when it is set. */
  const schedule = useCallback(async (id: string, at: number | null) => {
    const done = await api?.schedule?.(id, at);
    if (!done || isNotesFailure(done)) { if (done) setMessage(done.message); return false; }
    setDrafts((cur) => cur.map((d) => (d.id === id ? done : d)));
    return true;
  }, [api]);

  const reply = useCallback((to: MailContent, all = false) => {
    const people = all ? replyAllTo(to, accounts.map((a) => a.email)) : { to: to.from.email, cc: '' };
    setEditing({ id: '', account: '', ...people, subject: reSubject(to.subject), body: quoted(to), replyTo: to.id, by: 'you', why: '', updatedMs: 0 });
  }, [accounts]);
  const forward = useCallback((m: MailContent) => {
    setEditing({ id: '', account: accounts[0]?.id ?? '', to: '', cc: '', subject: fwdSubject(m.subject), body: forwarded(m), replyTo: null, by: 'you', why: '', updatedMs: 0 });
  }, [accounts]);
  const compose = useCallback(() => {
    setOpen(null);
    setEditing({ id: '', account: accounts[0]?.id ?? '', to: '', cc: '', subject: '', body: '', replyTo: null, by: 'you', why: '', updatedMs: 0 });
  }, [accounts]);

  return { available: api !== undefined, accounts, view, setView, query, setQuery, messages, counts, drafts, open, setOpen, read, editing, setEditing, connect, sync, syncing, removeAccount, sort, flag, saveDraft, deleteDraft, send, reply, forward, compose, message, refresh, archive, remindTomorrow, schedule };
}

export type MailState = ReturnType<typeof useMail>;
