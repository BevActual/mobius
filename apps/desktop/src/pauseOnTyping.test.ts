import { describe, expect, it } from 'vitest';
import { pausesOnTyping, writes } from './pauseOnTyping';

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing', boolean>> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...mods });
const field = (tag: string, extra: Record<string, unknown> = {}) => ({ tagName: tag, isContentEditable: false, closest: () => null, ...extra }) as unknown as EventTarget;

describe('typing pauses Mobius', () => {
  it('counts characters, Backspace, Delete and Enter written into a field', () => {
    expect(writes(key('a'), field('TEXTAREA'))).toBe(true);
    expect(writes(key('Backspace'), field('INPUT', { type: 'text' }))).toBe(true);
    expect(writes(key('Enter'), field('DIV', { isContentEditable: true }))).toBe(true);
  });
  it('leaves shortcuts, arrows and fields that cannot be written in alone', () => {
    expect(writes(key('z', { ctrlKey: true }), field('TEXTAREA'))).toBe(false);
    expect(writes(key('ArrowDown'), field('TEXTAREA'))).toBe(false);
    expect(writes(key('a'), field('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(writes(key('a'), field('TEXTAREA', { readOnly: true }))).toBe(false);
    expect(writes(key('a'), field('BUTTON'))).toBe(false);
  });
  it('only while Mobius is working, unpaused, in the app on screen', () => {
    const working = { label: 'Writing in Notes', app: 'notes' as const, needsYou: false };
    expect(pausesOnTyping(working, null, 'notes')).toBe(true);
    expect(pausesOnTyping(working, null, 'docs')).toBe(false);
    expect(pausesOnTyping({ ...working, paused: { step: 1 } }, null, 'notes')).toBe(false);
    expect(pausesOnTyping({ ...working, needsYou: true }, null, 'notes')).toBe(false);
    expect(pausesOnTyping(null, 'notes', 'notes')).toBe(false);
    // Thinking or writing between steps, it is still at work where its last step was.
    expect(pausesOnTyping({ label: 'Writing', app: null, needsYou: false }, 'notes', 'notes')).toBe(true);
    expect(pausesOnTyping({ label: 'Writing', app: null, needsYou: false }, null, 'notes')).toBe(false);
  });
});
