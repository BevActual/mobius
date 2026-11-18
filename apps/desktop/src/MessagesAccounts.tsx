import { useCallback, useEffect, useState } from 'react';
import { isNotesFailure, type ChatAccount } from '@mobius/shared';
import { Row, Empty } from './settings/primitives';

/**
 * Settings › Messages › Accounts: the chat accounts Messages reads and sends through as the person. Slack signs in on
 * Slack's own page; signing in to a workspace already here gives it the new sign-in. Kept out of Messages.tsx so
 * Settings does not load the whole app.
 */
export function MessagesAccountsSettings({ highlight }: { highlight?: boolean }) {
  const api = window.mobius.messages;
  const [accounts, setAccounts] = useState<ChatAccount[]>([]);
  const [status, setStatus] = useState<{ setUp: boolean; hint: string | null } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const load = useCallback(async () => { const got = await api?.accounts().catch(() => null); if (got && !isNotesFailure(got)) setAccounts(got); }, [api]);
  useEffect(() => {
    void load();
    void api?.slackStatus?.().then((r) => { if (!isNotesFailure(r)) { setStatus({ setUp: r.setUp, hint: r.hint }); setWaiting(r.pending !== null); } }).catch(() => {});
    return api?.onChanged(() => void load());
  }, [api, load]);
  useEffect(() => api?.onSignIn?.((done) => {
    setWaiting(false);
    if (done.ok) { setProblem(null); void load(); } else setProblem(done.message);
  }), [api, load]);
  const signIn = async () => {
    setProblem(null);
    const r = await api?.slackSignIn?.().catch(() => null);
    if (!r) { setProblem('Signing in to Slack is not available here.'); return; }
    if (isNotesFailure(r)) { setProblem(r.message); return; }
    setWaiting(true);
    void window.mobius.browser.open(r.url);
  };
  const cancel = () => { void api?.slackCancel?.(); setWaiting(false); };
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
                    <span>{a.name} · Slack</span>
                    {a.status !== 'ready' && <span className="field-error" role="alert">{a.message ?? 'This account cannot be reached.'}</span>}
                  </div>
                  {removing === a.id ? (
                    <>
                      <button type="button" className="btn danger" onClick={() => { setRemoving(null); void api.removeAccount?.(a.id).then(load); }}>Remove</button>
                      <button type="button" className="btn" autoFocus onClick={() => setRemoving(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      {a.status === 'signed-out' && <button type="button" className="btn" aria-label={`Sign in to ${a.name} again`} disabled={waiting || notSetUp} onClick={() => void signIn()}>Sign in again</button>}
                      <button type="button" className="btn" aria-label={`Remove ${a.name}`} onClick={() => setRemoving(a.id)}>Remove…</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {notSetUp && <Empty>{status.hint}</Empty>}
          {waiting && <Empty>Finish signing in on Slack’s page. Your workspace shows here when you’re done.</Empty>}
          {problem && <p className="field-error" role="alert">{problem}</p>}
          {waiting
            ? <button type="button" className="btn" onClick={cancel}>Cancel sign-in</button>
            : <button type="button" className="btn" disabled={notSetUp} onClick={() => void signIn()}>Sign in to Slack…</button>}
        </>
      )}
    </Row>
  );
}
