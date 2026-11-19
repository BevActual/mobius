import { useCallback, useEffect, useState } from 'react';
import { isNotesFailure, type ChatAccount, type MatrixVerification } from '@mobius/shared';
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
  const [waiting, setWaiting] = useState<'slack' | 'matrix' | 'teams' | null>(null);
  const [teams, setTeams] = useState<{ setUp: boolean; hint: string | null } | null>(null);
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
    void api?.slackStatus?.().then((r) => { if (!isNotesFailure(r)) { setStatus({ setUp: r.setUp, hint: r.hint }); if (r.pending !== null) setWaiting('slack'); } }).catch(() => {});
    void api?.teamsStatus?.().then((r) => { if (!isNotesFailure(r)) { setTeams({ setUp: r.setUp, hint: r.hint }); if (r.pending !== null) setWaiting('teams'); } }).catch(() => {});
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
  const teamsSignIn = async () => {
    setProblem(null);
    const r = await api?.teamsSignIn?.().catch(() => null);
    if (!r) { setProblem('Signing in to Teams is not available here.'); return; }
    if (isNotesFailure(r)) { setProblem(r.message); return; }
    setWaiting('teams');
    void window.mobius.browser.open(r.url);
  };
  const cancel = () => {
    if (waiting === 'matrix') void api?.matrixCancel?.();
    else if (waiting === 'teams') void api?.teamsCancel?.();
    else void api?.slackCancel?.();
    setWaiting(null);
  };
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
    if (a.service === 'matrix') { setServer(a.name); void findServer(a.name); } else if (a.service === 'teams') void teamsSignIn(); else void signIn();
  };
  const hostOf = (address: string) => { try { return new URL(address).host; } catch { return address; } };
  const notSetUp = status !== null && !status.setUp;
  const teamsNotSetUp = teams !== null && !teams.setUp;
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
                    {a.service === 'matrix' && a.status === 'ready' && <MatrixDevice account={a} />}
                  </div>
                  {removing === a.id ? (
                    <>
                      <button type="button" className="btn danger" onClick={() => { setRemoving(null); void api.removeAccount?.(a.id).then(load); }}>Remove</button>
                      <button type="button" className="btn" autoFocus onClick={() => setRemoving(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      {a.status === 'signed-out' && a.service !== 'telegram' && <button type="button" className="btn" aria-label={`Sign in to ${a.name} again`} disabled={waiting !== null || (a.service === 'slack' && notSetUp) || (a.service === 'teams' && teamsNotSetUp)} onClick={() => again(a)}>Sign in again</button>}
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
          {waiting === 'teams' && <Empty>Finish signing in on Microsoft’s page with your work or school account. Your Teams chats show here when you’re done.</Empty>}
          {problem && <p className="field-error" role="alert">{problem}</p>}
          {waiting
            ? <button type="button" className="btn" onClick={cancel}>Cancel sign-in</button>
            : (
              <>
                <button type="button" className="btn" disabled={notSetUp} onClick={() => void signIn()}>Sign in to Slack…</button>
                {api.teamsSignIn && <button type="button" className="btn" disabled={teamsNotSetUp} title={teamsNotSetUp ? teams?.hint ?? undefined : undefined} onClick={() => void teamsSignIn()}>Sign in to Microsoft Teams…</button>}
              </>
            )}
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
          {!waiting && api.telegramSignIn && <TelegramSignIn onDone={() => void load()} />}
        </>
      )}
    </Row>
  );
}

/**
 * Signing in to Telegram as the person's own account: their phone number, then the code Telegram sends to their other
 * Telegram apps (or by SMS), then their two-step verification password if they set one. The password goes only to
 * Telegram and is not kept.
 */
function TelegramSignIn({ onDone }: { onDone: () => void }) {
  const api = window.mobius.messages;
  const [status, setStatus] = useState<{ setUp: boolean; hint: string | null } | null>(null);
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [value, setValue] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void api?.telegramStatus?.().then((r) => { if (!isNotesFailure(r)) setStatus({ setUp: r.setUp, hint: r.hint }); }).catch(() => {});
  }, [api]);
  if (!status) return null;
  if (!status.setUp) return <Empty>{status.hint ?? 'Telegram is not set up in this build.'}</Empty>;
  const send = async () => {
    setProblem(null);
    setBusy(true);
    const r = await api?.telegramSignIn?.(step, value).catch(() => null);
    setBusy(false);
    if (!r) { setProblem('Signing in to Telegram is not available here.'); return; }
    if (isNotesFailure(r)) { setProblem(r.message); if (step === 'password') setValue(''); return; }
    setValue('');
    if ('next' in r) {
      setStep(r.next);
      setHint(r.next === 'password' ? r.hint : null);
      return;
    }
    setStep('phone');
    onDone();
  };
  const restart = () => { void api?.telegramCancel?.(); setStep('phone'); setValue(''); setProblem(null); };
  const label = step === 'phone' ? 'Telegram phone number' : step === 'code' ? 'Code from Telegram' : 'Two-step verification password';
  return (
    <form className="messages-matrix" aria-label="Sign in to Telegram" onSubmit={(event) => { event.preventDefault(); if (value.trim()) void send(); }}>
      {step === 'code' && <span className="slist-sub">Telegram sent a code to your other Telegram apps (or by text message).</span>}
      {step === 'password' && <span className="slist-sub">This account has two-step verification.{hint ? ` Hint: ${hint}` : ''}</span>}
      <label className="field compact wide">
        <span>{label}</span>
        <input
          type={step === 'password' ? 'password' : 'text'}
          inputMode={step === 'password' ? undefined : 'tel'}
          value={value}
          placeholder={step === 'phone' ? '+44 7700 900123' : undefined}
          autoComplete={step === 'password' ? 'current-password' : step === 'code' ? 'one-time-code' : 'tel'}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button type="submit" className="btn" disabled={busy || !value.trim()}>{step === 'phone' ? 'Send code' : 'Sign in to Telegram'}</button>
      {step !== 'phone' && <button type="button" className="btn link" onClick={restart}>Start again</button>}
      {problem && <p className="field-error" role="alert">{problem}</p>}
    </form>
  );
}

