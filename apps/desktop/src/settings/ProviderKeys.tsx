import { useCallback, useEffect, useState } from 'react';
import type { ProviderInfo } from '@mobius/shared';
import { Empty, Row } from './primitives';
import { settingPath } from './manifest';
import type { SectionProps } from './sections';

/** Settings > Providers > API keys, after Hermes's Providers page: one row per service, its key, and a switch to it. */
export function ProvidersSection({ highlight }: SectionProps) {
  return (
    <Row path={settingPath('providers', 'keys', 'provider-keys')} title="Provider keys" description="One key per service, kept in the system's secret store and never shown again. A key is only ever sent to its own service." highlight={highlight === 'provider-keys'}>
      <ProviderList />
    </Row>
  );
}

function ProviderList() {
  const api = window.mobius.providers;
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const reload = useCallback(() => void api?.list().then(setProviders), [api]);
  useEffect(() => { reload(); return api?.onChanged(reload); }, [api, reload]);
  if (!api) return <Empty>Providers are available in the desktop app.</Empty>;
  const hosted = providers.filter((p) => p.needsKey);
  const local = providers.filter((p) => !p.needsKey);
  return (
    <div className="providers">
      <ul className="plist" role="list" aria-label="Online services">
        {hosted.map((p) => <ProviderRow key={p.id} provider={p} onChanged={reload} />)}
      </ul>
      <h4 className="plist-head">On this computer</h4>
      <ul className="plist" role="list" aria-label="Servers on this computer">
        {local.map((p) => <ProviderRow key={p.id} provider={p} onChanged={reload} />)}
      </ul>
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
  const usable = !p.needsKey || p.hasKey;

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
        {p.hasKey && <button type="button" className="btn" aria-label={`Remove the key for ${p.name}`} onClick={() => void api.removeKey(p.id).then(onChanged)}>Remove key</button>}
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
