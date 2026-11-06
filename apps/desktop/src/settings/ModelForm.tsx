import { useState, type FormEvent } from 'react';
import type { AgentConfigureRequest, AgentResult, AgentSettings } from '@mobius/shared';
import { PROVIDERS, findProvider, providerForUrl } from './providers';

export interface SettingsFormProps {
  settings: AgentSettings;
  onSave: (request: AgentConfigureRequest) => Promise<AgentResult>;
  onDone?: () => void;
}

export function SettingsForm({ settings, onSave, onDone }: SettingsFormProps) {
  const [saved, setSaved] = useState(false);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState('');
  const [system, setSystem] = useState(settings.system);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [useBackup, setUseBackup] = useState(settings.fallbackModel !== '');
  const [backupUrl, setBackupUrl] = useState(settings.fallbackBaseUrl);
  const [backupModel, setBackupModel] = useState(settings.fallbackModel);
  const [backupKey, setBackupKey] = useState('');
  const backupKeyKept = settings.hasFallbackKey && backupUrl.trim() === settings.fallbackBaseUrl;
  const backupProvider = providerForUrl(backupUrl);
  const keyKept = settings.hasKey && baseUrl.trim() === settings.baseUrl;
  const provider = providerForUrl(baseUrl);
  const keyHost = provider?.keyUrl ? new URL(provider.keyUrl).host : null;

  const save = async (event: FormEvent, clearKey = false) => {
    event.preventDefault();
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const fallback = useBackup && backupUrl.trim() && backupModel.trim() ? { baseUrl: backupUrl, model: backupModel, ...(backupKey ? { apiKey: backupKey } : {}) } : undefined;
    const result = await onSave({ baseUrl, model, ...(apiKey ? { apiKey } : {}), ...(system ? { system } : {}), ...(clearKey ? { clearKey: true } : {}), ...(fallback ? { fallback } : {}) });
    setSaving(false);
    if (result.ok) {
      setApiKey('');
      setBackupKey('');
      setSaved(true);
      onDone?.();
    } else setProblem(result.error);
  };

  return (
    <form className="settings" role="form" aria-label="Model settings" onSubmit={(event) => void save(event)}>
      <p className="settings-intro">Connect a model. Any server that speaks the OpenAI chat format works, including ones running on this computer.</p>
      <label className="field">
        <span>Provider</span>
        <select value={provider?.id ?? 'other'} onChange={(event) => { const picked = findProvider(event.target.value); if (picked) { setBaseUrl(picked.baseUrl); setSaved(false); } }}>
          <option value="other">Other (type the address below)</option>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <small>{provider ? `${provider.note}${keyHost ? ` Make a key at ${keyHost}.` : ''}` : 'Any server that speaks the OpenAI chat format.'}</small>
      </label>
      <label className="field">
        <span>Server address</span>
        <input type="text" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" spellCheck={false} autoComplete="off" required />
      </label>
      <label className="field">
        <span>Model</span>
        <input type="text" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model name" spellCheck={false} autoComplete="off" required />
      </label>
      <label className="field">
        <span>API key</span>
        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={keyKept ? 'Saved. Leave blank to keep it' : 'Optional for local servers'} spellCheck={false} autoComplete="off" />
        <small>
          {keyKept ? (settings.keyStorage === 'keychain' ? 'Stored encrypted by your system.' : 'Kept until you quit Mobius.') : 'Stored encrypted by your system when it can, never shown again.'}
        </small>
      </label>
      <label className="field">
        <span>Instructions (optional)</span>
        <textarea value={system} onChange={(event) => setSystem(event.target.value)} rows={3} placeholder="Always on. Leave blank for the default." />
      </label>
      <div className="field">
        <label className="switch-line">
          <input type="checkbox" role="switch" aria-label="Use a second model when the first cannot answer" checked={useBackup} onChange={(event) => { setUseBackup(event.target.checked); setSaved(false); }} />
          <span>Use a second model when the first cannot answer</span>
        </label>
        <small>If the first model is busy, down or unreachable, Mobius asks the second one instead and tells you. A rejected key or a wrong model name is shown, not hidden.</small>
      </div>
      {useBackup && (
        <fieldset className="backup" aria-label="Second model">
          <label className="field">
            <span>Second model provider</span>
            <select value={backupProvider?.id ?? 'other'} onChange={(event) => { const picked = findProvider(event.target.value); if (picked) setBackupUrl(picked.baseUrl); }}>
              <option value="other">Other (type the address below)</option>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Second model address</span>
            <input type="text" value={backupUrl} onChange={(event) => setBackupUrl(event.target.value)} placeholder="https://openrouter.ai/api/v1" spellCheck={false} autoComplete="off" />
          </label>
          <label className="field">
            <span>Second model name</span>
            <input type="text" value={backupModel} onChange={(event) => setBackupModel(event.target.value)} placeholder="Model name" spellCheck={false} autoComplete="off" />
          </label>
          <label className="field">
            <span>Second model API key</span>
            <input type="password" value={backupKey} onChange={(event) => setBackupKey(event.target.value)} placeholder={backupKeyKept ? 'Saved. Leave blank to keep it' : 'Optional for local servers'} spellCheck={false} autoComplete="off" />
          </label>
        </fieldset>
      )}
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {saved && <p className="field-ok" role="status">Saved</p>}
      <div className="settings-actions">
        <button type="submit" className="btn primary" disabled={saving || !baseUrl.trim() || !model.trim() || (useBackup && (!backupUrl.trim() || !backupModel.trim()))}>Save</button>
        {keyKept && <button type="button" className="btn" disabled={saving} onClick={(event) => void save(event, true)}>Remove saved key</button>}
        {onDone && <button type="button" className="btn" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

