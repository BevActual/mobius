import { describe, expect, it } from 'vitest';
import { parseDownloadId, parseFindRequest, parseHistoryQuery, parseHistoryUrl } from './ipc';

describe('find in page requests', () => {
  it('want a tab, some text, and whether to go forward or back', () => {
    expect(parseFindRequest({ tabId: 'tab-1', text: 'apple', forward: true, again: false })).toEqual({ tabId: 'tab-1', text: 'apple', forward: true, again: false });
    expect(parseFindRequest({ tabId: 'tab-1', text: 'apple' })).toEqual({ tabId: 'tab-1', text: 'apple', forward: true, again: false });
  });
  it('refuse empty or very long text, odd tab ids and non-objects', () => {
    for (const bad of [null, 'x', [], {}, { tabId: 'tab-1', text: '' }, { tabId: 'tab-1', text: 'x'.repeat(201) }, { tabId: '../x', text: 'a' }, { tabId: 'tab-1', text: 5 }, { tabId: 'tab-1', text: 'a', forward: 'yes' }, { text: 'a' }]) {
      expect(parseFindRequest(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('download ids', () => {
  it('are the ones the app hands out and nothing else', () => {
    expect(parseDownloadId('dl-1')).toBe('dl-1');
    for (const bad of ['', 'dl-', 'dl-x', '../dl-1', 'dl-1/../x', 5, null, undefined, 'dl-1234567890']) expect(parseDownloadId(bad), String(bad)).toBeNull();
  });
});

describe('history requests', () => {
  it('take only short text', () => {
    expect(parseHistoryQuery('shoes')).toBe('shoes');
    expect(parseHistoryQuery('x'.repeat(500))).toHaveLength(200);
    for (const bad of [5, null, undefined, {}]) expect(parseHistoryQuery(bad)).toBe('');
    expect(parseHistoryUrl('https://a.example/')).toBe('https://a.example/');
    for (const bad of [5, null, 'x'.repeat(3000)]) expect(parseHistoryUrl(bad)).toBeNull();
  });
});
