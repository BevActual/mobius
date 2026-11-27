import type { Notebook, NotePage } from '@mobius/shared';

/** A note a fact was taken from, named in its source as `Notes · <title>` or `Notes · <notebook> · <title>`. */
export interface NoteSource { notebook: string; page: NotePage }

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * The page a claim's source names, found among an app's notebooks by title (the notebook too, when it is named):
 * `Notes · <title>`, `Docs · <folder> · <title>`. When two pages share the title, the one changed last: it is the one
 * a search put first. Null for a source naming another app.
 */
export function pageForSource(source: string, app: string, notebooks: readonly Notebook[]): NoteSource | null {
  const parts = source.split('·').map((p) => p.trim());
  if (parts.length < 2 || !same(parts[0] ?? '', app)) return null;
  const title = parts.at(-1) ?? '';
  const inNotebook = parts.length > 2 ? parts.slice(1, -1).join(' · ') : null;
  if (!title) return null;
  let best: NoteSource | null = null;
  for (const nb of notebooks) {
    if (inNotebook !== null && !same(nb.name, inNotebook)) continue;
    for (const page of nb.pages) {
      if (same(page.title, title) && (!best || page.modified > best.page.modified)) best = { notebook: nb.name, page };
    }
  }
  return best;
}

/** The note a claim's source names (`Notes · <title>` or `Notes · <notebook> · <title>`). */
export const noteForSource = (source: string, notebooks: readonly Notebook[]): NoteSource | null => pageForSource(source, 'Notes', notebooks);

/** The task list a claim's source names: `Tasks · <list>`. */
export function listForSource(source: string, lists: readonly string[]): string | null {
  const parts = source.split('·').map((p) => p.trim());
  if (parts.length !== 2 || !same(parts[0] ?? '', 'Tasks')) return null;
  return lists.find((l) => same(l, parts[1] ?? '')) ?? null;
}

/** Words too common to tell lines apart (as notes.search leaves out). */
const COMMON = new Set(['a', 'about', 'after', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'they', 'this', 'to', 'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your']);
const wordsOf = (text: string): string[] => [...new Set(text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !COMMON.has(w)))];

/**
 * Which of a note's lines a fact was most likely taken from: those holding the most of its words, at most three. None
 * when no line holds at least half of them, so a loose match tints nothing rather than the wrong line.
 */
export function citedLines(lines: readonly string[], fact: string): number[] {
  const want = wordsOf(fact);
  if (!want.length) return [];
  const scores = lines.map((line) => { const have = new Set(wordsOf(line)); return want.filter((w) => have.has(w)).length; });
  const best = Math.max(0, ...scores);
  if (best === 0 || best < Math.ceil(want.length / 2)) return [];
  return scores.flatMap((s, i) => (s === best ? [i] : [])).slice(0, 3);
}

/** A note opened from a fact's card, waiting for its page to show so the fact's lines can be tinted there. */
let waiting: { path: string; fact: string } | null = null;
export const citeWhenOpen = (path: string, fact: string) => { waiting = { path, fact }; };
/** The fact waiting for `path`, taken once. */
export function takeCite(path: string | null | undefined): string | null {
  if (!waiting || !path || waiting.path !== path) return null;
  const { fact } = waiting;
  waiting = null;
  return fact;
}
