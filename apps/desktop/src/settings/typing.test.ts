import { describe, expect, it } from 'vitest';
import { typingIn } from './SettingsPage';

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget;

describe('typingIn', () => {
  it('is true in fields that take text, so Escape leaves the field rather than Settings', () => {
    for (const type of ['text', 'search', 'email', 'url', 'password', 'number', 'tel']) expect(typingIn(el('INPUT', { type })), type).toBe(true);
    expect(typingIn(el('TEXTAREA'))).toBe(true);
    expect(typingIn(el('DIV', { isContentEditable: true }))).toBe(true);
  });

  it('is false on buttons, switches, sliders and the page itself', () => {
    for (const type of ['checkbox', 'radio', 'range', 'button', 'color']) expect(typingIn(el('INPUT', { type })), type).toBe(false);
    expect(typingIn(el('BUTTON'))).toBe(false);
    expect(typingIn(el('BODY'))).toBe(false);
    expect(typingIn(null)).toBe(false);
  });
});
