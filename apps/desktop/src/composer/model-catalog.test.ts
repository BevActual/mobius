import { describe, expect, it } from 'vitest';
import type { ModelGroup } from '@mobius/shared';
import { filterCatalog } from './model-catalog';

const group = (name: string, models: string[], error: string | null = null): ModelGroup => ({ kind: 'provider', id: name.toLowerCase(), name, active: false, models: models.map((m) => ({ id: m, label: m })), error });

describe('finding a model in the picker', () => {
  const groups = [group('OpenAI', ['gpt-5.5', 'gpt-5.4-mini']), group('Groq', ['llama-3.3-70b', 'qwen3-32b']), group('Mistral', [], 'The model server did not accept the key.')];
  it('shows everything, problems included, when nothing is typed', () => {
    expect(filterCatalog(groups, '  ')).toBe(groups);
  });
  it('keeps the models that match every word, in their groups, and drops empty groups', () => {
    expect(filterCatalog(groups, 'GPT mini').map((g) => [g.name, g.models.map((m) => m.id)])).toEqual([['OpenAI', ['gpt-5.4-mini']]]);
    expect(filterCatalog(groups, 'qwen').map((g) => g.name)).toEqual(['Groq']);
  });
  it('matches a provider name too', () => {
    expect(filterCatalog(groups, 'groq').flatMap((g) => g.models.map((m) => m.id))).toEqual(['llama-3.3-70b', 'qwen3-32b']);
  });
});
