import { describe, expect, it } from 'vitest';
import type { ModelGroup } from '@mobius/shared';
import { asCatalog, filterCatalog } from './model-catalog';

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

describe('a catalog that is late, failed or malformed', () => {
  it('never breaks the menu: a failure or a missing list is an empty catalog with the model in use', () => {
    expect(asCatalog({ ok: false, error: 'This is the preview: nothing is saved.' }, 'chat-model')).toEqual({ current: 'chat-model', groups: [] });
    expect(asCatalog(undefined, 'm')).toEqual({ current: 'm', groups: [] });
    expect(asCatalog({ current: 'x', groups: null })).toEqual({ current: 'x', groups: [] });
  });
  it('keeps good groups and models, and drops what cannot be drawn', () => {
    const got = asCatalog({ current: 'gpt-5.5', groups: [{ kind: 'provider', id: 'openai', name: 'OpenAI', active: true, models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }, { label: 'no id' }, null] }, { name: 'no id' }, 'junk'] });
    expect(got.groups).toHaveLength(1);
    expect(got.groups[0]!.models).toEqual([{ id: 'gpt-5.5', label: 'GPT-5.5' }]);
    expect(got.groups[0]!.error).toBeNull();
    expect(filterCatalog(got.groups, 'gpt')).toHaveLength(1);
  });
});
