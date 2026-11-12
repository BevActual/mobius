import { describe, expect, it } from 'vitest';
import { LESSONS, appsWithoutLesson, buildLessons, capabilities, firstSentence, readable, searchLessons } from './learn';

const pages = {
  '../../../docs/getting-started/tour.md': '# A tour of the workspace\n\nEvery app has the same frame. So once you know one you know them all.\n\n## The sidebar\n\nIt is [explained](../guide/x.md) here.',
  '../../../docs/getting-started/install.md': '# Install Mobius\n\nDownload it.\n',
  '../../../docs/guide/voice.md': '# Voice\n\nTalk to Mobius.\n\n| Key | What |\n| --- | --- |\n| [Ctrl+M](a.md) | Dictate |\n',
  '../../../docs/apps/write-and-plan.md': '# Write and plan\n\n## Notes\n\nQuick pages, saved as you type.\n\n![The Notes app](../readme/apps/notes.png)\n\n- **Notebooks** in the sidebar.\n- **History**: earlier versions.\n- Plain item.\n\n## Tasks\n\nLists of things to do.\n\n- **Smart lists**: Today.\n',
  '../../../docs/apps/assistant.md': '# Assistant\n\n## Agent\n\nThe desk.\n',
  '../../../docs/apps/README.md': '# Apps\n\n## Not a lesson\n',
  '../../../docs/developers/testing.md': '# Testing\n\nInternal.\n',
};

describe('Learn', () => {
  const lessons = buildLessons(pages);

  it('makes a lesson of each user-facing page and of each app section, in reading order', () => {
    expect(lessons.map((l) => l.id)).toEqual(['start/install', 'start/tour', 'apps/agent', 'apps/notes', 'apps/tasks', 'guide/voice']);
    expect(lessons.find((l) => l.id === 'apps/notes')).toMatchObject({ topic: 'apps', app: 'notes', title: 'Notes', summary: 'Quick pages, saved as you type.', can: ['Notebooks', 'History'], source: 'docs/apps/write-and-plan.md#notes' });
    expect(lessons.find((l) => l.id === 'apps/agent')?.app).toBe('agent');
  });

  it('shows a page as text the app can read: no pictures, links as words, tables as lists', () => {
    expect(lessons.find((l) => l.id === 'apps/notes')!.body).not.toContain('![');
    expect(lessons.find((l) => l.id === 'start/tour')!.body).toContain('It is explained here.');
    expect(readable('| Key | What |\n| --- | --- |\n| [Ctrl+M](a.md) | Dictate |')).toBe('- **Ctrl+M**: Dictate');
  });

  it('takes the first sentence for the card and the bold lead-ins for what an app can do', () => {
    expect(firstSentence('\n![x](y.png)\n\nEvery app has the same frame. So once.')).toBe('Every app has the same frame.');
    expect(capabilities('- **A thing.** more\n- **B**: x\n- **A thing**\n- plain')).toEqual(['A thing', 'B']);
  });

  it('searches within a topic', () => {
    expect(searchLessons(lessons, 'apps', 'smart').map((l) => l.id)).toEqual(['apps/tasks']);
    expect(searchLessons(lessons, 'start', 'smart')).toEqual([]);
    expect(searchLessons(lessons, 'all', '').length).toBe(lessons.length);
  });

  it('reads the real docs, and every Start here and guide page has a title and a summary', () => {
    expect(LESSONS.some((l) => l.id === 'start/tour')).toBe(true);
    expect(LESSONS.some((l) => l.app === 'notes')).toBe(true);
    expect(LESSONS.some((l) => l.source.includes('developers'))).toBe(false);
    for (const l of LESSONS) { expect(l.title, l.source).not.toBe(''); expect(l.summary, l.source).not.toBe(''); }
  });

  it('lists the apps whose docs section is missing (a warning, so app threads are not blocked)', () => {
    const missing = appsWithoutLesson(LESSONS);
    if (missing.length) console.warn(`Learn: no docs/apps section yet for ${missing.join(', ')}`);
    expect(appsWithoutLesson(lessons, ['notes', 'tasks', 'mail'])).toEqual(['mail']);
  });
});
