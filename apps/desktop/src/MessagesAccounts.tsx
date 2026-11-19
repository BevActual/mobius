import { useCallback, useEffect, useState } from 'react';
import { isNotesFailure, type ChatAccount } from '@mobius/shared';
import { Row, Empty } from './settings/primitives';
import { SERVICE_NAMES } from './messages-view';

/**
 * Settings › Messages › Accounts: the chat accounts Messages reads and sends through as the person. Slack signs in on
 * Slack's own page; Matrix on the person's server's own page, or with a username and password sent only to that
 * server. Signing in to an account already here gives it the new sign-in. Kept out of Messages.tsx so Settings does
 * not load the whole app.
 */
export function MessagesAccountsSettings({ highlight }: { highlight?: boolean }) {
  const api = window.mobius.messages;
  const [accounts, setAccounts] = useState<ChatAccount[]>([]);
  const [status, setStatus] = useState<{ setUp: boolean; hint: string | null } | null>(null);
  const [waiting, setWaiting] = useState<'slack' | 'matrix' | null>(null);
  // Matrix: the ID or server typed, then how that server signs in.
  const [server, setServer] = useState('');
  const [methods, setMethods] = useState<{ homeserver: string; password: boolean; browser: boolean } | null>(null);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const load = useCallback(async () => { const got = await api?.accounts().catch(() => null); if (got && !isNotesFailure(got)) setAccounts(got); }, [api]);
  useEffect(() => {
    void load();
    void api?.slackStatus?.().then((r) => { if (!isNotesFailure(r)) { setStatus({ setUp: r.setUp, hint: r.hint }); setWaiting(r.pending !== null ? 'slack' : null); } }).catch(() => {});
    return api?.onChanged(() => void load());
  }, [api, load]);
  useEffect(() => api?.onSignIn?.((done) => {
    setWaiting(null);
    if (done.ok) { setProblem(null); setMethods(null); setServer(''); void load(); } else setProblem(done.message);
  }), [api, load]);
  const signIn = async () => {
    setProblem(null);
    const r = await api?.slackSignIn?.().catch(() => null);
    if (!r) { setProblem('Signing in to Slack is not available here.'); return; }
    if (isNotesFailure(r)) { setProblem(r.message); return; }
    setWaiting('slack');
    void window.mobius.browser.open(r.url);
  };
  const cancel = () => { if (waiting === 'matrix') void api?.matrixCancel?.(); else void api?.slackCancel?.(); setWaiting(null); };
  const findServer = async (typed = server) => {
    setProblem(null);
    setBusy(true);
    const r = await api?.matrixMethods?.(typed.trim()).catch(() => null);
    setBusy(false);
    if (!r) { setProblem('Signing in to Matrix is not available here.'); return; }
    if (isNotesFailure(r)) { setProblem(r.message); return; }
    setMethods(r);
    setUser(typed.trim().startsWith('@') ? typed.trim() : '');
    setPassword('');
  };
  const matrixPage = async () => {
    setProblem(null);
    const r = await api?.matrixBrowserSignIn?.(server.trim()).catch(() => null);
    if (!r) { setProblem('Signing in to Matrix is not available here.'); return; }
    if (isNotesFailure(r)) { setProblem(r.message); return; }
    setWaiting('matrix');
    void window.mobius.browser.open(r.url);
  };
  const matrixPassword = async () => {
    setProblem(null);
    setBusy(true);
    const r = await api?.matrixSignIn?.(server.trim(), user.trim(), password).catch(() => null);
    setBusy(false);
    setPassword('');
    if (!r) { setProblem('Signing in to Matrix is not available here.'); return; }
    if (isNotesFailure(r)) { setProblem(r.message); return; }
    setMethods(null);
    setServer('');
    void load();
  };
  const again = (a: ChatAccount) => {
    if (a.service === 'matrix') { setServer(a.name); void findServer(a.name); } else void signIn();
  };
  const hostOf = (address: string) => { try { return new URL(address).host; } catch { return address; } };
  const notSetUp = status !== null && !status.setUp;
  return (
    <Row path="messages/accounts/messages-accounts" title="Message accounts" description="Chat accounts Messages reads and sends through as you. Only you send: Mobius can draft, never send. Removing one keeps its messages where they are." {...(highlight ? { highlight } : {})}>
      {!api ? <Empty>Messages is not available here.</Empty> : (
        <>
          {accounts.length === 0 && <Empty>No message account yet.</Empty>}
          {accounts.length > 0 && (
            <ul className="slist" aria-label="Message accounts">
              {accounts.map((a) => (
                <li key={a.id} className="slist-item">
                  <div className="slist-main">
                    <span>{a.name} · {SERVICE_NAMES[a.service] ?? a.service}</span>
                    {a.status !== 'ready' && <span className="field-error" role="alert">{a.message ?? 'This account cannot be reached.'}</span>}
                  </div>
                  {removing === a.id ? (
                    <>
                      <button type="button" className="btn danger" onClick={() => { setRemoving(null); void api.removeAccount?.(a.id).then(load); }}>Remove</button>
                      <button type="button" className="btn" autoFocus onClick={() => setRemoving(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      {a.status === 'signed-out' && <button type="button" className="btn" aria-label={`Sign in to ${a.name} again`} disabled={waiting !== null || (a.service === 'slack' && notSetUp)} onClick={() => again(a)}>Sign in again</button>}
                      <button type="button" className="btn" aria-label={`Remove ${a.name}`} onClick={() => setRemoving(a.id)}>Remove…</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {notSetUp && <Empty>{status.hint}</Empty>}
          {waiting === 'slack' && <Empty>Finish signing in on Slack’s page. Your workspace shows here when you’re done.</Empty>}
          {waiting === 'matrix' && <Empty>Finish signing in on your Matrix server’s page. Your account shows here when you’re done.</Empty>}
          {problem && <p className="field-error" role="alert">{problem}</p>}
          {waiting
            ? <button type="button" className="btn" onClick={cancel}>Cancel sign-in</button>
            : <button type="button" className="btn" disabled={notSetUp} onClick={() => void signIn()}>Sign in to Slack…</button>}
          {!waiting && (
            <form className="messages-matrix" aria-label="Sign in to Matrix" onSubmit={(event) => { event.preventDefault(); if (methods?.password && password) void matrixPassword(); else if (!methods) void findServer(); }}>
              <label className="field compact wide">
                <span>Matrix ID or server</span>
                <input value={server} placeholder="@you:matrix.org" autoComplete="off" spellCheck={false} onChange={(event) => { setServer(event.target.value); setMethods(null); }} />
              </label>
              {!methods && <button type="submit" className="btn" disabled={busy || !server.trim()}>Continue</button>}
              {methods?.browser && <button type="button" className="btn primary" onClick={() => void matrixPage()}>Sign in on {hostOf(methods.homeserver)}…</button>}
              {methods?.password && (
                <>
                  <label className="field compact wide">
                    <span>Username</span>
                    <input value={user} autoComplete="username" spellCheck={false} onChange={(event) => setUser(event.target.value)} />
                  </label>
                  <label className="field compact wide">
                    <span>Password</span>
                    <input type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
                  </label>
                  <button type="submit" className="btn" disabled={busy || !user.trim() || !password}>Sign in with password</button>
                </>
              )}
            </form>
          )}
        </>
      )}
    </Row>
  );
}
