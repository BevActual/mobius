import { useCallback, useEffect, useState } from 'react';
import type { AccountInfo, AccountStatus, ProviderInfo } from '@mobius/shared';
import { Empty, Row } from './primitives';
import { settingPath } from './manifest';
import type { SectionProps } from './sections';
import { SettingsForm } from './ModelForm';

/**
 * Settings > Gateways: the services Mobius is connected to, each with its key (kept in the system's secret store, never
 * shown again, only ever sent to its own service), and Add Gateway… for the others. Which model does what is in Models.
 */
export function ProvidersSection({ highlight, settings, onSaveSettings }: SectionProps) {
  const [custom, setCustom] = useState(highlight !== null && ['provider', 'endpoint', 'model-name', 'api-key', 'fallback', 'instructions'].includes(highlight));
  return (
    <>
    <Row path={settingPath('providers', 'keys', 'provider-keys')} title="Your gateways" description="The services Mobius can reach. Each key is kept in your system's secret store, never shown again, and only ever sent to its own service." highlight={highlight === 'provider-keys'}>
      <ProviderList />
    </Row>
    <Row path={settingPath('providers', 'keys', 'custom-server')} title="Custom server" description="Any server that speaks the OpenAI chat format, at an address you give, with its key, instructions and a second model." highlight={highlight === 'custom-server' || custom && highlight !== null}>
      {!custom ? (
        <button type="button" className="btn" onClick={() => setCustom(true)}>Custom server…</button>
      ) : settings ? (
        <div className="gateway-sheet" role="group" aria-label="Custom server">
          <SettingsForm key={`${settings.baseUrl}|${settings.model}|${settings.system}`} settings={settings} onSave={onSaveSettings} />
          <button type="button" className="btn" onClick={() => setCustom(false)}>Done</button>
        </div>
      ) : <Empty>Loading…</Empty>}
    </Row>
    </>
  );
}

function ProviderList() {
  const api = window.mobius.providers;
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const reload = useCallback(() => void api?.list().then((got) => setProviders(Array.isArray(got) ? got : [])), [api]);
  useEffect(() => { reload(); return api?.onChanged(reload); }, [api, reload]);
  const [adding, setAdding] = useState(false);
  if (!api) return <Empty>Gateways are available in the desktop app.</Empty>;
  const list = Array.isArray(providers) ? providers : [];
  const connected = list.filter((p) => p.hasKey || p.active);
  const hosted = list.filter((p) => p.needsKey && !connected.includes(p));
  const local = list.filter((p) => !p.needsKey && !connected.includes(p));
  return (
    <div className="providers">
      <Accounts onChanged={reload} />
      {connected.length > 0 ? (
        <ul className="plist" role="list" aria-label="Connected gateways">
          {connected.map((p) => <ProviderRow key={p.id} provider={p} onChanged={reload} />)}
        </ul>
      ) : (
        <div className="gateways-empty">
          <p className="gateways-empty-title">No gateways yet</p>
          <p className="srow-desc">Connect a service with its key, sign in to a plan, or use a server on this computer.</p>
        </div>
      )}
      <button type="button" className="btn" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>{adding ? 'Done adding' : 'Add Gateway…'}</button>
      {adding && <>
      <h4 className="plist-head">With an API key</h4>
      <ul className="plist" role="list" aria-label="Online services">
        {hosted.map((p) => <ProviderRow key={p.id} provider={p} onChanged={reload} />)}
      </ul>
      <h4 className="plist-head">On this computer</h4>
      <ul className="plist" role="list" aria-label="Servers on this computer">
        {local.map((p) => <ProviderRow key={p.id} provider={p} onChanged={reload} />)}
      </ul>
      </>}
    </div>
  );
}

type Open = 'none' | 'key' | 'use';

