import type { ModelGroup } from '@mobius/shared';

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
