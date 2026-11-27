import { describe, expect, it } from 'vitest';
import { SPEECH_IDLE, isSpeaking, readAloudNow, speechNext, speechParts, spokenText } from './speech';

describe('reading replies aloud', () => {
  it('speaks one reply at a time: starting another takes over, and stop ends it', () => {
    let s = speechNext(SPEECH_IDLE, { kind: 'start', id: 'a' });
    expect(s).toEqual({ state: 'loading', id: 'a' });
    s = speechNext(s, { kind: 'ready', id: 'a' });
    expect(isSpeaking(s, 'a')).toBe(true);
    s = speechNext(s, { kind: 'start', id: 'b' });
    expect(isSpeaking(s, 'a')).toBe(false);
    expect(isSpeaking(s, 'b')).toBe(true);
    expect(speechNext(s, { kind: 'stop' })).toEqual(SPEECH_IDLE);
  });

  it('ignores a late answer for a reply no longer asked for', () => {
    const s = speechNext(speechNext(SPEECH_IDLE, { kind: 'start', id: 'a' }), { kind: 'start', id: 'b' });
    expect(speechNext(s, { kind: 'ready', id: 'a' })).toEqual(s);
    expect(speechNext(s, { kind: 'ended', id: 'a' })).toEqual(s);
    expect(speechNext(s, { kind: 'failed', id: 'a', error: 'x', setup: false })).toEqual(s);
  });

  it('says why it could not speak, and whether Settings, Models is the place to fix it', () => {
    const s = speechNext(speechNext(SPEECH_IDLE, { kind: 'start', id: 'a' }), { kind: 'failed', id: 'a', error: 'Speaking is off.', setup: true });
    expect(s).toEqual({ state: 'failed', id: 'a', error: 'Speaking is off.', setup: true });
    expect(speechNext(speechNext(s, { kind: 'start', id: 'a' }), { kind: 'ended', id: 'a' })).toEqual(SPEECH_IDLE);
  });

  it('reads a reply by itself only when chosen, once, as its turn ends', () => {
    const reply = { id: 'r1', text: 'Hello.' };
    expect(readAloudNow(true, true, false, reply, null)).toBe(true);
    expect(readAloudNow(false, true, false, reply, null)).toBe(false);
    expect(readAloudNow(true, false, false, reply, null)).toBe(false);
    expect(readAloudNow(true, true, true, reply, null)).toBe(false);
    expect(readAloudNow(true, true, false, reply, 'r1')).toBe(false);
    expect(readAloudNow(true, true, false, { id: 'r2', text: '  ' }, null)).toBe(false);
  });
});

describe('spokenText', () => {
  it('reads markdown as words: no marks, link text without its address, no code', () => {
    const md = '# Garden\n\n- [ ] Plant the **tulips**\n- See [the guide](https://x.test/a)\n\n```\nlet x = 1;\n```\n\n> Quoted _line_\n\n![photo](a.png)';
    expect(spokenText(md)).toBe('Garden.\n\nPlant the tulips\nSee the guide\n\nQuoted line');
  });
});

describe('speechParts', () => {
  it('keeps short text whole and gives each paragraph a pause', () => {
    expect(speechParts('Hello there.\n\nA list item\n\nDone')).toEqual(['Hello there. A list item. Done.']);
  });
  it('splits long text at sentences, each part under the limit', () => {
    const sentence = 'This sentence is about forty characters. ';
    const parts = speechParts(sentence.repeat(30), 200);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.join(' ').split('This sentence').length - 1).toBe(30);
  });
  it('cuts a sentence longer than the limit at a space', () => {
    const parts = speechParts('word '.repeat(100), 120);
    expect(parts.every((p) => p.length <= 120 && !p.startsWith(' '))).toBe(true);
  });
  it('leaves out parts with nothing to say', () => {
    expect(speechParts(' \n\n ... ')).toEqual([]);
  });
});

describe('a title with a full stop', () => {
  it('does not end the part', () => {
    expect(speechParts('Dr. Chen came.\n\nThen Mr. Box.', 16)).toEqual(['Dr. Chen came.', 'Then Mr. Box.']);
  });
});

describe('the first part', () => {
  it('can be shorter than the rest', () => {
    const text = 'One two three. Four five six. Seven eight nine. Ten eleven twelve.';
    expect(speechParts(text, 40, 15)).toEqual(['One two three.', 'Four five six. Seven eight nine.', 'Ten eleven twelve.']);
  });
});

describe('titles read aloud', () => {
  it('are said in full', () => {
    expect(spokenText("Dr. Chen's ferries and Mr. Box.")).toBe("Doctor Chen's ferries and Mister Box.");
  });
});
