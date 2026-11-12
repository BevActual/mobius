import type { ModelCatalog, ModelGroup } from '@mobius/shared';

/**
 * The groups and models that match what was typed: every word must appear in the model's name or its group's name.
 * Groups with nothing left are dropped, except one whose problem should still be seen when nothing was typed.
 */
export function filterCatalog(groups: ModelGroup[], query: string): ModelGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map((group) => ({ ...group, error: null, models: group.models.filter((m) => words.every((w) => `${m.label} ${m.id} ${group.name}`.toLowerCase().includes(w))) }))
    .filter((group) => group.models.length > 0);
}

const KINDS: ReadonlyArray<ModelGroup['kind']> = ['subscription', 'provider', 'local', 'server'];

/**
 * What the providers answered, made safe to draw: a failure, a missing list or a malformed group gives an empty
 * catalog (or drops that group) instead of breaking the menu. `current` is the model in use when the answer has none.
 */
export function asCatalog(value: unknown, current = ''): ModelCatalog {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const groups = Array.isArray(v.groups) ? v.groups : [];
  return {
    current: typeof v.current === 'string' && v.current ? v.current : current,
    groups: groups.flatMap((g): ModelGroup[] => {
      if (!g || typeof g !== 'object') return [];
      const o = g as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.name !== 'string') return [];
      const models = (Array.isArray(o.models) ? o.models : []).flatMap((m) => {
        const r = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
        return typeof r.id === 'string' ? [{ id: r.id, label: typeof r.label === 'string' ? r.label : r.id, ...(r.current === true ? { current: true } : {}) }] : [];
      });
      const kind = KINDS.includes(o.kind as ModelGroup['kind']) ? (o.kind as ModelGroup['kind']) : 'provider';
      return [{ kind, id: o.id, name: o.name, active: o.active === true, ...(typeof o.address === 'string' ? { address: o.address } : {}), models, error: typeof o.error === 'string' ? o.error : null }];
    }),
  };
}
