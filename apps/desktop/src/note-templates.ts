import type { Notebook } from '@mobius/shared';
import { TEMPLATES_FOLDER, templateName } from './docs-view';

/**
 * What a new note can start from: three kept here (a meeting, a day, a project), and every note in the Templates
 * notebook, which Save as template adds to. One saved there with a kept one's name is used in its place, so a kept
 * template is changed by saving one of the same name. `{{date}}` in a title or the words becomes today.
 */
export interface NoteTemplate { name: string; title: string; path?: string; content?: string }

export const KEPT_NOTE_TEMPLATES: readonly NoteTemplate[] = [
  { name: 'Meeting', title: 'Meeting, {{date}}', content: '# Meeting, {{date}}\n\n**With:** \n\n## Agenda\n\n- \n\n## Notes\n\n\n\n## Decisions\n\n- \n\n## Next steps\n\n- [ ] \n' },
  { name: 'Daily', title: '{{date}}', content: '# {{date}}\n\n## Top three\n\n- [ ] \n- [ ] \n- [ ] \n\n## Notes\n\n\n\n## Done\n\n- \n' },
  { name: 'Project', title: 'Project', content: '# Project\n\n**Goal:** \n\n**Due:** \n\n## Why\n\n\n\n## Plan\n\n- [ ] \n\n## Open questions\n\n- \n\n## Links\n\n- \n' },
];

/** The Templates notebook's name as it is on disk, if there is one. */
export const templatesNotebook = (notebooks: readonly Notebook[]): string | undefined =>
  notebooks.find((n) => n.name.toLowerCase() === TEMPLATES_FOLDER.toLowerCase())?.name;

/** The kept templates first (or the saved ones that replace them), then the other saved ones by name. */
export function noteTemplates(notebooks: readonly Notebook[]): NoteTemplate[] {
  const folder = templatesNotebook(notebooks);
  const saved = (notebooks.find((n) => n.name === folder)?.pages ?? []).map((p) => ({ name: templateName(p.title), title: p.title, path: p.path }));
  const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const kept = KEPT_NOTE_TEMPLATES.map((t) => saved.find((s) => same(s.name, t.name)) ?? t);
  const rest = saved.filter((s) => !kept.includes(s)).sort((a, b) => a.name.localeCompare(b.name));
  return [...kept, ...rest];
}
