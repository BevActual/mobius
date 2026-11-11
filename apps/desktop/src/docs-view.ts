/** Docs' small pieces of logic, kept apart from the editor so they can be tested. */

/** The Markdown as the words a reader sees: no marks, links as their words, pictures and code fences gone. */
export function readableText(markdown: string): string {
  return markdown
    .replace(/^```.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_~`|]/g, ' ');
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** Words, characters (not counting spaces), and minutes to read at 230 words a minute (at least one). */
export function docStats(markdown: string): { words: number; characters: number; minutes: number } {
  const text = readableText(markdown);
  const words = (text.match(WORD) ?? []).length;
  const characters = text.replace(/\s+/g, '').length;
  return { words, characters, minutes: Math.max(1, Math.round(words / 230)) };
}

/** Which heading the cursor is under: the last one that starts at or before it, or -1 before the first. */
export function activeHeading(outline: readonly { pos: number }[], at: number): number {
  let found = -1;
  outline.forEach((h, i) => { if (h.pos <= at) found = i; });
  return found;
}
