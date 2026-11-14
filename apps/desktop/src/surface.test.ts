import { describe, expect, it } from 'vitest';
import { MAX_CONTEXT_ITEM_CHARS } from '@mobius/shared';
import { COMPARE_TABS, isStarter, MAKE_A_DECK, noteContext, PLAN_MY_DAY, suggestionsFor, tasksContext, tidyFolder, WHAT_STANDS_OUT } from './surface';

describe('what each app suggests', () => {
  it('offers page suggestions in the browser only when a page is showing, and they attach the page', () => {
    expect(suggestionsFor({ app: 'browser', hasPage: false, note: null })).toEqual([]);
    const page = suggestionsFor({ app: 'browser', hasPage: true, note: null });
    expect(page.length).toBeGreaterThan(0);
    expect(page.every((s) => s.attach === 'page')).toBe(true);
  });
  it('leads with Compare these once two or more tabs show web pages, and it reads them itself', () => {
    expect(suggestionsFor({ app: 'browser', hasPage: true, pages: 1, note: null }).map((s) => s.label)).not.toContain('Compare these');
    const two = suggestionsFor({ app: 'browser', hasPage: true, pages: 2, note: null });
    expect(two[0]).toEqual({ label: 'Compare these', prompt: COMPARE_TABS });
    for (const tool of ['browser.tabs', 'browser.read', 'files.read', '#:~:text=']) expect(COMPARE_TABS).toContain(tool);
    // What the fifth demo run showed: a colon in the name failed on Windows, and rows came from the prompt's examples.
    expect(COMPARE_TABS).toContain('no colon or slash');
    expect(COMPARE_TABS).not.toContain('Compare:');
    expect(COMPARE_TABS).toContain('a row no page answers is left out');
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
  it('offers a one-page brief from an open document, written beside it and leaving it as it is', () => {
    const brief = suggestionsFor({ app: 'docs', hasPage: false, note: { path: 'Documents/Plan.md', title: 'Plan', text: '# Plan' } })[0];
    expect(brief).toMatchObject({ label: 'One-page brief', attach: 'note' });
    expect(brief?.prompt).toContain('Leave this document as it is.');
    expect(brief?.prompt).toContain('At most 450 words');
  });
  it('leads Home and Tasks with Plan my day: the same ask, which times tasks and suggests blocks but sends nothing', () => {
    for (const app of ['agent', 'tasks'] as const) expect(suggestionsFor({ app, hasPage: false, note: null })[0]).toMatchObject({ label: 'Plan my day', prompt: PLAN_MY_DAY });
    for (const tool of ['tasks.list', 'calendar.list', 'tasks.update', 'calendar.suggest', 'mail.draft']) expect(PLAN_MY_DAY).toContain(tool);
    expect(PLAN_MY_DAY).toContain('Do not send anything');
    // What the third demo run showed: a task due tomorrow was planned for today, and two replies were drafted.
    for (const words of ['not for today', 'draft no others', 'one line of a few words']) expect(PLAN_MY_DAY).toContain(words);
  });
  it('leads an open sheet with What stands out?, which leaves its working in the sheet as formulas', () => {
    const first = suggestionsFor({ app: 'sheets', hasPage: false, note: null, sheet: { title: 'Sales', source: 'sheets/Sales.json', text: 'A1: Month' } })[0];
    expect(first).toEqual({ label: 'What stands out?', prompt: WHAT_STANDS_OUT, attach: 'sheet' });
    for (const bit of ['sheets.read', 'sheets.write', 'SUM', 'AVERAGE', 'Stands out', 'column chart (charts)']) expect(WHAT_STANDS_OUT).toContain(bit);
  });
  it('offers Make this a deck from an open document, in the deck format with notes', () => {
    const open = suggestionsFor({ app: 'docs', hasPage: false, note: { path: 'Documents/Plan.md', title: 'Plan', text: '# Plan', folder: 'docs' } });
    expect(open.slice(0, 2).map((s) => s.label)).toEqual(['One-page brief', 'Make this a deck']);
    for (const bit of ['slides/Presentations/', '---', 'Notes:', 'Leave this document as it is.', 'read no other file', 'at most half the slides have bullets']) expect(MAKE_A_DECK).toContain(bit);
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
