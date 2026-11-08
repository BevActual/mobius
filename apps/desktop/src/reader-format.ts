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

/** How the reader shows text: size and typeface, kept per device. */
export interface ReadingLook { size: 's' | 'm' | 'l'; face: 'sans' | 'serif' }
const LOOK_KEY = 'mobius.reader.look';
export function readLook(): ReadingLook {
  try {
    const v = JSON.parse(window.localStorage.getItem(LOOK_KEY) ?? 'null') as Partial<ReadingLook> | null;
    return { size: v?.size === 's' || v?.size === 'l' ? v.size : 'm', face: v?.face === 'serif' ? 'serif' : 'sans' };
  } catch { return { size: 'm', face: 'sans' }; }
}
export const keepLook = (look: ReadingLook) => { try { window.localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* Not kept. */ } };
