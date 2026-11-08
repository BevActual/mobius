import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type MailAccount, type MailCategory, type MailContent, type MailCounts, type MailDraft, type MailMessage } from '@mobius/shared';

export type MailView = { kind: 'box'; box: 'inbox' | 'sent'; category: MailCategory | 'all' } | { kind: 'drafts' };
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

  const refresh = useCallback(async () => {
    if (!api) return;
    const v = live.current.view;
    const [a, list, c, d] = await Promise.all([api.accounts(), v.kind === 'box' ? api.list(v.box, v.category, live.current.query) : Promise.resolve([] as MailMessage[]), api.counts(), api.drafts()]);
    if (!isNotesFailure(a)) setAccounts(a);
    if (!isNotesFailure(list)) setMessages(list);
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
  const flag = useCallback(async (id: string, on: boolean) => { await api?.flag(id, 'flagged', on); await refresh(); }, [api, refresh]);

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

  const reply = useCallback((to: MailContent) => {
    setEditing({ id: '', account: '', to: to.from.email, cc: '', subject: /^re:/i.test(to.subject) ? to.subject : `Re: ${to.subject}`, body: '', replyTo: to.id, by: 'you', why: '', updatedMs: 0 });
  }, []);
  const compose = useCallback(() => {
    setOpen(null);
    setEditing({ id: '', account: accounts[0]?.id ?? '', to: '', cc: '', subject: '', body: '', replyTo: null, by: 'you', why: '', updatedMs: 0 });
  }, [accounts]);

  return { available: api !== undefined, accounts, view, setView, query, setQuery, messages, counts, drafts, open, setOpen, read, editing, setEditing, connect, sync, syncing, removeAccount, sort, flag, saveDraft, deleteDraft, send, reply, compose, message, refresh };
}

export type MailState = ReturnType<typeof useMail>;
