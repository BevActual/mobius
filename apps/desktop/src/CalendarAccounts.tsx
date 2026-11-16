import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { isNotesFailure, type CalendarAccount } from '@mobius/shared';
import { Row, Empty } from './settings/primitives';
import { CALENDAR_ACCOUNTS_EVENT } from './calendar-view';

/**
 * Calendar accounts: a subscribed link, a CalDAV account, or a Google or Microsoft account, added and removed in Settings › Calendar
 * so the Calendar sidebar holds only calendars. Kept out of Calendar.tsx so Settings does not load the whole app.
 */

const told = () => window.dispatchEvent(new Event(CALENDAR_ACCOUNTS_EVENT));

type NewAccount = { kind: 'subscription'; name: string; link: string } | { kind: 'caldav'; name: string; server: string; username: string; password: string };

const PRESETS = [
  { id: 'icloud', name: 'iCloud', server: 'https://caldav.icloud.com', user: 'Apple Account email', help: 'Use an app-specific password, made at account.apple.com under Sign-In and Security. Your Apple Account password will not work here.' },
  { id: 'fastmail', name: 'Fastmail', server: 'https://caldav.fastmail.com/dav/', user: 'Fastmail email', help: 'Use an app password, made in Fastmail under Settings › Privacy & Security › Manage app passwords, with access to calendars (CalDAV).' },
  { id: 'other', name: 'Nextcloud or another server', server: '', user: 'Account name', help: 'Nextcloud\'s address ends in /remote.php/dav. Most servers take an app password, made in their security settings.' },
] as const;

type SignInService = 'google' | 'microsoft';
const SERVICE: Record<SignInService, { name: string; page: string; button: string }> = {
  google: { name: 'Google', page: 'Google’s', button: 'Sign in with Google' },
  microsoft: { name: 'Outlook', page: 'Microsoft’s', button: 'Sign in with Microsoft' },
};

/** Signs in to Google or Microsoft in the browser: answers why it could not start, or null once the page is open. */
async function startSignIn(service: SignInService, account: { name?: string; again?: string }): Promise<string | null> {
  const api = window.mobius.calendar;
  const r = await (service === 'google' ? api?.googleSignIn?.(account) : api?.microsoftSignIn?.(account))?.catch(() => null);
  if (!r) return 'That sign-in is not available here.';
  if (isNotesFailure(r)) return r.message;
  void window.mobius.browser.open(r.url);
  return null;
}

