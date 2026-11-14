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

/** A line or a block's words, as compared when Mobius's changes are found in the page: plain, single-spaced. */
export const plainLine = (text: string) => readableText(text).replace(/\s+/g, ' ').trim();

/**
 * Where each of Mobius's changes sits in the page. `lines` is the comparison of the document before and now, `groups`
 * which change each line belongs to (changeGroups), and `blocks` the page's paragraphs, headings and list items, in
 * order, as plain words. Lines are matched to blocks in order; a line with no block of its own (a table row, a picture)
 * is passed over, so a change there is shown without its marking rather than marking the wrong words.
 * Gives the blocks each change added, and where each change's note goes: before its first added block, else after the
 * last block before it, else before the first block after it (`block` -1: the top of the page).
 */
export function placeChanges(lines: readonly { kind: 'same' | 'added' | 'removed'; text: string }[], groups: readonly (number | null)[], blocks: readonly string[]): { added: Map<number, number>; notes: Map<number, { block: number; before: boolean }> } {
  const at: (number | null)[] = lines.map(() => null);
  let next = 0;
  lines.forEach((line, i) => {
    if (line.kind === 'removed') return;
    const words = plainLine(line.text);
    if (!words) return;
    for (let b = next; b < Math.min(blocks.length, next + 60); b++) {
      if (blocks[b] === words) { at[i] = b; next = b + 1; return; }
    }
  });
  const added = new Map<number, number>();
  const notes = new Map<number, { block: number; before: boolean }>();
  lines.forEach((line, i) => {
    const g = groups[i];
    if (g === null || g === undefined) return;
    if (line.kind === 'added' && at[i] !== null) added.set(at[i]!, g);
  });
  const ids = [...new Set(groups.filter((g): g is number => g !== null))];
  for (const g of ids) {
    const first = groups.indexOf(g);
    const own = lines.findIndex((l, i) => groups[i] === g && l.kind === 'added' && at[i] !== null);
    if (own >= 0) { notes.set(g, { block: at[own]!, before: true }); continue; }
    let found = false;
    for (let i = first - 1; i >= 0 && !found; i--) if (at[i] !== null && groups[i] !== g) { notes.set(g, { block: at[i]!, before: false }); found = true; }
    for (let i = first + 1; i < lines.length && !found; i++) if (at[i] !== null && groups[i] !== g) { notes.set(g, { block: at[i]!, before: true }); found = true; }
    if (!found) notes.set(g, { block: -1, before: true });
  }
  return { added, notes };
}

/** The text before Mobius's turn with one of its changes taken in: what "before" becomes when that change is kept. */
export function acceptGroup(lines: readonly { kind: 'same' | 'added' | 'removed'; text: string }[], groups: readonly (number | null)[], group: number): string {
  return lines
    .filter((line, i) => line.kind === 'same' || (groups[i] === group ? line.kind === 'added' : line.kind === 'removed'))
    .map((line) => line.text)
    .join('\n');
}
