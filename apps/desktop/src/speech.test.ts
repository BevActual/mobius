import { describe, expect, it } from 'vitest';
import { SPEECH_IDLE, isSpeaking, readAloudNow, speechNext } from './speech';

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

  it('says why it could not speak, and whether Settings, Voice is the place to fix it', () => {
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
