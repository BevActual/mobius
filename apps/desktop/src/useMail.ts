import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { formatWith } from './dates';
import { usePreferences } from './usePreferences';
import { threadKey, threads } from './mail-threads';
import { isNotesFailure, type MailAccount, type MailCategory, type MailContent, type MailCounts, type MailDraft, type MailMessage } from '@mobius/shared';

/** How long Send waits, with Undo, before the message goes. */
export const UNDO_SEND_MS = 5000;

/**
 * Inbox and Sent are mirrored mailboxes; Flagged, Later and Done (archive) are picked from all mail. The inbox splits
 * as Superhuman's split inbox does: Important (the Primary label), Other (the rest), and Waiting, sent mail that waits
 * on a reply.
 */
export type MailBox = 'inbox' | 'sent' | 'flagged' | 'later' | 'archive';
export type MailView = { kind: 'box'; box: MailBox; category: MailCategory | 'all' | 'other' } | { kind: 'drafts'; only?: 'mobius' } | { kind: 'waiting' };

/** Where Mail opens: the inbox's Important tab. */
export const IMPORTANT: MailView = { kind: 'box', box: 'inbox', category: 'primary' };

/** What the list shows for a mailbox: Flagged, Later and Done are read from all mail and picked here. */
export function inBox(box: MailBox, all: readonly MailMessage[], category: MailCategory | 'all' | 'other' = 'all', now = Date.now()): MailMessage[] {
  if (box === 'flagged') return all.filter((m) => m.flagged);
  if (box === 'archive') return all.filter((m) => m.archived && m.box === 'inbox');
  if (box === 'later') return all.filter((m) => m.box === 'inbox' && !m.archived && (m.laterMs ?? 0) > now).sort((a, b) => (a.laterMs ?? 0) - (b.laterMs ?? 0));
  if (category === 'other') return all.filter((m) => m.category !== 'primary');
  return [...all];
}