/**
 * A Matrix account's encrypted rooms: they open once this device is verified, with the recovery key (or passphrase)
 * the person saved when they set up recovery in another Matrix app. Verifying also restores their key backup, so older
 * encrypted messages read too. The key goes only to Mobius's own encryption and is not kept.
 */
function MatrixDevice({ account }: { account: ChatAccount }) {
  const api = window.mobius.messages;
  const [verified, setVerified] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    void api?.matrixDevice?.(account.id).then((r) => { if (!isNotesFailure(r)) setVerified(r.verified); }).catch(() => {});
  }, [api, account.id]);
  if (verified === null || !api?.matrixRecover) return null;
  if (verified) return <span className="slist-sub">Encrypted rooms: this device is verified.{said?.ok ? ` ${said.text}` : ''}</span>;
  const restored = (keys: number) => (keys === 1 ? '1 message key restored from your backup.' : `${keys} message keys restored from your backup.`);
  const verify = async () => {
    setBusy(true);
    setSaid(null);
    const r = await api.matrixRecover!(account.id, key).catch(() => null);
    setBusy(false);
    setKey('');
    if (!r) { setSaid({ ok: false, text: 'Verifying is not available here.' }); return; }
    if (isNotesFailure(r)) { setSaid({ ok: false, text: r.message }); return; }
    setVerified(r.verified);
    setSaid({ ok: true, text: restored(r.keys) });
  };
  return (
    <form className="messages-matrix" aria-label={`Verify this device for ${account.name}`} onSubmit={(event) => { event.preventDefault(); if (key.trim()) void verify(); }}>
      <span className="slist-sub">Encrypted rooms open once this device is verified. Type the recovery key you saved when you set up recovery in another Matrix app, such as Element.</span>
      <label className="field compact wide">
        <span>Recovery key</span>
        <input type="password" value={key} autoComplete="off" spellCheck={false} onChange={(event) => setKey(event.target.value)} />
      </label>
      <button type="submit" className="btn" disabled={busy || !key.trim()}>{busy ? 'Verifying…' : 'Verify this device'}</button>
      {said && !said.ok && <p className="field-error" role="alert">{said.text}</p>}
      {api.matrixVerify && (
        <MatrixEmojiVerify
          account={account}
          onVerified={(keys) => { setVerified(true); setSaid({ ok: true, text: restored(keys) }); }}
        />
      )}
    </form>
  );
}

/** The steps that wait on the other device or the server: checked again every couple of seconds. */
const VERIFY_WAITING: MatrixVerification['state'][] = ['waiting', 'starting', 'confirmed', 'finishing'];

/**
 * Verifying with another of the person's devices (Element on their phone, say): it shows a prompt there, then both
 * show the same seven emoji, and the person says whether they match. The other device then sends this one the
 * person's keys.
 */
function MatrixEmojiVerify({ account, onVerified }: { account: ChatAccount; onVerified: (keys: number) => void }) {
  const api = window.mobius.messages;
  const [now, setNow] = useState<MatrixVerification | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const step = useCallback(async (s: 'start' | 'check' | 'match' | 'differ' | 'cancel') => {
    const r = await api?.matrixVerify?.(account.id, s).catch(() => null);
    if (!r) { setFailed('Verifying is not available here.'); setNow(null); return; }
    if (isNotesFailure(r)) { setFailed(r.message); setNow(null); return; }
    setFailed(null);
    setNow(r);
    if (r.state === 'done') onVerified(r.keys ?? 0);
  }, [api, account.id, onVerified]);
  const waiting = now !== null && VERIFY_WAITING.includes(now.state);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => { void step('check'); }, 2000);
    return () => window.clearTimeout(timer);
  }, [waiting, now, step]);
  const said: Partial<Record<MatrixVerification['state'], string>> = {
    waiting: 'Accept the request on your other device.',
    starting: 'Starting…',
    confirmed: 'Waiting for your other device to say they match too.',
    finishing: 'Verified. Bringing your keys over…',
  };
  return (
    <div className="messages-verify" aria-label={`Verify ${account.name} with another device`}>
      {now === null || now.state === 'idle' || now.state === 'done' || now.state === 'cancelled' ? (
        <>
          <span className="slist-sub">{now?.state === 'cancelled' ? now.reason : 'Or verify with another device where you use this account.'}</span>
          <button type="button" className="btn" onClick={() => { void step('start'); }}>Verify with another device</button>
        </>
      ) : now.state === 'compare' ? (
        <>
          <span className="slist-sub">Do these emoji match the ones on your other device, in the same order?</span>
          <ol className="messages-verify-emoji" aria-label="Emoji to compare">
            {(now.emoji ?? []).map((e, i) => (
              <li key={i}><span aria-hidden="true">{e.symbol}</span><span>{e.name}</span></li>
            ))}
          </ol>
          <button type="button" className="btn primary" onClick={() => { void step('match'); }}>They match</button>
          <button type="button" className="btn" onClick={() => { void step('differ'); }}>They don't match</button>
        </>
      ) : (
        <>
          <span className="slist-sub" role="status">{said[now.state]}</span>
          <button type="button" className="btn link" onClick={() => { void step('cancel'); }}>Cancel</button>
        </>
      )}
      {failed && <p className="field-error" role="alert">{failed}</p>}
    </div>
  );
}
