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

/**
 * Which heading's part of the document is in view, from each heading's top measured from the top of the view: the last
 * one that has reached the top quarter of the view (the first heading while none has). At the end of the document the
 * last heading that shows is marked, since a short last part can never reach the top.
 */
export function headingInView(tops: readonly number[], height: number, atEnd: boolean): number {
  if (!tops.length) return -1;
  const line = atEnd ? height - 24 : Math.max(48, height / 4);
  let found = 0;
  tops.forEach((top, i) => { if (top <= line) found = i; });
  return found;
}

/** What the foot of a document counts, one at a time as in Pages. */
export type CountShown = 'words' | 'characters' | 'minutes';
export const COUNT_ORDER: CountShown[] = ['words', 'characters', 'minutes'];

/** The foot's count. Chosen words show as part of the whole, unless they are all of it. */
export function countLabel(shown: CountShown, stats: { words: number; characters: number; minutes: number }, chosen = 0): string {
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (shown === 'characters') return plural(stats.characters, 'character');
  if (shown === 'minutes') return `${stats.minutes} min read`;
  return chosen > 0 && chosen < stats.words ? `${chosen} of ${plural(stats.words, 'word')}` : plural(stats.words, 'word');
}
