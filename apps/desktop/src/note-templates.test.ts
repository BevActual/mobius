import { describe, expect, it } from 'vitest';
import { fillTemplate } from './docs-view';
import { noteTemplates } from './note-templates';

const page = (path: string, title: string) => ({ path, title, modified: 1 });

describe('what a new note can start from', () => {
  it('is the meeting, day and project kept here when nothing is saved', () => {
    expect(noteTemplates([]).map((t) => t.name)).toEqual(['Meeting', 'Daily', 'Project']);
    const meeting = noteTemplates([])[0]!;
    expect(fillTemplate(meeting.title, new Date(2026, 10, 26))).not.toContain('{{');
    expect(meeting.content).toContain('## Next steps');
  });
  it('takes a saved one of the same name in place of a kept one, and lists the other saved ones after', () => {
    const books = [{ name: 'templates', pages: [page('templates/Standup.md', 'Standup'), page('templates/Meeting.md', 'Meeting, {{date}}'), page('templates/Brief.md', 'Brief')] }];
    const got = noteTemplates(books);
    expect(got.map((t) => t.name)).toEqual(['Meeting', 'Daily', 'Project', 'Brief', 'Standup']);
    expect(got[0]!.path).toBe('templates/Meeting.md');
    expect(got[1]!.path).toBeUndefined();
  });
});
