import { describe, expect, it } from 'vitest';
import type { ConversationInfo } from '@mobius/shared';
import { hubResults, type HubSources } from './search-hub';

const conv = (id: string, title: string, updated_ms: number): ConversationInfo => ({ id, title, updated_ms, messages: 2, activity: 'idle', waiting: 0 }) as ConversationInfo;
const sources = (): HubSources => ({
  conversations: [conv('a', 'Trip planning', 500), conv('b', 'Plumber quotes', 100)],
  noteHits: [],
  notebooks: [{ name: 'Work', pages: [{ path: 'Work/Plan.md', title: 'Plan', modified: 400 }] }],
  tasks: { Inbox: [{ line: 2, text: 'Call the plumber', done: false, due: '2026-11-10' }, { line: 3, text: 'Old thing', done: true, due: null }] },
  history: [{ url: 'https://example.com/a', title: 'Example A', visited: 300 }, { url: 'https://example.com/a', title: 'Example A', visited: 50 }],
  bookmarks: [{ url: 'https://plumbers.test/', title: 'Plumbers', added: 200 }],
});

describe('one place to find everything', () => {
  it('with no query, lists the latest from every app by time, without tasks', () => {
    expect(hubResults(sources(), '', 'all').map((r) => r.key)).toEqual(['c:a', 'n:Work/Plan.md', 'p:https://example.com/a', 'p:https://plumbers.test/', 'c:b']);
  });
  it('the Tasks filter lists the open tasks, and each says where it lives', () => {
    const tasks = hubResults(sources(), '', 'task');
    expect(tasks.map((r) => [r.title, r.where, r.due])).toEqual([['Call the plumber', 'Tasks › Inbox', '2026-11-10']]);
  });
  it('a query finds every kind, names that start with it first, and pages only once', () => {
    const s = { ...sources(), noteHits: [{ path: 'Work/Plan.md', title: 'Plan', notebook: 'Work', line: 'call the plumber friday' }] };
    const found = hubResults(s, 'plumb', 'all');
    expect(found.map((r) => r.key)).toEqual(['p:https://plumbers.test/', 'c:b', 'n:Work/Plan.md', 't:Inbox:2']);
    expect(hubResults(s, 'example', 'page')).toHaveLength(1);
  });
  it('a page found by what it says shows the line that matched, and the first notebook is not named twice', () => {
    const s = { ...sources(), noteHits: [{ path: 'Notes/Untitled.md', title: 'Untitled', notebook: 'Notes', line: '  Plant tulips before the frost. ' }] };
    const [hit] = hubResults(s, 'tulips', 'note');
    expect([hit?.where, hit?.line]).toEqual(['Notes', 'Plant tulips before the frost.']);
  });
  it('a filter keeps only that kind, and every result knows which app opens it', () => {
    const notes = hubResults(sources(), '', 'note');
    expect(notes.map((r) => r.target)).toEqual([{ app: 'notes', path: 'Work/Plan.md', title: 'Plan' }]);
    expect(hubResults(sources(), 'trip', 'conversation')[0]!.target).toEqual({ app: 'agent', conversation: 'a' });
    expect(hubResults(sources(), 'nothing like this', 'all')).toEqual([]);
  });

  it('finds documents, decks, workbooks and mail too, each opening in its app', () => {
    const more: HubSources = {
      ...sources(),
      docHits: [{ path: 'Work/Brief.md', title: 'Offsite brief', notebook: 'Work', line: '' }],
      deckHits: [{ path: 'Presentations/Kickoff.md', title: 'Offsite kickoff', notebook: 'Presentations', line: '' }],
      workbooks: [{ name: 'Offsite budget', sheets: ['Budget', 'People'] }],
      mail: [{ id: 'abcd1234/inbox/7', account: 'abcd1234', box: 'inbox', uid: 7, from: { name: 'Rui', email: 'rui@example.com' }, to: [], cc: [], subject: 'Offsite terrace', dateMs: 5, seen: true, flagged: false, preview: '', category: 'primary', attachments: [] }],
    };
    const found = hubResults(more, 'offsite', 'all');
    expect(found.filter((r) => r.kind !== 'conversation' && r.kind !== 'note' && r.kind !== 'page' && r.kind !== 'task').map((r) => r.target)).toEqual(expect.arrayContaining([
      { app: 'docs', path: 'Work/Brief.md', title: 'Offsite brief' },
      { app: 'slides', path: 'Presentations/Kickoff.md', title: 'Offsite kickoff' },
      { app: 'sheets', workbook: 'Offsite budget', sheet: 'Budget' },
      { app: 'mail', id: 'abcd1234/inbox/7' },
    ]));
    expect(hubResults(more, 'offsite', 'sheet').map((r) => r.title)).toEqual(['Offsite budget']);
    expect(hubResults(more, 'offsite', 'mail')[0]!.where).toBe('Mail · Rui');
  });
  it('finds what the creative apps keep, under Made', () => {
    const made: HubSources = { ...sources(), designFolders: [{ name: 'Trip app', pages: [{ path: 'Trip app/Home.json', title: 'Home', modified: 900 }] }], songFolders: [{ name: 'Songs', pages: [{ path: 'Songs/Night Drive.json', title: 'Night Drive', modified: 10 }] }], albums: [{ name: 'Lisbon', photos: [{ path: 'Lisbon/coast.jpg', name: 'coast.jpg', modified: 20 }] }], videoProjects: ['Offsite recap'], codeProjects: [{ name: 'offsite-planner', modified: 30 }] };
    expect(hubResults(made, '', 'made').map((r) => r.where)).toEqual(['Design › Trip app', 'Code', 'Photo › Lisbon', 'Music › Songs', 'Video']);
    expect(hubResults(made, 'offsite', 'all').filter((r) => r.kind === 'made').map((r) => r.target)).toEqual([{ app: 'code', project: 'offsite-planner' }, { app: 'video', project: 'Offsite recap' }]);
    expect(hubResults(made, 'lisbon', 'made')[0]!.target).toEqual({ app: 'photo', path: 'Lisbon/coast.jpg' });
  });
});
