/**
 * Reader keeps pages to read later as Markdown in `reading/<list>/<article>.md`:
 *
 *     # Slow travel in Portugal
 *
 *     [example.com](https://example.com/slow-travel) · saved 2026-11-08 · 6 min read
 *
 *     ---
 *
 *     The article's text, with its headings, paragraphs, lists and quotes.
 *
 * The line under the title says where it came from; everything after the rule is the article.
 */
export const READING_LIST = 'Reading list';
export const ARCHIVE = 'Archive';

export const siteOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** About how long the text takes to read, at 230 words a minute, never less than one. */
export function readingMinutes(text: string): number {
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  return Math.max(1, Math.round(words / 230));
}

/** A one-line title: the page's own, else its address's site. */
export function articleTitle(title: string, url: string): string {
  const line = title.replace(/\s+/g, ' ').trim();
  return (line || siteOf(url)).slice(0, 150);
}

/** The file for a page fetched to read later. */
export function articleFile(page: { url: string; title: string; text: string }, saved: Date = new Date()): string {
  const title = articleTitle(page.title, page.url);
  // The page's own first heading repeats the title: left out.
  const body = page.text.replace(/^#{1,3}\s+(.+)\n*/, (whole, heading: string) => (heading.trim().toLowerCase() === title.toLowerCase() ? '' : whole)).trim();
  const day = `${saved.getFullYear()}-${String(saved.getMonth() + 1).padStart(2, '0')}-${String(saved.getDate()).padStart(2, '0')}`;
  return `# ${title}\n\n[${siteOf(page.url)}](${page.url}) · saved ${day} · ${readingMinutes(body)} min read\n\n---\n\n${body}\n`;
}

export interface Article { title: string; url: string | null; site: string | null; saved: string | null; minutes: number; body: string }

/** An article file read back; a page written some other way is all body. */
export function parseArticle(markdown: string): Article {
  const lines = markdown.split('\n');
  const titleAt = lines.findIndex((l) => /^#\s/.test(l));
  const title = titleAt >= 0 ? lines[titleAt]!.replace(/^#\s+/, '').trim() : '';
  const rule = lines.findIndex((l, i) => i > titleAt && /^(-{3,}|\*{3,})\s*$/.test(l.trim()));
  const head = rule >= 0 ? lines.slice(titleAt + 1, rule).join('\n') : '';
  const link = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/.exec(head);
  const saved = /saved (\d{4}-\d{2}-\d{2})/.exec(head)?.[1] ?? null;
  const body = (rule >= 0 ? lines.slice(rule + 1) : lines.filter((_, i) => i !== titleAt)).join('\n').trim();
  return { title, url: link?.[2] ?? null, site: link ? (link[1] || siteOf(link[2]!)) : null, saved, minutes: readingMinutes(body), body };
}

/** How the reader shows text, as in Safari Reader: size, typeface and page colour, kept per device. */
export interface ReadingLook { size: ReadingSize; face: 'sans' | 'serif'; theme: ReadingTheme }
export const READING_SIZES = ['xs', 's', 'm', 'l', 'xl'] as const;
export type ReadingSize = (typeof READING_SIZES)[number];
/** The page colours: `auto` follows Mobius's light or dark look; the others are the reader's own. */
export const READING_THEMES = ['auto', 'sepia', 'grey', 'night'] as const;
export type ReadingTheme = (typeof READING_THEMES)[number];
const LOOK_KEY = 'mobius.reader.look';
export function readLook(): ReadingLook {
  try {
    const v = JSON.parse(window.localStorage.getItem(LOOK_KEY) ?? 'null') as Partial<ReadingLook> | null;
    return {
      size: READING_SIZES.includes(v?.size as ReadingSize) ? v!.size! : 'm',
      face: v?.face === 'serif' ? 'serif' : 'sans',
      theme: READING_THEMES.includes(v?.theme as ReadingTheme) ? v!.theme! : 'auto',
    };
  } catch { return { size: 'm', face: 'sans', theme: 'auto' }; }
}
export const keepLook = (look: ReadingLook) => { try { window.localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* Not kept. */ } };

/** The next text size up (+1) or down (-1); the same size at either end. */
export function stepSize(size: ReadingSize, by: 1 | -1): ReadingSize {
  const at = READING_SIZES.indexOf(size);
  return READING_SIZES[Math.min(READING_SIZES.length - 1, Math.max(0, at + by))]!;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** When an article was saved, as a person says it: today, yesterday, a weekday this week, else the date. */
export function savedWhen(day: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const saved = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ago = Math.round((today.getTime() - saved.getTime()) / 86_400_000);
  if (ago === 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago > 1 && ago < 7) return DAYS[saved.getDay()]!;
  const date = `${MONTHS[saved.getMonth()]} ${saved.getDate()}`;
  return saved.getFullYear() === now.getFullYear() ? date : `${date}, ${saved.getFullYear()}`;
}

/** What is left of an article: its length before you start, the minutes left while reading, and the end. */
export function timeLeft(minutes: number, read: number): string {
  if (read < 0.02) return `${minutes} min read`;
  if (read > 0.98) return 'Finished';
  return `${Math.max(1, Math.ceil(minutes * (1 - read)))} min left`;
}

/** How far through each article you are, by path, kept per device so an article opens where you stopped. */
const PLACE_KEY = 'mobius.reader.place';
const PLACES_KEPT = 200;
export function readPlace(path: string): number {
  try { return Number((JSON.parse(window.localStorage.getItem(PLACE_KEY) ?? '{}') as Record<string, number>)[path]) || 0; } catch { return 0; }
}
export function keepPlace(path: string, read: number): void {
  try {
    const all = JSON.parse(window.localStorage.getItem(PLACE_KEY) ?? '{}') as Record<string, number>;
    delete all[path];
    all[path] = Math.round(Math.min(1, Math.max(0, read)) * 1000) / 1000;
    const paths = Object.keys(all);
    for (const old of paths.slice(0, Math.max(0, paths.length - PLACES_KEPT))) delete all[old];
    window.localStorage.setItem(PLACE_KEY, JSON.stringify(all));
  } catch { /* Not kept. */ }
}

/** The article with a passage marked as a highlight, `==passage==`; null when the passage is not in it as written. */
export function addHighlight(markdown: string, passage: string): string | null {
  const words = passage.replace(/\s+/g, ' ').trim();
  if (words.length < 2 || words.includes('==')) return null;
  const rule = markdown.search(/^(-{3,}|\*{3,})\s*$/m);
  const from = rule < 0 ? 0 : rule;
  const at = markdown.indexOf(words, from);
  if (at < 0) return null;
  return `${markdown.slice(0, at)}==${words}==${markdown.slice(at + words.length)}`;
}

/** The article with one highlight taken off again. */
export function removeHighlight(markdown: string, passage: string): string {
  const at = markdown.indexOf(`==${passage}==`);
  return at < 0 ? markdown : `${markdown.slice(0, at)}${passage}${markdown.slice(at + passage.length + 4)}`;
}

/** The highlights in an article, in order. */
export const highlightsOf = (markdown: string): string[] => [...markdown.matchAll(/==(?=\S)([^=\n]*?\S)==/g)].map((m) => m[1]!);
