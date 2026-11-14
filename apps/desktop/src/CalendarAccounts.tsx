import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { isNotesFailure, type CalendarAccount } from '@mobius/shared';
import { Row, Empty } from './settings/primitives';
import { CALENDAR_ACCOUNTS_EVENT } from './calendar-view';

/**
 * Calendar accounts: a subscribed link or a CalDAV account, added and removed in Settings › Calendar so the Calendar
 * sidebar holds only calendars. Kept out of Calendar.tsx so Settings does not load the whole app.
 */

const told = () => window.dispatchEvent(new Event(CALENDAR_ACCOUNTS_EVENT));

type NewAccount = { kind: 'subscription'; name: string; link: string } | { kind: 'caldav'; name: string; server: string; username: string; password: string };

const PRESETS = [
  { id: 'icloud', name: 'iCloud', server: 'https://caldav.icloud.com', user: 'Apple Account email', help: 'Use an app-specific password, made at account.apple.com under Sign-In and Security. Your Apple Account password will not work here.' },
  { id: 'fastmail', name: 'Fastmail', server: 'https://caldav.fastmail.com/dav/', user: 'Fastmail email', help: 'Use an app password, made in Fastmail under Settings › Privacy & Security › Manage app passwords, with access to calendars (CalDAV).' },
  { id: 'other', name: 'Nextcloud or another server', server: '', user: 'Account name', help: 'Nextcloud\'s address ends in /remote.php/dav. Most servers take an app password, made in their security settings.' },
] as const;

/** Adds a calendar kept elsewhere: a link to subscribe to, or an account on a CalDAV server. */
function AccountDialog({ add, onClose }: { add: (account: NewAccount) => Promise<string | null>; onClose: () => void }) {
  const [kind, setKind] = useState<'link' | (typeof PRESETS)[number]['id']>('link');
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
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {kind === 'link' ? (
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
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Connecting…' : kind === 'link' ? 'Subscribe' : 'Connect'}</button>
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
  const load = useCallback(async () => { const got = await api?.accounts(); if (got && !isNotesFailure(got)) setAccounts(got); }, [api]);
  useEffect(() => { void load(); return api?.onChanged(() => void load()); }, [api, load]);
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
    <Row path="calendar/accounts/calendar-accounts" title="Calendar accounts" description="Calendars kept elsewhere: a subscribed link, or an iCloud, Fastmail or Nextcloud account. Removing one keeps its events where they are." {...(highlight ? { highlight } : {})}>
      {!api ? <Empty>Calendar is not available here.</Empty> : (
        <>
          {accounts.length === 0 && <Empty>No calendar account yet. Calendars made in Mobius need none.</Empty>}
          {accounts.length > 0 && (
            <ul className="slist" aria-label="Calendar accounts">
              {accounts.map((a) => (
                <li key={a.id} className="slist-item">
                  <div className="slist-main">
                    <span>{a.name}</span>
                    {a.problem && <span className="field-error" role="alert">{a.problem}</span>}
                  </div>
                  {removing === a.id ? (
                    <>
                      <button type="button" className="btn danger" onClick={() => { setRemoving(null); void api.removeAccount(a.id).then(load).then(told); }}>Remove</button>
                      <button type="button" className="btn" autoFocus onClick={() => setRemoving(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
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
