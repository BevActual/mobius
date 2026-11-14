import { describe, expect, it } from 'vitest';
import { MAX_CONTEXT_ITEM_CHARS } from '@mobius/shared';
import { tidyFolder, isStarter, noteContext, PLAN_MY_DAY, suggestionsFor, tasksContext } from './surface';

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
  it('offers Tidy this folder in an open folder of Files, as one files.move that deletes nothing', () => {
    expect(suggestionsFor({ app: 'files', hasPage: false, note: null, folder: null }).map((s) => s.label)).not.toContain('Tidy this folder');
    const open = suggestionsFor({ app: 'files', hasPage: false, note: null, folder: 'Downloads' });
    expect(open[0]).toEqual({ label: 'Tidy this folder', prompt: tidyFolder('Downloads') });
    expect(open.map((s) => s.label)).not.toContain('Tidy a folder…');
    expect(tidyFolder('Downloads')).toContain('one files.move call');
    expect(tidyFolder('Downloads')).toContain('Delete nothing.');
    // What the second demo run showed: two approvals to list, twelve folders, and three different counts.
    for (const words of ['only once', 'at most six folders', 'no folders inside them', 'files.move answers']) expect(tidyFolder('Downloads')).toContain(words);
  });
  it('leads Home and Tasks with Plan my day: the same ask, which times tasks and suggests blocks but sends nothing', () => {
    for (const app of ['agent', 'tasks'] as const) expect(suggestionsFor({ app, hasPage: false, note: null })[0]).toMatchObject({ label: 'Plan my day', prompt: PLAN_MY_DAY });
    for (const tool of ['tasks.list', 'calendar.list', 'tasks.update', 'calendar.suggest', 'mail.draft']) expect(PLAN_MY_DAY).toContain(tool);
    expect(PLAN_MY_DAY).toContain('Do not send anything');
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
