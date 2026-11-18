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
export function meetingNote(event: { title: string; start: string; end: string; allDay: boolean; calendar: string; location: string }): { title: string; content: string } {
  const day = event.start.slice(0, 10);
  const name = (event.title.trim() || 'Meeting').replace(/[\\/:*?"<>|#[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const title = `${day} ${name}`.slice(0, 100);
  const when = event.allDay ? day : `${day}, ${event.start.slice(11, 16)}–${event.end.slice(11, 16)}`;
  const facts = [`Event: ${event.title.trim() || 'Meeting'}`, `When: ${when}`, `Calendar: ${event.calendar}`, ...(event.location.trim() ? [`Where: ${event.location.trim()}`] : [])];
  return { title, content: `# ${title}\n\n${facts.join('  \n')}\n` };
}

/** What Mobius is asked after a meeting: a summary in the note, and the actions as tasks. */
export function meetingAsk(title: string, path: string): string {
  return `I just recorded a meeting into my note "${title}" (${path}); its transcript is under the last "## Meeting" heading. `
    + 'Above "### Transcript" in that section, add "### Summary" with a few lines on what was discussed and decided, then "### Actions" listing each action with who owns it. '
    + 'Add each action to Tasks as well. Change nothing else in the note.';
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
