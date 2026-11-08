import { describe, expect, it } from 'vitest';
import { describeChange, reviewShortcut } from './ReviewStrip';

describe('review strip names', () => {
  it('names notes, task lists and other files', () => {
    expect(describeChange('notes/Design/Split view.md')).toEqual({ kind: 'Note', name: 'Design / Split view' });
    expect(describeChange('tasks/This week.md')).toEqual({ kind: 'Tasks', name: 'This week' });
    expect(describeChange('drafts/plan.txt')).toEqual({ kind: 'File', name: 'drafts/plan.txt' });
  });
});

describe('keep and discard keys', () => {
  const press = (key: string, over: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });
  it('takes Cmd or Ctrl with Enter and Backspace, never while you are typing', () => {
    expect(reviewShortcut(press('Enter', { metaKey: true }), false)).toBe('keep');
    expect(reviewShortcut(press('Enter', { ctrlKey: true }), false)).toBe('keep');
    expect(reviewShortcut(press('Backspace', { ctrlKey: true }), false)).toBe('discard');
    expect(reviewShortcut(press('Backspace', { ctrlKey: true }), true)).toBeNull();
    expect(reviewShortcut(press('Enter'), false)).toBeNull();
    expect(reviewShortcut(press('Enter', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
  });
});
