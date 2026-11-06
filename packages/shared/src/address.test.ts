import { describe, expect, it } from 'vitest';
import { resolveAddress } from './address';

describe('resolveAddress', () => {
  it('keeps full http and https URLs', () => {
    expect(resolveAddress('https://example.com/a?b=1')).toEqual({ kind: 'url', url: 'https://example.com/a?b=1' });
    expect(resolveAddress('http://example.com')).toEqual({ kind: 'url', url: 'http://example.com/' });
  });
  it('adds https to bare hosts', () => {
    expect(resolveAddress('example.com')).toEqual({ kind: 'url', url: 'https://example.com/' });
    expect(resolveAddress('docs.example.co.uk/path')).toEqual({ kind: 'url', url: 'https://docs.example.co.uk/path' });
  });
  it('uses http for localhost and loopback', () => {
    expect(resolveAddress('localhost:5173')).toEqual({ kind: 'url', url: 'http://localhost:5173/' });
    expect(resolveAddress('127.0.0.1:8080/x')).toEqual({ kind: 'url', url: 'http://127.0.0.1:8080/x' });
  });
  it('treats anything with spaces or a question mark as a question for the agent', () => {
    expect(resolveAddress('what is a webview')).toEqual({ kind: 'ask', text: 'what is a webview' });
    expect(resolveAddress('is example.com safe?')).toEqual({ kind: 'ask', text: 'is example.com safe?' });
  });
  it('treats a single word with no dot as a question, not a host', () => {
    expect(resolveAddress('electron')).toEqual({ kind: 'ask', text: 'electron' });
  });
  it('blocks dangerous and internal schemes', () => {
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'file:///C:/Windows/win.ini', 'chrome://settings', 'devtools://devtools', 'vbscript:x', 'about:blank#x']) {
      expect(resolveAddress(bad).kind, bad).toBe('blocked');
    }
  });
  it('blocks URLs with embedded credentials', () => {
    expect(resolveAddress('https://user:pass@example.com').kind).toBe('blocked');
  });
  it('ignores surrounding whitespace and rejects empty input', () => {
    expect(resolveAddress('  example.com  ')).toEqual({ kind: 'url', url: 'https://example.com/' });
    expect(resolveAddress('   ').kind).toBe('empty');
    expect(resolveAddress('').kind).toBe('empty');
  });
  it('rejects absurdly long input', () => {
    expect(resolveAddress('a'.repeat(5000) + '.com').kind).toBe('blocked');
  });
});
