import { useCallback, useEffect, useState } from 'react';
import type { ImageModelChoice, ModelCatalog, ModelGroup } from '@mobius/shared';
import { asCatalog } from '../composer/model-catalog';
import { Row } from './primitives';

/** The value a pop-up keeps for one model: where it comes from, and its name. */
const keyOf = (group: ModelGroup, model: string) => `${group.kind}|${group.id}|${model}`;

/** The model in use, as the pop-up shows it. */
export function currentKey(catalog: ModelCatalog): string {
  for (const group of catalog.groups) {
    if (!group.active) continue;
    const model = group.models.find((m) => (group.kind === 'local' ? m.current === true : m.id === catalog.current));
    if (model) return keyOf(group, model.id);
  }
  return '';
}

/**
 * The chat model, as a pop-up of every model the connected gateways offer (and the ones on this computer). Choosing
 * one moves the agent to it, the same way the message box's model menu does. Connecting a service is in Gateways.
 */
export function ChatModelPopUp({ localContext, onChanged }: { localContext: number; onChanged?: () => void }) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(async () => {
    const got = await window.mobius.providers?.catalog().catch(() => null);
    setCatalog(asCatalog(got));
  }, []);
  useEffect(() => { void load(); return window.mobius.providers?.onChanged(() => void load()); }, [load]);
  if (catalog === null) return <span className="srow-text" role="status">Loading models…</span>;
  const groups = catalog.groups.filter((g) => g.models.length > 0);
  if (groups.length === 0) return <span className="srow-text">Add a gateway first, in Gateways.</span>;
  const value = currentKey(catalog);
  const choose = async (key: string) => {
    const [kind, id, ...rest] = key.split('|');
    const model = rest.join('|');
    setProblem(null);
    const result =
      kind === 'local' ? await window.mobius.models.start(model, localContext)
      : kind === 'server' ? await window.mobius.agent.setModel(model)
      : window.mobius.providers ? await window.mobius.providers.use(id ?? '', model)
      : { ok: false as const, error: 'That cannot be used here.' };
    if (!result.ok) setProblem(result.error);
    await load();
    onChanged?.();
  };
  return (
    <>
      <select className="popup" aria-label="Chat model" value={value} onChange={(e) => void choose(e.target.value)}>
        {value === '' && <option value="">Choose a model</option>}
        {groups.map((g) => (
          <optgroup key={`${g.kind}-${g.id}`} label={g.name}>
            {g.models.map((m) => <option key={m.id} value={keyOf(g, m.id)}>{m.label}</option>)}
          </optgroup>
        ))}
      </select>
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </>
  );
}

const same = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase();

/** The second model as the pop-up shows it: the gateway at the address the second model uses, and its name. */
export function fallbackKey(catalog: ModelCatalog, baseUrl: string, model: string): string {
  if (!baseUrl || !model) return 'none';
  const group = catalog.groups.find((g) => g.address !== undefined && same(g.address, baseUrl));
  return group ? keyOf(group, model) : 'other';
}

/**
 * The second model, asked when the first is busy, down or cannot be reached: a pop-up of the models the connected
 * gateways offer, or None. Its address and key come from the gateway, in the core; a model on this computer cannot
 * be the second one yet. One set by hand at another address shows as Other (it is in Gateways, Custom server).
 */
export function FallbackPopUp({ baseUrl, model, onChanged }: { baseUrl: string; model: string; onChanged?: () => void }) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(async () => {
    const got = await window.mobius.providers?.catalog().catch(() => null);
    setCatalog(asCatalog(got));
  }, []);
  useEffect(() => { void load(); return window.mobius.providers?.onChanged(() => void load()); }, [load]);
  if (catalog === null) return <span className="srow-text" role="status">Loading models…</span>;
  const groups = catalog.groups.filter((g) => (g.kind === 'provider' || g.kind === 'subscription') && g.models.length > 0);
  const value = fallbackKey(catalog, baseUrl, model);
  const choose = async (key: string) => {
    setProblem(null);
    const api = window.mobius.providers;
    if (!api?.useFallback) { setProblem('That cannot be set here.'); return; }
    const [, id, ...rest] = key.split('|');
    const result = key === 'none' ? await api.useFallback('none') : await api.useFallback(id ?? '', rest.join('|'));
    if (!result.ok) setProblem(result.error);
    onChanged?.();
  };
  return (
    <>
      <select className="popup" aria-label="Second model" value={value} onChange={(e) => void choose(e.target.value)}>
        <option value="none">None</option>
        {value === 'other' && <option value="other" disabled>{model} (Custom server)</option>}
        {groups.map((g) => (
          <optgroup key={`${g.kind}-${g.id}`} label={g.name}>
            {g.models.map((m) => <option key={m.id} value={keyOf(g, m.id)}>{m.label}</option>)}
          </optgroup>
        ))}
      </select>
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </>
  );
}

