import { useCallback, useEffect, useState } from 'react';
import type { ModelCatalog, ModelGroup } from '@mobius/shared';
import { asCatalog } from '../composer/model-catalog';

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