function ProviderRow({ provider: p, onChanged }: { provider: ProviderInfo; onChanged: () => void }) {
  const api = window.mobius.providers!;
  const [open, setOpen] = useState<Open>('none');
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const usable = !p.voiceOnly && (!p.needsKey || p.hasKey);

  const saveKey = async () => {
    setBusy(true);
    const r = await api.setKey(p.id, key);
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    setKey(''); setProblem(null); setOpen('none'); onChanged();
  };
  const startUse = async () => {
    setOpen('use'); setProblem(null); setModels(null);
    const r = await api.models(p.id);
    if (r.ok) { setModels(r.models); setModel((m) => m || r.models[0] || ''); }
    else { setModels([]); setProblem(`${r.error} You can still type a model name.`); }
  };
  const use = async () => {
    setBusy(true);
    const r = await api.use(p.id, model.trim());
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    setProblem(null); setOpen('none'); onChanged();
  };
  const status = !p.needsKey ? 'No key needed' : p.hasKey ? (p.storage === 'session' ? 'Key saved until Mobius quits' : 'Key saved') : 'No key';

  return (
    <li className="prow" aria-label={p.name} data-active={p.active || undefined}>
      <div className="prow-main">
        <span className="prow-name">{p.name}{p.active && <span className="prow-badge">In use</span>}</span>
        <span className="prow-note">{p.note}</span>
      </div>
      <span className="prow-status" data-has-key={p.hasKey || !p.needsKey}>{status}</span>
      <span className="prow-actions">
        {p.needsKey && !p.hasKey && open !== 'key' && <button type="button" className="btn" aria-label={`Add a key for ${p.name}`} onClick={() => { setOpen('key'); setProblem(null); }}>Add key</button>}
        {usable && open !== 'use' && <button type="button" className="btn" aria-label={`Use ${p.name}`} onClick={() => void startUse()}>Use…</button>}
        {p.hasKey && !confirming && <button type="button" className="btn link danger" aria-label={`Remove the key for ${p.name}`} onClick={() => setConfirming(true)}>Remove key…</button>}
        {confirming && (
          <span className="prow-confirm" role="group" aria-label={`Remove the key for ${p.name}?`}>
            <span className="prow-note">Remove the key for {p.name}?</span>
            <button type="button" className="btn danger" onClick={() => { setConfirming(false); void api.removeKey(p.id).then(onChanged); }}>Remove</button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        )}
      </span>
      {open === 'key' && (
        <form className="prow-form" onSubmit={(e) => { e.preventDefault(); void saveKey(); }}>
          <input className="input" type="password" autoFocus autoComplete="off" spellCheck={false} aria-label={`${p.name} API key`} placeholder="Paste the key" value={key} onChange={(e) => setKey(e.target.value)} />
          <button type="submit" className="btn primary" disabled={busy || key.trim() === ''}>Save key</button>
          <button type="button" className="btn" onClick={() => { setOpen('none'); setKey(''); setProblem(null); }}>Cancel</button>
          {p.keyUrl && <button type="button" className="btn link" onClick={() => void window.mobius.browser.open(p.keyUrl!)}>Get a key</button>}
        </form>
      )}
      {open === 'use' && (
        <form className="prow-form" onSubmit={(e) => { e.preventDefault(); void use(); }}>
          {models === null ? <span className="prow-note" role="status">Asking {p.name} for its models…</span>
            : models.length > 0 ? (
              <select aria-label={`${p.name} model`} value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : <input className="input" aria-label={`${p.name} model`} placeholder="Model name" value={model} onChange={(e) => setModel(e.target.value)} />}
          <button type="submit" className="btn primary" disabled={busy || model.trim() === ''}>Use this model</button>
          <button type="button" className="btn" onClick={() => { setOpen('none'); setProblem(null); }}>Cancel</button>
        </form>
      )}
      {problem && <span className="field-error prow-problem" role="alert">{problem}</span>}
    </li>
  );
}

/** Plans you sign in to: the service's own app keeps the sign-in, Mobius only asks it whether it is signed in. */
function Accounts({ onChanged }: { onChanged: () => void }) {
  const api = window.mobius.providers!;
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const reload = useCallback(() => void api.accounts().then((got) => setAccounts(Array.isArray(got) ? got : [])), [api]);
  useEffect(() => { reload(); return api.onChanged(reload); }, [api, reload]);
  if (accounts.length === 0) return null;
  return (
    <>
      <h4 className="plist-head">With your subscription</h4>
      <ul className="plist" role="list" aria-label="Subscriptions">
        {accounts.map((a) => <AccountRow key={a.id} account={a} onChanged={() => { reload(); onChanged(); }} />)}
      </ul>
    </>
  );
}

function AccountRow({ account: a, onChanged }: { account: AccountInfo; onChanged: () => void }) {
  const api = window.mobius.providers!;
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [model, setModel] = useState(a.models[0]?.id ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const device = a.kind === 'device';
  const check = useCallback(() => { setStatus(null); void api.accountStatus(a.id).then(setStatus); }, [api, a.id]);
  useEffect(check, [check]);
  // A device sign-in finishes on the service's site: keep asking quietly while a code is waiting.
  const waiting = status?.pending ?? null;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void api.accountStatus(a.id).then(setStatus), 2000);
    return () => clearInterval(timer);
  }, [api, a.id, waiting]);
  useEffect(() => api.onChanged(() => void api.accountStatus(a.id).then(setStatus)), [api, a.id]);
  const signIn = async () => {
    const r = await api.signIn(a.id);
    setProblem(r.ok ? null : r.error);
    if (r.ok && device) void api.accountStatus(a.id).then(setStatus);
  };
  const signOut = async () => {
    await api.signOut(a.id);
    setChoosing(false);
    check();
    onChanged();
  };
  const use = async () => {
    setBusy(true);
    const r = await api.use(a.id, model);
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    setProblem(null); setChoosing(false); onChanged();
  };
  const said = status === null ? 'Checking…' : !status.installed ? 'Claude Code is not installed' : status.signedIn ? `Signed in${status.account ? ` as ${status.account}` : ''}` : waiting ? 'Waiting for you to enter the code' : 'Not signed in';
  return (
    <li className="prow" aria-label={a.name} data-active={a.active || undefined}>
      <div className="prow-main">
        <span className="prow-name">{a.name}{a.active && <span className="prow-badge">In use</span>}</span>
        <span className="prow-note">{a.note}</span>
      </div>
      <span className="prow-status" role="status" data-has-key={status?.signedIn === true}>{said}</span>
      <span className="prow-actions">
        {status?.installed && !status.signedIn && !waiting && <button type="button" className="btn" aria-label={`Sign in to ${a.name}`} onClick={() => void signIn()}>Sign in…</button>}
        {waiting && <button type="button" className="btn" onClick={() => void api.cancelSignIn(a.id).then(check)}>Cancel</button>}
        {device && status?.signedIn && <button type="button" className="btn" aria-label={`Sign out of ${a.name}`} onClick={() => void signOut()}>Sign out</button>}
        {!device && status !== null && <button type="button" className="btn" aria-label={`Check ${a.name} again`} onClick={check}>Check again</button>}
        {status?.signedIn && !choosing && <button type="button" className="btn" aria-label={`Use ${a.name}`} onClick={() => setChoosing(true)}>Use…</button>}
      </span>
      {status && !status.installed && status.hint && <span className="prow-note prow-problem">{status.hint}</span>}
      {!device && status?.installed && !status.signedIn && <span className="prow-note prow-problem">Sign in opens Claude Code's own sign-in in a window. Come back and choose Check again when it is done.</span>}
      {waiting && (
        <div className="prow-form device-code" aria-label="Sign-in code">
          <span className="prow-note">Enter this code on OpenAI's sign-in page:</span>
          <code className="device-code-value">{waiting.code}</code>
          <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(waiting.code)}>Copy code</button>
          <button type="button" className="btn primary" onClick={() => void window.mobius.browser.open(waiting.url)}>Open the sign-in page</button>
        </div>
      )}
      {device && !waiting && !status?.signedIn && status?.hint && <span className="field-error prow-problem" role="alert">{status.hint}</span>}
      {choosing && (
        <form className="prow-form" onSubmit={(e) => { e.preventDefault(); void use(); }}>
          <select aria-label={`${a.name} model`} value={model} onChange={(e) => setModel(e.target.value)}>
            {a.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button type="submit" className="btn primary" disabled={busy || !model}>Use this model</button>
          <button type="button" className="btn" onClick={() => { setChoosing(false); setProblem(null); }}>Cancel</button>
        </form>
      )}
      {problem && <span className="field-error prow-problem" role="alert">{problem}</span>}
    </li>
  );
}
