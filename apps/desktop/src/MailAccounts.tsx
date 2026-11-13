import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { isNotesFailure, type MailAccount } from '@mobius/shared';
import { Row, Empty } from './settings/primitives';

/**
 * Mail accounts: adding one (also offered by Mail while it has none) and the list in Settings › Mail, where they
 * are removed. Kept out of Mail.tsx so Settings does not load the whole app.
 */

type Connect = (account: { preset: string; email: string; password: string; imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number }) => Promise<string | null>;

const PRESETS = [
  { id: 'icloud', name: 'iCloud', help: 'Use an app-specific password, made at account.apple.com under Sign-In and Security.' },
  { id: 'fastmail', name: 'Fastmail', help: 'Use an app password from Settings › Privacy & Security › Manage app passwords, with access to mail.' },
  { id: 'gmail', name: 'Gmail', help: 'Turn on 2-Step Verification, then make an app password at myaccount.google.com/apppasswords.' },
  { id: 'yahoo', name: 'Yahoo', help: 'Make an app password in Yahoo Account Security.' },
  { id: 'other', name: 'Another provider', help: 'Your provider lists its IMAP and SMTP servers; most need an app password.' },
] as const;

export function AccountDialog({ connect, onClose }: { connect: Connect; onClose: () => void }) {
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
    const failed = await connect({ preset, email: email.trim(), password, ...(preset === 'other' ? { imapHost: i.host, imapPort: i.port, smtpHost: s.host, smtpPort: s.port } : {}) });
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

/** Settings › Mail › Accounts: each account, its problem if it has one, Remove (asked once more), and Add. */
export function MailAccountsSettings({ highlight }: { highlight?: boolean }) {
  const api = window.mobius.mail;
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const load = useCallback(async () => { const got = await api?.accounts(); if (got && !isNotesFailure(got)) setAccounts(got); }, [api]);
  useEffect(() => { void load(); return api?.onChanged(() => void load()); }, [api, load]);
  const connect: Connect = async (account) => {
    if (!api) return 'Mail is not available.';
    const result = await api.connect(account);
    if (isNotesFailure(result)) return result.message;
    await load();
    return null;
  };
  return (
    <Row path="mail/accounts/mail-accounts" title="Mail accounts" description="The accounts Mail reads and sends from. Removing one keeps its mail with your provider." {...(highlight ? { highlight } : {})}>
      {!api ? <Empty>Mail is not available here.</Empty> : (
        <>
          {accounts.length === 0 && <Empty>No mail account yet.</Empty>}
          {accounts.length > 0 && (
            <ul className="slist" aria-label="Mail accounts">
              {accounts.map((a) => (
                <li key={a.id} className="slist-item">
                  <div className="slist-main">
                    <span>{a.email}</span>
                    {a.problem && <span className="field-error" role="alert">{a.problem}</span>}
                  </div>
                  {removing === a.id ? (
                    <>
                      <button type="button" className="btn danger" onClick={() => { setRemoving(null); void api.removeAccount(a.id).then(load); }}>Remove</button>
                      <button type="button" className="btn" autoFocus onClick={() => setRemoving(null)}>Cancel</button>
                    </>
                  ) : <button type="button" className="btn" aria-label={`Remove ${a.email}`} onClick={() => setRemoving(a.id)}>Remove…</button>}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn" onClick={() => setAdding(true)}>Add a mail account…</button>
        </>
      )}
      {adding && <AccountDialog connect={connect} onClose={() => setAdding(false)} />}
    </Row>
  );
}