const quoteDate = (ms: number) => (ms ? formatWith(ms, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const who = (p: { name: string; email: string }) => (p.name ? `${p.name} <${p.email}>` : p.email);

/** A reply's body: room to write, then the message quoted, as Apple Mail does. */
export function quoted(m: MailContent): string {
  const lines = m.text.replace(/\s+$/, '').split('\n').map((l) => (l ? `> ${l}` : '>'));
  return `\n\nOn ${quoteDate(m.dateMs)}, ${who(m.from)} wrote:\n${lines.join('\n')}`;
}

/** A body with the account's signature under where the person writes, above any quoted or forwarded message. */
export function withSignature(body: string, signature: string | undefined): string {
  const sig = signature?.trim();
  return sig ? `\n\n-- \n${sig}${body}` : body;
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
/** "tomorrow at 8:00", "Sat at 9:00", "at 13:15": when a put-off message comes back, for its Undo toast and its row. */
export function backAt(at: number, now = new Date()): string {
  const d = new Date(at);
  const time = formatWith(at, { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(now)) / 86_400_000);
  if (days === 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days < 7) return `${formatWith(at, { weekday: 'short' })} at ${time}`;
  return `${formatWith(at, { day: 'numeric', month: 'short' })} at ${time}`;
}
const NO_COUNTS: MailCounts = { primary: 0, transactions: 0, updates: 0, all: 0, drafts: 0, suggested: 0 };

/** The Mail app's state: accounts, the list on screen, the message open, and drafts. */
export function useMail() {
  const api = window.mobius.mail;
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [view, setView] = useState<MailView>(IMPORTANT);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [counts, setCounts] = useState<MailCounts>(NO_COUNTS);
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [open, setShown] = useState<MailContent | null>(null);
  // The newest open or close wins: a message that comes back from the host after the person closed it (Mark as
  // Unread closes it) or opened another stays closed.
  const opens = useRef(0);
  const setOpen = useCallback((next: SetStateAction<MailContent | null>) => { opens.current += 1; setShown(next); }, []);
  const [editing, setEditing] = useState<MailDraft | null>(null);
  const [syncing, setSyncing] = useState(false);
  /** False until the first list has come back: the list shows placeholder bars until then. */
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  /** What the last archive or Remind me did, offered back for a while in the shared Undo toast. */
  const [undo, setUndo] = useState<{ text: string; run: () => Promise<void>; /** When a held send goes out: the toast counts down to it. */ until?: number } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);
  const clearUndo = useCallback(() => setUndo(null), []);
  const subjectOf = (id: string) => messages.find((m) => m.id === id)?.subject || live.current.open?.subject || 'the message';
  const live = useRef({ view, query, open });
  live.current = { view, query, open };

  // Several reads of the list can be under way at once (after a change, and when Mail says it changed). Only the
  // newest is shown: one that began before a change would bring back what the change took out of the inbox.
  const reading = useRef(0);
  const refresh = useCallback(async () => {
    if (!api) return;
    const mine = ++reading.current;
    const v = live.current.view;
    const [a, list, c, d] = await Promise.all([api.accounts(), v.kind === 'box' ? (v.box === 'inbox' || v.box === 'sent' ? api.list(v.box, v.category === 'other' ? 'all' : v.category, live.current.query) : api.list('all', 'all', live.current.query)) : Promise.resolve([] as MailMessage[]), api.counts(), api.drafts()]);
    if (mine !== reading.current) return;
    if (!isNotesFailure(a)) setAccounts(a);
    if (!isNotesFailure(list)) setMessages(v.kind === 'box' ? inBox(v.box, list, v.category) : list);
    if (!isNotesFailure(c)) setCounts(c);
    if (!isNotesFailure(d)) setDrafts(d);
    setLoaded(true);
  }, [api]);

  useEffect(() => { void refresh(); }, [view, query, refresh]);
  useEffect(() => api?.onChanged(() => void refresh()), [api, refresh]);

  // Counts Flag and Mark as Unread / Read. A message opening shows as read only if neither came while it opened:
  // Mark as Unread pressed then is the person's last word, and the open must not paint it read again.
  const marking = useRef(0);
  const read = useCallback(async (id: string) => {
    const before = marking.current;
    const mine = ++opens.current;
    const got = await api?.read(id);
    if (!got) return;
    if (isNotesFailure(got)) { setMessage(got.message); return; }
    if (mine !== opens.current) return;
    setShown(got);
    setEditing(null);
    if (marking.current === before) setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, seen: true } : m)));
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
    marking.current += 1;
    // A read of the list already under way began before this mark: dropped, so it cannot paint the old state back
    // over the one shown here. The read after the host has kept the mark is the one shown.
    reading.current += 1;
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

  /**
   * Sends, only when the person presses Send, and only after UNDO_SEND_MS: until then Undo takes it back and opens it
   * again, as in Gmail. It waits as a saved draft, so if Mobius closes in those seconds it stays in Drafts, unsent.
   */
  const [holding, setHolding] = useState<ReadonlySet<string>>(() => new Set());
  const send = useCallback(async (draft: MailDraft): Promise<string | null> => {
    if (!api) return 'Mail is not available.';
    const saved = await api.saveDraft(draft);
    if (isNotesFailure(saved)) return saved.message;
    setEditing(null);
    const hold = (on: boolean) => setHolding((cur) => { const next = new Set(cur); if (on) next.add(saved.id); else next.delete(saved.id); return next; });
    hold(true);
    const label = saved.subject.trim() ? `“${saved.subject.trim()}”` : 'your message';
    let undone = false;
    const timer = setTimeout(() => {
      if (undone) return;
      setUndo((cur) => (cur?.text.startsWith('Sending') && cur.text.includes(label) ? null : cur));
      void api.send(saved.id).then(async (done) => {
        hold(false);
        if (isNotesFailure(done)) { setMessage(`${label} wasn't sent: ${done.message} It's in Drafts.`); return; }
        await refresh();
      });
    }, UNDO_SEND_MS);
    setUndo({ text: `Sending ${label}`, until: Date.now() + UNDO_SEND_MS, run: async () => { undone = true; clearTimeout(timer); setUndo(null); hold(false); setEditing(saved); } });
    return null;
  }, [api, refresh]);

  /** The list as conversations, as Gmail and Superhuman show it: one row for each, its latest message on top. */
  const rows = useMemo(() => threads(messages), [messages]);
  /** Every message in the list that is in the same conversation as this one (just this one if it is not listed). */
  const sameThread = (id: string): string[] => {
    const m = messages.find((x) => x.id === id);
    if (!m) return [id];
    const key = threadKey(m);
    return messages.filter((x) => threadKey(x) === key).map((x) => x.id);
  };
  /** The conversation after this one in the list (or the one before, at the end), to open when this one leaves it. */
  const after = (id: string): string | null => {
    const i = rows.findIndex((t) => t.messages.some((m) => m.id === id));
    if (i < 0) return null;
    return rows[i + 1]?.latest.id ?? rows[i - 1]?.latest.id ?? null;
  };
  /**
   * E: the whole conversation out of the inbox (still in Archive and search), or back in it. The next one opens.
   * Undo puts back just what this took out.
   */
  const archive = useCallback(async (id: string, on = true) => {
    const ids = sameThread(id);
    const open = live.current.open?.id;
    const next = open && ids.includes(open) ? after(id) : null;
    reading.current += 1;
    for (const one of ids) {
      const done = await api?.archive?.(one, on);
      if (!done || isNotesFailure(done)) { if (done) setMessage(done.message); return; }
    }
    setOpen((cur) => (cur && ids.includes(cur.id) ? null : cur));
    setUndo(on ? { text: `Done: “${subjectOf(id)}”`, run: async () => { setUndo(null); for (const one of ids) await api?.archive?.(one, false); await refresh(); } } : null);
    await refresh();
    if (next) await read(next);
  }, [api, refresh, read, messages, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  /** H: the whole conversation out of the inbox until `at`, then back at its top (null: back now). The next one opens. */
  const later = useCallback(async (id: string, at: number | null) => {
    const ids = sameThread(id);
    const open = live.current.open?.id;
    const next = at !== null && open && ids.includes(open) ? after(id) : null;
    reading.current += 1;
    for (const one of ids) {
      const done = await api?.remind?.(one, at);
      if (!done || isNotesFailure(done)) { if (done) setMessage(done.message); return; }
    }
    if (at !== null) {
      setOpen((cur) => (cur && ids.includes(cur.id) ? null : cur));
      setUndo({ text: `“${subjectOf(id)}” comes back ${backAt(at)}`, run: async () => { setUndo(null); for (const one of ids) await api?.remind?.(one, null); await refresh(); } });
    }
    await refresh();
    if (next) await read(next);
  }, [api, refresh, read, messages, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Send later, as the person chose (null: unschedule). True when it is set. */
  const schedule = useCallback(async (id: string, at: number | null) => {
    const done = await api?.schedule?.(id, at);
    if (!done || isNotesFailure(done)) { if (done) setMessage(done.message); return false; }
    setDrafts((cur) => cur.map((d) => (d.id === id ? done : d)));
    return true;
  }, [api]);

  // Each account's signature, from Settings › Mail; a reply goes from the first account unless the host picks another.
  const { value: preferences } = usePreferences();
  const signatures = preferences.mailSignatures;
  const signatureOf = useCallback((account: string) => signatures?.[account || accounts[0]?.id || ''] ?? '', [signatures, accounts]);
  const reply = useCallback((to: MailContent, all = false) => {
    const people = all ? replyAllTo(to, accounts.map((a) => a.email)) : { to: to.from.email, cc: '' };
    setEditing({ id: '', account: '', ...people, subject: reSubject(to.subject), body: withSignature(quoted(to), signatureOf('')), replyTo: to.id, by: 'you', why: '', updatedMs: 0 });
  }, [accounts, signatureOf]);
  const forward = useCallback((m: MailContent) => {
    setEditing({ id: '', account: accounts[0]?.id ?? '', to: '', cc: '', subject: fwdSubject(m.subject), body: withSignature(forwarded(m), signatureOf(accounts[0]?.id ?? '')), replyTo: null, by: 'you', why: '', updatedMs: 0 });
  }, [accounts, signatureOf]);
  const compose = useCallback(() => {
    setOpen(null);
    setEditing({ id: '', account: accounts[0]?.id ?? '', to: '', cc: '', subject: '', body: withSignature('', signatureOf(accounts[0]?.id ?? '')), replyTo: null, by: 'you', why: '', updatedMs: 0 });
  }, [accounts, signatureOf]);

  // A message waiting out its Undo seconds is not shown as a draft.
  const shownDrafts = useMemo(() => (holding.size === 0 ? drafts : drafts.filter((d) => !holding.has(d.id))), [drafts, holding]);
  return { available: api !== undefined, loaded, accounts, view, setView, query, setQuery, messages, rows, counts, drafts: shownDrafts, open, setOpen, read, editing, setEditing, connect, sync, syncing, removeAccount, sort, flag, saveDraft, deleteDraft, send, reply, forward, compose, undo, clearUndo, message, refresh, archive, later, schedule };
}

export type MailState = ReturnType<typeof useMail>;
