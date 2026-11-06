import { describe, expect, it } from 'vitest';
import { parseDownloadRequest, parseModelId, parseSearchQuery } from './ipc';

describe('model identifiers', () => {
  it('are non-empty text of reasonable length without control characters', () => {
    expect(parseModelId('unsloth/Qwen3.5-9B-GGUF/Qwen3.5-9B-UD-Q4_K_XL.gguf')).toBe('unsloth/Qwen3.5-9B-GGUF/Qwen3.5-9B-UD-Q4_K_XL.gguf');
    expect(parseModelId('C:\\models\\x-Q4_K_M.gguf')).toBe('C:\\models\\x-Q4_K_M.gguf');
    for (const bad of ['', 5, null, undefined, {}, 'a\0b', 'x'.repeat(1001)]) expect(parseModelId(bad), String(bad)).toBeNull();
  });
});

describe('download requests', () => {
  it('accept a repository and a .gguf file inside it', () => {
    expect(parseDownloadRequest('unsloth/Qwen3.5-9B-GGUF', 'Qwen3.5-9B-Q4_K_M.gguf')).toEqual({ repo: 'unsloth/Qwen3.5-9B-GGUF', file: 'Qwen3.5-9B-Q4_K_M.gguf' });
    expect(parseDownloadRequest('a/b', 'Q4_K_M/model-00001-of-00002.gguf')).not.toBeNull();
    expect(parseDownloadRequest('a/b', 'MODEL.GGUF')).not.toBeNull();
  });
  it('refuse anything that could point somewhere else', () => {
    const bad: Array<[unknown, unknown]> = [
      ['../x/y', 'a.gguf'], ['a/..', 'a.gguf'], ['a/b/c', 'a.gguf'], ['a', 'a.gguf'], ['a b/c', 'a.gguf'], ['a/b?x', 'a.gguf'], ['', 'a.gguf'], [5, 'a.gguf'], [null, 'a.gguf'],
      ['a/b', '../a.gguf'], ['a/b', '/a.gguf'], ['a/b', 'x/../a.gguf'], ['a/b', 'a\\b.gguf'], ['a/b', 'C:a.gguf'], ['a/b', 'a.exe'], ['a/b', 'a.gguf.exe'], ['a/b', ''], ['a/b', 5], ['a/b', 'x//a.gguf'], ['a/b', `${'x'.repeat(400)}.gguf`],
    ];
    for (const [repo, file] of bad) expect(parseDownloadRequest(repo, file), `${String(repo)} ${String(file)}`).toBeNull();
  });
});

describe('search queries', () => {
  it('may be empty, are trimmed, and are short', () => {
    expect(parseSearchQuery(undefined)).toBe('');
    expect(parseSearchQuery(null)).toBe('');
    expect(parseSearchQuery('  qwen coder ')).toBe('qwen coder');
    expect(parseSearchQuery('x'.repeat(100))).toHaveLength(100);
    for (const bad of [5, {}, [], 'x'.repeat(101)]) expect(parseSearchQuery(bad)).toBeNull();
  });
});
