/** What Notes' Insert bar puts into a page, at the cursor, each on lines of its own. */

export const CHECKLIST = '- [ ] \n- [ ] \n- [ ] ';
export const TABLE = '| Column | Column |\n| --- | --- |\n|  |  |';

/** `text` put in at `at` (the cursor), on its own lines; gives the page and where the cursor goes after. */
export function insertBlock(page: string, at: number, text: string): { page: string; cursor: number } {
  let i = Math.max(0, Math.min(at, page.length));
  // Never above the page's title.
  const titleEnd = /^# [^\n]*/.exec(page)?.[0].length ?? 0;
  if (i < titleEnd) i = titleEnd;
  const before = page.slice(0, i);
  const after = page.slice(i);
  const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail = after === '' ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const block = `${lead}${text}${tail}`;
  // Checklists and tables leave the cursor where the first thing is typed.
  const first = text.indexOf('- [ ] ') === 0 ? 6 : text.startsWith('| Column') ? 2 : text.length;
  return { page: before + block + after, cursor: before.length + lead.length + first };
}

/** A recording's words as a section of the page. */
export function recordingBlock(words: string, seconds: number, when: Date = new Date()): string {
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  return `### Recording · ${clock} · ${time}\n\n${words.trim() || '(nothing was heard)'}`;
}

/** A meeting's transcript as a section of the page: a heading with how long it ran and when it started, then what was said. */
export function meetingBlock(parts: string[], seconds: number, started: Date = new Date()): string {
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const time = `${String(started.getHours()).padStart(2, '0')}:${String(started.getMinutes()).padStart(2, '0')}`;
  const said = parts.map((p) => p.trim()).filter(Boolean);
  return `## Meeting · ${time} · ${clock}\n\n### Transcript\n\n${said.length ? said.join('\n\n') : '(nothing was heard)'}`;
}

/** Where a calendar event's meeting pages are kept. */
export const MEETINGS_NOTEBOOK = 'Meetings';

/** The page a calendar event's meeting is written in: named for its day and title, and saying which event it was. */
export function meetingNote(event: { title: string; start: string; end: string; allDay: boolean; calendar: string; location: string; attendees?: { name: string; email: string }[] }): { title: string; content: string } {
  const day = event.start.slice(0, 10);
  const name = (event.title.trim() || 'Meeting').replace(/[\\/:*?"<>|#[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const title = `${day} ${name}`.slice(0, 100);
  const when = event.allDay ? day : `${day}, ${event.start.slice(11, 16)}–${event.end.slice(11, 16)}`;
  const facts = [`Event: ${event.title.trim() || 'Meeting'}`, `When: ${when}`, `Calendar: ${event.calendar}`, ...(event.location.trim() ? [`Where: ${event.location.trim()}`] : []), ...(event.attendees?.length ? [`With: ${event.attendees.map((p) => p.name || p.email).join(', ')}`] : [])];
  return { title, content: `# ${title}\n\n${facts.join('  \n')}\n` };
}

/**
 * What Mobius is asked after a meeting: to fill in the notes the person typed from what was said, not to write a
 * summary of its own beside them. Their lines stay as they are; the actions go to Tasks too.
 */
export function meetingAsk(title: string, path: string): string {
  return `I just recorded a meeting into my note "${title}" (${path}); what was said is under the last "## Meeting" heading, in "### Transcript". `
    + 'Fill in my notes above that heading from it with files.edit. Under each line I typed, add what was said about it, as short points. '
    + 'Put each thing someone agreed to do as a - [ ] item with who and by when, under my Next steps or Actions heading, or under "## Next steps" at the end of my notes if I have neither. '
    + 'If I typed nothing above it, write short notes there from what was said. Never reword, move or remove a line I wrote, and leave the transcript as it is. '
    + 'Add each action to Tasks as well. Make the change without asking first: I keep or discard it.';
}

/** A web page kept in a note: its first paragraphs quoted, then where it came from. */
export function clipBlock(page: { url: string; title: string; text: string }, paragraphs = 3): string {
  const parts = page.text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !/^#{1,3}\s/.test(p)).slice(0, paragraphs);
  const quote = parts.join('\n\n').split('\n').map((l) => `> ${l}`.trimEnd()).join('\n');
  const title = (page.title || page.url).replace(/[[\]]/g, '');
  return `${quote || '> (no text on that page)'}\n\n— [${title}](${page.url})`;
}

/**
 * The editor's Markdown, written as people write it: one blank line between blocks and a newline at the end. An empty
 * paragraph (Enter twice) comes out of the editor as `&nbsp;`; in a note it is only a blank line.
 */
export const tidyMarkdown = (md: string) => `${md.replace(/^(?:&nbsp;| )$/gm, '').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
