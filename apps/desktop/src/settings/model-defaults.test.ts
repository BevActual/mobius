import { describe, expect, it } from 'vitest';
import type { ModelCatalog } from '@mobius/shared';
import { currentKey, fallbackKey } from './ModelDefaults';

const catalog: ModelCatalog = {
  current: 'gpt-5.5',
  groups: [
    { kind: 'provider', id: 'openai', name: 'OpenAI', address: 'https://api.openai.com/v1', active: true, models: [{ id: 'gpt-5.5', label: 'gpt-5.5' }], error: null },
    { kind: 'provider', id: 'groq', name: 'Groq', address: 'https://api.groq.com/openai/v1', active: false, models: [{ id: 'llama', label: 'llama' }], error: null },
  ],
};

describe('the model pop-ups in Models, Defaults', () => {
  it('show the chat model in use', () => {
    expect(currentKey(catalog)).toBe('provider|openai|gpt-5.5');
  });
  it('show the second model by the gateway at its address, None without one, and Other for one set by hand', () => {
    expect(fallbackKey(catalog, 'https://api.groq.com/openai/v1/', 'llama')).toBe('provider|groq|llama');
    expect(fallbackKey(catalog, '', '')).toBe('none');
    expect(fallbackKey(catalog, 'http://127.0.0.1:9/v1', 'x')).toBe('other');
  });
});
