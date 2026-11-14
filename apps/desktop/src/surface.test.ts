import { describe, expect, it } from 'vitest';
import { MAX_CONTEXT_ITEM_CHARS } from '@mobius/shared';
import { isStarter, noteContext, suggestionsFor, tasksContext } from './surface';

describe('what each app suggests', () => {
  it('offers page suggestions in the browser only when a page is showing, and they attach the page', () => {
    expect(suggestionsFor({ app: 'browser', hasPage: false, note: null })).toEqual([]);
    const page = suggestionsFor({ app: 'browser', hasPage: true, note: null });
    expect(page.length).toBeGreaterThan(0);
    expect(page.every((s) => s.attach === 'page')).toBe(true);
  });
  it('offers note suggestions that attach the open note, and a search when none is open', () => {
    const open = suggestionsFor({ app: 'notes', hasPage: false, note: { path: 'work/plan.md', title: 'Plan', text: '# Plan' } });
    expect(open.every((s) => s.attach === 'note')).toBe(true);
    const none = suggestionsFor({ app: 'notes', hasPage: false, note: null });
    expect(none.map((s) => s.attach)).toEqual([undefined]);
    expect(isStarter(none[0]!)).toBe(true);
  });
  it('suggests nothing from the app underneath while Settings is open', () => {
    expect(suggestionsFor({ app: 'mail', hasPage: false, note: null }).length).toBeGreaterThan(0);
    expect(suggestionsFor({ app: 'mail', hasPage: false, note: null, settings: true })).toEqual([]);
  });
  it('starts Find a time with… in the box, for the person to name who, and it uses calendar.free', () => {
    const first = suggestionsFor({ app: 'calendar', hasPage: false, note: null })[0]!;
    expect(first.label).toBe('Find a time with…');
    expect(isStarter(first)).toBe(true);
    for (const tool of ['calendar.free', 'calendar.suggest', 'mail.draft']) expect(first.prompt).toContain(tool);
  });
  it('never asks the agent app to attach anything', () => {
    expect(suggestionsFor({ app: 'agent', hasPage: true, note: null }).every((s) => s.attach === undefined)).toBe(true);
  });
  it('attaches a note as a file the person can see, cut to the size one attachment may be', () => {
    const item = noteContext({ path: 'work/plan.md', title: 'Plan', text: 'x'.repeat(MAX_CONTEXT_ITEM_CHARS + 10) });
    expect(item).toMatchObject({ kind: 'file', title: 'Plan', source: 'notes/work/plan.md' });
    expect(item.text.length).toBe(MAX_CONTEXT_ITEM_CHARS);
  });
  it('writes the open task list out as a checklist, and Today with where each task lives', () => {
    const all = { Inbox: [{ line: 2, text: 'Pay rent', done: false, due: '2000-01-01' }, { line: 3, text: 'Old', done: true, due: null }] };
    expect(tasksContext({ view: { kind: 'list', name: 'Inbox' }, all })).toEqual({ title: 'Inbox', text: '# Inbox\n- [ ] Pay rent (due 2000-01-01)\n- [x] Old' });
    expect(tasksContext({ view: { kind: 'smart', id: 'today' }, all }).text).toBe('# Today\n- [ ] Pay rent (due 2000-01-01, in Inbox)');
    expect(suggestionsFor({ app: 'tasks', hasPage: false, note: null }).some((s) => s.attach === 'tasks')).toBe(true);
  });
});
