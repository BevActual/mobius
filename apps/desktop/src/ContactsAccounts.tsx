import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { isNotesFailure, type ContactAccount } from '@mobius/shared';
import { Row, Empty } from './settings/primitives';

/**
 * Settings › Contacts: address books on a CardDAV server (iCloud, Fastmail, Nextcloud), each kept in step with its own
 * folder under contacts/, as Calendar does with CalDAV. Removing an account stops the syncing; its cards stay here and
 * on the server.
 */

const PRESETS = [
  { id: 'icloud', name: 'iCloud', server: 'https://contacts.icloud.com', user: 'Apple Account email', help: 'Use an app-specific password, made at account.apple.com under Sign-In and Security. Your Apple Account password will not work here.' },
  { id: 'fastmail', name: 'Fastmail', server: 'https://carddav.fastmail.com/dav/', user: 'Fastmail email', help: 'Use an app password, made in Fastmail under Settings › Privacy & Security › Manage app passwords, with access to contacts (CardDAV).' },
  { id: 'other', name: 'Nextcloud or another server', server: '', user: 'Account name', help: 'Nextcloud\'s address ends in /remote.php/dav. Most servers take an app password, made in their security settings.' },
] as const;

type Connect = (account: { name: string; server: string; username: string; password: string }) => Promise<string | null>;

export function ContactsAccountDialog({ connect, onClose }: { connect: Connect; onClose: () => void }) {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['id']>('icloud');
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const p = PRESETS.find((x) => x.id === preset)!;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    const failed = await connect({ name: preset === 'other' ? '' : p.name, server: p.server || server.trim(), username: username.trim(), password });
    setBusy(false);
    if (failed) setProblem(failed); else onClose();
  };
  return createPortal(
    <div className="cal-modal-layer">
      <div className="cal-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <form className="cal-editor" role="dialog" aria-modal="true" aria-label="Add a contacts account" onSubmit={(e) => void submit(e)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
          <h2 className="cal-editor-heading">Add a contacts account</h2>
          <label className="cal-editor-row"><span>Provider</span>
            <select aria-label="Provider" value={preset} onChange={(e) => { setPreset(e.target.value as typeof preset); setProblem(null); }}>{PRESETS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          {preset === 'other' && <input aria-label="Server address" placeholder="https://cloud.example.com/remote.php/dav" value={server} required onChange={(e) => setServer(e.target.value)} />}
          <input aria-label={p.user} placeholder={p.user} value={username} required autoFocus autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
          <input aria-label="App password" placeholder="App password" type="password" value={password} required autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
          <p className="cal-editor-note">{p.help} The password is kept in this computer's secret store. Each address book is kept in step with a folder in Contacts.</p>
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

/** Settings › Contacts › Accounts: each account and its address books, Remove (asked once more), and Add. */
export function ContactsAccountsSettings({ highlight }: { highlight?: boolean }) {
  const api = window.mobius.contacts;
  const [accounts, setAccounts] = useState<ContactAccount[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(async () => { const got = await api?.accounts().catch(() => null); if (got && !isNotesFailure(got)) setAccounts(got); }, [api]);
  useEffect(() => { void load(); return api?.onChanged(() => void load()); }, [api, load]);
  const connect: Connect = async (account) => {
    if (!api) return 'Contacts is not available.';
    const result = await api.connect(account);
    if (isNotesFailure(result)) return result.message;
    await load();
    return null;
  };
  const remove = async (id: string) => {
    setRemoving(null);
    const r = await api?.removeAccount(id);
    setProblem(r && isNotesFailure(r) ? r.message : null);
    await load();
  };
  return (
    <Row path="contacts/accounts/contacts-accounts" title="Contacts accounts" description="Address books kept in step with a server. Removing one keeps its cards here and on the server." {...(highlight ? { highlight } : {})}>
      {!api ? <Empty>Contacts is not available here.</Empty> : (
        <>
          {accounts.length === 0 && <Empty>No contacts account yet.</Empty>}
          {accounts.length > 0 && (
            <ul className="slist" aria-label="Contacts accounts">
              {accounts.map((a) => (
                <li key={a.id} className="slist-item">
                  <div className="slist-main">
                    <span>{a.username || a.name}</span>
                    <span className="srow-desc">{a.books.map((b) => b.name).join(', ') || a.name}</span>
                  </div>
                  {removing === a.id ? (
                    <>
                      <button type="button" className="btn danger" onClick={() => void remove(a.id)}>Remove</button>
                      <button type="button" className="btn" autoFocus onClick={() => setRemoving(null)}>Cancel</button>
                    </>
                  ) : <button type="button" className="btn" aria-label={`Remove ${a.username || a.name}`} onClick={() => setRemoving(a.id)}>Remove…</button>}
                </li>
              ))}
            </ul>
          )}
          {problem && <p className="field-error" role="alert">{problem}</p>}
          <button type="button" className="btn" onClick={() => setAdding(true)}>Add a contacts account…</button>
        </>
      )}
      {adding && <ContactsAccountDialog connect={connect} onClose={() => setAdding(false)} />}
    </Row>
  );
}
