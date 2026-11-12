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
