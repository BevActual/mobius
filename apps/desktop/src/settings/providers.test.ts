import { describe, expect, it } from 'vitest';
import { PROVIDERS, findProvider, providerForUrl } from './providers';

describe('the list of providers', () => {
  it('has unique ids and names, and every entry has what the form needs', () => {
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
    expect(new Set(PROVIDERS.map((p) => p.name)).size).toBe(PROVIDERS.length);
    for (const p of PROVIDERS) {
      expect(p.name.trim(), p.id).not.toBe('');
      expect(p.note.trim(), p.id).not.toBe('');
    }
  });
  it('only offers addresses the core will accept a key for: https, or this computer', () => {
    for (const p of PROVIDERS) {
      const url = new URL(p.baseUrl);
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      expect(local || url.protocol === 'https:', p.id).toBe(true);
      expect(url.username + url.password, p.id).toBe('');
      expect(p.baseUrl.endsWith('/') || /\/v1$|\/openai$|\/v1beta\/openai$|\/api\/v1$|\/inference\/v1$/.test(p.baseUrl), p.id).toBe(true);
    }
  });
  it('says where to get a key, only for providers that need one, and only over https', () => {
    for (const p of PROVIDERS) {
      if (p.needsKey) expect(new URL(p.keyUrl ?? 'x:').protocol, p.id).toBe('https:');
      else expect(p.keyUrl, p.id).toBeUndefined();
    }
    expect(PROVIDERS.filter((p) => !p.needsKey).every((p) => new URL(p.baseUrl).hostname === '127.0.0.1')).toBe(true);
  });
  it('includes the common cloud services and the common local servers', () => {
    const ids = PROVIDERS.map((p) => p.id);
    for (const id of ['openai', 'openrouter', 'anthropic', 'gemini', 'ollama', 'lmstudio', 'llamacpp']) expect(ids).toContain(id);
  });
});

describe('finding a provider', () => {
  it('by id, and by the address someone typed (ignoring a trailing slash and case)', () => {
    expect(findProvider('openrouter')?.name).toBe('OpenRouter');
    expect(findProvider('nope')).toBeUndefined();
    expect(providerForUrl('https://openrouter.ai/api/v1/')?.id).toBe('openrouter');
    expect(providerForUrl('HTTPS://OPENROUTER.AI/api/v1')?.id).toBe('openrouter');
    expect(providerForUrl('https://example.com/v1')).toBeUndefined();
    expect(providerForUrl('')).toBeUndefined();
  });
});
