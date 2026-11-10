/**
 * `#tags` in a note, as Bear writes them: a `#` at the start of a word, then a letter, then letters, digits, `_`, `-`
 * or `/` (`#kestrel/p2`). Headings (`# Title`), `\#`, links (`page#part`) and code are not tags. The same rules as
 * `tags_in` in `crates/mobius-workspace/src/notes.rs`, which gives the sidebar every page's tags.
 */
const TAG = /(^|[\s(])#(\p{L}[\p{L}\p{N}_/-]*)/gu;
const MAX_TAGS = 50;

/** Each tag once (other case is the same tag), first spelling kept, sorted. */
export function tagsIn(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) { fenced = !fenced; continue; }
    if (fenced) continue;
    // Inline code is not read for tags.
    const plain = line.replace(/`[^`]*`?/g, (m) => ' '.repeat(m.length));
    for (const m of plain.matchAll(TAG)) {
      const tag = m[2]!.replace(/[-/]+$/, '').slice(0, 60);
      if (out.length < MAX_TAGS && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    }
  }
  return out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** Whether a page carries `tag`, or a tag under it (`#kestrel` holds `#kestrel/p2`). */
export function hasTag(tags: readonly string[] | undefined, tag: string): boolean {
  const want = tag.toLowerCase();
  return (tags ?? []).some((t) => { const l = t.toLowerCase(); return l === want || l.startsWith(`${want}/`); });
}

/** Every tag across the pages, with how many pages carry it, by name. */
export function tagCounts(pages: readonly { tags?: readonly string[] }[]): { tag: string; count: number }[] {
  const seen = new Map<string, { tag: string; count: number }>();
  for (const page of pages) {
    for (const tag of page.tags ?? []) {
      const key = tag.toLowerCase();
      const had = seen.get(key);
      if (had) had.count++; else seen.set(key, { tag, count: 1 });
    }
  }
  return [...seen.values()].sort((a, b) => a.tag.toLowerCase().localeCompare(b.tag.toLowerCase()));
}

const TAG_EVENT = 'mobius:notes-tag';
/** Show the pages with `tag` in the Notes sidebar (a tag clicked in a note). */
export const showTag = (tag: string): void => { window.dispatchEvent(new CustomEvent<string>(TAG_EVENT, { detail: tag })); };
export function onShowTag(handler: (tag: string) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<string>).detail);
  window.addEventListener(TAG_EVENT, listener);
  return () => window.removeEventListener(TAG_EVENT, listener);
}

/** Where each tag sits in a run of text, for marking it in the editor: `[start, end)` including the `#`. */
export function tagRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(TAG)) {
    const start = m.index! + m[1]!.length;
    const tag = m[2]!.replace(/[-/]+$/, '');
    out.push([start, start + 1 + tag.length]);
  }
  return out;
}