/** The quick model as the pop-up shows it: `gateway|model` from the preferences, as a catalog key. */
export function quickKey(catalog: ModelCatalog, quick: string): string {
  const [id, ...rest] = quick.split('|');
  const model = rest.join('|');
  if (!id || !model) return 'none';
  const group = catalog.groups.find((g) => g.kind === 'provider' && g.id === id);
  return group ? keyOf(group, model) : 'none';
}

/**
 * The model for quick jobs, such as checking a step in Auto before it runs: a pop-up of the models the connected
 * gateways offer, or Same as chat. A small, fast model fits. Its address and key come from the gateway, in the core.
 */
export function QuickPopUp({ quick, onChanged }: { quick: string; onChanged?: () => void }) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(async () => {
    const got = await window.mobius.providers?.catalog().catch(() => null);
    setCatalog(asCatalog(got));
  }, []);
  useEffect(() => { void load(); return window.mobius.providers?.onChanged(() => void load()); }, [load]);
  if (catalog === null) return <span className="srow-text" role="status">Loading models…</span>;
  const groups = catalog.groups.filter((g) => g.kind === 'provider' && g.models.length > 0);
  const value = quickKey(catalog, quick);
  const choose = async (key: string) => {
    setProblem(null);
    const api = window.mobius.providers;
    if (!api?.useQuick) { setProblem('That cannot be set here.'); return; }
    const [, id, ...rest] = key.split('|');
    const result = key === 'none' ? await api.useQuick('none') : await api.useQuick(id ?? '', rest.join('|'));
    if (!result.ok) setProblem(result.error);
    onChanged?.();
  };
  return (
    <>
      <select className="popup" aria-label="Quick model" value={value} onChange={(e) => void choose(e.target.value)}>
        <option value="none">Same as chat</option>
        {groups.map((g) => (
          <optgroup key={`${g.kind}-${g.id}`} label={g.name}>
            {g.models.map((m) => <option key={m.id} value={keyOf(g, m.id)}>{m.label}</option>)}
          </optgroup>
        ))}
      </select>
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </>
  );
}

/**
 * The model that makes pictures, for Photo, Design and Slides: the image models of the gateways with a key, or None.
 * Each picture may cost money on that gateway.
 */
export function ImagesRow({ path, highlight, chosen }: { path: string; highlight: boolean; chosen: string }) {
  const [choices, setChoices] = useState<ImageModelChoice[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(async () => {
    const got = await window.mobius.providers?.imageModels?.().catch(() => null);
    setChoices(got?.choices ?? []);
  }, []);
  useEffect(() => { void load(); return window.mobius.providers?.onChanged(() => void load()); }, [load]);
  const description = 'Makes pictures for Photo, Design and Slides when you ask. Each picture may cost money on that gateway.'
    // With no gateway that makes pictures, what to add says so under the row's help, where every row's help is.
    + (choices?.length === 0 ? ' Add a key for OpenAI, OpenRouter, Together AI or xAI in Gateways first.' : '');
  if (choices === null) return <Row path={path} title="Images" description={description} highlight={highlight}><span className="srow-text" role="status">Loading models…</span></Row>;
  const choose = async (key: string) => {
    setProblem(null);
    const api = window.mobius.providers;
    if (!api?.useImages) { setProblem('That cannot be set here.'); return; }
    const [id, ...rest] = key.split('|');
    const result = key === 'none' ? await api.useImages('none') : await api.useImages(id ?? '', rest.join('|'));
    if (!result.ok) setProblem(result.error);
  };
  const gateways = [...new Set(choices.map((c) => c.gatewayName))];
  const value = choices.some((c) => `${c.gateway}|${c.model}` === chosen) ? chosen : 'none';
  return (
    <Row path={path} title="Images" description={description} highlight={highlight}>
      <select className="popup" aria-label="Image model" value={value} onChange={(e) => void choose(e.target.value)}>
        <option value="none">None</option>
        {gateways.map((g) => (
          <optgroup key={g} label={g}>
            {choices.filter((c) => c.gatewayName === g).map((c) => <option key={`${c.gateway}|${c.model}`} value={`${c.gateway}|${c.model}`}>{c.label}</option>)}
          </optgroup>
        ))}
      </select>
      {problem && <span className="field-error" role="alert">{problem}</span>}
    </Row>
  );
}
