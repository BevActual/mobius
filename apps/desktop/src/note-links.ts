import type { Notebook, NotePage } from '@mobius/shared';

/**
 * Links between notes are plain Markdown links to the page's file, so they work in any editor: `[Plan](Plan.md)` in
 * the same notebook, `[Plan](../Home/Plan.md)` in another, spaces written `%20`. The same rules as `links_in` in
 * `crates/mobius-workspace/src/notes.rs`.
 */
export function pageOfLink(href: string, from: string): string | null {
  const notebook = from.split('/')[0];
  let target: string;
  try { target = decodeURIComponent(href.trim().replace(/^<|>$/g, '')); } catch { return null; }
  if (!notebook || target.includes(':') || target.startsWith('/') || target.includes('\\') || !target.endsWith('.md')) return null;
  const path = target.startsWith('../') ? target.slice(3) : `${notebook}/${target.replace(/^\.\//, '')}`;
  const parts = path.split('/');
  if (parts.length !== 2 || !parts[0] || parts[0].startsWith('.') || parts[0] === '..' || !parts[1] || parts[1] === '.md') return null;
  return path;
}

/** The link from one page to another, as it is written in the page. */
export function linkTo(from: string, to: string): string {
  const [fromBook] = from.split('/');
  const [toBook, file] = to.split('/');
  return (toBook === fromBook ? file! : `../${to}`).replace(/ /g, '%20');
}

/** The pages that link to `path`, newest first. */
export function linkedFrom(notebooks: readonly Notebook[], path: string): (NotePage & { notebook: string })[] {
  return notebooks
    .flatMap((nb) => nb.pages.map((pg) => ({ ...pg, notebook: nb.name })))
    .filter((pg) => pg.path !== path && pg.links?.includes(path))
    .sort((a, b) => b.modified - a.modified);
}

/** Pages whose title has every word typed, for linking one: title starts first, then the rest, at most `max`. */
export function pagesMatching(notebooks: readonly Notebook[], query: string, except: string | undefined, max = 8): (NotePage & { notebook: string })[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = notebooks.flatMap((nb) => nb.pages.map((pg) => ({ ...pg, notebook: nb.name }))).filter((pg) => pg.path !== except);
  const hits = all.filter((pg) => words.every((w) => pg.title.toLowerCase().includes(w) || pg.notebook.toLowerCase().includes(w)));
  const first = words[0] ?? '';
  return hits.sort((a, b) => Number(!a.title.toLowerCase().startsWith(first)) - Number(!b.title.toLowerCase().startsWith(first)) || b.modified - a.modified).slice(0, max);
}

/** The pages a page links to, as `notebook/page.md`, each once; links in code and pictures are left out. */
export function linksIn(text: string, from: string): string[] {
  const plain = text.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
  const out: string[] = [];
  for (const m of plain.matchAll(/(!?)\[[^\]\n]*\]\(([^)\s]+)[^)\n]*\)/g)) {
    const page = m[1] ? null : pageOfLink(m[2]!, from);
    if (page && page !== from && !out.includes(page)) out.push(page);
  }
  return out;
}