/** Adds a calendar kept elsewhere: a link to subscribe to, a Google or Microsoft account, or an account on a CalDAV server. */
function AccountDialog({ add, onClose }: { add: (account: NewAccount) => Promise<string | null>; onClose: () => void }) {
  const api = window.mobius.calendar;
  const [kind, setKind] = useState<'link' | SignInService | (typeof PRESETS)[number]['id']>('link');
  const service: SignInService | null = kind === 'google' || kind === 'microsoft' ? kind : null;
  const [status, setStatus] = useState<{ setUp: boolean; hint: string | null } | null>(null);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    setStatus(null);
    if (!service) return;
    void (service === 'google' ? api?.googleStatus?.() : api?.microsoftStatus?.())?.then((r) => { if (!isNotesFailure(r)) { setStatus({ setUp: r.setUp, hint: r.hint ?? null }); setWaiting(r.pending !== null); } }).catch(() => {});
  }, [api, service]);
  useEffect(() => api?.onSignIn?.((done) => {
    setWaiting(false);
    if (!done.ok) { setProblem(done.message); return; }
    void api.sync(done.account.id).then(() => { told(); onClose(); });
  }), [api, onClose]);
  const preset = PRESETS.find((p) => p.id === kind);
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    if (service) {
      const failed = await startSignIn(service, { name: name.trim() });
      setBusy(false);
      if (failed) setProblem(failed); else setWaiting(true);
      return;
    }
    const failed = kind === 'link'
      ? await add({ kind: 'subscription', name: name.trim(), link: link.trim() })
      : await add({ kind: 'caldav', name: name.trim() || preset!.name, server: preset!.server || server.trim(), username: username.trim(), password });
    setBusy(false);
    if (failed) setProblem(failed); else onClose();
  };
  return createPortal(
    <div className="cal-modal-layer">
      <div className="cal-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <form className="cal-editor" role="dialog" aria-modal="true" aria-label="Add a calendar account" onSubmit={(e) => void submit(e)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
          <h2 className="cal-editor-heading">Add a calendar</h2>
          <label className="cal-editor-row"><span>From</span>
            <select aria-label="Where the calendar is" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setProblem(null); }}>
              <option value="link">A calendar link (.ics or webcal)</option>
              <option value="google">Google</option>
              <option value="microsoft">Outlook or Microsoft 365</option>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {service ? (
            <>
              <input aria-label="Name" placeholder="Name, such as Work (optional)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <p className="cal-editor-note">
                {status && !status.setUp
                  ? status.hint
                  : waiting
                    ? `Finish signing in on ${SERVICE[service].page} page. Mobius adds your calendars when you’re done.`
                    : `Mobius opens ${SERVICE[service].page} sign-in page. Your calendars come in, and events you or Mobius add go to ${SERVICE[service].name}. The sign-in is kept in this computer’s secret store.`}
              </p>
            </>
          ) : kind === 'link' ? (
            <>
              <input aria-label="Calendar link" placeholder="webcal://… or https://….ics" value={link} required autoFocus onChange={(e) => setLink(e.target.value)} />
              <input aria-label="Name" placeholder="Name, such as Holidays" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <p className="cal-editor-note">Mobius reads the link again every 15 minutes. A subscribed calendar can be read but not changed. For Google or Outlook, their settings give a private address in iCal format that works here.</p>
            </>
          ) : (
            <>
              {kind === 'other' && <input aria-label="Server address" placeholder="https://cloud.example.com/remote.php/dav" value={server} required autoFocus onChange={(e) => setServer(e.target.value)} />}
              <input aria-label={preset!.user} placeholder={preset!.user} value={username} required autoFocus={kind !== 'other'} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
              <input aria-label="App password" placeholder="App password" type="password" value={password} required autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
              <p className="cal-editor-note">{preset!.help} The password is kept in this computer's secret store. Events you or Mobius add go to the server.</p>
            </>
          )}
          {problem && <p className="tasks-message" role="alert">{problem}</p>}
          <div className="cal-editor-actions">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => { if (waiting) void (service === 'microsoft' ? api?.microsoftCancel?.() : api?.googleCancel?.()); onClose(); }}>Cancel</button>
            {service
              ? <button type="submit" className="btn primary" disabled={busy || waiting || status?.setUp === false}>{waiting ? `Waiting for ${SERVICE[service].name}…` : SERVICE[service].button}</button>
              : <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Connecting…' : kind === 'link' ? 'Subscribe' : 'Connect'}</button>}
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/** Settings › Calendar › Accounts: each account, its problem if it has one, Refresh, Remove (asked once more), and Add. */
export function CalendarAccountsSettings({ highlight }: { highlight?: boolean }) {
  const api = window.mobius.calendar;
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [again, setAgain] = useState<{ id: string; problem: string | null } | null>(null);
  const load = useCallback(async () => { const got = await api?.accounts(); if (got && !isNotesFailure(got)) setAccounts(got); }, [api]);
  useEffect(() => { void load(); return api?.onChanged(() => void load()); }, [api, load]);
  // A sign-in started from an account's Sign in again (the dialog hears its own).
  useEffect(() => api?.onSignIn?.((done) => {
    setAgain((a) => {
      if (!a) return a;
      if (done.ok) { void api.sync(done.account.id).then(load).then(told); return null; }
      return { ...a, problem: done.message };
    });
  }), [api, load]);
  const signInAgain = async (id: string) => {
    const kind = accounts.find((a) => a.id === id)?.kind;
    const failed = await startSignIn(kind === 'microsoft' ? 'microsoft' : 'google', { again: id });
    setAgain({ id, problem: failed });
  };
  const add = async (account: NewAccount) => {
    if (!api) return 'Calendar is not available.';
    const result = account.kind === 'subscription' ? await api.subscribe(account.name, account.link) : await api.connect(account);
    if (isNotesFailure(result)) return result.message;
    await load();
    told();
    return null;
  };
  const refresh = async (id: string) => {
    if (!api) return;
    setSyncing(id);
    try { await api.sync(id); await load(); told(); } finally { setSyncing(null); }
  };
  return (
    <Row path="calendar/accounts/calendar-accounts" title="Calendar accounts" description="Calendars kept elsewhere: a subscribed link, or a Google, Outlook, iCloud, Fastmail or Nextcloud account. Removing one keeps its events where they are." {...(highlight ? { highlight } : {})}>
      {!api ? <Empty>Calendar is not available here.</Empty> : (
        <>
          {accounts.length === 0 && <Empty>No calendar account yet. Calendars made in Mobius need none.</Empty>}
          {accounts.length > 0 && (
            <ul className="slist" aria-label="Calendar accounts">
              {accounts.map((a) => (
                <li key={a.id} className="slist-item">
                  <div className="slist-main">
                    <span>{a.name}</span>
                    {(again?.id === a.id && again.problem ? again.problem : a.problem) && <span className="field-error" role="alert">{again?.id === a.id && again.problem ? again.problem : a.problem}</span>}
                  </div>
                  {removing === a.id ? (
                    <>
                      <button type="button" className="btn danger" onClick={() => { setRemoving(null); void api.removeAccount(a.id).then(load).then(told); }}>Remove</button>
                      <button type="button" className="btn" autoFocus onClick={() => setRemoving(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      {(a.kind === 'google' || a.kind === 'microsoft') && a.problem && <button type="button" className="btn" aria-label={`Sign in to ${a.name} again`} disabled={again?.id === a.id && !again.problem} onClick={() => void signInAgain(a.id)}>{again?.id === a.id && !again.problem ? 'Waiting…' : 'Sign in again'}</button>}
                      <button type="button" className="btn" aria-label={`Refresh ${a.name}`} disabled={syncing !== null} onClick={() => void refresh(a.id)}>{syncing === a.id ? 'Refreshing…' : 'Refresh'}</button>
                      <button type="button" className="btn" aria-label={`Remove ${a.name}`} onClick={() => setRemoving(a.id)}>Remove…</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn" onClick={() => setAdding(true)}>Add a calendar account…</button>
        </>
      )}
      {adding && <AccountDialog add={add} onClose={() => setAdding(false)} />}
    </Row>
  );
}
