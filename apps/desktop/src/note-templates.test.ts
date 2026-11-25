import { describe, expect, it } from 'vitest';
import { fillTemplate } from './docs-view';
import { dailyTemplate, noteTemplates, templateBody } from './note-templates';

const page = (path: string, title: string) => ({ path, title, modified: 1 });

describe('what a new note can start from', () => {
  it('is the meeting and project kept here when nothing is saved', () => {
    expect(noteTemplates([]).map((t) => t.name)).toEqual(['Meeting', 'Project']);
    const meeting = noteTemplates([])[0]!;
    expect(fillTemplate(meeting.title, new Date(2026, 10, 26))).not.toContain('{{');
    expect(meeting.content).toContain('## Next steps');
  });
  it('takes a saved one of the same name in place of a kept one, and lists the other saved ones after', () => {
    const books = [{ name: 'templates', pages: [page('templates/Standup.md', 'Standup'), page('templates/Meeting.md', 'Meeting, {{date}}'), page('templates/Brief.md', 'Brief')] }];
    const got = noteTemplates(books);
    expect(got.map((t) => t.name)).toEqual(['Meeting', 'Project', 'Brief', 'Standup']);
    expect(got[0]!.path).toBe('templates/Meeting.md');
    expect(got[1]!.path).toBeUndefined();
  });
  it('keeps a saved Daily for Today\'s note, not the list, and gives its words without its heading', () => {
    const books = [{ name: 'Templates', pages: [page('Templates/Daily.md', 'Daily'), page('Templates/Brief.md', 'Brief')] }];
    expect(noteTemplates(books).map((t) => t.name)).toEqual(['Meeting', 'Project', 'Brief']);
    expect(dailyTemplate(books)?.path).toBe('Templates/Daily.md');
    expect(dailyTemplate([])).toBeUndefined();
    expect(templateBody('# Daily\n\n## Top three\n\n- [ ] \n')).toBe('## Top three\n\n- [ ] \n');
    expect(templateBody('No heading\n')).toBe('No heading\n');
  });
});
